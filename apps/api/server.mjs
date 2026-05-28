import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { openDatabase } from "./db.mjs";
import { CHANNELS, createBroker } from "./realtime.mjs";
import { SIGNUP_DEFAULT_RATING, SIGNUP_GRANT_CENTS } from "./seed.mjs";
import {
  EMAIL_VERIFY_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  generateEmailToken,
  generateSessionToken,
  hashEmailToken,
  hashPassword,
  isEmailTokenExpired,
  isSessionExpired,
  newEmailTokenExpiry,
  newSessionExpiry,
  SESSION_TTL_MS,
  validateEmailInput,
  validateLoginInput,
  validatePasswordInput,
  validateSignupInput,
  verifyPassword
} from "./auth.mjs";
import {
  emailDeliveryConfig,
  passwordResetBody,
  sendEmail,
  verifyEmailBody
} from "./email.mjs";
import { applyMove, STARTING_FEN, summarizeGame } from "../../packages/chess/src/board.mjs";
import {
  abortGameSettlement,
  adjustGameSettlement,
  calculatePot,
  createEscrowHold,
  findSettlementEntries,
  settleGame,
  transitionChallenge,
  voidGameSettlement,
  walletSummary
} from "../../packages/shared/domain.mjs";
import {
  applyMoveToClock,
  FIRST_MOVE_DEADLINE_MS,
  flaggedSide,
  initClockState,
  msUntilFlag,
  parseTimeControl
} from "../../packages/shared/clocks.mjs";
import { computeRatingChange } from "../../packages/shared/rating.mjs";
import {
  computeTrustTier,
  effectiveStakeCapCents,
  isValidTierFloor,
  meetsTierFloor,
  stakeCapForTier,
  TIER_FLOORS
} from "../../packages/shared/trust.mjs";
import { detectMilestonesForGame, publicMilestonePayload } from "./milestones.mjs";
import {
  AVATAR_CATALOG,
  avatarsForMilestone,
  DEFAULT_AVATAR_ID,
  getAvatar,
  isValidAvatarId
} from "../../packages/shared/avatars.mjs";
import {
  calibratingThresholdForTier,
  claimedSeedFromAccounts,
  ExternalAccountError,
  fetchProviderProfile,
  fetchProviderRawProfile,
  findTokenInRawProfile,
  generateClaimToken,
  isCalibrating,
  isClaimTokenExpired,
  newClaimTokenExpiry,
  normalizeProvider,
  publicExternalAccountPayload
} from "./external-accounts.mjs";
import { createPresenceRegistry } from "../../packages/shared/presence.mjs";
import {
  acceptDraw,
  clearOwnOffer,
  declineDraw,
  offerDraw
} from "../../packages/shared/draw-offers.mjs";
import { logger, nextRequestId } from "./logger.mjs";
import {
  TOS_VERSION,
  TOS_TITLE,
  TOS_SECTIONS,
  needsTosAcceptance
} from "../../packages/shared/tos.mjs";
import {
  CHIP_PACKAGES,
  PAYMENT_PROVIDER,
  SUPPORTED_PAY_CURRENCIES,
  packageById,
  mapNowPaymentsStatus
} from "../../packages/shared/payments.mjs";
import { createInvoice, verifyIpnSignature } from "./payments.mjs";
import {
  isValidRestriction,
  RESTRICTION_LADDER
} from "../../packages/shared/restrictions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const webDir = path.join(rootDir, "apps/web");
const port = Number.parseInt(process.env.PORT || "8787", 10);
const host = process.env.HOST || "127.0.0.1";
const dbPath = process.env.HORSEY_DB_PATH || path.join(rootDir, "data/horsey.db");

const db = openDatabase(dbPath);
const broker = createBroker();
const presence = createPresenceRegistry();
const enableDevFinalize = process.env.HORSEY_ENABLE_DEV_FINALIZE === "1";
const enableDevAccountPicker = process.env.HORSEY_ENABLE_DEV_ACCOUNT_PICKER === "1";
// Payments v1 kill switch (ADR 0007). Default 0 so chip purchases stay
// dark until ops explicitly flips them on per-environment.
const paymentsEnabled = process.env.HORSEY_PAYMENTS_ENABLED === "1";
const devAccountPassword = process.env.HORSEY_DEV_ACCOUNT_PASSWORD || "password123";
const enableDevBots =
  process.env.HORSEY_ENABLE_DEV_BOTS === "1" && process.env.NODE_ENV !== "production";
let botDaemon = null;
const rateLimits = new Map();

const RATE_LIMITS = {
  auth: { limit: 12, windowMs: 60_000 },
  challenge: { limit: 30, windowMs: 60_000 },
  matchmaking: { limit: 40, windowMs: 60_000 },
  externalAccounts: { limit: 8, windowMs: 60_000 },
  emailLink: { limit: 5, windowMs: 60 * 60_000 }
};

const EMAIL_LINK_PER_USER_WINDOW_MS = 60 * 60_000;
const EMAIL_LINK_PER_USER_LIMIT = 5;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function notFound(res) { json(res, 404, { error: "not_found" }); }

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(firstForwarded || req.socket?.remoteAddress || "local").split(",")[0].trim();
}

function checkRateLimit(req, bucket) {
  const config = RATE_LIMITS[bucket];
  if (!config) return;
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + config.windowMs });
    return;
  }
  current.count += 1;
  if (current.count > config.limit) {
    const e = new RangeError("Too many attempts. Try again shortly.");
    e.code = "rate_limited";
    e.retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
    throw e;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function moveRows(moves) {
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push([moves[i]?.san ?? "", moves[i + 1]?.san ?? ""]);
  }
  return rows;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

// Per-game spectator tracker. A "watcher" is a viewer subscribed to the game
// channel who is NOT one of the game's two players. Multiple tabs/sessions
// for the same viewer collapse to one watcher via the per-viewer ref count.
//
// We can't derive this from broker.channelSize because that count blends
// player and spectator subscriptions; for the lobby liveness payload we want
// only the spectator side.
const watchers = new Map(); // gameId -> Map<viewerId, refCount>

function watcherCountForGame(gameId) {
  return watchers.get(gameId)?.size ?? 0;
}

function addWatcher(gameId, viewerId) {
  let m = watchers.get(gameId);
  if (!m) { m = new Map(); watchers.set(gameId, m); }
  const previousSize = m.size;
  m.set(viewerId, (m.get(viewerId) ?? 0) + 1);
  return m.size !== previousSize;
}

function removeWatcher(gameId, viewerId) {
  const m = watchers.get(gameId);
  if (!m) return false;
  const cur = m.get(viewerId) ?? 0;
  if (cur <= 0) return false;
  if (cur === 1) {
    m.delete(viewerId);
    if (m.size === 0) watchers.delete(gameId);
    return true;
  }
  m.set(viewerId, cur - 1);
  return false;
}

function publishWatcherCount(gameId) {
  broker.publish(CHANNELS.game(gameId), {
    type: "spectators.changed",
    gameId,
    watcherCount: watcherCountForGame(gameId)
  });
  publishLobbyHeartbeat();
}

function recordGameEvent(gameId, type, payload = {}) {
  db.appendGameEvent({
    id: newId("evt"),
    gameId,
    type,
    payload,
    occurredAt: new Date().toISOString()
  });
}

function enrichGame(game) {
  if (!game) return null;
  const moves = game.moves || [];
  const summary = summarizeGame(game.fen);
  const playersWithPresence = (game.players || []).map((player) => {
    const live = db.getUser(player.id);
    return {
      ...player,
      presence: presence.snapshot(player.id),
      trustTier: trustTierForUser(player.id),
      equippedAvatar: live?.equippedAvatar ?? DEFAULT_AVATAR_ID
    };
  });
  return {
    ...summary,
    ...game,
    players: playersWithPresence,
    moveNumber: Math.floor(moves.length / 2) + 1,
    lastMove: moves[moves.length - 1] || null,
    moveRows: moveRows(moves),
    watcherCount: watcherCountForGame(game.id)
  };
}

const SESSION_COOKIE = "horsey_session";
// When running behind a TLS-terminating proxy (Fly's edge, a reverse proxy,
// or NODE_ENV=production), emit `Secure` so the cookie only flows over HTTPS.
// Local dev over http://127.0.0.1:8787 keeps the cookie working without TLS.
const useSecureCookie =
  process.env.HORSEY_TRUST_PROXY === "1" || process.env.NODE_ENV === "production";
const secureAttr = useSecureCookie ? "; Secure" : "";

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureAttr}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr}`
  );
}

function unauthenticatedError(message = "sign in required") {
  const e = new RangeError(message);
  e.code = "unauthenticated";
  return e;
}

function viewerFromSessionToken(token) {
  if (!token) throw unauthenticatedError();
  const session = db.getSession(token);
  if (!session || isSessionExpired(session)) {
    if (session) db.deleteSession(token);
    throw unauthenticatedError();
  }
  const user = db.getUser(session.userId);
  if (!user) {
    db.deleteSession(token);
    throw unauthenticatedError();
  }
  return user;
}

function resolveViewer(req) {
  return viewerFromSessionToken(parseCookies(req)[SESSION_COOKIE]);
}

function publishGameUpdated(game) {
  if (!game) return;
  broker.publish(CHANNELS.game(game.id), { type: "game.updated", game: enrichGame(game) });
}

function publishGameFinalized(game) {
  if (!game) return;
  const enriched = enrichGame(game);
  broker.publish(CHANNELS.game(game.id), { type: "game.finalized", game: enriched });
  for (const player of game.players) {
    broker.publish(CHANNELS.user(player.id), { type: "game.finalized", gameId: game.id });
  }
  publishLobbyHeartbeat();
}

function emitNotification(args) {
  const { inserted, notification } = db.upsertNotification(args);
  broker.publish(CHANNELS.user(notification.userId), {
    type: inserted ? "notification.created" : "notification.updated",
    notification
  });
  return notification;
}

function moneyShort(cents) {
  if (typeof cents !== "number") return "";
  return `$${Math.round(cents / 100)}`;
}

// Drive challenge notifications off of the challenge state machine. Open-table
// (recipient-less) challenges don't notify — they'd fan out to every viewer
// and drown the bell.
function upsertChallengeNotifications(challenge) {
  if (!challenge.recipientId) return;
  const challenger = db.getUser(challenge.challengerId);
  const recipient = db.getUser(challenge.recipientId);
  if (!challenger || !recipient) return;
  const stake = moneyShort(challenge.stakeCents);
  const tc = challenge.timeControl;
  const baseData = {
    challengeId: challenge.id,
    stakeCents: challenge.stakeCents,
    timeControl: challenge.timeControl,
    route: `wager/${challenge.id}`
  };

  if (challenge.state === "incoming") {
    emitNotification({
      userId: challenge.recipientId,
      type: "challenge_received",
      entityType: "challenge",
      entityId: challenge.id,
      status: "pending",
      title: `${challenger.handle} challenged you · ${stake} · ${tc}`,
      data: baseData
    });
    return;
  }

  if (challenge.state === "countered") {
    emitNotification({
      userId: challenge.challengerId,
      type: "challenge_countered",
      entityType: "challenge",
      entityId: challenge.id,
      status: "pending",
      title: `${recipient.handle} countered · ${stake} · ${tc}`,
      data: baseData
    });
    return;
  }

  // Terminal states: only update existing rows (don't create new ones — the
  // party who never had a pending row doesn't need a "this thing they weren't
  // tracking is now resolved" entry).
  if (["accepted", "declined", "expired"].includes(challenge.state)) {
    for (const userId of [challenge.recipientId, challenge.challengerId]) {
      const existing = db.findNotificationForEntity(userId, "challenge", challenge.id);
      if (!existing) continue;
      const isSelfActor = pickTerminalActor(challenge) === userId;
      // If the user was the actor (they accepted/declined themselves), don't
      // re-flag the row unread — they know. Preserve read_at by re-upserting
      // with the same status no-op... actually status changed, so we need to
      // mark-read after the upsert if the actor.
      const other = userId === challenge.recipientId ? challenger : recipient;
      const verbForOther = {
        accepted: `${other.handle} accepted your challenge`,
        declined: `${other.handle} declined your challenge`,
        expired: `Challenge with ${other.handle} expired`
      }[challenge.state];
      const verbForSelf = {
        accepted: `Accepted ${other.handle}'s challenge`,
        declined: `Declined ${other.handle}'s challenge`,
        expired: `Your challenge with ${other.handle} expired`
      }[challenge.state];
      const note = emitNotification({
        userId,
        type: existing.type,
        entityType: "challenge",
        entityId: challenge.id,
        status: challenge.state,
        title: isSelfActor ? verbForSelf : verbForOther,
        data: existing.data || baseData
      });
      if (isSelfActor && note && !note.readAt) {
        db.markNotificationRead(userId, note.id);
      }
    }
  }
}

function pickTerminalActor(challenge) {
  // Inferred from prior responder: if the challenge was 'incoming', the
  // responder was the recipient; if it was 'countered', the responder was
  // the challenger. We can't query history reliably, but for accepted /
  // declined the actor's user-id is who performed the action. We approximate:
  // when the metadata is set by transitionChallenge it carries hints.
  // Fallback: assume recipient is the actor (the common path).
  return challenge.acceptedBy || challenge.declinedBy || challenge.recipientId;
}

function publishChallengeCreated(challenge) {
  if (challenge.recipientId) {
    broker.publish(CHANNELS.user(challenge.recipientId), {
      type: "challenge.created",
      challenge: challengePayload(challenge, challenge.recipientId)
    });
  }
  broker.publish(CHANNELS.user(challenge.challengerId), {
    type: "challenge.created",
    challenge: challengePayload(challenge, challenge.challengerId)
  });
  upsertChallengeNotifications(challenge);
}

function publishChallengeUpdated(challenge) {
  const recipients = new Set([challenge.challengerId]);
  if (challenge.recipientId) recipients.add(challenge.recipientId);
  for (const userId of recipients) {
    broker.publish(CHANNELS.user(userId), {
      type: "challenge.updated",
      challenge: challengePayload(challenge, userId)
    });
  }
  upsertChallengeNotifications(challenge);
}

function publishPresenceChanged(userId) {
  const snapshot = presence.snapshot(userId);
  const payload = {
    type: "presence.changed",
    userId,
    online: snapshot.online,
    lastSeenAt: snapshot.lastSeenAt
  };
  const liveGame = db.findLiveGameForUser(userId);
  if (!liveGame) return;
  for (const player of liveGame.players) {
    if (player.id === userId) continue;
    broker.publish(CHANNELS.user(player.id), payload);
  }
}

function lobbyLiveGameProjection(game) {
  return {
    id: game.id,
    players: (game.players || []).map((p) => {
      const live = db.getUser(p.id);
      return {
        id: p.id,
        handle: p.handle,
        rating: p.rating,
        trustTier: trustTierForUser(p.id),
        equippedAvatar: live?.equippedAvatar ?? DEFAULT_AVATAR_ID
      };
    }),
    stakeCents: game.pot?.stakeCents ?? 0,
    timeControl: game.timeControl,
    moveCount: (game.moves || []).length,
    startedAt: game.createdAt,
    watcherCount: watcherCountForGame(game.id)
  };
}

function listLobbyLiveGames(limit = 8) {
  return db.listLiveGames()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit)
    .map(lobbyLiveGameProjection);
}

let lastHeartbeatSnapshot = null;
function computeLobbyLiveness() {
  return {
    onlineCount: presence.onlineCount(),
    activeGames: db.countLiveGames(),
    liveGames: listLobbyLiveGames(8)
  };
}

function publishLobbyHeartbeat({ force = false } = {}) {
  const snapshot = computeLobbyLiveness();
  const liveGamesChanged = JSON.stringify(lastHeartbeatSnapshot?.liveGames ?? null) !== JSON.stringify(snapshot.liveGames);
  if (!force && lastHeartbeatSnapshot
      && lastHeartbeatSnapshot.onlineCount === snapshot.onlineCount
      && lastHeartbeatSnapshot.activeGames === snapshot.activeGames
      && !liveGamesChanged) {
    return;
  }
  lastHeartbeatSnapshot = snapshot;
  broker.publish(CHANNELS.lobby, {
    type: "lobby.heartbeat",
    onlineCount: snapshot.onlineCount,
    activeGames: snapshot.activeGames,
    liveGames: snapshot.liveGames
  });
}

function publishMatchmakingMatched(game) {
  if (!game) return;
  const enriched = enrichGame(game);
  for (const player of game.players) {
    broker.publish(CHANNELS.user(player.id), {
      type: "matchmaking.matched",
      game: enriched
    });
  }
  publishLobbyHeartbeat();
}

function viewerPayload(viewerId) {
  const user = db.getUser(viewerId);
  const games = db.listFinalizedGamesForUser(viewerId, 50);
  const milestones = db.listUserMilestones(viewerId).map(publicMilestonePayload);
  const latestTos = db.getLatestTosAcceptance(viewerId);
  return {
    ...user,
    ...walletSummary(db.listLedger(), viewerId),
    ...trustChipsForUser(viewerId),
    stats: aggregateUserStats(viewerId, games),
    milestones,
    ownedAvatarIds: db.listUserAvatarsForUser(viewerId).map((a) => a.avatarId),
    tos: {
      currentVersion: TOS_VERSION,
      latestAcceptedVersion: latestTos?.tosVersion ?? null,
      latestAcceptedAt: latestTos?.acceptedAt ?? null,
      needsAcceptance: needsTosAcceptance(latestTos?.tosVersion ?? null)
    }
  };
}

function normalizeTierPref(value) {
  if (value === undefined || value === null || value === "") return "any";
  if (!isValidTierFloor(value)) {
    const e = new RangeError(`tierPref must be one of: ${TIER_FLOORS.join(", ")}`);
    e.code = "invalid_tier_pref";
    throw e;
  }
  return value;
}

function trustTierForUser(userId) {
  const finishedGames = db.listFinalizedGamesForUser(userId, 50).length;
  const accounts = db.listExternalAccountsForUser(userId);
  return computeTrustTier({ externalAccounts: accounts, finishedGames });
}

function requireStakeWithinCap(stakeCents, viewerId, opponentId = null) {
  const viewerTier = trustTierForUser(viewerId);
  const opponentTier = opponentId ? trustTierForUser(opponentId) : null;
  const cap = effectiveStakeCapCents(viewerTier, opponentTier);
  if (stakeCents > cap) {
    const e = new RangeError(
      opponentTier
        ? `Stake exceeds the lower of the two players' trust caps ($${(cap / 100).toFixed(0)}). Verify your chess account to raise the limit.`
        : `Stake exceeds your trust-tier cap ($${(cap / 100).toFixed(0)}). Verify your chess account to raise the limit.`
    );
    e.code = "stake_exceeds_trust_cap";
    throw e;
  }
}

function trustChipsForUser(userId) {
  // Cap the count at the established threshold so we never load 50+ rows just
  // to ask "is this user calibrating?". listFinalizedGamesForUser already
  // accepts a limit.
  const finishedGames = db.listFinalizedGamesForUser(userId, 50).length;
  const accounts = db.listExternalAccountsForUser(userId);
  const trustTier = computeTrustTier({ externalAccounts: accounts, finishedGames });
  return {
    calibrating: isCalibrating(finishedGames, trustTier),
    calibratingThreshold: calibratingThresholdForTier(trustTier),
    finishedGames,
    externalAccounts: accounts.map(publicExternalAccountPayload),
    trustTier,
    stakeCapCents: stakeCapForTier(trustTier)
  };
}

async function linkExternalAccount(viewer, body) {
  const provider = normalizeProvider(body?.provider);
  if (db.getExternalAccountByProvider(viewer.id, provider)) {
    throw new ExternalAccountError("external_account_taken", "this provider is already linked");
  }
  const fetched = await fetchProviderProfile(provider, body?.username);
  const now = new Date().toISOString();
  const account = {
    id: newId("ext"),
    userId: viewer.id,
    provider,
    externalUsername: fetched.externalUsername,
    externalId: fetched.externalId,
    status: "claimed",
    importedStats: {
      ratings: fetched.ratings,
      title: fetched.title,
      accountCreatedAt: fetched.accountCreatedAt
    },
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now
  };

  let seededTo = null;
  db.transaction(() => {
    db.insertExternalAccount(account);
    // Apply claimed-tier seed only when the user has no Horsey games yet.
    // Once any game has finalized, the on-platform K-factor owns the rating.
    const horseyGames = db.listFinalizedGamesForUser(viewer.id, 1).length;
    if (horseyGames === 0) {
      const accounts = db.listExternalAccountsForUser(viewer.id);
      const seed = claimedSeedFromAccounts(accounts);
      if (seed != null && seed !== db.getUser(viewer.id).rating) {
        db.updateUserRating(viewer.id, seed);
        seededTo = seed;
      }
    }
    // A successful link counts as completing onboarding (idempotent).
    db.markOnboardingCompleted(viewer.id);
  })();
  return { account: db.getExternalAccount(account.id), seededTo };
}

function unlinkExternalAccount(viewer, accountId) {
  const account = db.getExternalAccount(accountId);
  if (!account || account.userId !== viewer.id) {
    throw new ExternalAccountError("external_account_not_found", "linked account not found");
  }
  db.deleteExternalAccount(accountId);
  return account;
}

function requireOwnedAccount(viewer, accountId) {
  const account = db.getExternalAccount(accountId);
  if (!account || account.userId !== viewer.id) {
    throw new ExternalAccountError("external_account_not_found", "linked account not found");
  }
  return account;
}

function startVerification(viewer, accountId, { regenerate = false } = {}) {
  const account = requireOwnedAccount(viewer, accountId);
  if (account.status === "verified") {
    throw new ExternalAccountError("external_account_already_verified", "this account is already verified");
  }
  // Default: idempotent — return the existing token so clicking Verify a
  // second time doesn't invalidate the one the user already pasted.
  // regenerate=true forces a fresh token (used by the "Get new token" link).
  let claimToken = account.claimToken;
  let claimTokenExpiresAt = account.claimTokenExpiresAt;
  const needsNew = regenerate || !claimToken || isClaimTokenExpired(claimTokenExpiresAt);
  if (needsNew) {
    claimToken = generateClaimToken();
    claimTokenExpiresAt = newClaimTokenExpiry();
    db.updateExternalAccountClaimToken(account.id, {
      status: "verification_pending",
      claimToken,
      claimTokenExpiresAt
    });
  } else if (account.status !== "verification_pending") {
    db.updateExternalAccountClaimToken(account.id, {
      status: "verification_pending",
      claimToken,
      claimTokenExpiresAt
    });
  }
  return {
    account: db.getExternalAccount(account.id),
    claimToken,
    claimTokenExpiresAt
  };
}

async function checkVerification(viewer, accountId) {
  const account = requireOwnedAccount(viewer, accountId);
  if (account.status === "verified") {
    throw new ExternalAccountError("external_account_already_verified", "this account is already verified");
  }
  if (!account.claimToken) {
    throw new ExternalAccountError("claim_token_missing", "no verification in progress — start one first");
  }
  if (isClaimTokenExpired(account.claimTokenExpiresAt)) {
    throw new ExternalAccountError("claim_token_expired", "verification token expired — start again");
  }
  const raw = await fetchProviderRawProfile(account.provider, account.externalUsername);
  if (!findTokenInRawProfile(account.provider, raw, account.claimToken)) {
    throw new ExternalAccountError(
      "claim_token_not_found_in_profile",
      "Token not found in your Lichess profile. Paste it into your bio (or first/last name / location), save, then click Check now."
    );
  }

  let seededTo = null;
  db.transaction(() => {
    db.markExternalAccountVerified(account.id);
    // Drop other Horsey users' claims for the same external handle. Once
    // someone proves ownership, prior claims are stale by definition.
    const conflicts = db.listExternalAccountsByProviderHandle(account.provider, account.externalUsername);
    for (const conflict of conflicts) {
      if (conflict.id !== account.id) db.deleteExternalAccount(conflict.id);
    }
    // Verified-tier reseed: only if the user has no Horsey games yet.
    const horseyGames = db.listFinalizedGamesForUser(viewer.id, 1).length;
    if (horseyGames === 0) {
      const accounts = db.listExternalAccountsForUser(viewer.id);
      const seed = claimedSeedFromAccounts(accounts);
      if (seed != null && seed !== db.getUser(viewer.id).rating) {
        db.updateUserRating(viewer.id, seed);
        seededTo = seed;
      }
    }
  })();
  return { account: db.getExternalAccount(account.id), seededTo };
}

function challengePayload(challenge, viewerId) {
  const challenger = db.getUser(challenge.challengerId);
  const recipient = challenge.recipientId ? db.getUser(challenge.recipientId) : null;
  const opponent = viewerId === challenge.challengerId
    ? (recipient ? withOpponentDecor(recipient) : { handle: "Anyone", rating: null })
    : withOpponentDecor(challenger);
  return {
    ...challenge,
    challenger,
    recipient,
    opponent
  };
}

function withOpponentDecor(user) {
  return {
    id: user.id,
    handle: user.handle,
    rating: user.rating,
    trustTier: trustTierForUser(user.id),
    equippedAvatar: user.equippedAvatar ?? DEFAULT_AVATAR_ID
  };
}

function requireRecipient(viewer, challenge) {
  if (challenge.recipientId && viewer.id !== challenge.recipientId) {
    const e = new RangeError("only the recipient can act on this challenge");
    e.code = "not_your_challenge";
    throw e;
  }
}

function requireAdmin(viewer) {
  const user = db.getUser(viewer.id);
  if (!user?.isAdmin) {
    const e = new RangeError("admin only");
    e.code = "admin_only";
    throw e;
  }
}

function requireChallenger(viewer, challenge) {
  if (viewer.id !== challenge.challengerId) {
    const e = new RangeError("only the challenger can withdraw this challenge");
    e.code = "not_your_challenge";
    throw e;
  }
}

function requireRespondingParty(viewer, challenge) {
  if (challenge.state === "countered") {
    requireChallenger(viewer, challenge);
    return;
  }
  requireRecipient(viewer, challenge);
}

function requireChallengeViewer(viewer, challenge) {
  const isParticipant = viewer.id === challenge.challengerId || viewer.id === challenge.recipientId;
  const isOpenTable = challenge.state === "incoming" && challenge.recipientId === null;
  if (!isParticipant && !isOpenTable) {
    const e = new RangeError("only challenge participants can view this challenge");
    e.code = "not_your_challenge";
    throw e;
  }
}

function requireTurnOwner(viewer, game) {
  const summary = summarizeGame(game.fen);
  const currentPlayer = game.players.find((p) => p.color === summary.turn);
  if (!currentPlayer || currentPlayer.id !== viewer.id) {
    const e = new RangeError("not your turn");
    e.code = "not_your_turn";
    throw e;
  }
}

function requirePlayer(viewer, game) {
  if (!game.players.some((p) => p.id === viewer.id)) {
    const e = new RangeError("only a player can act on this game");
    e.code = "not_a_player";
    throw e;
  }
}

function isGamePlayer(viewer, game) {
  return !!game?.players?.some((p) => p.id === viewer.id);
}

function requireGameViewer(viewer, game) {
  if (isGamePlayer(viewer, game)) return;
  if (game.state === "live") return;
  const e = new RangeError("only a player can read this game");
  e.code = "not_a_player";
  throw e;
}

function requireLiveGame(game) {
  if (game.state !== "live") {
    const e = new RangeError("game already finalized");
    e.code = "game_already_finalized";
    throw e;
  }
}

function requireNoLiveGame(userId) {
  const game = db.findLiveGameForUser(userId);
  if (!game) return;
  const e = new RangeError("Finish your live game before starting another table.");
  e.code = "has_live_game";
  throw e;
}

function withdrawPendingSentChallenges(userId, { exceptId = null, now = new Date().toISOString() } = {}) {
  const withdrawn = [];
  for (const challenge of db.listSentByChallenger(userId)) {
    if (challenge.id === exceptId) continue;
    if (challenge.state !== "incoming" && challenge.state !== "countered") continue;
    const next = transitionChallenge(challenge, "declined", {
      withdrawnAt: now,
      autoWithdrawnForLiveGame: true
    });
    db.saveChallenge(next);
    withdrawn.push(db.getChallenge(challenge.id));
  }
  return withdrawn;
}

function handleDomainError(error, res) {
  const statuses = {
    insufficient_funds: 409,
    invalid_challenge_transition: 409,
    missing_escrow_hold: 409,
    game_not_ready: 409,
    not_your_turn: 403,
    not_your_challenge: 403,
    not_a_player: 403,
    game_already_finalized: 409,
    challenge_not_found: 404,
    game_not_found: 404,
    invalid_challenge_input: 400,
    has_live_game: 409,
    unauthenticated: 401,
    email_taken: 409,
    handle_taken: 409,
    invalid_email: 400,
    invalid_handle: 400,
    invalid_password: 400,
    invalid_credentials: 401,
    rate_limited: 429,
    cannot_match_self: 400,
    negative_wallet: 500,
    draw_already_offered: 409,
    draw_should_accept: 409,
    no_draw_offer: 409,
    not_your_offer_to_accept: 409,
    not_your_offer_to_decline: 409,
    dev_finalize_disabled: 403,
    invalid_provider: 400,
    invalid_external_handle: 400,
    external_account_taken: 409,
    external_account_not_found: 404,
    external_handle_not_found: 404,
    admin_only: 403,
    invalid_admin_action: 400,
    game_not_finalized: 409,
    user_not_found: 404,
    tos_required: 400,
    tos_version_stale: 409,
    payments_disabled: 503,
    payments_geo_blocked: 451,
    payments_not_implemented: 501,
    payments_not_configured: 503,
    payments_unknown_package: 400,
    payments_provider_error: 502,
    waitlist_email_required: 400,
    external_rate_limited: 502,
    external_fetch_timeout: 504,
    external_fetch_failed: 502,
    stake_exceeds_trust_cap: 403,
    external_account_already_verified: 409,
    claim_token_missing: 409,
    claim_token_expired: 410,
    claim_token_not_found_in_profile: 422,
    avatar_not_found: 404,
    avatar_not_owned: 403,
    avatar_already_owned: 409,
    avatar_not_purchasable: 400,
    invalid_token: 410,
    email_rate_limited: 429,
    email_delivery_failed: 502
  };
  const headers = {};
  if (error.code === "rate_limited" && error.retryAfterSeconds) {
    headers["retry-after"] = String(error.retryAfterSeconds);
  }
  const body = JSON.stringify({
    error: error.code || "invalid_request",
    message: error.message
  });
  res.writeHead(statuses[error.code] || 400, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

function settlementPayload(game, viewerId) {
  const ledger = db.listLedger();
  const entries = findSettlementEntries(ledger, game.id);
  const finalized = entries.length > 0;

  const stakeCents = game.pot?.stakeCents ?? 0;
  const pot = stakeCents ? calculatePot({ stakeCents }) : { grossPotCents: 0, rakeCents: 0, netPotCents: 0 };
  const isAborted = game.state === "aborted";
  const isVoided = game.state === "voided";
  const isDraw = !isAborted && !isVoided && finalized && !game.winnerId;
  const winnerId = isVoided || isDraw ? null : game.winnerId;
  const viewerWon = winnerId === viewerId;
  let result = "pending";
  if (finalized) {
    if (isVoided) result = "voided";
    else if (isAborted) result = "aborted";
    else if (isDraw) result = "draw";
    else result = viewerWon ? "win" : "loss";
  }

  let creditedCents = 0;
  if (finalized) {
    creditedCents = entries
      .filter((e) => e.userId === viewerId)
      .reduce((sum, e) => sum + e.availableDeltaCents, 0);
  }
  const rakeCents = finalized
    ? entries.filter((e) => e.userId === "house").reduce((sum, e) => sum + e.availableDeltaCents, 0)
    : pot.rakeCents;

  const lastMove = game.moves[game.moves.length - 1];
  const opponentId = game.players.find((p) => p.id !== viewerId)?.id;
  const opponentHandle = opponentId ? db.getUser(opponentId)?.handle : null;
  const challenge = game.challengeId ? db.getChallenge(game.challengeId) : null;
  const timeControl = challenge?.timeControl ?? null;
  const canRematch = finalized && opponentId && timeControl;

  let ratingDelta = null;
  let ratingBefore = null;
  let ratingAfter = null;
  if (finalized && game.ratingChange) {
    const viewerColor = game.players.find((p) => p.id === viewerId)?.color;
    if (viewerColor === "white") {
      ratingDelta = game.ratingChange.whiteDelta;
      ratingBefore = game.ratingChange.whiteBefore;
      ratingAfter = game.ratingChange.whiteAfter;
    } else if (viewerColor === "black") {
      ratingDelta = game.ratingChange.blackDelta;
      ratingBefore = game.ratingChange.blackBefore;
      ratingAfter = game.ratingChange.blackAfter;
    }
  }

  return {
    id: `set_${game.id}`,
    gameId: game.id,
    state: finalized ? "finalized" : "pending",
    result,
    reason: game.endReason || (finalized ? "checkmate" : null),
    winnerId,
    creditedCents,
    grossPotCents: pot.grossPotCents,
    rakeCents,
    netPotCents: pot.netPotCents,
    balanceAfterCents: walletSummary(ledger, viewerId).balanceCents,
    winningMove: lastMove?.san ?? null,
    ratingDelta,
    ratingBefore,
    ratingAfter,
    rematchChallenge: canRematch
      ? { opponentId, opponent: opponentHandle, stakeCents, timeControl }
      : null,
    entries
  };
}

function replayPayload(game) {
  let fen = STARTING_FEN;
  const moves = game.moves.map((stored, index) => {
    const ply = index + 1;
    const color = ply % 2 === 1 ? "white" : "black";
    const applied = applyMove(fen, { from: stored.from, to: stored.to, promotion: stored.promotion ?? null });
    fen = applied.fen;
    return {
      ply,
      color,
      san: stored.san,
      from: stored.from,
      to: stored.to,
      promotion: stored.promotion ?? null,
      fenAfter: fen
    };
  });
  return {
    gameId: game.id,
    startingFen: STARTING_FEN,
    moves
  };
}

// Result for the given user in a finalized game ("win" | "loss" | "draw" | null).
function gameResultForUser(game, userId) {
  if (game.state !== "finalized") return null;
  if (!game.winnerId) return "draw";
  return game.winnerId === userId ? "win" : "loss";
}

// Per-game ledger-equivalent net delta for the given user. Mirrors the math in
// settleGame (packages/shared/domain.mjs) so we don't need to fetch ledger rows.
function netDeltaForUser(game, userId) {
  const stake = game.pot?.stakeCents ?? 0;
  if (!stake) return 0;
  const pot = calculatePot({ stakeCents: stake });
  if (!game.winnerId) {
    return Math.floor(pot.netPotCents / 2) - stake;
  }
  if (game.winnerId === userId) {
    return pot.netPotCents - stake;
  }
  return -stake;
}

function aggregateUserStats(userId, games) {
  let wins = 0; let losses = 0; let draws = 0;
  const last10 = [];
  for (const game of games) {
    const r = gameResultForUser(game, userId);
    if (r === "win") wins += 1;
    else if (r === "loss") losses += 1;
    else if (r === "draw") draws += 1;
    if (last10.length < 10 && r) last10.push(r === "win" ? "W" : r === "loss" ? "L" : "D");
  }
  let streakKind = null; let streakLength = 0;
  for (const game of games) {
    const r = gameResultForUser(game, userId);
    const kind = r === "win" ? "W" : r === "loss" ? "L" : r === "draw" ? "D" : null;
    if (!kind) break;
    if (streakKind === null) { streakKind = kind; streakLength = 1; continue; }
    if (kind !== streakKind) break;
    streakLength += 1;
  }
  const ratingTimeline = [];
  for (let i = games.length - 1; i >= 0 && ratingTimeline.length < 20; i -= 1) {
    const game = games[i];
    const rc = game.ratingChange;
    if (!rc) continue;
    const player = game.players?.find((p) => p.id === userId);
    if (!player) continue;
    const delta = player.color === "white" ? rc.whiteDelta : rc.blackDelta;
    const after = player.color === "white" ? rc.whiteAfter : rc.blackAfter;
    if (delta == null || after == null) continue;
    ratingTimeline.push({ at: game.endedAt ?? null, delta, after });
  }
  return {
    finishedGames: games.length,
    wins, losses, draws,
    currentStreak: streakKind ? { kind: streakKind, length: streakLength } : null,
    last10,
    ratingTimeline
  };
}

// Bucket a stake into a public-facing band. Buckets are intentionally coarse
// so the published value is "where they play" not "exactly what they bet."
function stakeBandLabel(stakeCents) {
  if (!stakeCents || stakeCents <= 0) return null;
  if (stakeCents < 500) return "$1–$5";
  if (stakeCents < 2500) return "$5–$25";
  if (stakeCents < 10000) return "$25–$100";
  return "$100+";
}

// Aggregate the per-user "evidence" block: stake comfort, reliability, and
// stakes-experience signals. Per project_no_loss_advertising, every value
// here is either positive (biggest pot won) or neutral (band, reliability
// rate). Net-loss totals are never surfaced.
//
// Sample-size guards: blocks return null when the user hasn't generated
// enough evidence yet. "Missing block is better than a fake one" (SCOUTING
// § 3) is the rule.
const EVIDENCE_MIN_GAMES = 5;

function evidenceForUser(userId, games) {
  if (!games || games.length === 0) {
    return {
      sampleSize: 0,
      stakeBand: null,
      stakeBandShare: null,
      timeoutRate: null,
      biggestPotCents: null
    };
  }
  const bands = new Map();
  let timeoutLosses = 0;
  let finishedWithReason = 0;
  let biggestPotCents = 0;
  for (const game of games) {
    const band = stakeBandLabel(game.pot?.stakeCents ?? 0);
    if (band) bands.set(band, (bands.get(band) ?? 0) + 1);
    if (game.endReason) finishedWithReason += 1;
    if (game.endReason === "timeout" && game.winnerId && game.winnerId !== userId) {
      timeoutLosses += 1;
    }
    if (game.winnerId === userId) {
      const stake = game.pot?.stakeCents ?? 0;
      if (stake > 0) {
        const pot = calculatePot({ stakeCents: stake });
        if (pot.netPotCents > biggestPotCents) biggestPotCents = pot.netPotCents;
      }
    }
  }
  let dominantBand = null;
  let dominantCount = 0;
  for (const [band, count] of bands) {
    if (count > dominantCount) { dominantBand = band; dominantCount = count; }
  }
  const sampleSize = games.length;
  const enoughForBand = sampleSize >= EVIDENCE_MIN_GAMES;
  const enoughForTimeout = finishedWithReason >= EVIDENCE_MIN_GAMES;
  return {
    sampleSize,
    stakeBand: enoughForBand ? dominantBand : null,
    stakeBandShare: enoughForBand && dominantCount > 0
      ? Math.round((dominantCount / sampleSize) * 100)
      : null,
    timeoutRate: enoughForTimeout
      ? Math.round((timeoutLosses / finishedWithReason) * 100)
      : null,
    biggestPotCents: biggestPotCents > 0 ? biggestPotCents : null
  };
}

function userH2hVsViewer(targetId, viewerId) {
  if (!viewerId || viewerId === targetId) return null;
  const games = db.listFinalizedGamesBetween(viewerId, targetId, 50);
  if (games.length === 0) return null;
  let viewerWins = 0; let viewerLosses = 0; let draws = 0;
  let viewerNetTotalCents = 0;
  const last5 = [];
  for (const game of games) {
    const r = gameResultForUser(game, viewerId);
    if (r === "win") viewerWins += 1;
    else if (r === "loss") viewerLosses += 1;
    else if (r === "draw") draws += 1;
    viewerNetTotalCents += netDeltaForUser(game, viewerId);
    if (last5.length < 5 && r) {
      const challenge = game.challengeId ? db.getChallenge(game.challengeId) : null;
      last5.push({
        gameId: game.id,
        result: r === "win" ? "W" : r === "loss" ? "L" : "D",
        timeControl: challenge?.timeControl ?? null,
        endedAt: game.endedAt ?? null,
        endReason: game.endReason ?? null
      });
    }
  }
  // Per project_no_loss_advertising: surface the dollar tally only when the
  // viewer is net-up. Negative tallies become null on the wire; the client
  // renders the score-only treatment.
  const viewerNetCents = viewerNetTotalCents > 0 ? viewerNetTotalCents : null;
  return {
    games: games.length,
    viewerWins,
    viewerLosses,
    draws,
    viewerNetCents,
    last5
  };
}

function userProfilePayload(targetId, viewerId) {
  const user = db.getUser(targetId);
  if (!user) return null;
  const games = db.listFinalizedGamesForUser(targetId, 50);
  const liveGame = db.findLiveGameForUser(targetId);
  const liveOpponentPlayer = liveGame?.players?.find((p) => p.id !== targetId);
  const liveOpponent = liveOpponentPlayer ? db.getUser(liveOpponentPlayer.id) : null;
  const rawAccounts = db.listExternalAccountsForUser(targetId);
  const externalAccounts = rawAccounts.map(publicExternalAccountPayload);
  const trustTier = computeTrustTier({
    externalAccounts: rawAccounts,
    finishedGames: games.length
  });
  return {
    id: user.id,
    handle: user.handle,
    rating: user.rating,
    createdAt: user.createdAt,
    stats: aggregateUserStats(targetId, games),
    evidence: evidenceForUser(targetId, games),
    presence: presence.snapshot(targetId),
    liveGame: liveGame
      ? {
        id: liveGame.id,
        opponent: liveOpponent ? withOpponentDecor(liveOpponent) : null,
        stakeCents: liveGame.pot?.stakeCents ?? 0
      }
      : null,
    h2hVsViewer: userH2hVsViewer(targetId, viewerId),
    calibrating: isCalibrating(games.length, trustTier),
    calibratingThreshold: calibratingThresholdForTier(trustTier),
    externalAccounts,
    trustTier,
    stakeCapCents: stakeCapForTier(trustTier)
  };
}

function userRecentGamesPayload(targetId, limit) {
  const cappedLimit = Math.min(Math.max(1, Number.isInteger(limit) ? limit : 10), 25);
  const games = db.listFinalizedGamesForUser(targetId, cappedLimit);
  return games.map((game) => {
    const opponentPlayer = game.players?.find((p) => p.id !== targetId);
    const opponent = opponentPlayer ? db.getUser(opponentPlayer.id) : null;
    const r = gameResultForUser(game, targetId);
    const challenge = game.challengeId ? db.getChallenge(game.challengeId) : null;
    return {
      id: game.id,
      // Opponent shown from THIS user's POV; stake amounts intentionally omitted:
      // other people's bet sizes aren't ours to publish per the privacy rules in
      // docs/USER_PROFILE_IA.md.
      opponent: opponent ? withOpponentDecor(opponent) : null,
      result: r === "win" ? "W" : r === "loss" ? "L" : r === "draw" ? "D" : null,
      endedAt: game.endedAt ?? null,
      timeControl: challenge?.timeControl ?? null,
      endReason: game.endReason ?? null
    };
  });
}

function historyEntry(game, viewerId) {
  const settlement = settlementPayload(game, viewerId);
  const viewerPlayer = game.players.find((p) => p.id === viewerId);
  const opponentPlayer = game.players.find((p) => p.id !== viewerId);
  const opponent = opponentPlayer ? db.getUser(opponentPlayer.id) : null;
  const challenge = game.challengeId ? db.getChallenge(game.challengeId) : null;
  return {
    gameId: game.id,
    endedAt: game.endedAt,
    endReason: game.endReason,
    viewerColor: viewerPlayer?.color ?? null,
    opponent: opponent ? withOpponentDecor(opponent) : null,
    stakeCents: challenge?.stakeCents ?? game.pot?.stakeCents ?? 0,
    timeControl: challenge?.timeControl ?? null,
    result: settlement.result,
    creditedCents: settlement.creditedCents
  };
}

function createChallenge({ challengerId, recipientId, stakeCents, timeControl }) {
  requireNoLiveGame(challengerId);
  if (!Number.isInteger(stakeCents) || stakeCents <= 0) {
    const e = new RangeError("stakeCents must be a positive integer");
    e.code = "invalid_challenge_input"; throw e;
  }
  if (typeof timeControl !== "string" || !timeControl) {
    const e = new RangeError("timeControl is required");
    e.code = "invalid_challenge_input"; throw e;
  }
  try { parseTimeControl(timeControl); } catch (err) {
    const e = new RangeError(err.message);
    e.code = "invalid_challenge_input"; throw e;
  }
  if (recipientId === challengerId) {
    const e = new RangeError("cannot challenge yourself");
    e.code = "invalid_challenge_input"; throw e;
  }
  if (recipientId && !db.getUser(recipientId)) {
    const e = new RangeError(`unknown recipient: ${recipientId}`);
    e.code = "invalid_challenge_input"; throw e;
  }

  requireStakeWithinCap(stakeCents, challengerId, recipientId);

  const pot = calculatePot({ stakeCents });
  const challenge = {
    id: newId("chg"),
    state: "incoming",
    challengerId,
    recipientId: recipientId || null,
    gameId: null,
    expiresInSeconds: 60,
    stakeCents,
    timeControl,
    pot,
    tells: []
  };
  db.insertChallenge(challenge);
  return challenge;
}

function acceptChallenge(challenge, accepterId) {
  if (challenge.state === "accepted") {
    return { game: db.getGame(challenge.gameId), cleanedChallenges: [] };
  }
  if (challenge.state !== "incoming" && challenge.state !== "countered") {
    const e = new RangeError(`cannot accept challenge in state ${challenge.state}`);
    e.code = "invalid_challenge_transition"; throw e;
  }

  // An open table's host already passed their cap at creation, but the taker
  // can be at a lower tier; check both sides at accept time.
  requireNoLiveGame(accepterId);
  requireNoLiveGame(challenge.challengerId);
  requireStakeWithinCap(challenge.stakeCents, accepterId, challenge.challengerId);

  let createdGame;
  let cleanedChallenges = [];
  db.transaction(() => {
    const recipientId = challenge.recipientId || accepterId;
    if (recipientId === challenge.challengerId) {
      const e = new RangeError("cannot accept your own challenge");
      e.code = "invalid_challenge_input"; throw e;
    }

    const now = new Date().toISOString();
    const ledger = db.listLedger();
    const recipientHold = createEscrowHold({
      id: newId("led_hold"),
      userId: recipientId,
      challengeId: challenge.id,
      amountCents: challenge.stakeCents,
      ledgerEntries: ledger,
      createdAt: now
    });
    const challengerHold = createEscrowHold({
      id: newId("led_hold"),
      userId: challenge.challengerId,
      challengeId: challenge.id,
      amountCents: challenge.stakeCents,
      ledgerEntries: [...ledger, recipientHold],
      createdAt: now
    });
    db.appendLedger([recipientHold, challengerHold]);

    const gameId = newId("game");
    const challenger = db.getUser(challenge.challengerId);
    const recipient = db.getUser(recipientId);
    const colors = Math.random() < 0.5 ? ["white", "black"] : ["black", "white"];
    const players = [
      { id: challenger.id, handle: challenger.handle, color: colors[0], rating: challenger.rating },
      { id: recipient.id, handle: recipient.handle, color: colors[1], rating: recipient.rating }
    ];
    const clock = initClockState(challenge.timeControl, now);
    db.insertGame({
      id: gameId,
      state: "live",
      fen: STARTING_FEN,
      challengeId: challenge.id,
      winnerId: null,
      endReason: null,
      endedAt: null,
      players,
      moves: [],
      pot: challenge.pot,
      clock,
      timeControl: challenge.timeControl
    });
    createdGame = db.getGame(gameId);

    db.saveChallenge(transitionChallenge(
      { ...challenge, recipientId, gameId },
      "accepted",
      { acceptedAt: now, escrowEntryIds: [recipientHold.id, challengerHold.id] }
    ));
    db.deleteTicket(recipientId);
    db.deleteTicket(challenge.challengerId);
    cleanedChallenges = [
      ...withdrawPendingSentChallenges(recipientId, { exceptId: challenge.id, now }),
      ...withdrawPendingSentChallenges(challenge.challengerId, { exceptId: challenge.id, now })
    ];
  })();
  return { game: createdGame, cleanedChallenges };
}

function finalizeGame(game, { result, reason }) {
  if (!["white_win", "black_win", "draw"].includes(result)) {
    const e = new RangeError("result must be white_win, black_win, or draw");
    e.code = "invalid_result"; throw e;
  }
  if (game.state === "finalized") return;

  const challenge = db.getChallenge(game.challengeId);
  if (!challenge || challenge.state !== "accepted") {
    const e = new RangeError("challenge must be accepted before finalization");
    e.code = "game_not_ready"; throw e;
  }

  const white = game.players.find((p) => p.color === "white");
  const black = game.players.find((p) => p.color === "black");
  const winnerId = result === "white_win" ? white.id : result === "black_win" ? black.id : null;
  const defaultReason = result === "draw" ? "agreement" : "checkmate";

  let unlockedMilestones = [];
  db.transaction(() => {
    const outcome = settleGame({
      gameId: game.id,
      challengeId: challenge.id,
      stakeCents: challenge.stakeCents,
      playerIds: [white.id, black.id],
      winnerId,
      ledgerEntries: db.listLedger(),
      createdAt: new Date().toISOString()
    });
    if (outcome.newEntries.length > 0) {
      db.appendLedger(outcome.newEntries);
      const ratingChange = computeRatingChange({
        whiteRating: db.getUser(white.id).rating,
        blackRating: db.getUser(black.id).rating,
        result
      });
      db.updateUserRating(white.id, ratingChange.whiteAfter);
      db.updateUserRating(black.id, ratingChange.blackAfter);
      const endReason = reason || defaultReason;
      const endedAt = new Date().toISOString();
      const finalizedGame = {
        ...game,
        state: "finalized",
        winnerId,
        endReason,
        endedAt,
        ratingChange
      };
      db.saveGame(finalizedGame);
      recordGameEvent(game.id, "finalized", {
        result,
        reason: endReason,
        winnerId,
        ratingChange
      });
      // Milestone detection runs inside the same transaction so a partial
      // commit can't leak unlocks for an un-finalized game. Persist here;
      // publish over the broker after the transaction commits.
      unlockedMilestones = detectMilestonesForGame(db, finalizedGame);
      for (const m of unlockedMilestones) {
        db.insertUserMilestone(m);
        for (const avatar of avatarsForMilestone(m.eventKey)) {
          db.grantUserAvatar(m.userId, avatar.id, `milestone:${m.eventKey}`, m.occurredAt);
        }
      }
    }
  })();
  clearClockTimeout(game.id);
  for (const m of unlockedMilestones) publishMilestoneUnlocked(m);
}

function publishMilestoneUnlocked(milestone) {
  if (!milestone) return;
  broker.publish(CHANNELS.user(milestone.userId), {
    type: "milestone.unlocked",
    milestone: publicMilestonePayload(milestone)
  });
}

function resignGame(viewer, game) {
  if (game.state === "finalized" || game.state === "aborted") {
    const e = new RangeError("game already finalized");
    e.code = "game_already_finalized"; throw e;
  }
  // Pre-move resign collapses to an abort — no rake, both stakes returned.
  // Closing the tab and clicking "resign" before any move should feel the same.
  if ((game.moves || []).length === 0) {
    recordGameEvent(game.id, "resigned", { byUserId: viewer.id, preMove: true });
    abortGame(game, { reason: "aborted_pre_move" });
    return;
  }
  const resigning = game.players.find((p) => p.id === viewer.id);
  const result = resigning.color === "white" ? "black_win" : "white_win";
  recordGameEvent(game.id, "resigned", { byUserId: viewer.id, color: resigning.color });
  finalizeGame(game, { result, reason: "resignation" });
}

const clockTimeouts = new Map();

function clearClockTimeout(gameId) {
  const handle = clockTimeouts.get(gameId);
  if (handle) {
    clearTimeout(handle);
    clockTimeouts.delete(gameId);
  }
}

function scheduleClockTimeout(game) {
  clearClockTimeout(game.id);
  if (!game || game.state !== "live" || !game.clock) return;
  const ms = msUntilFlag(game.clock, Date.now());
  const handle = setTimeout(() => {
    const fresh = db.getGame(game.id);
    if (!fresh || fresh.state !== "live") return;
    if (settleIfFlagged(fresh, Date.now())) {
      const refreshed = db.getGame(fresh.id);
      publishGameFinalized(refreshed);
    } else {
      scheduleClockTimeout(fresh);
    }
  }, Math.max(0, ms) + 50);
  if (typeof handle.unref === "function") handle.unref();
  clockTimeouts.set(game.id, handle);
}

function settleIfFlagged(game, now) {
  if (!game.clock || game.state !== "live") return false;
  const flagged = flaggedSide(game.clock, now);
  if (!flagged) return false;
  const result = flagged === "white" ? "black_win" : "white_win";
  finalizeGame(game, { result, reason: "timeout" });
  return true;
}

function flaggedSettlementPayload(game, viewerId) {
  if (!settleIfFlagged(game, Date.now())) return null;
  const refreshed = db.getGame(game.id);
  publishGameFinalized(refreshed);
  return {
    game: enrichGame(refreshed),
    settlement: settlementPayload(refreshed, viewerId),
    viewer: viewerPayload(viewerId),
    timedOut: true
  };
}

function rehydrateClockTimeouts() {
  for (const game of db.listLiveGames()) {
    if (settleIfFlagged(game, Date.now())) {
      const refreshed = db.getGame(game.id);
      publishGameFinalized(refreshed);
    } else {
      scheduleClockTimeout(game);
      scheduleFirstMoveTimeout(game);
    }
  }
}

// First-move abort scheduler (OPERATIONAL_POLICY.md § 1.10).
// While moves.length < 2, the side-to-move has FIRST_MOVE_DEADLINE_MS from
// game.clock.lastMoveAt to play their first move; if they miss it, the game
// aborts and both stakes are returned with no rake.
// `HORSEY_FIRST_MOVE_DEADLINE_MS` is a test hook for shrinking the window.
const firstMoveDeadlineMs = Number(process.env.HORSEY_FIRST_MOVE_DEADLINE_MS) || FIRST_MOVE_DEADLINE_MS;
const firstMoveTimeouts = new Map();

function clearFirstMoveTimeout(gameId) {
  const handle = firstMoveTimeouts.get(gameId);
  if (handle) {
    clearTimeout(handle);
    firstMoveTimeouts.delete(gameId);
  }
}

function firstMoveDeadlineAt(game) {
  if (!game?.clock || game.state !== "live") return null;
  if ((game.moves || []).length >= 2) return null;
  return Date.parse(game.clock.lastMoveAt) + firstMoveDeadlineMs;
}

function scheduleFirstMoveTimeout(game) {
  clearFirstMoveTimeout(game.id);
  const deadlineMs = firstMoveDeadlineAt(game);
  if (deadlineMs == null) return;
  const wait = Math.max(0, deadlineMs - Date.now()) + 50;
  const handle = setTimeout(() => {
    const fresh = db.getGame(game.id);
    if (!fresh || fresh.state !== "live") return;
    if ((fresh.moves || []).length >= 2) return;
    if (firstMoveDeadlineAt(fresh) > Date.now()) {
      scheduleFirstMoveTimeout(fresh);
      return;
    }
    abortGame(fresh, { reason: "aborted_pre_move" });
    const refreshed = db.getGame(fresh.id);
    publishGameFinalized(refreshed);
  }, wait);
  if (typeof handle.unref === "function") handle.unref();
  firstMoveTimeouts.set(game.id, handle);
}

function abortGame(game, { reason = "aborted_pre_move" } = {}) {
  if (game.state !== "live") return;
  const challenge = db.getChallenge(game.challengeId);
  if (!challenge || challenge.state !== "accepted") {
    const e = new RangeError("challenge must be accepted before abort");
    e.code = "game_not_ready"; throw e;
  }
  const [a, b] = game.players;
  db.transaction(() => {
    const outcome = abortGameSettlement({
      gameId: game.id,
      challengeId: challenge.id,
      stakeCents: challenge.stakeCents,
      playerIds: [a.id, b.id],
      ledgerEntries: db.listLedger(),
      createdAt: new Date().toISOString()
    });
    if (outcome.newEntries.length > 0) {
      db.appendLedger(outcome.newEntries);
      const endedAt = new Date().toISOString();
      db.saveGame({
        ...game,
        state: "aborted",
        winnerId: null,
        endReason: reason,
        endedAt
      });
      recordGameEvent(game.id, "aborted", { reason });
    }
  })();
  clearClockTimeout(game.id);
  clearFirstMoveTimeout(game.id);
}

function requireAdminReason(reason) {
  const normalized = String(reason ?? "").trim();
  if (normalized.length < 3) {
    const e = new RangeError("A reason is required for admin mutations.");
    e.code = "invalid_admin_action";
    throw e;
  }
  return normalized.slice(0, 1000);
}

function adminGameSnapshot(game) {
  if (!game) return null;
  return {
    id: game.id,
    state: game.state,
    winnerId: game.winnerId ?? null,
    endReason: game.endReason ?? null,
    endedAt: game.endedAt ?? null,
    ratingChange: game.ratingChange ?? null,
    adminAdjustment: game.adminAdjustment ?? null
  };
}

function reverseRatingChange(game) {
  if (!game?.ratingChange) return null;
  const white = game.players.find((p) => p.color === "white");
  const black = game.players.find((p) => p.color === "black");
  if (!white || !black) return null;
  const whiteUser = db.getUser(white.id);
  const blackUser = db.getUser(black.id);
  if (!whiteUser || !blackUser) return null;
  const whiteAfter = whiteUser.rating - (game.ratingChange.whiteDelta ?? 0);
  const blackAfter = blackUser.rating - (game.ratingChange.blackDelta ?? 0);
  db.updateUserRating(white.id, whiteAfter);
  db.updateUserRating(black.id, blackAfter);
  return {
    white: { userId: white.id, before: whiteUser.rating, after: whiteAfter },
    black: { userId: black.id, before: blackUser.rating, after: blackAfter }
  };
}

function resultToWinnerId(game, result) {
  if (result === "draw") return null;
  const color = result === "white_win" ? "white" : result === "black_win" ? "black" : null;
  if (!color) {
    const e = new RangeError("result must be white_win, black_win, or draw");
    e.code = "invalid_admin_action";
    throw e;
  }
  const player = game.players.find((p) => p.color === color);
  if (!player) {
    const e = new RangeError("game is missing the requested player color");
    e.code = "invalid_admin_action";
    throw e;
  }
  return player.id;
}

function adminVoidGame(actor, game, reason) {
  const before = adminGameSnapshot(game);
  if (game.state === "aborted" || game.state === "voided") {
    db.appendAdminAction({
      actorUserId: actor.id,
      targetType: "game",
      targetId: game.id,
      action: "void",
      reason,
      before,
      after: before
    });
    return { game, alreadyNoop: true };
  }
  if (game.state !== "live" && game.state !== "finalized") {
    const e = new RangeError("Only live, finalized, aborted, or already-voided games can be voided.");
    e.code = "invalid_admin_action";
    throw e;
  }
  const challenge = db.getChallenge(game.challengeId);
  if (!challenge) {
    const e = new RangeError("challenge not found");
    e.code = "challenge_not_found";
    throw e;
  }
  const [a, b] = game.players;
  const endedAt = new Date().toISOString();
  let ratingReversal = null;
  db.transaction(() => {
    const outcome = voidGameSettlement({
      gameId: game.id,
      challengeId: challenge.id,
      playerIds: [a.id, b.id],
      ledgerEntries: db.listLedger(),
      createdAt: endedAt
    });
    if (outcome.newEntries.length > 0) db.appendLedger(outcome.newEntries);
    if (game.state === "finalized") ratingReversal = reverseRatingChange(game);
    const next = {
      ...game,
      state: "voided",
      winnerId: null,
      endReason: "admin_void",
      endedAt,
      ratingChange: game.ratingChange ?? null,
      adminVoid: { reason, actorUserId: actor.id, voidedAt: endedAt, ratingReversal }
    };
    db.saveGame(next);
    recordGameEvent(game.id, "admin_voided", { byUserId: actor.id, reason, ratingReversal });
    db.appendAdminAction({
      actorUserId: actor.id,
      targetType: "game",
      targetId: game.id,
      action: "void",
      reason,
      before,
      after: adminGameSnapshot(next)
    });
  })();
  clearClockTimeout(game.id);
  clearFirstMoveTimeout(game.id);
  return { game: db.getGame(game.id), alreadyNoop: false, ratingReversal };
}

function adminAdjustGame(actor, game, { result, reason }) {
  if (game.state !== "finalized") {
    const e = new RangeError("Only finalized games can be adjusted.");
    e.code = "game_not_finalized";
    throw e;
  }
  const challenge = db.getChallenge(game.challengeId);
  if (!challenge) {
    const e = new RangeError("challenge not found");
    e.code = "challenge_not_found";
    throw e;
  }
  const winnerId = resultToWinnerId(game, result);
  const before = adminGameSnapshot(game);
  const [a, b] = game.players;
  const adjustedAt = new Date().toISOString();
  db.transaction(() => {
    const outcome = adjustGameSettlement({
      gameId: game.id,
      challengeId: challenge.id,
      stakeCents: challenge.stakeCents,
      playerIds: [a.id, b.id],
      winnerId,
      ledgerEntries: db.listLedger(),
      createdAt: adjustedAt
    });
    if (outcome.newEntries.length > 0) db.appendLedger(outcome.newEntries);
    const next = {
      ...game,
      winnerId,
      endReason: `admin_adjust:${result}`,
      adminAdjustment: { result, reason, actorUserId: actor.id, adjustedAt }
    };
    db.saveGame(next);
    recordGameEvent(game.id, "admin_adjusted", { byUserId: actor.id, result, reason });
    db.appendAdminAction({
      actorUserId: actor.id,
      targetType: "game",
      targetId: game.id,
      action: "adjust",
      reason,
      before,
      after: adminGameSnapshot(next)
    });
  })();
  return { game: db.getGame(game.id) };
}

function adminSetRestrictions(actor, targetUserId, restrictions, reason) {
  const user = db.getUser(targetUserId);
  if (!user) {
    const e = new RangeError("user not found");
    e.code = "user_not_found";
    throw e;
  }
  const requested = Array.from(new Set(restrictions ?? []));
  if (requested.length === 0 || !requested.every(isValidRestriction)) {
    const e = new RangeError(`restrictions must be one or more of: ${RESTRICTION_LADDER.join(", ")}`);
    e.code = "invalid_admin_action";
    throw e;
  }
  const before = db.listRestrictionsForUser(targetUserId);
  const autoVoided = [];
  db.transaction(() => {
    for (const restriction of requested) {
      db.applyUserRestriction({
        userId: targetUserId,
        restriction,
        reason,
        appliedBy: actor.id
      });
    }
    if (requested.includes("hard_ban")) {
      const live = db.findLiveGameForUser(targetUserId);
      if (live) {
        const voided = adminVoidGame(actor, live, `Hard ban auto-void: ${reason}`);
        autoVoided.push(voided.game.id);
      }
    }
    db.appendAdminAction({
      actorUserId: actor.id,
      targetType: "user",
      targetId: targetUserId,
      action: "restrict",
      reason,
      before,
      after: db.listRestrictionsForUser(targetUserId)
    });
  })();
  return {
    user: db.getUser(targetUserId),
    restrictions: db.listRestrictionsForUser(targetUserId),
    autoVoided
  };
}

function adminClearRestriction(actor, targetUserId, restriction, reason) {
  if (!isValidRestriction(restriction)) {
    const e = new RangeError(`restriction must be one of: ${RESTRICTION_LADDER.join(", ")}`);
    e.code = "invalid_admin_action";
    throw e;
  }
  const user = db.getUser(targetUserId);
  if (!user) {
    const e = new RangeError("user not found");
    e.code = "user_not_found";
    throw e;
  }
  const before = db.listRestrictionsForUser(targetUserId);
  db.transaction(() => {
    db.clearUserRestriction({
      userId: targetUserId,
      restriction,
      clearedBy: actor.id,
      clearedReason: reason
    });
    db.appendAdminAction({
      actorUserId: actor.id,
      targetType: "user",
      targetId: targetUserId,
      action: "clear_restriction",
      reason,
      before,
      after: db.listRestrictionsForUser(targetUserId)
    });
  })();
  return { user: db.getUser(targetUserId), restrictions: db.listRestrictionsForUser(targetUserId) };
}

function quickMatch(viewer, { stakeCents, timeControl, tierPref }) {
  requireNoLiveGame(viewer.id);
  if (!Number.isInteger(stakeCents) || stakeCents <= 0) {
    const e = new RangeError("stakeCents must be a positive integer");
    e.code = "invalid_challenge_input"; throw e;
  }
  if (typeof timeControl !== "string" || !timeControl) {
    const e = new RangeError("timeControl is required");
    e.code = "invalid_challenge_input"; throw e;
  }
  try { parseTimeControl(timeControl); } catch (err) {
    const e = new RangeError(err.message);
    e.code = "invalid_challenge_input"; throw e;
  }
  const pref = normalizeTierPref(tierPref);

  requireStakeWithinCap(stakeCents, viewer.id);
  const viewerTier = trustTierForUser(viewer.id);

  let matchedGame = null;
  let cleanedChallenges = [];
  db.transaction(() => {
    const candidates = db.listMatchingTickets(stakeCents, timeControl, viewer.id);
    // A match is only valid when both sides satisfy each other's tier floor.
    // Viewer asked for >= pref; the queued opponent asked for >= ticket.tierPref.
    const opponentTicket = candidates.find((ticket) => {
      if (db.findLiveGameForUser(ticket.userId)) {
        db.deleteTicket(ticket.userId);
        return false;
      }
      const oppTier = trustTierForUser(ticket.userId);
      if (!meetsTierFloor(oppTier, pref)) return false;
      if (!meetsTierFloor(viewerTier, ticket.tierPref)) return false;
      return true;
    });
    if (opponentTicket) {
      const challenge = createChallenge({
        challengerId: opponentTicket.userId,
        recipientId: viewer.id,
        stakeCents,
        timeControl
      });
      const accepted = acceptChallenge(db.getChallenge(challenge.id), viewer.id);
      matchedGame = accepted.game;
      cleanedChallenges = accepted.cleanedChallenges;
    } else {
      db.upsertTicket({
        userId: viewer.id,
        stakeCents,
        timeControl,
        tierPref: pref,
        createdAt: new Date().toISOString()
      });
    }
  })();
  return { matched: !!matchedGame, game: matchedGame, ticket: db.getTicket(viewer.id), cleanedChallenges };
}

async function signupAccount({ email, handle, password, acceptedTosVersion }) {
  const clean = validateSignupInput({ email, handle, password });
  // ToS acceptance is required at signup. The client passes the active
  // version number it rendered; we accept that number for the new user.
  // If the version doesn't match the live one (rare race during a bump),
  // the next session will prompt for the new version.
  if (acceptedTosVersion == null) {
    const e = new RangeError("You must accept the Horsey Terms to create an account.");
    e.code = "tos_required"; throw e;
  }
  if (db.getUserByEmail(clean.email)) {
    const e = new RangeError("We couldn't create that account. Try another email or handle.");
    e.code = "email_taken"; throw e;
  }
  if (db.getUserByHandle(clean.handle)) {
    const e = new RangeError("We couldn't create that account. Try another email or handle.");
    e.code = "handle_taken"; throw e;
  }
  const { passwordHash, passwordSalt } = await hashPassword(clean.password);
  const now = new Date().toISOString();
  const userId = newId("usr");
  let session;
  db.transaction(() => {
    db.insertUser({
      id: userId,
      email: clean.email,
      handle: clean.handle,
      passwordHash,
      passwordSalt,
      rating: SIGNUP_DEFAULT_RATING,
      createdAt: now
    });
    db.appendLedger([{
      id: newId("led_grant"),
      userId,
      type: "seed_grant",
      availableDeltaCents: SIGNUP_GRANT_CENTS,
      escrowDeltaCents: 0,
      refId: "signup",
      note: "Welcome fake-money grant",
      createdAt: now
    }]);
    db.recordTosAcceptance({
      userId,
      tosVersion: Number(acceptedTosVersion),
      acceptedAt: now
    });
    session = startSession(userId, now);
  })();
  const user = db.getUser(userId);
  // Best-effort verification email — if delivery fails we don't block signup.
  // The user can re-request via the banner action.
  sendVerificationEmail(user).catch((err) =>
    logger.warn("verification email send failed", {
      event: "signup.verification_email_failed",
      userId: user.id,
      err
    })
  );
  return { user, session };
}

function issueEmailToken({ userId, type, ttlMs }) {
  const now = new Date();
  const sinceIso = new Date(now.getTime() - EMAIL_LINK_PER_USER_WINDOW_MS).toISOString();
  const recent = db.countRecentEmailTokensForUser(userId, type, sinceIso);
  if (recent >= EMAIL_LINK_PER_USER_LIMIT) {
    const e = new RangeError("Too many email requests recently. Try again in an hour.");
    e.code = "email_rate_limited";
    throw e;
  }
  const rawToken = generateEmailToken();
  const record = {
    id: newId("etk"),
    userId,
    type,
    tokenHash: hashEmailToken(rawToken),
    expiresAt: newEmailTokenExpiry(ttlMs, now.getTime()),
    createdAt: now.toISOString()
  };
  // Replace any unused prior tokens of the same type so a re-request
  // invalidates earlier links.
  db.transaction(() => {
    db.deleteEmailTokensForUserByType(userId, type);
    db.insertEmailToken(record);
  })();
  return { rawToken, record };
}

async function sendVerificationEmail(user) {
  const { rawToken } = issueEmailToken({
    userId: user.id,
    type: "verify",
    ttlMs: EMAIL_VERIFY_TTL_MS
  });
  const link = `${emailDeliveryConfig().appUrl}/#verify-email/${rawToken}`;
  const body = verifyEmailBody({ handle: user.handle, link });
  return sendEmail({ to: user.email, ...body });
}

async function sendPasswordResetEmail(user) {
  const { rawToken } = issueEmailToken({
    userId: user.id,
    type: "reset",
    ttlMs: PASSWORD_RESET_TTL_MS
  });
  const link = `${emailDeliveryConfig().appUrl}/#password-reset/${rawToken}`;
  const body = passwordResetBody({ handle: user.handle, link });
  return sendEmail({ to: user.email, ...body });
}

function currentSessionId(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

function requirePassword(value, message = "password is required") {
  if (typeof value !== "string" || !value) {
    const e = new RangeError(message);
    e.code = "invalid_password";
    throw e;
  }
  return value;
}

async function updateAccountEmail(viewer, { email, password }) {
  const nextEmail = validateEmailInput(email);
  const privateUser = db.getPrivateUser(viewer.id);
  const ok = await verifyPassword(requirePassword(password, "current password is required"), privateUser.password_hash, privateUser.password_salt);
  if (!ok) {
    const e = new RangeError("invalid email or password");
    e.code = "invalid_credentials"; throw e;
  }
  const existing = db.getUserByEmail(nextEmail);
  if (existing && existing.id !== viewer.id) {
    const e = new RangeError("We couldn't update that email. Try another address.");
    e.code = "email_taken"; throw e;
  }
  db.updateUserEmail(viewer.id, nextEmail);
  return db.getUser(viewer.id);
}

async function updateAccountPassword(viewer, { currentPassword, nextPassword }) {
  const privateUser = db.getPrivateUser(viewer.id);
  const ok = await verifyPassword(
    requirePassword(currentPassword, "current password is required"),
    privateUser.password_hash,
    privateUser.password_salt
  );
  if (!ok) {
    const e = new RangeError("invalid email or password");
    e.code = "invalid_credentials"; throw e;
  }
  if (typeof nextPassword !== "string" || nextPassword.length < 8) {
    const e = new RangeError("password must be at least 8 characters");
    e.code = "invalid_password"; throw e;
  }
  const next = await hashPassword(nextPassword);
  db.updateUserPassword(viewer.id, next);
  return db.getUser(viewer.id);
}

async function loginAccount({ email, password }) {
  const clean = validateLoginInput({ email, password });
  const row = db.getUserByEmail(clean.email);
  if (!row) {
    const e = new RangeError("invalid email or password");
    e.code = "invalid_credentials"; throw e;
  }
  const ok = await verifyPassword(clean.password, row.password_hash, row.password_salt);
  if (!ok) {
    const e = new RangeError("invalid email or password");
    e.code = "invalid_credentials"; throw e;
  }
  const session = startSession(row.id);
  return { user: db.getUser(row.id), session };
}

function startSession(userId, nowIso = new Date().toISOString()) {
  db.deleteExpiredSessions(nowIso);
  const session = {
    id: generateSessionToken(),
    userId,
    createdAt: nowIso,
    expiresAt: newSessionExpiry(Date.parse(nowIso))
  };
  db.insertSession(session);
  return session;
}

function avatarCatalogPayload() {
  return AVATAR_CATALOG.map((a) => ({
    id: a.id,
    piece: a.piece,
    rarity: a.rarity,
    acquisition: a.acquisition
  }));
}

function equipAvatar(viewerId, avatarId) {
  if (!isValidAvatarId(avatarId)) {
    const e = new RangeError(`unknown avatar: ${avatarId}`);
    e.code = "avatar_not_found"; throw e;
  }
  if (!db.userOwnsAvatar(viewerId, avatarId)) {
    const e = new RangeError("you don't own that avatar");
    e.code = "avatar_not_owned"; throw e;
  }
  db.updateUserEquippedAvatar(viewerId, avatarId);
}

function purchaseAvatar(viewerId, avatarId) {
  const avatar = getAvatar(avatarId);
  if (!avatar) {
    const e = new RangeError(`unknown avatar: ${avatarId}`);
    e.code = "avatar_not_found"; throw e;
  }
  if (avatar.acquisition.type !== "purchase") {
    const e = new RangeError("that avatar isn't for sale");
    e.code = "avatar_not_purchasable"; throw e;
  }
  if (db.userOwnsAvatar(viewerId, avatarId)) {
    const e = new RangeError("you already own that avatar");
    e.code = "avatar_already_owned"; throw e;
  }
  const priceCents = avatar.acquisition.priceCents;
  // Wallet check + spend + grant runs inside one transaction so insufficient
  // funds can't half-grant the avatar.
  db.transaction(() => {
    const balance = walletSummary(db.listLedger(), viewerId).balanceCents;
    if (balance < priceCents) {
      const e = new RangeError("insufficient fake-money balance for avatar purchase");
      e.code = "insufficient_funds"; throw e;
    }
    db.appendLedger([{
      id: newId("led_av"),
      userId: viewerId,
      type: "avatar_purchase",
      availableDeltaCents: -priceCents,
      escrowDeltaCents: 0,
      refId: avatarId,
      note: `Avatar purchase: ${avatarId}`,
      createdAt: new Date().toISOString()
    }]);
    db.grantUserAvatar(viewerId, avatarId, "purchase");
  })();
}

function bootstrapPayload(viewer) {
  const baseLobby = db.getLobby();
  const liveness = computeLobbyLiveness();
  const lobby = { ...baseLobby, ...liveness };
  const openChallenges = refreshVisibleChallenges(db.listOpenChallenges()).map((c) => challengePayload(c, viewer.id));
  const incomingChallenges = refreshVisibleChallenges(db.listIncomingForRecipient(viewer.id)).map((c) =>
    challengePayload(c, viewer.id)
  );
  const sentChallenges = refreshVisibleChallenges(db.listSentByChallenger(viewer.id)).map((c) =>
    challengePayload(c, viewer.id)
  );
  const liveGame = db.findLiveGameForUser(viewer.id);
  const recentGame = liveGame || db.findMostRecentGameForUser(viewer.id);
  const ticket = db.getTicket(viewer.id);
  return {
    viewer: viewerPayload(viewer.id),
    lobby: { ...lobby, openChallenges },
    incomingChallenges,
    sentChallenges,
    activeGame: enrichGame(liveGame),
    recentGame: enrichGame(recentGame),
    recentSettlement: recentGame ? settlementPayload(recentGame, viewer.id) : null,
    matchmakingTicket: ticket,
    notifications: {
      unreadCount: db.countUnreadNotificationsForUser(viewer.id),
      recent: db.listNotificationsForUser(viewer.id, 20)
    },
    payments: paymentsBootstrap(viewer.id)
  };
}

function paymentsBootstrap(_viewerId) {
  // Slice 1: kill switch + catalog only. Slice 2 will add real checkout
  // sessions and surface in-flight purchase state.
  return {
    enabled: paymentsEnabled,
    provider: PAYMENT_PROVIDER,
    geoBlocked: false, // wired in a follow-on when we add edge geo lookup
    packages: CHIP_PACKAGES,
    currencies: SUPPORTED_PAY_CURRENCIES,
    cashoutOpen: false // Phase 7
  };
}

function getChallengeOr404(id) {
  const challenge = db.getChallenge(id);
  if (!challenge) {
    const e = new RangeError(`challenge not found: ${id}`);
    e.code = "challenge_not_found"; throw e;
  }
  return challenge;
}

function getGameOr404(id) {
  const game = db.getGame(id);
  if (!game) {
    const e = new RangeError(`game not found: ${id}`);
    e.code = "game_not_found"; throw e;
  }
  return game;
}

function refreshChallengeState(challenge, now = Date.now()) {
  if (!challenge || !["incoming", "countered"].includes(challenge.state)) return challenge;
  const expiresInMs = (challenge.expiresInSeconds ?? 0) * 1000;
  if (expiresInMs <= 0) return challenge;
  const baseTime = Date.parse(challenge.updatedAt || challenge.createdAt);
  if (!Number.isFinite(baseTime) || now < baseTime + expiresInMs) return challenge;

  const expired = transitionChallenge(challenge, "expired", {
    expiredAt: new Date(now).toISOString()
  });
  db.saveChallenge(expired);
  const refreshed = db.getChallenge(challenge.id);
  publishChallengeUpdated(refreshed);
  return refreshed;
}

function refreshVisibleChallenges(challenges) {
  return challenges
    .map((challenge) => refreshChallengeState(challenge))
    .filter((challenge) => challenge.state !== "expired");
}

async function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    return json(res, 200, { ok: true, service: "horsey-api" });
  }

  if (req.method === "GET" && pathname === "/api/dev/accounts") {
    if (!enableDevAccountPicker) return notFound(res);
    const accounts = db.listUsers()
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .map((user) => ({
        id: user.id,
        email: user.email,
        handle: user.handle,
        rating: user.rating,
        trustTier: trustTierForUser(user.id),
        equippedAvatar: user.equippedAvatar,
        password: devAccountPassword
      }));
    return json(res, 200, { accounts });
  }

  if (req.method === "POST" && pathname === "/api/auth/signup") {
    try {
      checkRateLimit(req, "auth");
      const body = await readJson(req);
      const { user, session } = await signupAccount(body);
      setSessionCookie(res, session.id);
      return json(res, 201, { viewer: viewerPayload(user.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    try {
      checkRateLimit(req, "auth");
      const body = await readJson(req);
      const { user, session } = await loginAccount(body);
      setSessionCookie(res, session.id);
      return json(res, 200, { viewer: viewerPayload(user.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) db.deleteSession(token);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-email/confirm") {
    try {
      checkRateLimit(req, "auth");
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!token) {
        const e = new RangeError("verification token is required");
        e.code = "invalid_token"; throw e;
      }
      const record = db.findEmailTokenByHash(hashEmailToken(token), "verify");
      if (!record || record.consumedAt || isEmailTokenExpired(record)) {
        const e = new RangeError("this verification link is invalid or has expired");
        e.code = "invalid_token"; throw e;
      }
      db.transaction(() => {
        db.markEmailVerified(record.userId);
        db.markEmailTokenConsumed(record.id);
      })();
      return json(res, 200, { ok: true });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/auth/password/reset/request") {
    try {
      checkRateLimit(req, "emailLink");
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
      // Always return 200 to avoid leaking which emails are accounts. We
      // still validate input shape so obviously-garbage requests don't
      // burn cycles, but we don't surface that distinction.
      if (email) {
        const user = db.getUserByEmail(email);
        if (user) {
          try {
            await sendPasswordResetEmail(db.getUser(user.id));
          } catch (sendError) {
            // Email-rate-limit and delivery failures are intentionally
            // swallowed so the response is identical to the unknown-email
            // path. The token is not issued on these errors.
            logger.warn("password reset email send failed", {
              event: "password_reset.email_failed",
              userId: user.id,
              err: sendError
            });
          }
        }
      }
      return json(res, 200, { ok: true });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/auth/password/reset/confirm") {
    try {
      checkRateLimit(req, "auth");
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!token) {
        const e = new RangeError("reset token is required");
        e.code = "invalid_token"; throw e;
      }
      const newPassword = validatePasswordInput(body.newPassword);
      const record = db.findEmailTokenByHash(hashEmailToken(token), "reset");
      if (!record || record.consumedAt || isEmailTokenExpired(record)) {
        const e = new RangeError("this reset link is invalid or has expired");
        e.code = "invalid_token"; throw e;
      }
      const { passwordHash, passwordSalt } = await hashPassword(newPassword);
      db.transaction(() => {
        db.updateUserPassword(record.userId, { passwordHash, passwordSalt });
        db.markEmailTokenConsumed(record.id);
        db.deleteSessionsForUser(record.userId);
      })();
      return json(res, 200, { ok: true });
    } catch (error) { return handleDomainError(error, res); }
  }

  // Public ToS read — the signup form's "Read" link needs this before
  // there's a session. Acceptance still requires auth (see /api/tos/accept).
  if (req.method === "GET" && pathname === "/api/tos") {
    return json(res, 200, {
      version: TOS_VERSION,
      title: TOS_TITLE,
      sections: TOS_SECTIONS
    });
  }

  // NOWPayments IPN webhook. Unauthenticated (the provider has no session) —
  // HMAC-SHA512 on the raw body against NOWPAYMENTS_IPN_SECRET gates this.
  if (req.method === "POST" && pathname === "/api/payments/webhook") {
    try {
      const raw = await readRawBody(req);
      const signature = req.headers["x-nowpayments-sig"];
      if (!verifyIpnSignature(raw, signature)) {
        logger.warn("payments webhook signature rejected", {
          event: "payments.webhook_bad_signature"
        });
        return json(res, 401, { error: "invalid_signature" });
      }
      const payload = JSON.parse(raw);
      const orderId = payload.order_id || null;
      const invoiceId = payload.invoice_id != null ? String(payload.invoice_id) : null;
      const paymentId = payload.payment_id != null ? String(payload.payment_id) : null;
      const purchase =
        (orderId && db.getPurchase(orderId)) ||
        (invoiceId && db.findPurchaseByProviderSession(PAYMENT_PROVIDER, invoiceId)) ||
        null;
      if (!purchase) {
        logger.warn("payments webhook for unknown purchase", {
          event: "payments.webhook_unknown_purchase",
          orderId,
          invoiceId
        });
        return json(res, 200, { ok: true, skipped: "unknown_purchase" });
      }
      const nextStatus = mapNowPaymentsStatus(payload.payment_status);
      const shouldCredit = nextStatus === "finished" && !purchase.ledgerEntryId;
      db.transaction(() => {
        let ledgerEntryId = purchase.ledgerEntryId || null;
        if (shouldCredit) {
          ledgerEntryId = newId("led_purchase");
          db.appendLedger([{
            id: ledgerEntryId,
            userId: purchase.userId,
            type: "purchase",
            availableDeltaCents: purchase.chipsCreditedCents,
            escrowDeltaCents: 0,
            refId: purchase.id,
            note: `Chip purchase: ${purchase.packageId}`,
            createdAt: new Date().toISOString()
          }]);
        }
        db.updatePurchase(purchase.id, {
          providerSessionId: invoiceId || purchase.providerSessionId,
          providerPaymentId: paymentId || purchase.providerPaymentId,
          status: nextStatus,
          payCurrency: payload.pay_currency || purchase.payCurrency,
          payAmount: payload.pay_amount != null ? String(payload.pay_amount) : purchase.payAmount,
          ledgerEntryId,
          rawProvider: payload
        });
      })();
      return json(res, 200, { ok: true });
    } catch (error) {
      logger.error("payments webhook handler failed", {
        event: "payments.webhook_error",
        err: error
      });
      return json(res, 500, { error: "webhook_failed" });
    }
  }

  let viewer;
  try {
    viewer = resolveViewer(req);
  } catch (error) {
    return handleDomainError(error, res);
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    return json(res, 200, { viewer: viewerPayload(viewer.id) });
  }

  if (req.method === "PATCH" && pathname === "/api/auth/account/email") {
    try {
      const body = await readJson(req);
      const user = await updateAccountEmail(viewer, body);
      return json(res, 200, { viewer: viewerPayload(user.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "PATCH" && pathname === "/api/auth/account/password") {
    try {
      const body = await readJson(req);
      const user = await updateAccountPassword(viewer, body);
      return json(res, 200, { viewer: viewerPayload(user.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/auth/onboarding/complete") {
    db.markOnboardingCompleted(viewer.id);
    return json(res, 200, { viewer: viewerPayload(viewer.id) });
  }

  if (req.method === "POST" && pathname === "/api/auth/logout-others") {
    const token = currentSessionId(req);
    db.deleteOtherSessions(viewer.id, token);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-email/send") {
    try {
      checkRateLimit(req, "emailLink");
      const user = db.getUser(viewer.id);
      if (user.emailVerifiedAt) {
        return json(res, 200, { ok: true, alreadyVerified: true });
      }
      await sendVerificationEmail(user);
      return json(res, 200, { ok: true });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    return json(res, 200, bootstrapPayload(viewer));
  }

  if (req.method === "GET" && pathname === "/api/avatars") {
    return json(res, 200, {
      catalog: avatarCatalogPayload(),
      ownedAvatarIds: db.listUserAvatarsForUser(viewer.id).map((a) => a.avatarId),
      equippedAvatar: db.getUser(viewer.id)?.equippedAvatar ?? DEFAULT_AVATAR_ID
    });
  }

  if (req.method === "POST" && pathname === "/api/avatars/equip") {
    try {
      const body = await readJson(req);
      equipAvatar(viewer.id, body?.avatarId);
      return json(res, 200, { viewer: viewerPayload(viewer.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/avatars/purchase") {
    try {
      const body = await readJson(req);
      purchaseAvatar(viewer.id, body?.avatarId);
      return json(res, 200, { viewer: viewerPayload(viewer.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/wallet") {
    return json(res, 200, {
      viewer: viewerPayload(viewer.id),
      ledger: db.listLedgerForUser(viewer.id)
    });
  }

  if (req.method === "GET" && pathname === "/api/games/history") {
    const games = db.listFinalizedGamesForUser(viewer.id, 50);
    const items = games.map((game) => historyEntry(game, viewer.id));
    return json(res, 200, { games: items });
  }

  let m;
  if (req.method === "GET" && (m = pathname.match(/^\/api\/users\/([^/]+)\/recent-games$/))) {
    const targetId = m[1];
    if (!db.getUser(targetId)) {
      return json(res, 404, { error: "user_not_found" });
    }
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;
    return json(res, 200, { games: userRecentGamesPayload(targetId, limit) });
  }

  if (req.method === "GET" && (m = pathname.match(/^\/api\/users\/([^/]+)$/))) {
    const targetId = m[1];
    const payload = userProfilePayload(targetId, viewer.id);
    if (!payload) {
      return json(res, 404, { error: "user_not_found" });
    }
    return json(res, 200, { user: payload });
  }

  if (req.method === "POST" && pathname === "/api/challenges") {
    try {
      checkRateLimit(req, "challenge");
      const body = await readJson(req);
      const challenge = createChallenge({
        challengerId: viewer.id,
        recipientId: body.recipientId || null,
        stakeCents: body.stakeCents,
        timeControl: body.timeControl
      });
      publishChallengeCreated(challenge);
      return json(res, 201, { challenge: challengePayload(challenge, viewer.id) });
    } catch (error) {
      return handleDomainError(error, res);
    }
  }

  if (req.method === "GET" && (m = pathname.match(/^\/api\/challenges\/([^/]+)$/))) {
    try {
      const challenge = refreshChallengeState(getChallengeOr404(m[1]));
      requireChallengeViewer(viewer, challenge);
      return json(res, 200, { challenge: challengePayload(challenge, viewer.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/challenges\/([^/]+)\/accept$/))) {
    try {
      const challenge = refreshChallengeState(getChallengeOr404(m[1]));
      requireRespondingParty(viewer, challenge);
      const accepted = acceptChallenge(challenge, viewer.id);
      const game = accepted.game;
      const updated = getChallengeOr404(m[1]);
      publishChallengeUpdated(updated);
      for (const cleaned of accepted.cleanedChallenges) publishChallengeUpdated(cleaned);
      publishMatchmakingMatched(game);
      scheduleClockTimeout(game);
      scheduleFirstMoveTimeout(game);
      return json(res, 200, {
        challenge: challengePayload(updated, viewer.id),
        viewer: viewerPayload(viewer.id),
        game: enrichGame(game)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/challenges\/([^/]+)\/decline$/))) {
    try {
      const challenge = refreshChallengeState(getChallengeOr404(m[1]));
      requireRespondingParty(viewer, challenge);
      db.saveChallenge(transitionChallenge(challenge, "declined", { declinedAt: new Date().toISOString() }));
      const updated = getChallengeOr404(m[1]);
      publishChallengeUpdated(updated);
      return json(res, 200, {
        challenge: challengePayload(updated, viewer.id),
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "DELETE" && (m = pathname.match(/^\/api\/challenges\/([^/]+)$/))) {
    try {
      const challenge = refreshChallengeState(getChallengeOr404(m[1]));
      requireChallenger(viewer, challenge);
      if (challenge.state !== "incoming" && challenge.state !== "countered") {
        const e = new RangeError(`cannot withdraw challenge in state ${challenge.state}`);
        e.code = "invalid_challenge_transition"; throw e;
      }
      db.saveChallenge(transitionChallenge(challenge, "declined", { withdrawnAt: new Date().toISOString() }));
      const updated = getChallengeOr404(m[1]);
      publishChallengeUpdated(updated);
      return json(res, 200, {
        challenge: challengePayload(updated, viewer.id),
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/challenges\/([^/]+)\/counter$/))) {
    try {
      const challenge = refreshChallengeState(getChallengeOr404(m[1]));
      requireRecipient(viewer, challenge);
      const body = await readJson(req);
      const stakeCents = Number.isInteger(body.stakeCents) ? body.stakeCents : challenge.stakeCents;
      const timeControl = typeof body.timeControl === "string" ? body.timeControl : challenge.timeControl;
      db.saveChallenge(transitionChallenge(challenge, "countered", {
        stakeCents, timeControl,
        pot: calculatePot({ stakeCents }),
        counteredAt: new Date().toISOString()
      }));
      const updated = getChallengeOr404(m[1]);
      publishChallengeUpdated(updated);
      return json(res, 200, {
        challenge: challengePayload(updated, viewer.id),
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && (m = pathname.match(/^\/api\/games\/([^/]+)$/))) {
    try {
      const game = getGameOr404(m[1]);
      requireGameViewer(viewer, game);
      return json(res, 200, { game: enrichGame(game) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && (m = pathname.match(/^\/api\/games\/([^/]+)\/settlement$/))) {
    try {
      const game = getGameOr404(m[1]);
      requirePlayer(viewer, game);
      return json(res, 200, { settlement: settlementPayload(game, viewer.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && (m = pathname.match(/^\/api\/games\/([^/]+)\/replay$/))) {
    try {
      const game = getGameOr404(m[1]);
      requireGameViewer(viewer, game);
      return json(res, 200, { replay: replayPayload(game) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/games\/([^/]+)\/resign$/))) {
    try {
      const game = getGameOr404(m[1]);
      requirePlayer(viewer, game);
      requireLiveGame(game);
      const timeoutPayload = flaggedSettlementPayload(game, viewer.id);
      if (timeoutPayload) return json(res, 200, timeoutPayload);
      resignGame(viewer, game);
      const refreshed = getGameOr404(m[1]);
      publishGameFinalized(refreshed);
      return json(res, 200, {
        game: enrichGame(refreshed),
        settlement: settlementPayload(refreshed, viewer.id),
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/games\/([^/]+)\/draw-offer$/))) {
    try {
      const game = getGameOr404(m[1]);
      requirePlayer(viewer, game);
      requireLiveGame(game);
      const timeoutPayload = flaggedSettlementPayload(game, viewer.id);
      if (timeoutPayload) return json(res, 200, timeoutPayload);
      const viewerColor = game.players.find((p) => p.id === viewer.id).color;
      const nextOffer = offerDraw(game.drawOffer, viewerColor, new Date());
      db.saveGame({ ...game, drawOffer: nextOffer });
      recordGameEvent(game.id, "draw_offered", { byUserId: viewer.id, color: viewerColor });
      const refreshed = getGameOr404(m[1]);
      publishGameUpdated(refreshed);
      return json(res, 200, { game: enrichGame(refreshed) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/games\/([^/]+)\/draw-accept$/))) {
    try {
      const game = getGameOr404(m[1]);
      requirePlayer(viewer, game);
      requireLiveGame(game);
      const timeoutPayload = flaggedSettlementPayload(game, viewer.id);
      if (timeoutPayload) return json(res, 200, timeoutPayload);
      const viewerColor = game.players.find((p) => p.id === viewer.id).color;
      acceptDraw(game.drawOffer, viewerColor); // throws if invalid; result.settle is implicit
      recordGameEvent(game.id, "draw_accepted", { byUserId: viewer.id, color: viewerColor });
      finalizeGame(game, { result: "draw", reason: "agreement" });
      const refreshed = getGameOr404(m[1]);
      publishGameFinalized(refreshed);
      return json(res, 200, {
        game: enrichGame(refreshed),
        settlement: settlementPayload(refreshed, viewer.id),
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/games\/([^/]+)\/draw-decline$/))) {
    try {
      const game = getGameOr404(m[1]);
      requirePlayer(viewer, game);
      requireLiveGame(game);
      const timeoutPayload = flaggedSettlementPayload(game, viewer.id);
      if (timeoutPayload) return json(res, 200, timeoutPayload);
      const viewerColor = game.players.find((p) => p.id === viewer.id).color;
      const nextOffer = declineDraw(game.drawOffer, viewerColor);
      db.saveGame({ ...game, drawOffer: nextOffer });
      recordGameEvent(game.id, "draw_declined", { byUserId: viewer.id, color: viewerColor });
      const refreshed = getGameOr404(m[1]);
      publishGameUpdated(refreshed);
      return json(res, 200, { game: enrichGame(refreshed) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/games\/([^/]+)\/finalize$/))) {
    try {
      if (!enableDevFinalize) {
        const e = new RangeError("manual finalization is disabled outside explicit dev mode");
        e.code = "dev_finalize_disabled"; throw e;
      }
      const game = getGameOr404(m[1]);
      requirePlayer(viewer, game);
      const body = await readJson(req);
      finalizeGame(game, { result: body.result, reason: body.reason });
      const refreshed = getGameOr404(m[1]);
      publishGameFinalized(refreshed);
      return json(res, 200, {
        game: enrichGame(refreshed),
        settlement: settlementPayload(refreshed, viewer.id),
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/games\/([^/]+)\/moves$/))) {
    try {
      const game = getGameOr404(m[1]);
      requireLiveGame(game);
      requireTurnOwner(viewer, game);
      const body = await readJson(req);

      const now = Date.now();
      if (settleIfFlagged(game, now)) {
        const refreshed = getGameOr404(m[1]);
        publishGameFinalized(refreshed);
        return json(res, 200, {
          game: enrichGame(refreshed),
          settlement: settlementPayload(refreshed, viewer.id),
          viewer: viewerPayload(viewer.id),
          timedOut: true
        });
      }

      const result = applyMove(game.fen, body, game.moves);
      const moves = [...game.moves, result.move];
      const nextClock = game.clock ? applyMoveToClock(game.clock, now) : null;
      const movingColor = game.players.find((p) => p.id === viewer.id).color;
      const nextDrawOffer = clearOwnOffer(game.drawOffer, movingColor);
      db.transaction(() => {
        db.saveGame({ ...game, fen: result.fen, moves, clock: nextClock, drawOffer: nextDrawOffer });
        recordGameEvent(game.id, "move", {
          ply: moves.length,
          byUserId: viewer.id,
          color: movingColor,
          san: result.move.san,
          from: result.move.from,
          to: result.move.to,
          promotion: result.move.promotion ?? null,
          fenAfter: result.fen,
          clockMs: nextClock ? (movingColor === "white" ? nextClock.whiteMs : nextClock.blackMs) : null
        });
      })();

      let autoSettled = false;
      if (result.result) {
        const refreshed = getGameOr404(m[1]);
        const challenge = db.getChallenge(refreshed.challengeId);
        if (challenge?.state === "accepted") {
          finalizeGame(refreshed, { result: result.result, reason: result.status });
          autoSettled = true;
        }
      }

      const refreshed = getGameOr404(m[1]);
      if (autoSettled) {
        publishGameFinalized(refreshed);
      } else {
        scheduleClockTimeout(refreshed);
        scheduleFirstMoveTimeout(refreshed);
        publishGameUpdated(refreshed);
      }
      return json(res, 200, {
        game: enrichGame(refreshed),
        settlement: autoSettled ? settlementPayload(refreshed, viewer.id) : null,
        viewer: autoSettled ? viewerPayload(viewer.id) : null
      });
    } catch (error) {
      if (["not_your_turn", "game_not_found", "game_already_finalized"].includes(error.code)) {
        return handleDomainError(error, res);
      }
      return json(res, error.code === "illegal_move" ? 422 : 400, {
        error: error.code || "invalid_move",
        message: error.message
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/matchmaking/quick") {
    try {
      checkRateLimit(req, "matchmaking");
      const body = await readJson(req);
      const result = quickMatch(viewer, body);
      if (result.matched && result.game) {
        for (const cleaned of result.cleanedChallenges) publishChallengeUpdated(cleaned);
        publishMatchmakingMatched(result.game);
        scheduleClockTimeout(result.game);
      }
      return json(res, 200, {
        matched: result.matched,
        ticket: result.ticket,
        game: result.game ? enrichGame(result.game) : null,
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/matchmaking/quick") {
    return json(res, 200, { ticket: db.getTicket(viewer.id) });
  }

  if (req.method === "DELETE" && pathname === "/api/matchmaking/quick") {
    db.deleteTicket(viewer.id);
    return json(res, 200, { ticket: null });
  }

  if (req.method === "GET" && pathname === "/api/external-accounts") {
    const accounts = db.listExternalAccountsForUser(viewer.id).map(publicExternalAccountPayload);
    return json(res, 200, { externalAccounts: accounts });
  }

  if (req.method === "POST" && pathname === "/api/external-accounts") {
    try {
      checkRateLimit(req, "externalAccounts");
      const body = await readJson(req);
      const { account, seededTo } = await linkExternalAccount(viewer, body);
      return json(res, 201, {
        externalAccount: publicExternalAccountPayload(account),
        viewer: viewerPayload(viewer.id),
        seededTo
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "DELETE" && (m = pathname.match(/^\/api\/external-accounts\/([^/]+)$/))) {
    try {
      unlinkExternalAccount(viewer, m[1]);
      return json(res, 200, { viewer: viewerPayload(viewer.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/external-accounts\/([^/]+)\/verify\/start$/))) {
    try {
      checkRateLimit(req, "externalAccounts");
      const body = await readJson(req);
      const result = startVerification(viewer, m[1], { regenerate: !!body?.regenerate });
      return json(res, 200, {
        externalAccount: publicExternalAccountPayload(result.account),
        claimToken: result.claimToken,
        claimTokenExpiresAt: result.claimTokenExpiresAt,
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/external-accounts\/([^/]+)\/verify\/check$/))) {
    try {
      checkRateLimit(req, "externalAccounts");
      const result = await checkVerification(viewer, m[1]);
      return json(res, 200, {
        externalAccount: publicExternalAccountPayload(result.account),
        seededTo: result.seededTo,
        viewer: viewerPayload(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  // ---- ToS (accept) ----------------------------------------------------------

  if (req.method === "POST" && pathname === "/api/tos/accept") {
    try {
      const body = await readJson(req);
      const acceptedVersion = Number(body.tosVersion);
      if (!Number.isInteger(acceptedVersion) || acceptedVersion < 1) {
        const e = new RangeError("tosVersion is required");
        e.code = "tos_required"; throw e;
      }
      if (acceptedVersion !== TOS_VERSION) {
        const e = new RangeError(`Stale ToS version. Current: ${TOS_VERSION}.`);
        e.code = "tos_version_stale"; throw e;
      }
      db.recordTosAcceptance({ userId: viewer.id, tosVersion: acceptedVersion });
      return json(res, 200, { viewer: viewerPayload(viewer.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  // ---- Payments (scaffold — slice 1) -----------------------------------------
  // Slice 1 ships routes that gate on the kill switch and ToS; slice 2 fills
  // in the NOWPayments invoice + IPN webhook against the same surface.

  if (req.method === "POST" && pathname === "/api/payments/checkout") {
    try {
      if (!paymentsEnabled) {
        const e = new RangeError("Payments are not enabled in this environment.");
        e.code = "payments_disabled"; throw e;
      }
      const latestTos = db.getLatestTosAcceptance(viewer.id);
      if (needsTosAcceptance(latestTos?.tosVersion ?? null)) {
        const e = new RangeError("You must accept the current Horsey Terms first.");
        e.code = "tos_required"; throw e;
      }
      const body = await readJson(req);
      const pkg = packageById(body?.packageId);
      if (!pkg) {
        const e = new RangeError("Unknown chip package.");
        e.code = "payments_unknown_package"; throw e;
      }
      const purchaseId = newId("pur");
      db.insertPurchase({
        id: purchaseId,
        userId: viewer.id,
        provider: PAYMENT_PROVIDER,
        packageId: pkg.id,
        amountUsdCents: pkg.priceUsdCents,
        chipsCreditedCents: pkg.chipsCents,
        status: "pending"
      });
      let invoice;
      try {
        invoice = await createInvoice({
          purchaseId,
          amountUsdCents: pkg.priceUsdCents,
          packageLabel: pkg.label
        });
      } catch (providerError) {
        db.updatePurchase(purchaseId, {
          status: "failed",
          rawProvider: { error: String(providerError?.message || providerError) }
        });
        throw providerError;
      }
      db.updatePurchase(purchaseId, {
        providerSessionId: invoice.invoiceId,
        rawProvider: invoice.raw
      });
      return json(res, 200, { purchaseId, invoiceUrl: invoice.invoiceUrl });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/payments/purchases") {
    try {
      const purchases = db.listPurchasesForUser(viewer.id, 50);
      return json(res, 200, { purchases });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/cashout-waitlist") {
    try {
      const body = await readJson(req);
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email || !email.includes("@")) {
        const e = new RangeError("A valid email is required to join the cashout waitlist.");
        e.code = "waitlist_email_required"; throw e;
      }
      db.addCashoutWaitlistEntry({ userId: viewer.id, email });
      return json(res, 200, { ok: true });
    } catch (error) { return handleDomainError(error, res); }
  }

  // ---- Notifications ---------------------------------------------------------

  if (req.method === "GET" && pathname === "/api/notifications") {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
      const notifications = db.listNotificationsForUser(viewer.id, limit);
      const unreadCount = db.countUnreadNotificationsForUser(viewer.id);
      return json(res, 200, { notifications, unreadCount });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/notifications/unread-count") {
    try {
      return json(res, 200, { unreadCount: db.countUnreadNotificationsForUser(viewer.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/))) {
    try {
      db.markNotificationRead(viewer.id, m[1]);
      return json(res, 200, {
        unreadCount: db.countUnreadNotificationsForUser(viewer.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/notifications/read-all") {
    try {
      const changed = db.markAllNotificationsRead(viewer.id);
      return json(res, 200, { marked: changed, unreadCount: 0 });
    } catch (error) { return handleDomainError(error, res); }
  }

  // ---- Admin ---------------------------------------------------------------
  // Every /api/admin/* route gates on users.is_admin via requireAdmin.

  if (req.method === "GET" && pathname === "/api/admin/audit") {
    try {
      requireAdmin(viewer);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
      return json(res, 200, { actions: db.listAdminActions(limit) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/admin\/games\/([^/]+)\/void$/))) {
    try {
      requireAdmin(viewer);
      const body = await readJson(req);
      const reason = requireAdminReason(body.reason);
      const game = getGameOr404(m[1]);
      const result = adminVoidGame(viewer, game, reason);
      publishGameFinalized(result.game);
      return json(res, 200, {
        game: enrichGame(result.game),
        alreadyNoop: result.alreadyNoop,
        ratingReversal: result.ratingReversal ?? null,
        actions: db.listAdminActionsForTarget("game", game.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/admin\/games\/([^/]+)\/adjust$/))) {
    try {
      requireAdmin(viewer);
      const body = await readJson(req);
      const reason = requireAdminReason(body.reason);
      const game = getGameOr404(m[1]);
      const result = adminAdjustGame(viewer, game, { result: body.result, reason });
      publishGameFinalized(result.game);
      return json(res, 200, {
        game: enrichGame(result.game),
        actions: db.listAdminActionsForTarget("game", game.id)
      });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/admin\/users\/([^/]+)\/restrictions$/))) {
    try {
      requireAdmin(viewer);
      const body = await readJson(req);
      const reason = requireAdminReason(body.reason);
      const result = adminSetRestrictions(viewer, m[1], body.restrictions, reason);
      for (const gameId of result.autoVoided) {
        const game = db.getGame(gameId);
        if (game) publishGameFinalized(game);
      }
      return json(res, 200, result);
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && (m = pathname.match(/^\/api\/admin\/users\/([^/]+)\/restrictions\/([^/]+)\/clear$/))) {
    try {
      requireAdmin(viewer);
      const body = await readJson(req);
      const reason = requireAdminReason(body.reason);
      return json(res, 200, adminClearRestriction(viewer, m[1], m[2], reason));
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/admin/users") {
    try {
      requireAdmin(viewer);
      const ledger = db.listLedger();
      const users = db.listUsers().map((user) => {
        const wallet = walletSummary(ledger, user.id);
        const finishedGames = db.listFinalizedGamesForUser(user.id, 50).length;
        const externalAccounts = db.listExternalAccountsForUser(user.id);
        const trustTier = computeTrustTier({ externalAccounts, finishedGames });
        return {
          id: user.id,
          handle: user.handle,
          email: user.email,
          rating: user.rating,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt,
          emailVerifiedAt: user.emailVerifiedAt,
          balanceCents: wallet.balanceCents,
          escrowCents: wallet.escrowCents,
          finishedGames,
          trustTier,
          restrictions: db.listActiveRestrictionsForUser(user.id)
        };
      });
      users.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
      return json(res, 200, { users });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/admin/games") {
    try {
      requireAdmin(viewer);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = clampInt(url.searchParams.get("limit"), 50, 1, 500);
      const live = db.listLiveGames().map(summarizeGameRow);
      const recentFinalized = db.listRecentFinalizedGames(limit).map(summarizeGameRow);
      return json(res, 200, { live, recentFinalized });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/admin/stuck-games") {
    try {
      requireAdmin(viewer);
      const now = Date.now();
      const stuck = db.listLiveGames()
        .map((game) => {
          const flagged = game.clock ? flaggedSide(game.clock, now) : null;
          const lastMoveIso = game.clock?.lastMoveAt ?? null;
          const idleMs = lastMoveIso ? now - new Date(lastMoveIso).getTime() : null;
          return { game, flagged, idleMs };
        })
        .filter(({ flagged, idleMs }) => flagged || (idleMs != null && idleMs > 15 * 60 * 1000))
        .map(({ game, flagged, idleMs }) => ({
          ...summarizeGameRow(game),
          flaggedSide: flagged,
          idleMs
        }));
      return json(res, 200, { stuck });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/admin/ledger") {
    try {
      requireAdmin(viewer);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = clampInt(url.searchParams.get("limit"), 200, 1, 1000);
      const userIdFilter = url.searchParams.get("userId") || null;
      const typeFilter = url.searchParams.get("type") || null;
      let entries = userIdFilter
        ? db.listLedgerForUser(userIdFilter)
        : db.listLedger();
      if (typeFilter) entries = entries.filter((e) => e.type === typeFilter);
      entries.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
      entries = entries.slice(0, limit);
      return json(res, 200, { entries });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/admin/external-accounts") {
    try {
      requireAdmin(viewer);
      const accounts = db.listAllExternalAccounts().map((a) => ({
        id: a.id,
        userId: a.userId,
        provider: a.provider,
        externalUsername: a.externalUsername,
        status: a.status,
        verifiedAt: a.verifiedAt,
        claimTokenExpiresAt: a.claimTokenExpiresAt,
        lastSyncedAt: a.lastSyncedAt,
        createdAt: a.createdAt
      }));
      return json(res, 200, { accounts });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "GET" && pathname === "/api/admin/challenges") {
    try {
      requireAdmin(viewer);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
      const challenges = db.listRecentChallengesAll(limit).map((c) => ({
        id: c.id,
        state: c.state,
        challengerId: c.challengerId,
        recipientId: c.recipientId,
        gameId: c.gameId,
        stakeCents: c.stakeCents,
        timeControl: c.timeControl,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      }));
      return json(res, 200, { challenges });
    } catch (error) { return handleDomainError(error, res); }
  }

  return notFound(res);
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function summarizeGameRow(game) {
  return {
    id: game.id,
    state: game.state,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    endedAt: game.endedAt,
    endReason: game.endReason,
    winnerId: game.winnerId,
    timeControl: game.timeControl,
    players: (game.players || []).map((p) => ({
      id: p.id,
      handle: p.handle,
      color: p.color
    })),
    moveCount: game.moves?.length ?? 0,
    pot: game.pot
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = safePath === "/" ? "/index.html" : safePath;
  let filePath = path.join(webDir, requestedPath);

  if (!filePath.startsWith(webDir)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch { filePath = path.join(webDir, "index.html"); }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

function logRequest(req, res, log, startMs) {
  // Health endpoint is hit by uptime checks every few seconds; logging each
  // call drowns out real signal. Successful 2xx health pings are silenced;
  // anything else still surfaces.
  const pathname = req.url ? req.url.split("?")[0] : "";
  const isHealth = pathname === "/api/health" && res.statusCode < 400;
  if (isHealth) return;
  const durationMs = Date.now() - startMs;
  const fields = {
    event: "request.complete",
    method: req.method,
    path: pathname,
    status: res.statusCode,
    durationMs
  };
  if (res.statusCode >= 500) log.error("request 5xx", fields);
  else if (res.statusCode >= 400) log.warn("request 4xx", fields);
  else log.info("request", fields);
}

const server = http.createServer((req, res) => {
  const requestId = nextRequestId();
  const reqLog = logger.child({ requestId });
  const startMs = Date.now();
  res.on("finish", () => logRequest(req, res, reqLog, startMs));
  if (req.url.startsWith("/api/")) {
    routeApi(req, res).catch((error) => {
      reqLog.error("unhandled api error", {
        event: "request.unhandled_error",
        method: req.method,
        path: req.url,
        err: error
      });
      json(res, 500, { error: "internal_error" });
    });
    return;
  }
  serveStatic(req, res).catch((error) => {
    reqLog.error("unhandled static error", {
      event: "request.unhandled_error",
      method: req.method,
      path: req.url,
      err: error
    });
    json(res, 500, { error: "internal_error" });
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  let viewer;
  try {
    viewer = viewerFromSessionToken(parseCookies(req)[SESSION_COOKIE]);
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachWebSocket(ws, viewer);
  });
});

function attachWebSocket(ws, viewer) {
  const client = {
    send(payload) { ws.send(payload); },
    isClosed() { return ws.readyState !== ws.OPEN; }
  };
  const gameChannels = new Set();
  // gameIds where this connection was counted as a spectator (i.e., the viewer
  // is not a player). Tracked here so cleanup() can decrement watcher refcounts
  // even when the socket closes without an explicit unsubscribe.
  const watchedGameIds = new Set();
  const userChannel = CHANNELS.user(viewer.id);
  broker.subscribe(userChannel, client);
  broker.subscribe(CHANNELS.lobby, client);

  const connectChange = presence.connect(viewer.id);
  if (!connectChange.previouslyOnline) {
    publishPresenceChanged(viewer.id);
    publishLobbyHeartbeat();
  }
  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    broker.unsubscribeAll(client);
    for (const gameId of watchedGameIds) {
      const changed = removeWatcher(gameId, viewer.id);
      if (changed) publishWatcherCount(gameId);
    }
    watchedGameIds.clear();
    const change = presence.disconnect(viewer.id);
    if (change.previouslyOnline && !change.nowOnline) {
      publishPresenceChanged(viewer.id);
      publishLobbyHeartbeat();
    }
  }

  function subscribeGame(gameId) {
    const game = db.getGame(gameId);
    try {
      if (!game) {
        const e = new RangeError("game not found");
        e.code = "game_not_found";
        throw e;
      }
      requireGameViewer(viewer, game);
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", code: error.code || "not_a_player", channel: CHANNELS.game(gameId) }));
      return;
    }
    const channel = CHANNELS.game(gameId);
    if (gameChannels.has(channel)) return;
    broker.subscribe(channel, client);
    gameChannels.add(channel);
    const isSpectator = !isGamePlayer(viewer, game) && game.state === "live";
    if (isSpectator) {
      watchedGameIds.add(gameId);
      const changed = addWatcher(gameId, viewer.id);
      if (changed) publishWatcherCount(gameId);
    }
    ws.send(JSON.stringify({
      type: "subscribed",
      channel,
      watcherCount: watcherCountForGame(gameId)
    }));
  }

  function unsubscribeGame(gameId) {
    const channel = CHANNELS.game(gameId);
    if (!gameChannels.has(channel)) return;
    broker.unsubscribe(channel, client);
    gameChannels.delete(channel);
    if (watchedGameIds.delete(gameId)) {
      const changed = removeWatcher(gameId, viewer.id);
      if (changed) publishWatcherCount(gameId);
    }
    ws.send(JSON.stringify({ type: "unsubscribed", channel }));
  }

  ws.send(JSON.stringify({ type: "ready", viewerId: viewer.id, userChannel }));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "subscribe" && typeof msg.channel === "string") {
      const [scope, id] = msg.channel.split(":");
      if (scope === "game" && id) subscribeGame(id);
    } else if (msg.type === "unsubscribe" && typeof msg.channel === "string") {
      const [scope, id] = msg.channel.split(":");
      if (scope === "game" && id) unsubscribeGame(id);
    } else if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

export async function closeServerResources() {
  for (const gameId of clockTimeouts.keys()) clearClockTimeout(gameId);
  for (const gameId of firstMoveTimeouts.keys()) clearFirstMoveTimeout(gameId);
  if (botDaemon) {
    await botDaemon.stop();
    botDaemon = null;
  }
  wss.close();
  db.close();
}

export { routeApi };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, host, async () => {
    logger.info("server listening", {
      event: "startup.listening",
      host,
      port,
      dbPath,
      nodeEnv: process.env.NODE_ENV || "development"
    });
    if (process.env.NODE_ENV === "production" && !process.env.RESEND_API_KEY) {
      logger.warn(
        "NODE_ENV=production but RESEND_API_KEY is unset — verification and password-reset emails will be silently dropped",
        { event: "startup.resend_key_missing" }
      );
    }
    rehydrateClockTimeouts();
    if (enableDevBots) {
      try {
        const { startBotDaemon } = await import("./dev-bots.mjs");
        const botLog = logger.child({ component: "dev-bots" });
        botDaemon = await startBotDaemon({
          db,
          services: {
            signupAccount,
            createChallenge,
            acceptChallenge,
            finalizeGame,
            publishChallengeCreated,
            publishChallengeUpdated,
            publishGameUpdated,
            publishGameFinalized,
            publishMatchmakingMatched,
            scheduleClockTimeout
          },
          log: (...args) => botLog.info(args.map(String).join(" "), { event: "dev_bots.log" })
        });
      } catch (err) {
        logger.warn("bot daemon failed to start", {
          event: "startup.bot_daemon_failed",
          err
        });
      }
    }
  });
}
