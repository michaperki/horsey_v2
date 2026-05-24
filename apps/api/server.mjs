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
  generateSessionToken,
  hashPassword,
  isSessionExpired,
  newSessionExpiry,
  SESSION_TTL_MS,
  validateLoginInput,
  validateEmailInput,
  validateSignupInput,
  verifyPassword
} from "./auth.mjs";
import { applyMove, STARTING_FEN, summarizeGame } from "../../packages/chess/src/board.mjs";
import {
  calculatePot,
  createEscrowHold,
  findSettlementEntries,
  settleGame,
  transitionChallenge,
  walletSummary
} from "../../packages/shared/domain.mjs";
import {
  applyMoveToClock,
  flaggedSide,
  initClockState,
  msUntilFlag,
  parseTimeControl
} from "../../packages/shared/clocks.mjs";
import { computeRatingChange } from "../../packages/shared/rating.mjs";
import {
  computeTrustTier,
  effectiveStakeCapCents,
  stakeCapForTier
} from "../../packages/shared/trust.mjs";
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
const rateLimits = new Map();

const RATE_LIMITS = {
  auth: { limit: 12, windowMs: 60_000 },
  challenge: { limit: 30, windowMs: 60_000 },
  matchmaking: { limit: 40, windowMs: 60_000 },
  externalAccounts: { limit: 8, windowMs: 60_000 }
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
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
  const playersWithPresence = (game.players || []).map((player) => ({
    ...player,
    presence: presence.snapshot(player.id)
  }));
  return {
    ...summary,
    ...game,
    players: playersWithPresence,
    moveNumber: Math.floor(moves.length / 2) + 1,
    lastMove: moves[moves.length - 1] || null,
    moveRows: moveRows(moves)
  };
}

const SESSION_COOKIE = "horsey_session";

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
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
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
    players: (game.players || []).map((p) => ({
      id: p.id,
      handle: p.handle,
      rating: p.rating
    })),
    stakeCents: game.pot?.stakeCents ?? 0,
    timeControl: game.timeControl,
    moveCount: (game.moves || []).length,
    startedAt: game.createdAt
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
  return {
    ...user,
    ...walletSummary(db.listLedger(), viewerId),
    ...trustChipsForUser(viewerId)
  };
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
    rating: user.rating
  };
}

function requireRecipient(viewer, challenge) {
  if (challenge.recipientId && viewer.id !== challenge.recipientId) {
    const e = new RangeError("only the recipient can act on this challenge");
    e.code = "not_your_challenge";
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
    external_rate_limited: 502,
    external_fetch_timeout: 504,
    external_fetch_failed: 502,
    stake_exceeds_trust_cap: 403,
    external_account_already_verified: 409,
    claim_token_missing: 409,
    claim_token_expired: 410,
    claim_token_not_found_in_profile: 422
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
  const winEntry = entries.find((e) => e.type === "wager_win");
  const rakeEntry = entries.find((e) => e.type === "rake");
  const releaseEntry = entries.find((e) => e.type === "escrow_release" && e.userId === viewerId);
  const drawEntry = entries.find((e) => e.type === "wager_draw" && e.userId === viewerId);

  const stakeCents = game.pot?.stakeCents ?? 0;
  const pot = stakeCents ? calculatePot({ stakeCents }) : { grossPotCents: 0, rakeCents: 0, netPotCents: 0 };
  const isDraw = !winEntry && entries.some((e) => e.type === "wager_draw");
  const winnerId = winEntry?.userId ?? null;
  const viewerWon = winnerId === viewerId;
  let result = "pending";
  if (finalized) result = isDraw ? "draw" : viewerWon ? "win" : "loss";

  let creditedCents = 0;
  if (finalized) {
    const release = releaseEntry?.availableDeltaCents ?? 0;
    if (isDraw) creditedCents = release + (drawEntry?.availableDeltaCents ?? 0);
    else if (viewerWon) creditedCents = release + (winEntry?.availableDeltaCents ?? 0);
  }

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
    rakeCents: rakeEntry?.availableDeltaCents ?? pot.rakeCents,
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
    return db.getGame(challenge.gameId);
  }
  if (challenge.state !== "incoming" && challenge.state !== "countered") {
    const e = new RangeError(`cannot accept challenge in state ${challenge.state}`);
    e.code = "invalid_challenge_transition"; throw e;
  }

  // An open table's host already passed their cap at creation, but the taker
  // can be at a lower tier; check both sides at accept time.
  requireStakeWithinCap(challenge.stakeCents, accepterId, challenge.challengerId);

  let createdGame;
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
  })();
  return createdGame;
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
      db.saveGame({
        ...game,
        state: "finalized",
        winnerId,
        endReason,
        endedAt,
        ratingChange
      });
      recordGameEvent(game.id, "finalized", {
        result,
        reason: endReason,
        winnerId,
        ratingChange
      });
    }
  })();
  clearClockTimeout(game.id);
}

function resignGame(viewer, game) {
  if (game.state === "finalized") {
    const e = new RangeError("game already finalized");
    e.code = "game_already_finalized"; throw e;
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
    }
  }
}

function quickMatch(viewer, { stakeCents, timeControl }) {
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

  requireStakeWithinCap(stakeCents, viewer.id);

  let matchedGame = null;
  db.transaction(() => {
    const opponentTicket = db.findMatchingTicket(stakeCents, timeControl, viewer.id);
    if (opponentTicket) {
      const challenge = createChallenge({
        challengerId: opponentTicket.userId,
        recipientId: viewer.id,
        stakeCents,
        timeControl
      });
      matchedGame = acceptChallenge(db.getChallenge(challenge.id), viewer.id);
    } else {
      db.upsertTicket({
        userId: viewer.id,
        stakeCents,
        timeControl,
        createdAt: new Date().toISOString()
      });
    }
  })();
  return { matched: !!matchedGame, game: matchedGame, ticket: db.getTicket(viewer.id) };
}

async function signupAccount({ email, handle, password }) {
  const clean = validateSignupInput({ email, handle, password });
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
    session = startSession(userId, now);
  })();
  return { user: db.getUser(userId), session };
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
    matchmakingTicket: ticket
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

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    return json(res, 200, bootstrapPayload(viewer));
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
      const game = acceptChallenge(challenge, viewer.id);
      const updated = getChallengeOr404(m[1]);
      publishChallengeUpdated(updated);
      publishMatchmakingMatched(game);
      scheduleClockTimeout(game);
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

  return notFound(res);
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

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    routeApi(req, res).catch((error) => {
      console.error(error);
      json(res, 500, { error: "internal_error" });
    });
    return;
  }
  serveStatic(req, res).catch((error) => {
    console.error(error);
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
    ws.send(JSON.stringify({ type: "subscribed", channel }));
  }

  function unsubscribeGame(gameId) {
    const channel = CHANNELS.game(gameId);
    if (!gameChannels.has(channel)) return;
    broker.unsubscribe(channel, client);
    gameChannels.delete(channel);
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

export function closeServerResources() {
  for (const gameId of clockTimeouts.keys()) clearClockTimeout(gameId);
  wss.close();
  db.close();
}

export { routeApi };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => {
    console.log(`Horsey dev server running at http://${host}:${port}`);
    console.log(`Database: ${dbPath}`);
    rehydrateClockTimeouts();
  });
}
