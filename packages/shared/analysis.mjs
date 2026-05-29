// FAIR_PLAY slice 1 — pure analysis helpers (ADR 0008).
//
// Engine-subprocess wiring lives in apps/api/engine.mjs. This module owns the
// math: cp-loss math, classification thresholds, and game-summary aggregation.
// Kept pure so it's testable without spawning Stockfish.

// Conventional Lichess-aligned thresholds (centipawns of loss vs. best move).
// Aligned so future ingest of Lichess pre-computed analysis lands in the same
// buckets. See ADR 0008 § Classification thresholds.
export const CLASSIFICATION_THRESHOLDS = {
  inaccuracy: 50,
  mistake: 100,
  blunder: 250
};

// First N plies skipped as "book" in slice 1. Crude — book theory will inflate
// top-move match pct otherwise. Refine when admin review surfaces noise.
export const DEFAULT_BOOK_PLIES = 8;

// Per-move cp_loss cap used in ACPL aggregation. Once a position is lost,
// "more lost" doesn't say anything more about move quality — and mate evals
// (~±30000) would otherwise dominate the average. Lichess uses a similar cap.
// Raw cp_loss values are still persisted uncapped on move_analysis so the
// per-ply UI keeps the underlying signal.
export const ACPL_CAP_CP = 1000;

export function classifyCpLoss(cpLoss, { isTopMove = false } = {}) {
  if (cpLoss == null || Number.isNaN(cpLoss)) return null;
  const loss = Math.max(0, Math.round(cpLoss));
  if (loss >= CLASSIFICATION_THRESHOLDS.blunder) return "blunder";
  if (loss >= CLASSIFICATION_THRESHOLDS.mistake) return "mistake";
  if (loss >= CLASSIFICATION_THRESHOLDS.inaccuracy) return "inaccuracy";
  if (isTopMove) return "best";
  return "good";
}

// Compute the cp-loss for a played move, from the side-to-move's perspective.
// `bestEvalCp` / `playedEvalCp` are both reported from white's perspective
// (UCI convention). For black, a more-positive eval is worse, so we flip.
//
// Mate scores arrive as ±100000 sentinels; treat any mate-in-N as +/-30000 cp
// for loss math so the loss number remains finite and ordered correctly.
const MATE_SENTINEL = 30000;

export function evalCpFromMate(mateIn) {
  if (mateIn == null) return null;
  if (mateIn === 0) return null;
  return mateIn > 0 ? MATE_SENTINEL - mateIn : -MATE_SENTINEL - mateIn;
}

export function normalizeEvalCp({ evalCp, mateIn }) {
  if (mateIn != null && mateIn !== 0) return evalCpFromMate(mateIn);
  if (evalCp == null) return null;
  return Math.round(evalCp);
}

export function cpLossForPlay({ side, bestEvalCp, playedEvalCp }) {
  if (bestEvalCp == null || playedEvalCp == null) return null;
  // Best eval is always >= played eval from the moving side's perspective.
  if (side === "white") return Math.max(0, bestEvalCp - playedEvalCp);
  return Math.max(0, playedEvalCp - bestEvalCp);
}

// Aggregate per-ply analyses into a game_analysis summary row. Book plies are
// excluded from ACPL and top-move-match (they're not really decisions).
export function summarizeMoveAnalyses(moveAnalyses) {
  const init = () => ({
    acpl: 0,
    nonBookCount: 0,
    topMoveMatches: 0,
    blunders: 0,
    mistakes: 0,
    inaccuracies: 0,
    totalCpLoss: 0
  });
  const sides = { white: init(), black: init() };

  for (const m of moveAnalyses) {
    if (m.isBook) continue;
    if (m.classification == null) continue;
    const bucket = sides[m.side];
    if (!bucket) continue;
    bucket.nonBookCount += 1;
    bucket.totalCpLoss += Math.min(m.cpLoss ?? 0, ACPL_CAP_CP);
    if (m.bestSan && m.playedSan === m.bestSan) bucket.topMoveMatches += 1;
    if (m.classification === "blunder") bucket.blunders += 1;
    else if (m.classification === "mistake") bucket.mistakes += 1;
    else if (m.classification === "inaccuracy") bucket.inaccuracies += 1;
  }

  const finalize = (b) => ({
    acpl: b.nonBookCount > 0 ? Math.round(b.totalCpLoss / b.nonBookCount) : 0,
    blunders: b.blunders,
    mistakes: b.mistakes,
    inaccuracies: b.inaccuracies,
    topMoveMatchPct: b.nonBookCount > 0
      ? Math.round((b.topMoveMatches / b.nonBookCount) * 100)
      : 0
  });

  return {
    white: finalize(sides.white),
    black: finalize(sides.black)
  };
}

// =============================================================================
// FAIR-PLAY METRICS (slice 2+ of FAIR_PLAY_NEXT_PASS)
// =============================================================================
// Distinct from the "game quality" summary above — this section answers "is
// this game suspicious?" rather than "who played better?". Honestly rule-
// based: no ground truth, no ML. Reasons are returned alongside the label
// so admins can see why a game flagged.

// Phase boundaries. Opening is the same crude book-ply skip as classification.
// Endgame triggers when total non-king material drops below this threshold.
// 14 ≈ a rook + minor on each side, or equivalent — well into endgame technique.
export const ENDGAME_MATERIAL_THRESHOLD = 14;
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Count non-king material on the board from a FEN. Used to classify endgame.
export function materialFromFen(fen) {
  if (!fen) return 0;
  const board = fen.split(" ")[0];
  let total = 0;
  for (const ch of board) {
    const piece = ch.toLowerCase();
    if (PIECE_VALUE[piece]) total += PIECE_VALUE[piece];
  }
  return total;
}

// Phase classifier. Pass the FEN BEFORE the move was played + the ply.
export function classifyPhase(ply, fenBefore, bookPlies = DEFAULT_BOOK_PLIES) {
  if (ply <= bookPlies) return "opening";
  const material = materialFromFen(fenBefore);
  if (material <= ENDGAME_MATERIAL_THRESHOLD) return "endgame";
  return "middlegame";
}

// A position is "critical" if it's post-book and the outcome is still in
// play (eval magnitude under 300cp from white's POV). Decisive positions
// (one side already crushing) tell us less about move quality.
export const CRITICAL_EVAL_RANGE_CP = 300;

export function isCriticalPosition(move) {
  if (move.isBook) return false;
  if (move.bestEvalCp == null) return false;
  return Math.abs(move.bestEvalCp) <= CRITICAL_EVAL_RANGE_CP;
}

// A move is "engine-grade" if cp_loss <= this threshold. 25cp is generous;
// it includes minor inaccuracies in eval, which is fine because we're
// asking "did the player play AT engine strength" not "did they play the
// exact top move."
export const ENGINE_GRADE_CP_LOSS = 25;

export function isEngineGrade(move) {
  if (move.cpLoss == null) return false;
  return move.cpLoss <= ENGINE_GRADE_CP_LOSS;
}

// Clock buckets for clock-aware analysis. A move played with very little
// time remaining is "low-time"; sustained engine accuracy at low time is
// the strongest single cheating signal we can extract from the data.
export const LOW_TIME_BUCKET_MS = 10_000;
export const HIGH_TIME_BUCKET_MS = 60_000;

export function timeBucket(clockMs) {
  if (clockMs == null) return null;
  if (clockMs < LOW_TIME_BUCKET_MS) return "low";
  if (clockMs >= HIGH_TIME_BUCKET_MS) return "high";
  return "mid";
}

// Lichess-style ACPL-by-rating reference curve. Approximate; the published
// curves vary by time control. Linear interpolation between anchor points.
// Used to compute a deviation: "1500-rated player observed at 25 ACPL is
// well below the expected ~55, deviation -30."
const EXPECTED_ACPL_BY_RATING = [
  { rating: 800, acpl: 130 },
  { rating: 1000, acpl: 100 },
  { rating: 1200, acpl: 80 },
  { rating: 1400, acpl: 65 },
  { rating: 1600, acpl: 50 },
  { rating: 1800, acpl: 38 },
  { rating: 2000, acpl: 28 },
  { rating: 2200, acpl: 22 },
  { rating: 2400, acpl: 18 },
  { rating: 2600, acpl: 14 }
];

export function expectedAcplForRating(rating) {
  if (rating == null || !Number.isFinite(rating)) return null;
  const r = Math.max(EXPECTED_ACPL_BY_RATING[0].rating, Math.min(EXPECTED_ACPL_BY_RATING[EXPECTED_ACPL_BY_RATING.length - 1].rating, rating));
  for (let i = 0; i < EXPECTED_ACPL_BY_RATING.length - 1; i++) {
    const lo = EXPECTED_ACPL_BY_RATING[i];
    const hi = EXPECTED_ACPL_BY_RATING[i + 1];
    if (r >= lo.rating && r <= hi.rating) {
      const t = (r - lo.rating) / (hi.rating - lo.rating);
      return Math.round(lo.acpl + t * (hi.acpl - lo.acpl));
    }
  }
  return EXPECTED_ACPL_BY_RATING[EXPECTED_ACPL_BY_RATING.length - 1].acpl;
}

// Per-phase summary for one side.
export function phaseBreakdownForSide(moves, side) {
  const init = () => ({ count: 0, totalCpLoss: 0, topMatches: 0, critical: 0, criticalEngineGrade: 0 });
  const phases = { opening: init(), middlegame: init(), endgame: init() };
  for (const m of moves) {
    if (m.side !== side) continue;
    const phase = m.phase || (m.isBook ? "opening" : "middlegame");
    const bucket = phases[phase];
    if (!bucket) continue;
    if (!m.isBook) {
      bucket.count += 1;
      bucket.totalCpLoss += Math.min(m.cpLoss ?? 0, ACPL_CAP_CP);
      if (m.bestSan && m.playedSan === m.bestSan) bucket.topMatches += 1;
    }
    if (isCriticalPosition(m)) {
      bucket.critical += 1;
      if (isEngineGrade(m)) bucket.criticalEngineGrade += 1;
    }
  }
  const finalize = (b) => ({
    moveCount: b.count,
    acpl: b.count > 0 ? Math.round(b.totalCpLoss / b.count) : 0,
    topMatchPct: b.count > 0 ? Math.round((b.topMatches / b.count) * 100) : 0,
    criticalCount: b.critical,
    criticalEngineGradePct: b.critical > 0 ? Math.round((b.criticalEngineGrade / b.critical) * 100) : null
  });
  return {
    opening: finalize(phases.opening),
    middlegame: finalize(phases.middlegame),
    endgame: finalize(phases.endgame)
  };
}

// Overall critical-position accuracy across all phases, one side.
export function criticalPositionAccuracy(moves, side) {
  let critical = 0;
  let engineGrade = 0;
  for (const m of moves) {
    if (m.side !== side) continue;
    if (!isCriticalPosition(m)) continue;
    critical += 1;
    if (isEngineGrade(m)) engineGrade += 1;
  }
  return {
    count: critical,
    engineGrade,
    accuracyPct: critical > 0 ? Math.round((engineGrade / critical) * 100) : null
  };
}

// Clock-aware top-move rate for one side. Null buckets if we have no clock
// data for any of that side's moves (most real games today).
export function clockAwareBreakdown(moves, side) {
  const init = () => ({ count: 0, engineGrade: 0 });
  const buckets = { low: init(), mid: init(), high: init() };
  let hasAnyClock = false;
  for (const m of moves) {
    if (m.side !== side) continue;
    if (m.isBook) continue;
    if (m.clockRemainingMs == null) continue;
    hasAnyClock = true;
    const bucket = buckets[timeBucket(m.clockRemainingMs)];
    if (!bucket) continue;
    bucket.count += 1;
    if (isEngineGrade(m)) bucket.engineGrade += 1;
  }
  if (!hasAnyClock) return null;
  const finalize = (b) => ({
    count: b.count,
    engineGrade: b.engineGrade,
    engineGradePct: b.count > 0 ? Math.round((b.engineGrade / b.count) * 100) : null
  });
  return {
    low: finalize(buckets.low),
    mid: finalize(buckets.mid),
    high: finalize(buckets.high)
  };
}

// Aggregate one player's prior analyzed games into a baseline. Caller passes
// the array of {playerAcpl, playerMatchPct, playerBlunders} rows from the
// listAnalyzedGamesForUser db helper (excluding the current game).
export function computePlayerBaseline(rows, { minSampleSize = 3 } = {}) {
  if (!Array.isArray(rows) || rows.length < minSampleSize) return null;
  const acplValues = rows.map((r) => r.player_acpl ?? r.playerAcpl).filter((v) => Number.isFinite(v));
  const matchValues = rows.map((r) => r.player_match_pct ?? r.playerMatchPct).filter((v) => Number.isFinite(v));
  if (acplValues.length < minSampleSize) return null;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    sampleSize: rows.length,
    meanAcpl: Math.round(mean(acplValues)),
    meanTopMatchPct: matchValues.length > 0 ? Math.round(mean(matchValues)) : null,
    minAcpl: Math.min(...acplValues),
    maxAcpl: Math.max(...acplValues)
  };
}

// Rule-based concern label. Inputs all flow from this module's metrics.
// Returns { level, reasons } so admins can see why something flagged. Reasons
// are short user-facing strings; the rules are intentionally conservative
// because we have no labeled data.
//
// Levels:
//   high   — strong signal of engine-like play (critical accuracy >= 70%
//            AND rating-adjusted ACPL is way better than expected); OR
//            sustained engine grade at low time across many moves
//   medium — one elevated signal: critical accuracy >= 55%, or rating-
//            adjusted delta >= 20 better than expected, or baseline deviation
//   low    — no strong signal
export function concernLabel({
  critical,
  ratingAdjusted,
  clockAware,
  baseline
}) {
  const reasons = [];
  let level = "low";

  // Critical-position accuracy signal.
  const ca = critical?.accuracyPct;
  if (ca != null && critical.count >= 5) {
    if (ca >= 70) reasons.push(`critical-position accuracy ${ca}% over ${critical.count} moments`);
    else if (ca >= 55) reasons.push(`elevated critical-position accuracy (${ca}%)`);
  }

  // Rating-adjusted ACPL deviation.
  if (ratingAdjusted && ratingAdjusted.expectedAcpl != null && ratingAdjusted.observedAcpl != null) {
    const delta = ratingAdjusted.expectedAcpl - ratingAdjusted.observedAcpl;
    if (delta >= 30) reasons.push(`ACPL ${ratingAdjusted.observedAcpl} vs expected ${ratingAdjusted.expectedAcpl} for rating (Δ ${delta} better)`);
    else if (delta >= 20) reasons.push(`ACPL ${ratingAdjusted.observedAcpl} vs expected ${ratingAdjusted.expectedAcpl} (Δ ${delta})`);
  }

  // Clock-aware: sustained engine grade at low time.
  if (clockAware?.low?.count >= 5 && clockAware.low.engineGradePct >= 70) {
    reasons.push(`engine-grade ${clockAware.low.engineGradePct}% at low time (${clockAware.low.count} moves)`);
  }

  // Baseline deviation: this game is much stronger than the player's history.
  if (baseline && ratingAdjusted?.observedAcpl != null) {
    const diff = baseline.meanAcpl - ratingAdjusted.observedAcpl;
    if (diff >= 25 && baseline.sampleSize >= 5) {
      reasons.push(`game ACPL ${ratingAdjusted.observedAcpl} vs player's ${baseline.sampleSize}-game baseline ${baseline.meanAcpl}`);
    }
  }

  // Promote level based on how many signals stacked.
  const strongCritical = ca != null && ca >= 70 && critical.count >= 5;
  const strongRating = ratingAdjusted?.expectedAcpl != null
    && (ratingAdjusted.expectedAcpl - ratingAdjusted.observedAcpl) >= 30;
  const strongClock = !!(clockAware?.low?.count >= 5 && clockAware.low.engineGradePct >= 70);

  if ((strongCritical && strongRating) || (strongCritical && strongClock) || (strongRating && strongClock)) {
    level = "high";
  } else if (reasons.length > 0) {
    level = "medium";
  }

  return { level, reasons };
}

// Build the full per-side fair-play summary. This is what the admin endpoint
// returns and the UI panel renders.
export function fairPlaySummary({ moves, side, playerRating, summary, baselineRows }) {
  const phaseBreakdown = phaseBreakdownForSide(moves, side);
  const critical = criticalPositionAccuracy(moves, side);
  const clockAware = clockAwareBreakdown(moves, side);
  const observedAcpl = side === "white" ? summary?.white?.acpl ?? null : summary?.black?.acpl ?? null;
  const expectedAcpl = expectedAcplForRating(playerRating);
  const ratingAdjusted = {
    rating: playerRating ?? null,
    expectedAcpl,
    observedAcpl,
    delta: expectedAcpl != null && observedAcpl != null ? expectedAcpl - observedAcpl : null
  };
  const baseline = computePlayerBaseline(baselineRows || []);
  const concern = concernLabel({ critical, ratingAdjusted, clockAware, baseline });
  return {
    side,
    phaseBreakdown,
    critical,
    ratingAdjusted,
    clockAware,
    baseline,
    concern
  };
}
