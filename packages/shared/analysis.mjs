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

// Phase boundaries.
//
// Endgame triggers on a few different shapes (queens off + low material,
// very few pieces, plain low total). Opening *extends past book* when the
// position still looks opening-y — many minor pieces undeveloped, kings not
// castled, queens still home — instead of slamming everything non-book into
// middlegame.
export const ENDGAME_MATERIAL_THRESHOLD = 14;
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Square indexes (a1 = 0 ... h8 = 63). Used by extractPositionFeatures to
// detect "piece still on its starting square."
const WHITE_KING_HOME = 4;     // e1
const BLACK_KING_HOME = 60;    // e8
const WHITE_QUEEN_HOME = 3;    // d1
const BLACK_QUEEN_HOME = 59;   // d8
const WHITE_MINOR_HOMES = new Set([1, 2, 5, 6]); // b1, c1, f1, g1
const BLACK_MINOR_HOMES = new Set([57, 58, 61, 62]); // b8, c8, f8, g8
const WHITE_ROOK_HOMES = new Set([0, 7]);  // a1, h1
const BLACK_ROOK_HOMES = new Set([56, 63]); // a8, h8
const WHITE_KING_CASTLED = new Set([2, 6]); // c1 (long), g1 (short)
const BLACK_KING_CASTLED = new Set([58, 62]); // c8, g8

function parseFenBoard(boardStr) {
  const board = new Array(64).fill(null);
  if (!boardStr) return board;
  const ranks = boardStr.split("/");
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    const rank = 7 - rankIdx; // FEN reads rank 8 first.
    let file = 0;
    for (const ch of ranks[rankIdx] || "") {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const square = rank * 8 + file;
      board[square] = ch;
      file += 1;
    }
  }
  return board;
}

// Count non-king material on the board from a FEN. Used as one endgame test.
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

// Rich feature extraction. Counts piece totals, where kings live, which
// minor pieces are still on home squares, which rooks are still on corners,
// etc. Used by classifyPhase below.
export function extractPositionFeatures(fen) {
  if (!fen) return null;
  const parts = fen.split(" ");
  const board = parseFenBoard(parts[0]);
  const castlingRights = parts[2] || "-";

  let material = 0;
  let queens = 0;
  let rooks = 0;
  let minors = 0;
  let pawns = 0;
  let whiteQueenHome = false;
  let blackQueenHome = false;
  let whiteKingSquare = -1;
  let blackKingSquare = -1;
  let whiteMinorsAtHome = 0;
  let blackMinorsAtHome = 0;
  let rooksOnHomeCorner = 0;

  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;
    const lower = piece.toLowerCase();
    material += PIECE_VALUE[lower] || 0;
    if (lower === "q") {
      queens += 1;
      if (piece === "Q" && sq === WHITE_QUEEN_HOME) whiteQueenHome = true;
      if (piece === "q" && sq === BLACK_QUEEN_HOME) blackQueenHome = true;
    } else if (lower === "r") {
      rooks += 1;
      if (piece === "R" && WHITE_ROOK_HOMES.has(sq)) rooksOnHomeCorner += 1;
      if (piece === "r" && BLACK_ROOK_HOMES.has(sq)) rooksOnHomeCorner += 1;
    } else if (lower === "b" || lower === "n") {
      minors += 1;
      if (piece === piece.toUpperCase() && WHITE_MINOR_HOMES.has(sq)) whiteMinorsAtHome += 1;
      if (piece === piece.toLowerCase() && BLACK_MINOR_HOMES.has(sq)) blackMinorsAtHome += 1;
    } else if (lower === "p") {
      pawns += 1;
    } else if (lower === "k") {
      if (piece === "K") whiteKingSquare = sq;
      else blackKingSquare = sq;
    }
  }

  const whiteKingHome = whiteKingSquare === WHITE_KING_HOME;
  const blackKingHome = blackKingSquare === BLACK_KING_HOME;
  const whiteKingCastled = WHITE_KING_CASTLED.has(whiteKingSquare);
  const blackKingCastled = BLACK_KING_CASTLED.has(blackKingSquare);
  const whiteCanCastle = castlingRights.includes("K") || castlingRights.includes("Q");
  const blackCanCastle = castlingRights.includes("k") || castlingRights.includes("q");

  return {
    material,
    queens,
    rooks,
    minors,
    pawns,
    whiteQueenHome,
    blackQueenHome,
    queensHomeCount: (whiteQueenHome ? 1 : 0) + (blackQueenHome ? 1 : 0),
    whiteKingSquare,
    blackKingSquare,
    whiteKingHome,
    blackKingHome,
    whiteKingCastled,
    blackKingCastled,
    whiteCanCastle,
    blackCanCastle,
    whiteMinorsAtHome,
    blackMinorsAtHome,
    undevelopedMinors: whiteMinorsAtHome + blackMinorsAtHome,
    rooksOnHomeCorner
  };
}

// Phase classifier. Heuristic, not perfect, but it should not classify a
// barely-developed early-game position past book as "middlegame."
//
// Inputs:
//   ply       — 1-indexed ply number
//   fenBefore — FEN of the position before the move
//   bookPlies — opening-book cutoff (default 8)
//
// Returns 'opening' | 'middlegame' | 'endgame'.
export function classifyPhase(ply, fenBefore, bookPlies = DEFAULT_BOOK_PLIES) {
  if (ply <= bookPlies) return "opening";
  if (!fenBefore) return "middlegame";
  const f = extractPositionFeatures(fenBefore);
  if (!f) return "middlegame";

  // ENDGAME tests (most decisive first).
  if (f.material <= ENDGAME_MATERIAL_THRESHOLD) return "endgame";
  // Queens off + total non-king material modest → endgame.
  if (f.queens === 0 && f.material <= 22) return "endgame";
  // Queens off + very few pieces (rook-and-pawn / minor-and-pawn endings).
  if (f.queens === 0 && (f.minors + f.rooks) <= 3) return "endgame";
  // Very few pieces total even with queens still on (e.g. Q+P vs K+P).
  if ((f.minors + f.rooks) <= 2 && f.queens <= 1) return "endgame";

  // OPENING extension past book. Score opening-ness signals:
  //  +1  at least one queen still on its home square
  //  +1  three+ minor pieces still on their home square
  //  +1  at least one side has not yet castled AND retains castling rights
  //  +1  three+ rooks still on their starting corner (a1/h1/a8/h8)
  let openingScore = 0;
  if (f.queensHomeCount >= 1) openingScore += 1;
  if (f.undevelopedMinors >= 3) openingScore += 1;
  const whiteUncastledWithRights = !f.whiteKingCastled && f.whiteKingHome && f.whiteCanCastle;
  const blackUncastledWithRights = !f.blackKingCastled && f.blackKingHome && f.blackCanCastle;
  if (whiteUncastledWithRights || blackUncastledWithRights) openingScore += 1;
  if (f.rooksOnHomeCorner >= 3) openingScore += 1;

  // Tunable thresholds. Earlier plies need fewer signals to count as still
  // in the opening; later plies need more.
  if (ply <= 14 && openingScore >= 2) return "opening";
  if (ply <= 20 && openingScore >= 3) return "opening";

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

// "High ACPL" gate. A chaotic, mistake-heavy game shouldn't earn concern
// from spotting the engine move on a tactical shot here and there — that's
// "lucky tactic," not "engine help." We use this threshold to mute the
// critical-accuracy signal in noisy games.
export const HIGH_ACPL_THRESHOLD = 80;

// Rule-based concern label. Inputs flow from this module's other metrics.
// Returns { level, reasons } so admins can see what triggered. Honestly
// rule-based — we have no labeled data, no ML.
//
// Levels:
//   high   — TWO+ strong signals stacked
//   medium — ONE strong signal (worth a human eye)
//   low    — no strong signals; reasons becomes a descriptive context line
//            ("high ACPL, several blunders, no low-clock data, no baseline yet")
//
// Strong signals:
//   - critical-position engine-grade >= 70% over 5+ critical moments,
//     AND the player's overall ACPL is NOT high. (Spotting top moves in
//     critical positions while playing badly everywhere else is much less
//     concerning than spotting them while playing engine-clean overall.)
//   - rating-adjusted ACPL delta >= 30 better than expected
//   - sustained engine-grade play at low clock time
//   - baseline deviation: game ACPL 25+ better than this player's prior
//     analyzed games, with sample size 5+
export function concernLabel({
  critical,
  ratingAdjusted,
  clockAware,
  baseline,
  blunders = 0
}) {
  const observedAcpl = ratingAdjusted?.observedAcpl ?? null;
  const expectedAcpl = ratingAdjusted?.expectedAcpl ?? null;
  const acplDelta = (expectedAcpl != null && observedAcpl != null)
    ? expectedAcpl - observedAcpl : null;
  const highAcpl = observedAcpl != null && observedAcpl >= HIGH_ACPL_THRESHOLD;

  const ca = critical?.accuracyPct ?? null;
  const criticalSampleOk = critical?.count >= 5;
  const strongCritical = !!(ca != null && criticalSampleOk && ca >= 70 && !highAcpl);
  const strongRating = !!(acplDelta != null && acplDelta >= 30);
  const strongClock = !!(clockAware?.low?.count >= 5 && clockAware.low.engineGradePct >= 70);

  let strongBaseline = false;
  if (baseline && observedAcpl != null) {
    const baselineDiff = baseline.meanAcpl - observedAcpl;
    if (baselineDiff >= 25 && baseline.sampleSize >= 5) strongBaseline = true;
  }

  const flags = [];
  if (strongCritical) {
    flags.push(`critical-position accuracy ${ca}% over ${critical.count} moments`);
  }
  if (strongRating) {
    flags.push(`ACPL ${observedAcpl} vs expected ${expectedAcpl} for rating (Δ ${acplDelta} better)`);
  }
  if (strongClock) {
    flags.push(`engine-grade ${clockAware.low.engineGradePct}% at low time (${clockAware.low.count} moves)`);
  }
  if (strongBaseline) {
    flags.push(`game ACPL ${observedAcpl} vs player's ${baseline.sampleSize}-game baseline ${baseline.meanAcpl}`);
  }

  const signalCount = flags.length;

  if (signalCount >= 2) return { level: "high", reasons: flags };
  if (signalCount >= 1) return { level: "medium", reasons: flags };

  // LOW concern — emit a descriptive context line instead of weak flags, so
  // the panel reads like a verdict, not a list of half-suspicions.
  const context = [];
  if (highAcpl) context.push(`high ACPL (${observedAcpl})`);
  if (blunders >= 2) context.push(`${blunders} blunders`);
  else if (blunders === 1) context.push("1 blunder");
  if (ca != null && criticalSampleOk && ca >= 55) {
    context.push(`elevated critical-position accuracy ${ca}% but ACPL too noisy to attribute`);
  } else if (acplDelta != null && acplDelta >= 15 && acplDelta < 30) {
    context.push(`ACPL ${observedAcpl} mildly under expected ${expectedAcpl} for rating`);
  }
  if (!clockAware) context.push("no per-ply clock data");
  if (!baseline) context.push("no historical baseline yet");

  return {
    level: "low",
    reasons: context.length > 0 ? [context.join(", ")] : []
  };
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
  const sideSummary = side === "white" ? summary?.white : summary?.black;
  const concern = concernLabel({
    critical,
    ratingAdjusted,
    clockAware,
    baseline,
    blunders: sideSummary?.blunders ?? 0
  });
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
