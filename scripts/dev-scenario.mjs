#!/usr/bin/env node

import path from "node:path";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../apps/api/db.mjs";
import { hashPassword } from "../apps/api/auth.mjs";
import { SIGNUP_DEFAULT_RATING } from "../apps/api/seed.mjs";
import { STARTING_FEN, applyMove } from "../packages/chess/src/board.mjs";
import { initClockState } from "../packages/shared/clocks.mjs";
import {
  calculatePot,
  cents,
  createEscrowHold,
  settleGame
} from "../packages/shared/domain.mjs";
import { computeRatingChange } from "../packages/shared/rating.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const DEFAULT_DB_PATH = "/tmp/horsey-qa.db";
const PASSWORD = "password123";

const USER_FIXTURES = [
  {
    id: "usr_qa_alice",
    handle: "alice_provisional",
    email: "alice.provisional@example.test",
    rating: SIGNUP_DEFAULT_RATING,
    avatar: "knight-01"
  },
  {
    id: "usr_qa_bob",
    handle: "bob_claimed",
    email: "bob.claimed@example.test",
    rating: 1780,
    avatar: "bishop-01",
    externalAccount: {
      id: "ext_qa_bob_lichess",
      provider: "lichess",
      externalUsername: "bob_claimed_lichess",
      externalId: "bob_claimed_lichess",
      status: "claimed",
      importedStats: providerStats({ blitz: 1780, rapid: 1810, games: 820 })
    }
  },
  {
    id: "usr_qa_vish",
    handle: "vish_verified",
    email: "vish.verified@example.test",
    rating: 2140,
    avatar: "rook-02",
    externalAccount: {
      id: "ext_qa_vish_lichess",
      provider: "lichess",
      externalUsername: "vish_verified_lichess",
      externalId: "vish_verified_lichess",
      status: "verified",
      verifiedAt: "2026-05-01T10:00:00.000Z",
      verifiedBy: "dev_fixture",
      importedStats: providerStats({ bullet: 2090, blitz: 2140, rapid: 2205, games: 3400 })
    }
  },
  {
    id: "usr_qa_mira",
    handle: "mira_established",
    email: "mira.established@example.test",
    rating: 1965,
    avatar: "queen-03",
    externalAccount: {
      id: "ext_qa_mira_lichess",
      provider: "lichess",
      externalUsername: "mira_established_lichess",
      externalId: "mira_established_lichess",
      status: "verified",
      verifiedAt: "2026-04-15T10:00:00.000Z",
      verifiedBy: "dev_fixture",
      importedStats: providerStats({ bullet: 1890, blitz: 1965, rapid: 2030, games: 5100 })
    }
  },
  {
    id: "usr_qa_otto",
    handle: "otto_regular",
    email: "otto.regular@example.test",
    rating: 1610,
    avatar: "king-01"
  }
];

const CHECKMATE_MOVES = [
  ["e2", "e4"],
  ["e7", "e5"],
  ["f1", "c4"],
  ["b8", "c6"],
  ["d1", "h5"],
  ["g8", "f6"],
  ["h5", "f7"]
];

const BLACK_CHECKMATE_MOVES = [
  ["f2", "f3"],
  ["e7", "e5"],
  ["g2", "g4"],
  ["d8", "h4"]
];

const SCENARIOS = new Set([
  "fresh-two-player",
  "live-game",
  "settled-checkmate",
  "draw-settlement",
  "timeout-settlement",
  "trust-matrix"
]);

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) || "trust-matrix";
const dbPath = valueAfter("--db") || process.env.HORSEY_QA_DB_PATH || DEFAULT_DB_PATH;
const keep = args.includes("--keep");
const allowNonTmp = args.includes("--allow-non-tmp");

if (!SCENARIOS.has(scenario)) {
  console.error(`Unknown scenario "${scenario}".`);
  console.error(`Available: ${[...SCENARIOS].join(", ")}`);
  process.exit(1);
}

if (!allowNonTmp && !path.resolve(dbPath).startsWith("/tmp/")) {
  console.error(`Refusing to reset non-/tmp database: ${dbPath}`);
  console.error("Pass --allow-non-tmp only if you intentionally want to replace that local DB.");
  process.exit(1);
}

if (!keep) resetSqliteFiles(dbPath);

const db = openDatabase(dbPath);

try {
  await seedBaseUsers(db);
  await applyScenario(db, scenario);
  printSummary(db, scenario, dbPath);
} finally {
  db.close();
}

function valueAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function resetSqliteFiles(target) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${target}${suffix}`, { force: true });
  }
}

function providerStats({ bullet = null, blitz = null, rapid = null, classical = null, games = 500 }) {
  const perf = (rating) => rating == null ? null : { rating, games, provisional: false };
  return {
    title: null,
    accountCreatedAt: "2024-01-15T10:00:00.000Z",
    ratings: {
      bullet: perf(bullet),
      blitz: perf(blitz),
      rapid: perf(rapid),
      classical: perf(classical)
    },
    raw: { source: "dev_fixture" }
  };
}

async function seedBaseUsers(db) {
  for (const fixture of USER_FIXTURES) {
    if (!db.getUser(fixture.id)) {
      const { passwordHash, passwordSalt } = await hashPassword(PASSWORD);
      db.insertUser({
        id: fixture.id,
        email: fixture.email,
        handle: fixture.handle,
        passwordHash,
        passwordSalt,
        rating: fixture.rating,
        createdAt: "2026-05-01T10:00:00.000Z"
      });
      db.markOnboardingCompleted(fixture.id, "2026-05-01T10:00:00.000Z");
      db.appendLedger([{
        id: `led_qa_grant_${fixture.id}`,
        userId: fixture.id,
        type: "seed_grant",
        availableDeltaCents: cents(10_000),
        escrowDeltaCents: 0,
        refId: "dev_scenario",
        note: "Dev scenario bankroll",
        createdAt: "2026-05-01T10:00:00.000Z"
      }]);
    }

    if (fixture.avatar) {
      db.grantUserAvatar(fixture.id, fixture.avatar, "dev_fixture", "2026-05-01T10:00:00.000Z");
      db.updateUserEquippedAvatar(fixture.id, fixture.avatar);
    }

    if (fixture.externalAccount && !db.getExternalAccount(fixture.externalAccount.id)) {
      const now = "2026-05-01T10:00:00.000Z";
      db.insertExternalAccount({
        ...fixture.externalAccount,
        userId: fixture.id,
        claimToken: null,
        claimTokenExpiresAt: null,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now
      });
    }
  }
}

async function applyScenario(db, name) {
  if (name === "fresh-two-player") return;

  if (name === "live-game") {
    createLiveGame(db, {
      id: "game_qa_live_alice_bob",
      whiteId: "usr_qa_alice",
      blackId: "usr_qa_bob",
      stakeCents: cents(5),
      timeControl: "3+0",
      createdAt: minutesAgo(8)
    });
    return;
  }

  if (name === "settled-checkmate") {
    createFinalizedGame(db, {
      id: "game_qa_mate_alice_bob",
      whiteId: "usr_qa_alice",
      blackId: "usr_qa_bob",
      winnerId: "usr_qa_alice",
      result: "white_win",
      reason: "checkmate",
      stakeCents: cents(5),
      timeControl: "3+0",
      moves: CHECKMATE_MOVES,
      endedAt: minutesAgo(5)
    });
    return;
  }

  if (name === "draw-settlement") {
    createFinalizedGame(db, {
      id: "game_qa_draw_vish_mira",
      whiteId: "usr_qa_vish",
      blackId: "usr_qa_mira",
      winnerId: null,
      result: "draw",
      reason: "agreement",
      stakeCents: cents(25),
      timeControl: "5+0",
      moves: [
        ["g1", "f3"],
        ["g8", "f6"],
        ["f3", "g1"],
        ["f6", "g8"]
      ],
      endedAt: minutesAgo(5)
    });
    return;
  }

  if (name === "timeout-settlement") {
    createFinalizedGame(db, {
      id: "game_qa_timeout_bob_vish",
      whiteId: "usr_qa_bob",
      blackId: "usr_qa_vish",
      winnerId: "usr_qa_vish",
      result: "black_win",
      reason: "timeout",
      stakeCents: cents(10),
      timeControl: "30s+0",
      moves: [["e2", "e4"], ["e7", "e5"]],
      endedAt: minutesAgo(5)
    });
    return;
  }

  createLiveGame(db, {
    id: "game_qa_live_alice_bob",
    whiteId: "usr_qa_alice",
    blackId: "usr_qa_bob",
    stakeCents: cents(5),
    timeControl: "3+0",
    createdAt: minutesAgo(12)
  });

  createFinalizedGame(db, {
    id: "game_qa_mate_vish_bob",
    whiteId: "usr_qa_vish",
    blackId: "usr_qa_bob",
    winnerId: "usr_qa_vish",
    result: "white_win",
    reason: "checkmate",
    stakeCents: cents(25),
    timeControl: "3+0",
    moves: CHECKMATE_MOVES,
    endedAt: minutesAgo(20)
  });

  createFinalizedGame(db, {
    id: "game_qa_draw_vish_mira",
    whiteId: "usr_qa_vish",
    blackId: "usr_qa_mira",
    winnerId: null,
    result: "draw",
    reason: "agreement",
    stakeCents: cents(25),
    timeControl: "5+0",
    moves: [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"]
    ],
    endedAt: minutesAgo(35)
  });

  for (let i = 0; i < 50; i += 1) {
    const miraWhite = i % 2 === 0;
    const miraWins = i % 5 !== 0;
    const whiteId = miraWhite ? "usr_qa_mira" : "usr_qa_otto";
    const blackId = miraWhite ? "usr_qa_otto" : "usr_qa_mira";
    const winnerId = miraWins ? "usr_qa_mira" : "usr_qa_otto";
    const result = winnerId === whiteId ? "white_win" : "black_win";
    createFinalizedGame(db, {
      id: `game_qa_mira_history_${String(i + 1).padStart(2, "0")}`,
      whiteId,
      blackId,
      winnerId,
      result,
      reason: i % 17 === 0 ? "timeout" : "checkmate",
      stakeCents: i % 4 === 0 ? cents(100) : cents(25),
      timeControl: i % 3 === 0 ? "3+0" : "5+0",
      moves: result === "black_win" ? BLACK_CHECKMATE_MOVES : CHECKMATE_MOVES,
      endedAt: minutesAgo(60 + i * 12)
    });
  }
}

function createLiveGame(db, { id, whiteId, blackId, stakeCents, timeControl, createdAt }) {
  const challengeId = `chg_${id}`;
  if (db.getGame(id)) return;
  insertAcceptedChallenge(db, { id: challengeId, challengerId: whiteId, recipientId: blackId, gameId: id, stakeCents, timeControl, at: createdAt });
  holdEscrow(db, { challengeId, userIds: [whiteId, blackId], stakeCents, at: createdAt });
  const clock = initClockState(timeControl, createdAt);
  db.insertGame({
    id,
    state: "live",
    fen: STARTING_FEN,
    challengeId,
    winnerId: null,
    endReason: null,
    endedAt: null,
    players: playersFor(whiteId, blackId),
    moves: [],
    pot: calculatePot({ stakeCents }),
    clock,
    timeControl
  });
}

function createFinalizedGame(db, {
  id,
  whiteId,
  blackId,
  winnerId,
  result,
  reason,
  stakeCents,
  timeControl,
  moves,
  endedAt
}) {
  const challengeId = `chg_${id}`;
  if (db.getGame(id)) return;
  const createdAt = new Date(Date.parse(endedAt) - 8 * 60_000).toISOString();
  insertAcceptedChallenge(db, { id: challengeId, challengerId: whiteId, recipientId: blackId, gameId: id, stakeCents, timeControl, at: createdAt });
  holdEscrow(db, { challengeId, userIds: [whiteId, blackId], stakeCents, at: createdAt });
  const replay = replayMoves(moves);
  const white = db.getUser(whiteId);
  const black = db.getUser(blackId);
  const ratingChange = computeRatingChange({
    whiteRating: white.rating,
    blackRating: black.rating,
    result
  });
  db.updateUserRating(whiteId, ratingChange.whiteAfter);
  db.updateUserRating(blackId, ratingChange.blackAfter);
  db.insertGame({
    id,
    state: "finalized",
    fen: replay.fen,
    challengeId,
    winnerId,
    endReason: reason,
    endedAt,
    players: playersFor(whiteId, blackId),
    moves: replay.moves,
    pot: calculatePot({ stakeCents }),
    clock: null,
    ratingChange,
    timeControl
  });
  db.appendLedger(settleGame({
    gameId: id,
    challengeId,
    stakeCents,
    playerIds: [whiteId, blackId],
    winnerId,
    ledgerEntries: db.listLedger(),
    createdAt: endedAt
  }).newEntries);
  db.appendGameEvent({
    id: `evt_${id}_finalized`,
    gameId: id,
    type: "finalized",
    payload: { result, reason, ratingChange },
    occurredAt: endedAt
  });
}

function insertAcceptedChallenge(db, { id, challengerId, recipientId, gameId, stakeCents, timeControl, at }) {
  if (db.getChallenge(id)) return;
  db.insertChallenge({
    id,
    state: "accepted",
    challengerId,
    recipientId,
    gameId,
    stakeCents,
    timeControl,
    expiresInSeconds: 60,
    createdAt: at,
    updatedAt: at,
    pot: calculatePot({ stakeCents })
  });
}

function holdEscrow(db, { challengeId, userIds, stakeCents, at }) {
  const existing = db.listLedger().some((entry) => entry.type === "escrow_hold" && entry.refId === challengeId);
  if (existing) return;
  const ledgerEntries = db.listLedger();
  db.appendLedger(userIds.map((userId) => createEscrowHold({
    id: `led_hold_${challengeId}_${userId}`,
    userId,
    challengeId,
    amountCents: stakeCents,
    ledgerEntries,
    createdAt: at
  })));
}

function replayMoves(pairs) {
  let fen = STARTING_FEN;
  const stored = [];
  for (const [from, to] of pairs) {
    const result = applyMove(fen, { from, to }, stored);
    fen = result.fen;
    stored.push(result.move);
  }
  return { fen, moves: stored };
}

function playersFor(whiteId, blackId) {
  return [
    { id: whiteId, color: "white" },
    { id: blackId, color: "black" }
  ];
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function printSummary(db, name, target) {
  const rows = USER_FIXTURES.map((u) => {
    const user = db.getUser(u.id);
    const games = db.listFinalizedGamesForUser(u.id, 50).length;
    return `${user.handle.padEnd(19)} rating ${String(user.rating).padEnd(4)} games ${String(games).padStart(2)} password ${PASSWORD}`;
  });
  console.log(`Seeded Horsey dev scenario: ${name}`);
  console.log(`DB: ${target}`);
  console.log("");
  console.log(rows.join("\n"));
  console.log("");
  console.log(`Run with: HORSEY_DB_PATH=${target} npm run dev`);
  console.log(`From PowerShell: $env:HORSEY_DB_PATH="${target}"; npm run dev`);
  console.log(`App: http://127.0.0.1:8787`);
  console.log(`Script: node ${path.relative(rootDir, fileURLToPath(import.meta.url))} ${name} --db ${target}`);
}
