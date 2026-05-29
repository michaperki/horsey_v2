// FAIR_PLAY slice 1 — single-flight analysis-job consumer (ADR 0008).
//
// Pulls one pending job at a time, replays the game through chess.js, runs
// each ply through the engine, classifies cp-loss, and writes game_analysis +
// move_analysis rows. Failure increments attempts; we re-queue up to MAX
// attempts before marking failed.
//
// Boots from server.mjs when HORSEY_ANALYSIS_ENABLED=1 and STOCKFISH_PATH
// resolves. Off by default (no engine in CI / fixture tests).

import { applyMove, STARTING_FEN } from "../../packages/chess/src/board.mjs";
import {
  classifyCpLoss,
  classifyPhase,
  cpLossForPlay,
  DEFAULT_BOOK_PLIES,
  normalizeEvalCp,
  summarizeMoveAnalyses
} from "../../packages/shared/analysis.mjs";
import { startEngine } from "./engine.mjs";

const MAX_ATTEMPTS = 3;
const IDLE_POLL_MS = 5000;

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

export function startAnalysisWorker({
  db,
  logger,
  enginePath = process.env.STOCKFISH_PATH || null,
  depth = Number(process.env.HORSEY_ANALYSIS_DEPTH || 18),
  bookPlies = DEFAULT_BOOK_PLIES,
  startEngineImpl = startEngine,
  autoStart = true
} = {}) {
  if (!enginePath) {
    logger?.warn?.("analysis worker disabled: STOCKFISH_PATH not set", {
      event: "analysis.disabled_no_engine"
    });
    return { stop: async () => {}, runOnce: async () => null };
  }

  let engine = null;
  let stopped = false;
  let loopHandle = null;

  async function ensureEngine() {
    if (engine) return engine;
    engine = await startEngineImpl({ path: enginePath, depth });
    logger?.info?.("analysis engine started", {
      event: "analysis.engine_started",
      version: engine.version,
      depth
    });
    return engine;
  }

  async function runOnce() {
    const job = db.claimNextAnalysisJob();
    if (!job) return null;
    try {
      await analyzeJob(job);
      db.completeAnalysisJob(job.id, { status: "complete" });
      logger?.info?.("analysis job complete", {
        event: "analysis.job_complete",
        jobId: job.id,
        gameId: job.gameId
      });
      return job;
    } catch (error) {
      const msg = String(error?.message || error);
      const attempts = job.attempts; // already incremented by claim
      if (attempts >= MAX_ATTEMPTS) {
        db.completeAnalysisJob(job.id, { status: "failed", error: msg });
        logger?.error?.("analysis job failed permanently", {
          event: "analysis.job_failed",
          jobId: job.id,
          gameId: job.gameId,
          attempts,
          err: error
        });
      } else {
        db.requeueAnalysisJob(job.id, { error: msg });
        logger?.warn?.("analysis job requeued", {
          event: "analysis.job_requeued",
          jobId: job.id,
          gameId: job.gameId,
          attempts,
          err: error
        });
      }
      return job;
    }
  }

  async function analyzeJob(job) {
    const game = db.getGame(job.gameId);
    if (!game) {
      throw new Error(`game ${job.gameId} not found`);
    }
    const moves = game.moves || [];
    if (moves.length === 0) {
      throw new Error(`game ${job.gameId} has no moves to analyze`);
    }
    const eng = await ensureEngine();

    // Walk positions ply-by-ply. For each ply we need:
    //   - eval at the position BEFORE the played move (deriving best-move + best-eval)
    //   - eval at the position AFTER the played move (the played-move eval, from the next side's POV)
    const moveAnalyses = [];
    const analysisId = newId("gan");

    // Per-ply clock remaining (ms). Populated only if the bustling daemon
    // stashed the clk array on the game when it created it from a PGN script.
    // Real Horsey games don't have per-ply clock capture yet.
    const clkAfterMs = Array.isArray(game.clkAfterMs) ? game.clkAfterMs : null;

    let fenBefore = STARTING_FEN;

    for (let i = 0; i < moves.length; i++) {
      const ply = i + 1;
      const side = ply % 2 === 1 ? "white" : "black";
      const stored = moves[i];

      const before = await eng.analyze(fenBefore);
      const bestEvalAtBefore = normalizeEvalCp({ evalCp: before.evalCp, mateIn: before.mateIn });
      const bestUciAtBefore = before.bestMoveUci || null;

      // Apply the played move.
      const applied = applyMove(fenBefore, {
        from: stored.from,
        to: stored.to,
        promotion: stored.promotion ?? null
      });
      const fenAfter = applied.fen;

      // Eval the position after the played move. The score is from the side-
      // to-move's perspective (next side); flip back to white POV.
      const after = await eng.analyze(fenAfter);
      const evalAfterFromNextSide = normalizeEvalCp({ evalCp: after.evalCp, mateIn: after.mateIn });
      const playedEvalCpWhite = evalAfterFromNextSide == null
        ? null
        : (side === "white" ? -evalAfterFromNextSide : evalAfterFromNextSide);

      // Best-move eval from the current side's perspective: that's bestEvalAtBefore
      // but the engine reports it from the side-to-move's POV. So bestEvalAtBefore
      // is already from `side`'s POV when we flip to white POV.
      const bestEvalCpWhite = bestEvalAtBefore == null
        ? null
        : (side === "white" ? bestEvalAtBefore : -bestEvalAtBefore);

      const cpLoss = cpLossForPlay({
        side,
        bestEvalCp: bestEvalCpWhite,
        playedEvalCp: playedEvalCpWhite
      });

      // best-move SAN: convert UCI to SAN by replaying it on the before-position.
      let bestSan = null;
      if (bestUciAtBefore && bestUciAtBefore.length >= 4) {
        try {
          const bestApplied = applyMove(fenBefore, {
            from: bestUciAtBefore.slice(0, 2),
            to: bestUciAtBefore.slice(2, 4),
            promotion: bestUciAtBefore.length > 4 ? bestUciAtBefore[4] : null
          });
          bestSan = bestApplied.move.san;
        } catch {
          bestSan = null;
        }
      }

      const isBook = ply <= bookPlies;
      const isTopMove = !!(bestSan && stored.san === bestSan);
      const classification = isBook ? null : classifyCpLoss(cpLoss, { isTopMove });
      const phase = classifyPhase(ply, fenBefore, bookPlies);
      const clockRemainingMs = clkAfterMs && clkAfterMs[i] != null ? clkAfterMs[i] : null;

      moveAnalyses.push({
        id: newId("mva"),
        gameAnalysisId: analysisId,
        ply,
        side,
        playedSan: stored.san,
        bestSan,
        playedEvalCp: playedEvalCpWhite,
        bestEvalCp: bestEvalCpWhite,
        cpLoss,
        classification,
        isBook,
        phase,
        clockRemainingMs
      });

      fenBefore = fenAfter;
    }

    const summary = summarizeMoveAnalyses(moveAnalyses);

    db.insertGameAnalysis({
      id: analysisId,
      gameId: job.gameId,
      source: "horsey",
      engineVersion: eng.version,
      depth,
      multipv: 1,
      whiteAcpl: summary.white.acpl,
      blackAcpl: summary.black.acpl,
      whiteBlunders: summary.white.blunders,
      blackBlunders: summary.black.blunders,
      whiteMistakes: summary.white.mistakes,
      blackMistakes: summary.black.mistakes,
      whiteInaccuracies: summary.white.inaccuracies,
      blackInaccuracies: summary.black.inaccuracies,
      whiteTopMoveMatchPct: summary.white.topMoveMatchPct,
      blackTopMoveMatchPct: summary.black.topMoveMatchPct,
      status: "complete"
    });
    db.insertMoveAnalyses(moveAnalyses);
    return { analysisId, summary, moveCount: moveAnalyses.length };
  }

  async function loop() {
    while (!stopped) {
      const job = await runOnce();
      if (stopped) break;
      if (!job) {
        await sleep(IDLE_POLL_MS);
      }
    }
  }

  // Fire-and-forget — server.mjs doesn't await this. Tests pass autoStart=false
  // so they can drive runOnce() deterministically.
  if (autoStart) {
    loopHandle = loop().catch((error) => {
      logger?.error?.("analysis worker loop crashed", {
        event: "analysis.worker_crashed",
        err: error
      });
    });
  }

  async function stop() {
    stopped = true;
    if (engine) {
      try { await engine.close(); } catch { /* ignore */ }
      engine = null;
    }
    if (loopHandle) {
      try { await loopHandle; } catch { /* ignore */ }
    }
  }

  return { stop, runOnce };
}

function sleep(ms) {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
}
