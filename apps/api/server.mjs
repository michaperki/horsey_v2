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
  msUntilFlag
} from "../../packages/shared/clocks.mjs";
import { computeRatingChange } from "../../packages/shared/rating.mjs";
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
const enableDevFinalize = process.env.HORSEY_ENABLE_DEV_FINALIZE === "1";

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
  return {
    ...summary,
    ...game,
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

function publishMatchmakingMatched(game) {
  if (!game) return;
  const enriched = enrichGame(game);
  for (const player of game.players) {
    broker.publish(CHANNELS.user(player.id), {
      type: "matchmaking.matched",
      game: enriched
    });
  }
}

function viewerPayload(viewerId) {
  const user = db.getUser(viewerId);
  return { ...user, ...walletSummary(db.listLedger(), viewerId) };
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
    cannot_match_self: 400,
    negative_wallet: 500,
    draw_already_offered: 409,
    draw_should_accept: 409,
    no_draw_offer: 409,
    not_your_offer_to_accept: 409,
    not_your_offer_to_decline: 409,
    dev_finalize_disabled: 403
  };
  return json(res, statuses[error.code] || 400, {
    error: error.code || "invalid_request",
    message: error.message
  });
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
  if (recipientId === challengerId) {
    const e = new RangeError("cannot challenge yourself");
    e.code = "invalid_challenge_input"; throw e;
  }
  if (recipientId && !db.getUser(recipientId)) {
    const e = new RangeError(`unknown recipient: ${recipientId}`);
    e.code = "invalid_challenge_input"; throw e;
  }

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
      clock
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
    const e = new RangeError("email already registered");
    e.code = "email_taken"; throw e;
  }
  if (db.getUserByHandle(clean.handle)) {
    const e = new RangeError("handle already taken");
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
  const lobby = db.getLobby();
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
      const body = await readJson(req);
      const { user, session } = await signupAccount(body);
      setSessionCookie(res, session.id);
      return json(res, 201, { viewer: viewerPayload(user.id) });
    } catch (error) { return handleDomainError(error, res); }
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    try {
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

  if (req.method === "POST" && pathname === "/api/challenges") {
    try {
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

  let m;
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
      requireRecipient(viewer, challenge);
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
      requireRecipient(viewer, challenge);
      db.saveChallenge(transitionChallenge(challenge, "declined", { declinedAt: new Date().toISOString() }));
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
      requirePlayer(viewer, game);
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
      requirePlayer(viewer, game);
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

      const result = applyMove(game.fen, body);
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

  function subscribeGame(gameId) {
    const game = db.getGame(gameId);
    if (!game?.players.some((p) => p.id === viewer.id)) {
      ws.send(JSON.stringify({ type: "error", code: "not_a_player", channel: CHANNELS.game(gameId) }));
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

  ws.on("close", () => {
    broker.unsubscribeAll(client);
  });

  ws.on("error", () => {
    broker.unsubscribeAll(client);
  });
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
