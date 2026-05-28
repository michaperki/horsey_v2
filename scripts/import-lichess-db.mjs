#!/usr/bin/env node
// Lichess PGN database importer (FAIR_PLAY slice 1 testing experiment, not a
// production feature — see docs/adr/0008-stockfish-for-offline-game-analysis.md
// § "Scope for slice 1").
//
// Reads a Lichess monthly DB PGN, parses N games, creates synthetic accounts
// (handle suffix `_li`), inserts games as state='finalized', and enqueues an
// analysis_jobs row per game so the worker can grind through them.
//
// Usage:
//   node scripts/import-lichess-db.mjs \
//     --pgn lichess/lichess_db_standard_rated_2013-01.pgn \
//     --limit 500
//
// To clean up: scripts/wipe-lichess-import.mjs

import { argv } from "node:process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";

import { openDatabase } from "../apps/api/db.mjs";
import { hashPassword } from "../apps/api/auth.mjs";

const IMPORT_SOURCE = "lichess-import";
const HANDLE_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const MIN_PLIES = 10;

function parseArgs(args) {
  const out = { pgn: null, limit: 500 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pgn") out.pgn = args[++i];
    else if (args[i] === "--limit") out.limit = Number(args[++i]);
    else if (args[i] === "--help" || args[i] === "-h") {
      console.error("Usage: import-lichess-db.mjs --pgn <path> [--limit N]");
      process.exit(0);
    }
  }
  if (!out.pgn) {
    console.error("--pgn <path> required");
    process.exit(2);
  }
  return out;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

// Lichess handles can contain `[a-zA-Z0-9_-]` up to 20 chars. Our system uses
// the same regex. The `_li` suffix marks imports so the cleanup script can
// scope to them; if the base handle is too long for `_li` to fit, we truncate.
function syntheticHandleFor(lichessHandle) {
  const cleaned = String(lichessHandle || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const maxBase = 20 - 3; // "_li" = 3 chars
  const truncated = cleaned.slice(0, maxBase);
  if (truncated.length < 1) return null;
  const handle = `${truncated}_li`;
  if (!HANDLE_RE.test(handle)) return null;
  return handle;
}

function syntheticEmail(lichessHandle) {
  return `${String(lichessHandle).toLowerCase().slice(0, 60)}@${IMPORT_SOURCE}.local`;
}

// Strip Lichess move comments + annotations + variations + result markers.
// Result is a clean SAN token stream.
function tokenizeMoves(moveText) {
  const cleaned = moveText
    .replace(/\{[^}]*\}/g, " ")     // {comments}
    .replace(/\([^)]*\)/g, " ")     // (variations) — Lichess DB doesn't normally have these
    .replace(/\$\d+/g, " ")          // $NAGs
    .replace(/[!?]+/g, "")           // !, ?, !?, ?!, !!, ??
    .replace(/\b1-0\b|\b0-1\b|\b1\/2-1\/2\b|\*/g, " ") // results
    .replace(/\d+\.(\.\.)?/g, " ");  // 1.  1... move numbers
  return cleaned.split(/\s+/).filter(Boolean);
}

function parseGameResult(resultTag) {
  if (resultTag === "1-0") return { winnerColor: "white", result: "white_win" };
  if (resultTag === "0-1") return { winnerColor: "black", result: "black_win" };
  if (resultTag === "1/2-1/2") return { winnerColor: null, result: "draw" };
  return null;
}

// Read PGN file line-by-line. Yields parsed games up to `limit`.
async function* readPgnGames(pgnPath, limit) {
  const stream = createReadStream(pgnPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let tags = {};
  let moveText = "";
  let inMoves = false;
  let produced = 0;

  for await (const line of rl) {
    if (line.startsWith("[")) {
      if (inMoves) {
        // We finished a game; the next [Tag block belongs to the next game.
        const game = { tags, moveText: moveText.trim() };
        tags = {};
        moveText = "";
        inMoves = false;
        if (game.moveText) {
          yield game;
          produced += 1;
          if (produced >= limit) return;
        }
      }
      const match = line.match(/^\[(\w+)\s+"(.*)"\]\s*$/);
      if (match) tags[match[1]] = match[2];
    } else if (line.trim().length === 0) {
      if (Object.keys(tags).length > 0 && !inMoves) inMoves = true;
    } else {
      if (inMoves) moveText += " " + line;
    }
  }

  if (Object.keys(tags).length > 0 && moveText.trim()) {
    yield { tags, moveText: moveText.trim() };
  }
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  const dbPath = process.env.HORSEY_DB_PATH || "data/horsey.db";
  console.log(`importing up to ${opts.limit} games from ${opts.pgn} into ${dbPath}`);

  const db = openDatabase(dbPath);

  // Stash a single shared throwaway password hash. Imported users never log in.
  const placeholderHash = await hashPassword(`lichess-import-${Math.random().toString(16).slice(2)}`);

  const stats = {
    parsed: 0,
    importedGames: 0,
    createdUsers: 0,
    reusedUsers: 0,
    skippedVariant: 0,
    skippedFen: 0,
    skippedShort: 0,
    skippedBadResult: 0,
    skippedBadHandle: 0,
    skippedMoveParse: 0,
    skippedDuplicate: 0,
    skippedNoMoves: 0,
    enqueuedJobs: 0
  };

  const userByHandle = new Map();

  for await (const { tags, moveText } of readPgnGames(opts.pgn, opts.limit)) {
    stats.parsed += 1;
    if (tags.Variant && tags.Variant !== "Standard") { stats.skippedVariant += 1; continue; }
    if (tags.FEN) { stats.skippedFen += 1; continue; }

    const outcome = parseGameResult(tags.Result);
    if (!outcome) { stats.skippedBadResult += 1; continue; }

    const whiteHandle = syntheticHandleFor(tags.White);
    const blackHandle = syntheticHandleFor(tags.Black);
    if (!whiteHandle || !blackHandle || whiteHandle === blackHandle) {
      stats.skippedBadHandle += 1;
      continue;
    }

    // Play the move list through chess.js to get verbose moves.
    const tokens = tokenizeMoves(moveText);
    if (tokens.length < MIN_PLIES) { stats.skippedShort += 1; continue; }

    const chess = new Chess();
    let parseOk = true;
    const moves = [];
    for (const san of tokens) {
      try {
        const m = chess.move(san);
        if (!m) { parseOk = false; break; }
        moves.push({
          from: m.from,
          to: m.to,
          san: m.san,
          promotion: m.promotion ?? null
        });
      } catch {
        parseOk = false;
        break;
      }
    }
    if (!parseOk || moves.length < MIN_PLIES) { stats.skippedMoveParse += 1; continue; }

    // Upsert players.
    const upsertUser = (lichessHandle, syntheticHandle, eloTag) => {
      if (userByHandle.has(syntheticHandle)) return userByHandle.get(syntheticHandle);
      const existing = db.getUserByHandle(syntheticHandle);
      if (existing) {
        userByHandle.set(syntheticHandle, existing);
        stats.reusedUsers += 1;
        return existing;
      }
      const rating = Number.parseInt(eloTag, 10);
      const user = {
        id: newId("usr"),
        email: syntheticEmail(lichessHandle),
        handle: syntheticHandle,
        passwordHash: placeholderHash.passwordHash,
        passwordSalt: placeholderHash.passwordSalt,
        rating: Number.isFinite(rating) ? rating : 1500,
        createdAt: new Date().toISOString()
      };
      try {
        db.insertUser(user);
      } catch (err) {
        // Race or duplicate handle. Re-fetch.
        const refetched = db.getUserByHandle(syntheticHandle);
        if (refetched) {
          userByHandle.set(syntheticHandle, refetched);
          stats.reusedUsers += 1;
          return refetched;
        }
        throw err;
      }
      userByHandle.set(syntheticHandle, user);
      stats.createdUsers += 1;
      return user;
    };

    const whiteUser = upsertUser(tags.White, whiteHandle, tags.WhiteElo);
    const blackUser = upsertUser(tags.Black, blackHandle, tags.BlackElo);

    // Deterministic game id from the Lichess site URL so re-runs don't dup.
    const siteId = (tags.Site || "").split("/").pop() || `unknown_${stats.parsed}`;
    const gameId = `game_li_${siteId}`;
    if (db.getGame?.(gameId)) { stats.skippedDuplicate += 1; continue; }

    const winnerId = outcome.winnerColor === "white"
      ? whiteUser.id
      : outcome.winnerColor === "black" ? blackUser.id : null;

    const endedAt = tags.UTCDate && tags.UTCTime
      ? new Date(`${tags.UTCDate.replace(/\./g, "-")}T${tags.UTCTime}Z`).toISOString()
      : new Date().toISOString();

    const game = {
      id: gameId,
      state: "finalized",
      fen: chess.fen(),
      challengeId: null,
      winnerId,
      endReason: (tags.Termination || "lichess_import").toLowerCase().replace(/\s+/g, "_"),
      endedAt,
      players: [
        { id: whiteUser.id, handle: whiteUser.handle, color: "white" },
        { id: blackUser.id, handle: blackUser.handle, color: "black" }
      ],
      moves,
      pot: { stakeCents: 0, rakeBps: 0 },
      timeControl: tags.TimeControl || null,
      drawOffer: null,
      ratingChange: null,
      // Sentinel for the cleanup script. Lives in data_json, no schema change.
      source: IMPORT_SOURCE,
      tags: {
        white: tags.White,
        black: tags.Black,
        whiteElo: tags.WhiteElo,
        blackElo: tags.BlackElo,
        opening: tags.Opening,
        eco: tags.ECO,
        event: tags.Event,
        site: tags.Site,
        utcDate: tags.UTCDate,
        utcTime: tags.UTCTime
      }
    };
    try {
      db.insertGame(game);
      stats.importedGames += 1;
    } catch (err) {
      console.error(`failed to insert ${gameId}: ${err.message}`);
      continue;
    }

    try {
      db.enqueueAnalysisJob({ id: newId("anj"), gameId });
      stats.enqueuedJobs += 1;
    } catch (err) {
      console.error(`failed to enqueue ${gameId}: ${err.message}`);
    }

    if (stats.importedGames % 50 === 0) {
      console.log(`  ... imported ${stats.importedGames} games`);
    }
  }

  console.log("\nimport complete.");
  console.table(stats);

  console.log(`\nTo run analysis against these games, start the server with:`);
  console.log(`  HORSEY_ANALYSIS_ENABLED=1 STOCKFISH_PATH=/usr/games/stockfish HORSEY_ANALYSIS_DEPTH=12 npm run dev`);
  console.log(`Then sign in as an admin and visit the Admin → Games tab.`);
}

main().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
