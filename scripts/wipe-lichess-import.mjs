#!/usr/bin/env node
// Companion to import-lichess-db.mjs — deletes all imported games, their
// analysis rows + jobs, and the synthetic _li users.
//
// Identifies imports by the `_li` handle suffix. Games are "imported" if ALL
// their game_players rows reference _li-suffixed users.
//
// Usage:
//   node scripts/wipe-lichess-import.mjs
//
// Or DRY_RUN=1 to just print counts:
//   DRY_RUN=1 node scripts/wipe-lichess-import.mjs

import Database from "better-sqlite3";

const dbPath = process.env.HORSEY_DB_PATH || "data/horsey.db";
const dryRun = process.env.DRY_RUN === "1";

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

console.log(`${dryRun ? "DRY RUN against" : "wiping import data from"} ${dbPath}`);

const liUsers = db.prepare("SELECT id FROM users WHERE handle LIKE '%\\_li' ESCAPE '\\'").all();
console.log(`found ${liUsers.length} _li users`);

const liUserIds = liUsers.map((u) => u.id);
const liUserSet = new Set(liUserIds);

const pgnScripts = liUserIds.length > 0
  ? db.prepare(`SELECT id FROM pgn_scripts WHERE white_user_id IN (${liUserIds.map(() => "?").join(",")}) OR black_user_id IN (${liUserIds.map(() => "?").join(",")})`).all(...liUserIds, ...liUserIds)
  : [];
console.log(`found ${pgnScripts.length} pgn_scripts rows`);

// Games where EVERY player is an _li user. We use a NOT EXISTS check rather
// than counts so a game gets wiped even if it has 1 or 2 players.
const importedGames = db.prepare(`
  SELECT g.id FROM games g
  WHERE NOT EXISTS (
    SELECT 1 FROM game_players gp
    JOIN users u ON u.id = gp.user_id
    WHERE gp.game_id = g.id AND u.handle NOT LIKE '%\\_li' ESCAPE '\\'
  )
  AND EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id)
`).all();
console.log(`found ${importedGames.length} imported games`);

const gameAnalyses = db.prepare(`
  SELECT ga.id FROM game_analysis ga
  WHERE ga.game_id IN (${importedGames.map(() => "?").join(",") || "''"})
`).all(...importedGames.map((g) => g.id));
console.log(`found ${gameAnalyses.length} game_analysis rows to wipe`);

if (dryRun) {
  console.log("DRY_RUN=1: no changes applied.");
  process.exit(0);
}

const wipe = db.transaction(() => {
  // move_analysis (children of game_analysis)
  if (gameAnalyses.length > 0) {
    db.prepare(`DELETE FROM move_analysis WHERE game_analysis_id IN (${gameAnalyses.map(() => "?").join(",")})`)
      .run(...gameAnalyses.map((g) => g.id));
  }
  if (importedGames.length > 0) {
    const ids = importedGames.map((g) => g.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM game_analysis WHERE game_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM analysis_jobs WHERE game_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM game_events WHERE game_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM game_players WHERE game_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM games WHERE id IN (${placeholders})`).run(...ids);
  }
  if (pgnScripts.length > 0) {
    const ids = pgnScripts.map((s) => s.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM pgn_scripts WHERE id IN (${placeholders})`).run(...ids);
  }
  if (liUsers.length > 0) {
    const ids = liUserIds;
    const placeholders = ids.map(() => "?").join(",");
    // Cascade cleanup for tables that hang off users.
    db.prepare(`DELETE FROM user_avatars WHERE user_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM ledger_entries WHERE user_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM sessions WHERE user_id IN (${placeholders})`).run(...ids).changes ?? 0;
    db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids);
  }
});
wipe();

console.log("done.");
console.log(`  removed ${gameAnalyses.length} game_analysis (and their move_analysis children)`);
console.log(`  removed ${importedGames.length} games`);
console.log(`  removed ${pgnScripts.length} pgn_scripts`);
console.log(`  removed ${liUsers.length} _li users`);
void liUserSet;
