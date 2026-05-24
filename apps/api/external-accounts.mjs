// External chess-account public-API fetchers.
//
// Both providers expose unauthenticated, read-only endpoints. The fetch path
// gets "claimed-tier" data: real stats, but no proof *this* Horsey user owns
// the handle. The verification path raises a row to "verified" by reading a
// Horsey-issued token out of the user's public profile fields. See
// docs/IMPLEMENTATION_PLAN.md § Trust Tiers for the model.

import { randomBytes } from "node:crypto";

export const PROVIDERS = ["lichess", "chesscom"];
export const CLAIMED_SEED_CAP = 1800;
export const VERIFIED_SEED_CAP = 2400;
// Calibration scales with how much prior information we had at link time.
// See docs/IMPLEMENTATION_PLAN.md § Trust Tiers / Calibration scales with tier.
export const CALIBRATING_GAMES_BY_TIER = {
  provisional: 10,
  claimed: 5,
  verified: 3,
  established: 0
};
export const CLAIM_TOKEN_TTL_MS = 30 * 60 * 1000;

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "horsey-dev (+local development)";
const HANDLE_PATTERN = /^[a-zA-Z0-9_-]{2,30}$/;

export class ExternalAccountError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function normalizeProvider(value) {
  if (!PROVIDERS.includes(value)) {
    throw new ExternalAccountError("invalid_provider", "provider must be 'lichess' or 'chesscom'");
  }
  return value;
}

export function normalizeHandle(value) {
  if (typeof value !== "string") {
    throw new ExternalAccountError("invalid_external_handle", "handle is required");
  }
  const trimmed = value.trim();
  if (!HANDLE_PATTERN.test(trimmed)) {
    throw new ExternalAccountError(
      "invalid_external_handle",
      "handle must be 2-30 chars: letters, digits, _ or -"
    );
  }
  return trimmed;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow"
    });
    if (response.status === 404) {
      throw new ExternalAccountError("external_handle_not_found", "handle not found on provider");
    }
    if (response.status === 429) {
      throw new ExternalAccountError("external_rate_limited", "provider rate-limited the request");
    }
    if (!response.ok) {
      throw new ExternalAccountError(
        "external_fetch_failed",
        `provider returned ${response.status}`
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ExternalAccountError) throw error;
    if (error.name === "AbortError") {
      throw new ExternalAccountError("external_fetch_timeout", "provider request timed out");
    }
    throw new ExternalAccountError("external_fetch_failed", error.message || "fetch failed");
  } finally {
    clearTimeout(timeout);
  }
}

function ratingsFromLichessPerfs(perfs) {
  if (!perfs || typeof perfs !== "object") return null;
  const pick = (key) => {
    const perf = perfs[key];
    if (!perf || typeof perf.rating !== "number") return null;
    return { rating: perf.rating, games: perf.games ?? null, provisional: !!perf.prov };
  };
  return {
    bullet: pick("bullet"),
    blitz: pick("blitz"),
    rapid: pick("rapid"),
    classical: pick("classical")
  };
}

async function fetchLichess(handle) {
  const data = await fetchJson(`https://lichess.org/api/user/${encodeURIComponent(handle)}`);
  if (!data || typeof data !== "object") {
    throw new ExternalAccountError("external_fetch_failed", "unexpected response shape");
  }
  return {
    externalId: data.id || null,
    externalUsername: data.username || handle,
    accountCreatedAt: typeof data.createdAt === "number" ? new Date(data.createdAt).toISOString() : null,
    title: data.title || null,
    ratings: ratingsFromLichessPerfs(data.perfs),
    raw: { perfs: data.perfs ?? null, createdAt: data.createdAt ?? null, title: data.title ?? null }
  };
}

function ratingFromChessComCategory(category) {
  if (!category || typeof category !== "object") return null;
  const last = category.last;
  if (!last || typeof last.rating !== "number") return null;
  const wins = category.record?.win ?? 0;
  const losses = category.record?.loss ?? 0;
  const draws = category.record?.draw ?? 0;
  return {
    rating: last.rating,
    games: wins + losses + draws,
    provisional: null
  };
}

async function fetchChessCom(handle) {
  const lower = handle.toLowerCase();
  const profile = await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(lower)}`);
  if (!profile || typeof profile !== "object") {
    throw new ExternalAccountError("external_fetch_failed", "unexpected response shape");
  }
  const stats = await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(lower)}/stats`);
  return {
    externalId: profile.player_id != null ? String(profile.player_id) : null,
    externalUsername: profile.username || lower,
    accountCreatedAt: typeof profile.joined === "number" ? new Date(profile.joined * 1000).toISOString() : null,
    title: profile.title || null,
    ratings: {
      bullet: ratingFromChessComCategory(stats.chess_bullet),
      blitz: ratingFromChessComCategory(stats.chess_blitz),
      rapid: ratingFromChessComCategory(stats.chess_rapid),
      classical: ratingFromChessComCategory(stats.chess_daily)
    },
    raw: { profile, stats }
  };
}

export async function fetchProviderProfile(provider, handle) {
  const p = normalizeProvider(provider);
  const h = normalizeHandle(handle);
  if (p === "lichess") return fetchLichess(h);
  return fetchChessCom(h);
}

// Fields we scan for a verification token. Only Lichess exposes a
// user-editable text field via its public API — the bio. Chess.com's
// public API has no equivalent (the "About me" field isn't in the API,
// and the name/location fields aren't editable on all account tiers).
// Chess.com verification will need a different mechanism (OAuth, club
// name, or similar) and is intentionally not handled here.
const SEARCHABLE_PROFILE_FIELDS = {
  lichess: (raw) => {
    const p = raw?.profile ?? {};
    return [p.bio, p.firstName, p.lastName, p.location, p.realName]
      .filter((x) => typeof x === "string");
  }
};

export function searchableTextFromProviderRaw(provider, raw) {
  const fn = SEARCHABLE_PROFILE_FIELDS[provider];
  if (!fn) return "";
  return fn(raw).join("\n");
}

// We need the provider's raw profile (not the normalized shape) to scan its
// free-text fields. This is a small re-fetch that only runs on explicit
// verify-check calls.
export async function fetchProviderRawProfile(provider, handle) {
  const p = normalizeProvider(provider);
  const h = normalizeHandle(handle);
  if (p === "lichess") {
    return await fetchJson(`https://lichess.org/api/user/${encodeURIComponent(h)}`);
  }
  const lower = h.toLowerCase();
  return await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(lower)}`);
}

// Crockford base32 minus the visually-ambiguous chars (I, L, O, U). 8 chars
// of entropy from this alphabet ~= 40 bits — plenty for a per-account
// short-TTL claim, and small enough to paste into a profile field without
// looking like spam.
const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateClaimToken() {
  let body = "";
  const buf = randomBytes(8);
  for (let i = 0; i < 8; i += 1) {
    body += TOKEN_ALPHABET[buf[i] % TOKEN_ALPHABET.length];
  }
  return `horsey-${body}`;
}

export function newClaimTokenExpiry(nowMs = Date.now()) {
  return new Date(nowMs + CLAIM_TOKEN_TTL_MS).toISOString();
}

export function isClaimTokenExpired(expiresAt, nowMs = Date.now()) {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) <= nowMs;
}

export function findTokenInRawProfile(provider, raw, token) {
  if (typeof token !== "string" || !token) return false;
  const hay = searchableTextFromProviderRaw(provider, raw).toLowerCase();
  return hay.includes(token.toLowerCase());
}

// Blitz-only rating seed, capped by the account's status (claimed → 1800,
// verified → 2400). Mirrors the policy in IMPLEMENTATION_PLAN.md § Trust
// Tiers. Returns null when no linked account has a blitz rating to seed
// from — in that case the caller should leave the Horsey rating alone.
export function claimedSeedFromAccounts(accounts) {
  // Prefer a verified account first; fall back to claimed (or pending) within
  // the lower cap.
  const ordered = ["verified", "claimed"];
  const statusMatchers = {
    verified: (s) => s === "verified",
    claimed: (s) => s === "claimed" || s === "verification_pending"
  };
  for (const status of ordered) {
    for (const provider of ["lichess", "chesscom"]) {
      const account = accounts.find((a) => a.provider === provider && statusMatchers[status](a.status));
      const blitz = account?.importedStats?.ratings?.blitz?.rating;
      if (typeof blitz === "number" && blitz > 0) {
        const cap = status === "verified" ? VERIFIED_SEED_CAP : CLAIMED_SEED_CAP;
        return Math.min(cap, Math.round(blitz));
      }
    }
  }
  return null;
}

export function isCalibrating(finishedGames, tier = "provisional") {
  const threshold = CALIBRATING_GAMES_BY_TIER[tier] ?? CALIBRATING_GAMES_BY_TIER.provisional;
  return (finishedGames ?? 0) < threshold;
}

export function calibratingThresholdForTier(tier) {
  return CALIBRATING_GAMES_BY_TIER[tier] ?? CALIBRATING_GAMES_BY_TIER.provisional;
}

export function publicExternalAccountPayload(account) {
  if (!account) return null;
  const ratings = account.importedStats?.ratings ?? null;
  return {
    id: account.id,
    provider: account.provider,
    username: account.externalUsername,
    status: account.status,
    verifiedAt: account.verifiedAt,
    lastSyncedAt: account.lastSyncedAt,
    title: account.importedStats?.title ?? null,
    ratings: ratings
      ? {
          bullet: ratings.bullet?.rating ?? null,
          blitz: ratings.blitz?.rating ?? null,
          rapid: ratings.rapid?.rating ?? null,
          classical: ratings.classical?.rating ?? null
        }
      : null
  };
}
