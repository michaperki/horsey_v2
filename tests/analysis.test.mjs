// FAIR_PLAY slice 1 tests (ADR 0008).
//
// Three layers:
//   1. Pure math from packages/shared/analysis.mjs.
//   2. Worker lifecycle against a stub engine (no real Stockfish in CI).
//   3. Admin endpoint gate using the API fixture.
//
// The actual Stockfish subprocess is exercised by the manual smoke described
// in PAYMENTS_NEXT_PASS-style go-live notes, not in CI.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";

import {
  classifyCpLoss,
  classifyPhase,
  clockAwareBreakdown,
  computePlayerBaseline,
  concernLabel,
  cpLossForPlay,
  criticalPositionAccuracy,
  evalCpFromMate,
  expectedAcplForRating,
  extractPositionFeatures,
  fairPlaySummary,
  isCriticalPosition,
  isEngineGrade,
  materialFromFen,
  normalizeEvalCp,
  phaseBreakdownForSide,
  summarizeMoveAnalyses,
  timeBucket
} from "../packages/shared/analysis.mjs";
import { startAnalysisWorker } from "../apps/api/analysis-worker.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// --- 1. Pure math ----------------------------------------------------------

test("classifyCpLoss honors blunder/mistake/inaccuracy thresholds", () => {
  assert.equal(classifyCpLoss(0, { isTopMove: true }), "best");
  assert.equal(classifyCpLoss(0), "good");
  assert.equal(classifyCpLoss(20), "good");
  assert.equal(classifyCpLoss(49), "good");
  assert.equal(classifyCpLoss(50), "inaccuracy");
  assert.equal(classifyCpLoss(99), "inaccuracy");
  assert.equal(classifyCpLoss(100), "mistake");
  assert.equal(classifyCpLoss(249), "mistake");
  assert.equal(classifyCpLoss(250), "blunder");
  assert.equal(classifyCpLoss(1500), "blunder");
});

test("classifyCpLoss returns null for missing or NaN loss", () => {
  assert.equal(classifyCpLoss(null), null);
  assert.equal(classifyCpLoss(undefined), null);
  assert.equal(classifyCpLoss(NaN), null);
});

test("cpLossForPlay flips perspective for black", () => {
  // White played; best was +50, played was +20 → loss 30.
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 50, playedEvalCp: 20 }), 30);
  // Black played; best was -50 (good for black), played was -20 (worse for black) → loss 30.
  assert.equal(cpLossForPlay({ side: "black", bestEvalCp: -50, playedEvalCp: -20 }), 30);
  // No regression when played equals best.
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 10, playedEvalCp: 10 }), 0);
  // Never negative — clamp.
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 0, playedEvalCp: 25 }), 0);
});

test("cpLossForPlay returns null if either input is missing", () => {
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: null, playedEvalCp: 10 }), null);
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 10, playedEvalCp: null }), null);
});

test("normalizeEvalCp prefers mate over cp when mate is set", () => {
  assert.equal(normalizeEvalCp({ evalCp: 50, mateIn: 3 }), evalCpFromMate(3));
  assert.equal(normalizeEvalCp({ evalCp: 50, mateIn: null }), 50);
  assert.equal(normalizeEvalCp({ evalCp: null, mateIn: null }), null);
  // mateIn=0 should be treated as not-mate.
  assert.equal(normalizeEvalCp({ evalCp: 100, mateIn: 0 }), 100);
});

test("summarizeMoveAnalyses excludes book plies from ACPL and top-move match", () => {
  const moves = [
    { side: "white", playedSan: "e4", bestSan: "e4", cpLoss: 0, classification: null, isBook: true },
    { side: "black", playedSan: "e5", bestSan: "e5", cpLoss: 0, classification: null, isBook: true },
    { side: "white", playedSan: "Nf3", bestSan: "Nf3", cpLoss: 10, classification: "good", isBook: false },
    { side: "black", playedSan: "Nc6", bestSan: "Nc6", cpLoss: 0, classification: "best", isBook: false },
    { side: "white", playedSan: "Bb5", bestSan: "Bb5", cpLoss: 80, classification: "inaccuracy", isBook: false },
    { side: "black", playedSan: "Qd7", bestSan: "a6", cpLoss: 300, classification: "blunder", isBook: false }
  ];
  const summary = summarizeMoveAnalyses(moves);
  // White non-book moves: cpLoss 10 + 80 = 90; / 2 plies = 45 ACPL.
  assert.equal(summary.white.acpl, 45);
  assert.equal(summary.white.blunders, 0);
  assert.equal(summary.white.inaccuracies, 1);
  // Black non-book: cpLoss 0 + 300 = 300 / 2 = 150 ACPL.
  assert.equal(summary.black.acpl, 150);
  assert.equal(summary.black.blunders, 1);
  // White matched best on both non-book moves → 100% match.
  assert.equal(summary.white.topMoveMatchPct, 100);
  // Black matched 1 of 2 non-book → 50%.
  assert.equal(summary.black.topMoveMatchPct, 50);
});

test("summarizeMoveAnalyses caps individual cp_loss at 1000 so mate evals don't dominate ACPL", () => {
  // One mating sequence shouldn't push ACPL into the tens of thousands.
  // Raw cp_loss values stay uncapped on move_analysis; only the ACPL math caps.
  const moves = [
    { side: "white", playedSan: "e4", bestSan: "e4", cpLoss: 0, classification: "best", isBook: false },
    { side: "white", playedSan: "??", bestSan: "Nf3", cpLoss: 30000, classification: "blunder", isBook: false }
  ];
  const summary = summarizeMoveAnalyses(moves);
  // (0 + 1000) / 2 = 500. Without the cap it would be ~15000.
  assert.equal(summary.white.acpl, 500);
});

test("summarizeMoveAnalyses tolerates empty/all-book input", () => {
  assert.deepEqual(summarizeMoveAnalyses([]).white, {
    acpl: 0,
    blunders: 0,
    mistakes: 0,
    inaccuracies: 0,
    topMoveMatchPct: 0
  });
});

// --- 1b. Fair-play pure math ----------------------------------------------

test("materialFromFen counts non-king material correctly", () => {
  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  // Each side: 8p (8) + 2n (6) + 2b (6) + 2r (10) + 1q (9) = 39. Total = 78.
  assert.equal(materialFromFen(startFen), 78);
  const kingsOnlyFen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
  assert.equal(materialFromFen(kingsOnlyFen), 0);
});

test("classifyPhase: pre-book is always opening", () => {
  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(classifyPhase(1, startFen), "opening");
  assert.equal(classifyPhase(8, startFen), "opening");
});

test("classifyPhase: opening extends past book when position still looks opening-y", () => {
  // After 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5 Be7 — ply 9, classic QGD opening.
  // White Bc1 developed to g5, Nb1 to c3. Black Ng8 to f6, Bf8 to e7.
  // Several minors still home, kings home, queens home, rooks home.
  const lateOpeningFen = "rnbqk2r/ppp1bppp/4pn2/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR w KQkq - 4 5";
  assert.equal(classifyPhase(9, lateOpeningFen), "opening");
  assert.equal(classifyPhase(12, lateOpeningFen), "opening");
});

test("classifyPhase: developed-and-castled position past book is middlegame", () => {
  // Both castled kingside, queens still on, central tension resolved.
  const middlegameFen = "r1bq1rk1/pp3ppp/2n1pn2/2bp4/3P4/2NB1N2/PPP2PPP/R1BQ1RK1 w - - 0 11";
  assert.equal(classifyPhase(22, middlegameFen), "middlegame");
});

test("classifyPhase: queenless middlegame stays middlegame when material is high", () => {
  // Queens traded but plenty of pieces still on. Material ~58 (well above 22).
  const queenlessMidFen = "r3kb1r/pp3ppp/2n1pn2/3p4/2PP4/2NB1N2/PP3PPP/R1B1K2R w KQkq - 0 15";
  assert.equal(classifyPhase(30, queenlessMidFen), "middlegame");
});

test("classifyPhase: low material is endgame", () => {
  const lowMaterialFen = "4k3/8/3p4/8/3P4/8/4K3/8 w - - 0 30";
  assert.equal(classifyPhase(60, lowMaterialFen), "endgame");
});

test("classifyPhase: queens off + modest material is endgame", () => {
  // K+R+5P each, queens off. Material = 20 (under the 22 threshold).
  const queenlessEndgameFen = "4k3/p4ppp/8/8/8/8/PP4PP/R3K2R w KQ - 0 30";
  assert.equal(classifyPhase(60, queenlessEndgameFen), "endgame");
});

test("classifyPhase: very-few-pieces rule catches Q+P vs K+P shapes", () => {
  const sparseFen = "4k3/8/8/8/8/8/4P3/Q3K3 w - - 0 50";
  assert.equal(classifyPhase(100, sparseFen), "endgame");
});

test("extractPositionFeatures captures castling, queens, minors, rooks", () => {
  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const f = extractPositionFeatures(startFen);
  assert.equal(f.queensHomeCount, 2);
  assert.equal(f.undevelopedMinors, 8);
  assert.equal(f.rooksOnHomeCorner, 4);
  assert.equal(f.whiteKingHome, true);
  assert.equal(f.blackKingHome, true);
  assert.equal(f.whiteCanCastle, true);

  // Castled position.
  const castledFen = "r1bq1rk1/pp3ppp/2n1pn2/2bp4/3P4/2NB1N2/PPP2PPP/R1BQ1RK1 w - - 0 11";
  const c = extractPositionFeatures(castledFen);
  assert.equal(c.whiteKingCastled, true);
  assert.equal(c.blackKingCastled, true);
  assert.equal(c.whiteCanCastle, false);
  assert.equal(c.blackCanCastle, false);
});

test("isCriticalPosition excludes book + decisive evals", () => {
  assert.equal(isCriticalPosition({ isBook: true, bestEvalCp: 0 }), false);
  assert.equal(isCriticalPosition({ isBook: false, bestEvalCp: null }), false);
  assert.equal(isCriticalPosition({ isBook: false, bestEvalCp: 50 }), true);
  assert.equal(isCriticalPosition({ isBook: false, bestEvalCp: -200 }), true);
  // Already crushing — not "critical" for our purposes.
  assert.equal(isCriticalPosition({ isBook: false, bestEvalCp: 500 }), false);
  assert.equal(isCriticalPosition({ isBook: false, bestEvalCp: -1500 }), false);
});

test("isEngineGrade is true for cp_loss <= 25", () => {
  assert.equal(isEngineGrade({ cpLoss: 0 }), true);
  assert.equal(isEngineGrade({ cpLoss: 25 }), true);
  assert.equal(isEngineGrade({ cpLoss: 26 }), false);
  assert.equal(isEngineGrade({ cpLoss: null }), false);
});

test("criticalPositionAccuracy counts only critical plies for the named side", () => {
  const moves = [
    // white critical, engine-grade
    { side: "white", isBook: false, bestEvalCp: 50, cpLoss: 10 },
    // white critical, not engine-grade
    { side: "white", isBook: false, bestEvalCp: -100, cpLoss: 120 },
    // black critical, engine-grade
    { side: "black", isBook: false, bestEvalCp: 200, cpLoss: 5 },
    // not critical (decisive)
    { side: "white", isBook: false, bestEvalCp: 800, cpLoss: 0 },
    // book — excluded
    { side: "white", isBook: true, bestEvalCp: 0, cpLoss: 0 }
  ];
  const w = criticalPositionAccuracy(moves, "white");
  assert.equal(w.count, 2);
  assert.equal(w.engineGrade, 1);
  assert.equal(w.accuracyPct, 50);
  const b = criticalPositionAccuracy(moves, "black");
  assert.equal(b.count, 1);
  assert.equal(b.engineGrade, 1);
  assert.equal(b.accuracyPct, 100);
});

test("phaseBreakdownForSide splits ACPL by opening/middlegame/endgame", () => {
  const moves = [
    { side: "white", phase: "opening", isBook: true, cpLoss: 0 },
    { side: "white", phase: "middlegame", isBook: false, cpLoss: 50, bestEvalCp: 0, playedSan: "a3", bestSan: "Nf3" },
    { side: "white", phase: "middlegame", isBook: false, cpLoss: 100, bestEvalCp: 0, playedSan: "b4", bestSan: "d4" },
    { side: "white", phase: "endgame", isBook: false, cpLoss: 10, bestEvalCp: 0, playedSan: "Kf2", bestSan: "Kf2" }
  ];
  const out = phaseBreakdownForSide(moves, "white");
  assert.equal(out.middlegame.moveCount, 2);
  assert.equal(out.middlegame.acpl, 75);
  assert.equal(out.endgame.moveCount, 1);
  assert.equal(out.endgame.acpl, 10);
  assert.equal(out.endgame.topMatchPct, 100);
});

test("expectedAcplForRating interpolates the reference curve", () => {
  assert.equal(expectedAcplForRating(800), 130);
  assert.equal(expectedAcplForRating(2600), 14);
  // 1500 sits halfway between 1400 (65) and 1600 (50): expect 58 ((65+50)/2).
  assert.equal(expectedAcplForRating(1500), 58);
  // Out-of-range clamps.
  assert.equal(expectedAcplForRating(300), 130);
  assert.equal(expectedAcplForRating(3000), 14);
  assert.equal(expectedAcplForRating(null), null);
});

test("timeBucket categorizes low/mid/high time", () => {
  assert.equal(timeBucket(2_000), "low");
  assert.equal(timeBucket(9_999), "low");
  assert.equal(timeBucket(10_000), "mid");
  assert.equal(timeBucket(45_000), "mid");
  assert.equal(timeBucket(60_000), "high");
  assert.equal(timeBucket(180_000), "high");
  assert.equal(timeBucket(null), null);
});

test("clockAwareBreakdown returns null when no clock data exists", () => {
  const moves = [
    { side: "white", isBook: false, cpLoss: 0, clockRemainingMs: null },
    { side: "white", isBook: false, cpLoss: 30, clockRemainingMs: null }
  ];
  assert.equal(clockAwareBreakdown(moves, "white"), null);
});

test("clockAwareBreakdown buckets moves by clock and counts engine-grade", () => {
  const moves = [
    { side: "white", isBook: false, cpLoss: 0, clockRemainingMs: 5_000 },     // low, engine
    { side: "white", isBook: false, cpLoss: 50, clockRemainingMs: 3_000 },    // low, not engine
    { side: "white", isBook: false, cpLoss: 10, clockRemainingMs: 90_000 },   // high, engine
    { side: "white", isBook: false, cpLoss: 80, clockRemainingMs: 30_000 }    // mid, not engine
  ];
  const out = clockAwareBreakdown(moves, "white");
  assert.equal(out.low.count, 2);
  assert.equal(out.low.engineGrade, 1);
  assert.equal(out.low.engineGradePct, 50);
  assert.equal(out.high.count, 1);
  assert.equal(out.high.engineGradePct, 100);
  assert.equal(out.mid.count, 1);
});

test("computePlayerBaseline requires minSampleSize and averages prior ACPL", () => {
  assert.equal(computePlayerBaseline([{ player_acpl: 50 }, { player_acpl: 70 }]), null);
  const b = computePlayerBaseline([
    { player_acpl: 60, player_match_pct: 50 },
    { player_acpl: 80, player_match_pct: 40 },
    { player_acpl: 70, player_match_pct: 45 }
  ]);
  assert.equal(b.sampleSize, 3);
  assert.equal(b.meanAcpl, 70);
  assert.equal(b.meanTopMatchPct, 45);
});

test("concernLabel: no strong signals → 'low' with descriptive context", () => {
  // High-ACPL, blunder-filled, mediocre-everywhere game. Critical accuracy
  // 67% (6 of 9) is elevated but should NOT flag concern in a noisy game.
  const verdict = concernLabel({
    critical: { count: 9, engineGrade: 6, accuracyPct: 67 },
    ratingAdjusted: { expectedAcpl: 50, observedAcpl: 98 },
    blunders: 3
  });
  assert.equal(verdict.level, "low");
  // The descriptive context line should mention the high ACPL and blunders.
  assert.equal(verdict.reasons.length, 1);
  assert.match(verdict.reasons[0], /high ACPL/);
  assert.match(verdict.reasons[0], /blunder/);
});

test("concernLabel: critical accuracy alone is muted when ACPL is high", () => {
  // 80% critical accuracy would normally be a strong signal — but combined
  // with ACPL 90 (chaotic game) we don't credit it.
  const verdict = concernLabel({
    critical: { count: 10, engineGrade: 8, accuracyPct: 80 },
    ratingAdjusted: { expectedAcpl: 55, observedAcpl: 90 }
  });
  assert.equal(verdict.level, "low");
});

test("concernLabel: 'medium' on one strong signal", () => {
  // 80% critical accuracy in a clean game (ACPL well under threshold).
  const verdict = concernLabel({
    critical: { count: 10, engineGrade: 8, accuracyPct: 80 },
    ratingAdjusted: { expectedAcpl: 55, observedAcpl: 50 }
  });
  assert.equal(verdict.level, "medium");
  assert.equal(verdict.reasons.length, 1);
  assert.match(verdict.reasons[0], /critical-position/);
});

test("concernLabel: 'high' when two strong signals stack", () => {
  const verdict = concernLabel({
    critical: { count: 10, engineGrade: 8, accuracyPct: 80 },
    ratingAdjusted: { expectedAcpl: 60, observedAcpl: 25 }
  });
  assert.equal(verdict.level, "high");
  assert.equal(verdict.reasons.length, 2);
});

test("concernLabel: clock-aware engine grade at low time counts as strong signal", () => {
  const verdict = concernLabel({
    critical: { count: 2, engineGrade: 1, accuracyPct: 50 }, // sample too small
    ratingAdjusted: { expectedAcpl: 50, observedAcpl: 45 },  // not strong enough
    clockAware: { low: { count: 8, engineGrade: 7, engineGradePct: 88 }, mid: { count: 5, engineGradePct: 60 }, high: { count: 10, engineGradePct: 70 } }
  });
  assert.equal(verdict.level, "medium");
  assert.match(verdict.reasons[0], /low time/);
});

test("concernLabel: baseline deviation 25+ counts as a strong signal", () => {
  const verdict = concernLabel({
    critical: { count: 4, engineGrade: 2, accuracyPct: 50 },
    ratingAdjusted: { expectedAcpl: 60, observedAcpl: 30 }, // strongRating
    baseline: { sampleSize: 8, meanAcpl: 90 } // game ACPL 30 vs baseline 90 = -60
  });
  // Two strong signals (rating + baseline) → high.
  assert.equal(verdict.level, "high");
  assert.equal(verdict.reasons.length, 2);
});

test("fairPlaySummary plugs all pieces together end-to-end", () => {
  const moves = [
    { side: "white", phase: "middlegame", isBook: false, cpLoss: 10, bestEvalCp: 50, playedSan: "Nf3", bestSan: "Nf3", clockRemainingMs: 120_000 },
    { side: "white", phase: "middlegame", isBook: false, cpLoss: 20, bestEvalCp: -100, playedSan: "Bb5", bestSan: "Bc4", clockRemainingMs: 90_000 },
    { side: "white", phase: "middlegame", isBook: false, cpLoss: 15, bestEvalCp: 100, playedSan: "Qe2", bestSan: "Qe2", clockRemainingMs: 60_000 },
    { side: "white", phase: "middlegame", isBook: false, cpLoss: 5, bestEvalCp: -50, playedSan: "Re1", bestSan: "Re1", clockRemainingMs: 30_000 },
    { side: "white", phase: "endgame", isBook: false, cpLoss: 0, bestEvalCp: 0, playedSan: "Kf2", bestSan: "Kf2", clockRemainingMs: 5_000 }
  ];
  const out = fairPlaySummary({
    moves,
    side: "white",
    playerRating: 1500,
    summary: { white: { acpl: 10 }, black: { acpl: 80 } }
  });
  assert.equal(out.side, "white");
  assert.equal(out.critical.count, 5);  // all 5 are critical
  assert.equal(out.critical.engineGrade, 5);  // all under 25 cpLoss
  assert.equal(out.ratingAdjusted.expectedAcpl, 58);
  assert.equal(out.ratingAdjusted.observedAcpl, 10);
  assert.equal(out.ratingAdjusted.delta, 48);
  // High concern: critical-accuracy 100% AND rating-adjusted delta 48 (>=30).
  assert.equal(out.concern.level, "high");
});

// --- 2. Worker against a stub engine --------------------------------------
//
// The stub engine always returns the played move as "best" with eval=0 (a
// "perfect" game). That lets us assert the full pipeline writes rows without
// pulling in a real Stockfish.

function makeStubEngine() {
  return {
    version: "stub-engine-1.0",
    depth: 18,
    async analyze() {
      return { bestMoveUci: null, evalCp: 0, mateIn: null };
    },
    async close() {}
  };
}

test("worker analyzes a finalized game end-to-end against a stub engine", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // Scholar's Mate to finalize the game with real moves so the worker has
  // something to chew on. Play a few moves so we're past the book-ply skip.
  const moves = [
    { color: "white", move: { from: "e2", to: "e4" } },
    { color: "black", move: { from: "e7", to: "e5" } },
    { color: "white", move: { from: "f1", to: "c4" } },
    { color: "black", move: { from: "b8", to: "c6" } },
    { color: "white", move: { from: "d1", to: "h5" } },
    { color: "black", move: { from: "g8", to: "f6" } },
    { color: "white", move: { from: "h5", to: "f7" } } // checkmate
  ];
  for (const { color, move } of moves) {
    const player = game.players.find((p) => p.color === color);
    const client = player.id === alice.user.id ? alice : bob;
    const r = await fixture.post(client, `/api/games/${game.id}/moves`, move);
    assert.equal(r.status, 200, `move failed: ${JSON.stringify(r.body)}`);
  }

  // Confirm the game finalized and a job was enqueued by finalizeGame.
  const db = new Database(fixture.dbPath);
  try {
    const finalized = db.prepare("SELECT state FROM games WHERE id = ?").get(game.id);
    assert.equal(finalized.state, "finalized");
    const job = db.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.ok(job, "expected analysis_jobs row after finalize");
    assert.equal(job.status, "pending");
  } finally {
    db.close();
  }

  // Now run the worker once with the stub engine.
  const dbApi = await freshDbApi(fixture.dbPath);
  const worker = startAnalysisWorker({
    db: dbApi,
    enginePath: "/fake/stockfish",
    startEngineImpl: async () => makeStubEngine(),
    autoStart: false
  });
  const claimed = await worker.runOnce();
  assert.ok(claimed, "worker should have claimed the pending job");
  await worker.stop();

  const verifyDb = new Database(fixture.dbPath);
  try {
    const ga = verifyDb.prepare("SELECT * FROM game_analysis WHERE game_id = ?").get(game.id);
    assert.ok(ga, "game_analysis row should exist");
    assert.equal(ga.engine_version, "stub-engine-1.0");
    assert.equal(ga.status, "complete");
    const ma = verifyDb.prepare("SELECT COUNT(*) AS n FROM move_analysis WHERE game_analysis_id = ?").get(ga.id);
    assert.equal(ma.n, moves.length);
    const finishedJob = verifyDb.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.equal(finishedJob.status, "complete");
  } finally {
    verifyDb.close();
  }
});

test("worker re-queues on engine failure until MAX_ATTEMPTS, then marks failed", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // Play one move and resign so we have a finalized game with moves.
  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = whiteClient === alice ? bob : alice;
  const firstMove = await fixture.post(whiteClient, `/api/games/${game.id}/moves`, { from: "e2", to: "e4" });
  assert.equal(firstMove.status, 200);
  const resigned = await fixture.post(blackClient, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);

  const dbApi = await freshDbApi(fixture.dbPath);
  const failingEngine = {
    version: "stub-failing",
    depth: 18,
    async analyze() { throw new Error("engine boom"); },
    async close() {}
  };
  const worker = startAnalysisWorker({
    db: dbApi,
    enginePath: "/fake/stockfish",
    startEngineImpl: async () => failingEngine,
    autoStart: false
  });

  // MAX_ATTEMPTS = 3 in worker. Run until the job hits status=failed.
  for (let i = 0; i < 4; i++) {
    const job = await worker.runOnce();
    if (!job) break;
  }
  await worker.stop();

  const verifyDb = new Database(fixture.dbPath);
  try {
    const job = verifyDb.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.equal(job.status, "failed");
    assert.equal(job.attempts, 3);
    assert.match(String(job.last_error), /engine boom/);
    const noAnalysis = verifyDb.prepare("SELECT COUNT(*) AS n FROM game_analysis WHERE game_id = ?").get(game.id);
    assert.equal(noAnalysis.n, 0);
  } finally {
    verifyDb.close();
  }
});

test("aborted games do not enqueue an analysis job", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // Resign before any move → abort path (policy § 1.10).
  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const resigned = await fixture.post(whiteClient, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.game.state, "aborted");

  const db = new Database(fixture.dbPath);
  try {
    const job = db.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.equal(job, undefined, "aborted game should not enqueue an analysis job");
  } finally {
    db.close();
  }
});

// --- 3. Admin endpoint gate ------------------------------------------------

test("/api/admin/games/:id/analysis is gated and returns null payload before any run", async (t) => {
  const fixture = await startFixture(t);
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  db.close();

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const nonAdmin = await fixture.get(alice, `/api/admin/games/${game.id}/analysis`);
  assert.equal(nonAdmin.status, 403);
  assert.equal(nonAdmin.body.error, "admin_only");

  const adminView = await fixture.get(admin, `/api/admin/games/${game.id}/analysis`);
  assert.equal(adminView.status, 200);
  assert.equal(adminView.body.job, null);
  assert.equal(adminView.body.analysis, null);
  assert.deepEqual(adminView.body.moves, []);
});

test("/api/admin/games/:id/analyze refuses non-finalized games and enqueues finalized ones", async (t) => {
  const fixture = await startFixture(t);
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  db.close();

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const liveReject = await fixture.post(admin, `/api/admin/games/${game.id}/analyze`, {});
  assert.equal(liveReject.status, 409);
  assert.equal(liveReject.body.error, "game_not_finalized");

  // Finalize via Scholar's Mate.
  const moves = [
    { color: "white", move: { from: "e2", to: "e4" } },
    { color: "black", move: { from: "e7", to: "e5" } },
    { color: "white", move: { from: "f1", to: "c4" } },
    { color: "black", move: { from: "b8", to: "c6" } },
    { color: "white", move: { from: "d1", to: "h5" } },
    { color: "black", move: { from: "g8", to: "f6" } },
    { color: "white", move: { from: "h5", to: "f7" } }
  ];
  for (const { color, move } of moves) {
    const player = game.players.find((p) => p.color === color);
    const client = player.id === alice.user.id ? alice : bob;
    await fixture.post(client, `/api/games/${game.id}/moves`, move);
  }

  // Finalize already enqueued — the explicit POST should return the existing
  // pending job, not create a second one.
  const enqueued = await fixture.post(admin, `/api/admin/games/${game.id}/analyze`, {});
  assert.equal(enqueued.status, 200);
  assert.ok(enqueued.body.job, "expected the existing job in the response");
  assert.equal(enqueued.body.job.status, "pending");
  assert.equal(enqueued.body.requeued, false);
});

test("/api/admin/games/:id/analysis/review updates status + note and is admin-gated", async (t) => {
  const fixture = await startFixture(t);
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // Hand-insert a complete game_analysis row (skips the engine entirely).
  const analysisId = `gan_test_${Math.random().toString(16).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO game_analysis
      (id, game_id, source, engine_version, depth, multipv,
       white_acpl, black_acpl, white_blunders, black_blunders,
       white_mistakes, black_mistakes, white_inaccuracies, black_inaccuracies,
       white_top_move_match_pct, black_top_move_match_pct,
       status, review_status, created_at, completed_at)
    VALUES (?, ?, 'horsey', 'stub-1.0', 12, 1, 50, 80, 0, 1, 1, 2, 2, 3, 60, 40, 'complete', 'open', ?, ?)
  `).run(analysisId, game.id, new Date().toISOString(), new Date().toISOString());
  db.close();

  const notAdmin = await fixture.post(alice, `/api/admin/games/${game.id}/analysis/review`, {
    reviewStatus: "suspicious",
    adminNote: "I shouldn't be able to do this"
  });
  assert.equal(notAdmin.status, 403);
  assert.equal(notAdmin.body.error, "admin_only");

  const badStatus = await fixture.post(admin, `/api/admin/games/${game.id}/analysis/review`, {
    reviewStatus: "made-up",
    adminNote: ""
  });
  assert.equal(badStatus.status, 400);
  assert.equal(badStatus.body.error, "invalid_review_status");

  const updated = await fixture.post(admin, `/api/admin/games/${game.id}/analysis/review`, {
    reviewStatus: "suspicious",
    adminNote: "Critical accuracy looked extreme, need second eyes."
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.analysis.reviewStatus, "suspicious");
  assert.equal(updated.body.analysis.adminNote, "Critical accuracy looked extreme, need second eyes.");

  // GET should reflect the new state.
  const fetched = await fixture.get(admin, `/api/admin/games/${game.id}/analysis`);
  assert.equal(fetched.body.analysis.reviewStatus, "suspicious");
  assert.equal(fetched.body.analysis.adminNote, "Critical accuracy looked extreme, need second eyes.");
});

// --- helpers ---------------------------------------------------------------

async function startFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-analysis-"));
  const dbPath = path.join(dir, "test.db");
  const previousDbPath = process.env.HORSEY_DB_PATH;
  process.env.HORSEY_DB_PATH = dbPath;

  const serverModuleUrl = pathToFileURL(path.join(ROOT, "apps/api/server.mjs"));
  serverModuleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  const api = await import(serverModuleUrl.href);

  t.after(async () => {
    api.closeServerResources();
    if (previousDbPath === undefined) delete process.env.HORSEY_DB_PATH;
    else process.env.HORSEY_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  async function request(client, method, pathname, body) {
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
    req.method = method;
    req.url = pathname;
    req.headers = {
      host: "127.0.0.1",
      ...(client?.cookie ? { cookie: client.cookie } : {})
    };
    return callRoute(api.routeApi, req);
  }

  return {
    dbPath,
    get: (client, pathname) => request(client, "GET", pathname),
    post: (client, pathname, body = {}) => request(client, "POST", pathname, body),
    async signup(prefix) {
      const response = await request(null, "POST", "/api/auth/signup", {
        email: `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@example.com`,
        handle: `${prefix}_${Math.random().toString(16).slice(2, 8)}`,
        password: "password123",
        acceptedTosVersion: 1
      });
      assert.equal(response.status, 201, `signup failed: ${JSON.stringify(response.body)}`);
      return { cookie: response.cookie, user: response.body.viewer };
    }
  };
}

async function freshDbApi(dbPath) {
  // Open a separate db API instance against the same file. Used so the worker
  // owns its own connection — no contention with the server's connection.
  const dbModuleUrl = pathToFileURL(path.join(ROOT, "apps/api/db.mjs"));
  dbModuleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  const mod = await import(dbModuleUrl.href);
  return mod.openDatabase(dbPath);
}

function callRoute(routeApi, req) {
  return new Promise((resolve, reject) => {
    let status = 200;
    const headers = {};
    let raw = "";
    const res = {
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(nextStatus, nextHeaders = {}) {
        status = nextStatus;
        for (const [name, value] of Object.entries(nextHeaders)) {
          headers[name.toLowerCase()] = value;
        }
      },
      end(chunk = "") {
        raw += chunk.toString();
        resolve({
          status,
          headers,
          body: raw ? JSON.parse(raw) : {},
          cookie: String(headers["set-cookie"] ?? "").split(";")[0] || null
        });
      }
    };
    routeApi(req, res).catch(reject);
  });
}
