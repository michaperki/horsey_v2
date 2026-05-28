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
