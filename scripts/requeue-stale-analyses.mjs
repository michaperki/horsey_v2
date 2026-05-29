#!/usr/bin/env node
// Re-queue stale-worker game analyses for re-analysis.
//
// A "stale" analysis is one missing fields the current worker produces:
//   - move_analysis.phase = NULL — produced before the phase/clock fields were
//     added (Fair Play panel can't render phase breakdown / clock metrics).
//   - game_analysis.multipv < 2 — produced before MultiPV / engine-rank support
//     (no engine_rank, eval_gap_cp, or candidate set; no sharp-critical signal).
// The underlying data (the game + its moves) is fine; only the derived analysis
// rows are incomplete, so we delete them and re-queue the game.
//
// This script:
//   - finds all such game_analysis rows
//   - prints what would be touched
//   - by default does NOTHING (dry-run)
//   - with --execute, deletes the analysis rows and resets the matching
//     analysis_jobs back to 'pending' so the running worker picks them up
//
// Idempotent: re-running when nothing is stale just prints "no stale
// analyses found".
//
// Usage:
//   node scripts/requeue-stale-analyses.mjs               # dry-run preview
//   node scripts/requeue-stale-analyses.mjs --execute     # actually re-queue
//   HORSEY_DB_PATH=/tmp/other.db node scripts/...         # against another DB

import Database from "better-sqlite3";

const dbPath = process.env.HORSEY_DB_PATH || "data/horsey.db";
const execute = process.argv.includes("--execute");

const db = new Database(dbPath);

// Stale = missing phase (old phase-less worker) OR predates MultiPV
// (game_analysis.multipv < 2 → no engine_rank / eval_gap_cp / candidates).
const stale = db.prepare(`
  SELECT
    ga.id,
    ga.game_id,
    ga.completed_at,
    ga.depth,
    ga.multipv,
    ga.engine_version,
    (SELECT COUNT(*) FROM move_analysis WHERE game_analysis_id = ga.id) AS move_count,
    (SELECT COUNT(*) FROM move_analysis WHERE game_analysis_id = ga.id AND phase IS NULL) AS null_phase_count,
    (SELECT COUNT(*) FROM move_analysis WHERE game_analysis_id = ga.id AND clock_remaining_ms IS NULL) AS null_clock_count,
    EXISTS(SELECT 1 FROM games g WHERE g.id = ga.game_id AND g.data_json LIKE '%clkAfterMs%') AS game_has_clk
  FROM game_analysis ga
  WHERE ga.status = 'complete'
    AND (
      ga.multipv < 2
      OR EXISTS (
        SELECT 1 FROM move_analysis
        WHERE game_analysis_id = ga.id AND phase IS NULL
      )
    )
  ORDER BY ga.completed_at DESC
`).all();

const summary = {
  staleAnalyses: stale.length,
  totalMoveAnalysisRows: stale.reduce((s, r) => s + r.move_count, 0),
  withGameClkData: stale.filter((r) => r.game_has_clk === 1).length,
  preMultipv: stale.filter((r) => r.multipv < 2).length,
  nullPhase: stale.filter((r) => r.null_phase_count > 0).length
};

console.log(`scanning ${dbPath}`);
console.log(`mode: ${execute ? "EXECUTE" : "DRY RUN (no changes)"}`);

if (stale.length === 0) {
  console.log("\nno stale analyses found. nothing to do.");
  db.close();
  process.exit(0);
}

console.log(`\nfound ${summary.staleAnalyses} stale-worker analyses`);
console.log(`  total move_analysis rows: ${summary.totalMoveAnalysisRows}`);
console.log(`  predate MultiPV (multipv<2): ${summary.preMultipv} (will gain engine-rank + sharp-critical signal after re-run)`);
console.log(`  missing phase: ${summary.nullPhase}`);
console.log(`  games whose source has clkAfterMs: ${summary.withGameClkData} (these will gain clock-aware metrics after re-run)`);

const previewCount = Math.min(10, stale.length);
console.log(`\nfirst ${previewCount}:`);
for (const row of stale.slice(0, previewCount)) {
  console.log(`  ${row.id} · game ${row.game_id.slice(0, 16)} · ${row.move_count} plies · ${row.engine_version} d${row.depth} mpv${row.multipv} · completed ${row.completed_at}`);
}
if (stale.length > previewCount) {
  console.log(`  ... and ${stale.length - previewCount} more`);
}

if (!execute) {
  console.log("\nDRY RUN. To actually re-queue these games, re-run with --execute:");
  console.log(`  node scripts/requeue-stale-analyses.mjs --execute`);
  db.close();
  process.exit(0);
}

console.log("\nre-queuing...");

const wipeAndReset = db.transaction(() => {
  for (const row of stale) {
    db.prepare("DELETE FROM move_analysis WHERE game_analysis_id = ?").run(row.id);
    db.prepare("DELETE FROM game_analysis WHERE id = ?").run(row.id);
    db.prepare(`
      UPDATE analysis_jobs
      SET status = 'pending',
          started_at = NULL,
          completed_at = NULL,
          last_error = NULL,
          attempts = 0
      WHERE game_id = ?
    `).run(row.game_id);
  }
});
wipeAndReset();

const pending = db.prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE status='pending'").get().n;

console.log(`\nre-queued ${stale.length} games for re-analysis.`);
console.log(`analysis_jobs pending now: ${pending}`);
console.log(`\nstart (or keep running) the server with HORSEY_ANALYSIS_ENABLED=1 to process them.`);

db.close();
