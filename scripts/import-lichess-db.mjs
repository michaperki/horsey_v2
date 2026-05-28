#!/usr/bin/env node
// Lichess PGN database importer (dev-only — see ADR 0008).
//
// Reads a Lichess monthly DB PGN, parses N games, creates synthetic accounts
// (handle suffix `_li`, with seed bankroll), and writes each game as a
// pgn_scripts row that the lichess-bustling daemon consumes one at a time
// to drive the live loop with realistic timing.
//
// Requires `%clk` annotations — Lichess includes those only on games from
// April 2017 onwards. The 2013 PGN file has no clock data; use a 2017+ slice.
//
// Usage:
//   node scripts/import-lichess-db.mjs \
//     --pgn lichess/lichess_db_standard_rated_2017-04-sample.pgn \
//     --limit 500
//
// To clean up: scripts/wipe-lichess-import.mjs

import { argv } from "node:process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";

import { openDatabase } from "../apps/api/db.mjs";
import { hashPassword } from "../apps/api/auth.mjs";
import { SIGNUP_GRANT_CENTS } from "../apps/api/seed.mjs";

const IMPORT_SOURCE = "lichess-import";
const HANDLE_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const MIN_PLIES = 10;

// Small random stake ladder so the live feed looks varied. Cents.
// Capped at $25 because imported users start at the provisional trust tier
// with a $25 per-game stake cap (see Trust Tiers § stake caps).
const STAKE_LADDER_CENTS = [500, 1000, 1500, 2500];

// Lichess time-control format is "base+inc" in seconds. Map to our format.
// Returns null for time controls we don't support (clocks.mjs has a 10s floor).
function mapLichessTimeControl(lichessTc) {
  if (!lichessTc) return null;
  const match = String(lichessTc).match(/^(\d+)\+(\d+)$/);
  if (!match) return null;
  const baseSec = Number(match[1]);
  const inc = Number(match[2]);
  if (baseSec < 10) return null;
  // Sub-minute formats use Ns+I; otherwise minutes+I.
  if (baseSec < 60) return `${baseSec}s+${inc}`;
  if (baseSec % 60 !== 0) return null; // non-whole-minute base, unusual
  const baseMin = baseSec / 60;
  return `${baseMin}+${inc}`;
}

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

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function syntheticHandleFor(lichessHandle) {
  const cleaned = String(lichessHandle || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const maxBase = 20 - 3; // "_li" suffix
  const truncated = cleaned.slice(0, maxBase);
  if (truncated.length < 1) return null;
  const handle = `${truncated}_li`;
  if (!HANDLE_RE.test(handle)) return null;
  return handle;
}

function syntheticEmail(lichessHandle) {
  return `${String(lichessHandle).toLowerCase().slice(0, 60)}@${IMPORT_SOURCE}.local`;
}

function parseClk(comment) {
  const m = comment.match(/\[%clk\s+(\d+):(\d+):(\d+)\]/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Walk a Lichess movetext, returning an array of { san, clkAfterSec | null }
// per ply. Move comments live in { ... } blocks; we extract %clk and discard
// the rest (evals, NAGs, variations).
function tokenizePliesWithClk(moveText) {
  const out = [];
  let i = 0;
  const text = moveText;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === "{") {
      const end = text.indexOf("}", i);
      if (end === -1) break;
      const comment = text.slice(i, end + 1);
      const clk = parseClk(comment);
      if (clk != null && out.length > 0) out[out.length - 1].clkAfterSec = clk;
      i = end + 1;
      continue;
    }
    if (text[i] === "(") {
      // Variation — skip.
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        i++;
      }
      continue;
    }
    if (text[i] === "$") {
      // NAG ($1, $2, ...).
      while (i < text.length && !/\s/.test(text[i])) i++;
      continue;
    }
    // Token (move number, SAN, or result).
    let j = i;
    while (j < text.length && !/\s/.test(text[j]) && text[j] !== "{" && text[j] !== "(") j++;
    const token = text.slice(i, j);
    i = j;
    if (/^\d+\.+$/.test(token)) continue; // move numbers
    if (/^[01](?:\/2)?-[01](?:\/2)?$/.test(token) || token === "*") continue; // results
    const cleaned = token.replace(/[!?]+$/, "");
    if (!cleaned) continue;
    out.push({ san: cleaned, clkAfterSec: null });
  }
  return out;
}

function parseGameResult(resultTag) {
  if (resultTag === "1-0") return { winnerColor: "white", result: "white_win" };
  if (resultTag === "0-1") return { winnerColor: "black", result: "black_win" };
  if (resultTag === "1/2-1/2") return { winnerColor: null, result: "draw" };
  return null;
}

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
  const placeholderHash = await hashPassword(`lichess-import-${Math.random().toString(16).slice(2)}`);

  const stats = {
    parsed: 0,
    scriptsWritten: 0,
    createdUsers: 0,
    skippedVariant: 0,
    skippedFen: 0,
    skippedBadResult: 0,
    skippedBadHandle: 0,
    skippedUnsupportedTc: 0,
    skippedNoClk: 0,
    skippedShort: 0,
    skippedMoveParse: 0
  };

  const userByHandle = new Map();
  const tcCounts = {};

  const upsertUser = (lichessHandle, syntheticHandle, eloTag) => {
    if (userByHandle.has(syntheticHandle)) return userByHandle.get(syntheticHandle);
    const existing = db.getUserByHandle(syntheticHandle);
    if (existing) {
      userByHandle.set(syntheticHandle, existing);
      return existing;
    }
    const rating = Number.parseInt(eloTag, 10);
    const now = new Date().toISOString();
    const user = {
      id: newId("usr"),
      email: syntheticEmail(lichessHandle),
      handle: syntheticHandle,
      passwordHash: placeholderHash.passwordHash,
      passwordSalt: placeholderHash.passwordSalt,
      rating: Number.isFinite(rating) ? rating : 1500,
      createdAt: now
    };
    db.transaction(() => {
      db.insertUser(user);
      // Grant the same fake-money bankroll a real signup would receive so
      // bustling can escrow stakes for these accounts.
      db.appendLedger([{
        id: newId("led_grant"),
        userId: user.id,
        type: "seed_grant",
        availableDeltaCents: SIGNUP_GRANT_CENTS,
        escrowDeltaCents: 0,
        refId: "lichess_import",
        note: "Imported-account seed grant",
        createdAt: now
      }]);
    })();
    userByHandle.set(syntheticHandle, user);
    stats.createdUsers += 1;
    return user;
  };

  for await (const { tags, moveText } of readPgnGames(opts.pgn, opts.limit)) {
    stats.parsed += 1;
    if (tags.Variant && tags.Variant !== "Standard") { stats.skippedVariant += 1; continue; }
    if (tags.FEN) { stats.skippedFen += 1; continue; }

    const outcome = parseGameResult(tags.Result);
    if (!outcome) { stats.skippedBadResult += 1; continue; }

    const horseyTc = mapLichessTimeControl(tags.TimeControl);
    if (!horseyTc) { stats.skippedUnsupportedTc += 1; continue; }

    const whiteHandle = syntheticHandleFor(tags.White);
    const blackHandle = syntheticHandleFor(tags.Black);
    if (!whiteHandle || !blackHandle || whiteHandle === blackHandle) {
      stats.skippedBadHandle += 1; continue;
    }

    const plies = tokenizePliesWithClk(moveText);
    if (plies.length < MIN_PLIES) { stats.skippedShort += 1; continue; }
    if (plies.some((p) => p.clkAfterSec == null)) { stats.skippedNoClk += 1; continue; }

    const chess = new Chess();
    let parseOk = true;
    const moves = [];
    const clkAfter = [];
    for (let i = 0; i < plies.length; i++) {
      try {
        const m = chess.move(plies[i].san);
        if (!m) { parseOk = false; break; }
        moves.push({
          from: m.from,
          to: m.to,
          san: m.san,
          promotion: m.promotion ?? null
        });
        clkAfter.push(plies[i].clkAfterSec);
      } catch {
        parseOk = false;
        break;
      }
    }
    if (!parseOk || moves.length < MIN_PLIES) { stats.skippedMoveParse += 1; continue; }

    const whiteUser = upsertUser(tags.White, whiteHandle, tags.WhiteElo);
    const blackUser = upsertUser(tags.Black, blackHandle, tags.BlackElo);

    const siteId = (tags.Site || "").split("/").pop() || `unknown_${stats.parsed}`;
    db.insertPgnScript({
      id: newId("pgs"),
      whiteUserId: whiteUser.id,
      blackUserId: blackUser.id,
      timeControl: horseyTc,
      stakeCents: pickRandom(STAKE_LADDER_CENTS),
      moves,
      clkAfter,
      result: outcome.result,
      termination: tags.Termination || null,
      sourceSiteId: siteId
    });
    stats.scriptsWritten += 1;
    tcCounts[horseyTc] = (tcCounts[horseyTc] || 0) + 1;

    if (stats.scriptsWritten % 50 === 0) {
      console.log(`  ... ${stats.scriptsWritten} scripts written`);
    }
  }

  console.log("\nimport complete.");
  console.table(stats);
  console.log("\ntime-control distribution:");
  console.table(tcCounts);
  console.log(`\nTo drive these scripts through the live loop:`);
  console.log(`  npm run dev:bustling-lichess`);
}

main().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
