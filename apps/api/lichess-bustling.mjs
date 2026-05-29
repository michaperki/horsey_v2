// PGN-driven bustling daemon (dev only).
//
// Pulls pgn_scripts rows (written by scripts/import-lichess-db.mjs),
// pairs the two scripted users via a real challenge + accept, and plays each
// move from the script honoring the per-ply clock data — so the live floor
// fills with games that have real time-pressure patterns instead of uniform
// tempo. finalizeGame fires normally at the end and enqueues analysis.
//
// Boots when HORSEY_ENABLE_PGN_BUSTLING=1 + NODE_ENV != production. Tuning:
//   HORSEY_PGN_REPLAY_SPEED   default 2.0  (2x wall-clock acceleration)
//   HORSEY_PGN_CONCURRENCY    default 8    (target concurrent live games)
//   HORSEY_PGN_TICK_MS        default 2000

import { applyMove } from "../../packages/chess/src/board.mjs";
import { applyMoveToClock, parseTimeControl } from "../../packages/shared/clocks.mjs";
import { clearOwnOffer } from "../../packages/shared/draw-offers.mjs";

const DEFAULT_SPEED = 2.0;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TICK_MS = 2_000;
// Hard floor + cap on per-move sleep so the floor stays visibly active
// and one slow-thought move doesn't block a slot for minutes.
const MIN_MOVE_DELAY_MS = 150;
const MAX_MOVE_DELAY_MS = 20_000;

export async function startLichessBustling({ db, services, log = () => {} }) {
  const speed = Number(process.env.HORSEY_PGN_REPLAY_SPEED || DEFAULT_SPEED);
  const concurrency = Number(process.env.HORSEY_PGN_CONCURRENCY || DEFAULT_CONCURRENCY);
  const tickMs = Number(process.env.HORSEY_PGN_TICK_MS || DEFAULT_TICK_MS);

  // gameId -> { script, scriptPly: number, baseSec, incSec }
  const activeScripts = new Map();
  const moveTimers = new Map();
  let stopped = false;
  let lastUnconsumedLog = -1;

  function clearMoveTimer(gameId) {
    const t = moveTimers.get(gameId);
    if (t) { clearTimeout(t); moveTimers.delete(gameId); }
  }

  // Compute the natural Lichess think-time for ply N from the per-ply
  // remaining-clock array. Clk_before for plies 0,1 is the base; for ply N>=2
  // it's clk_after[N-2] + increment (the same side's previous remaining + the
  // increment they earned). Think = clk_before - clk_after + increment.
  function thinkTimeMsForPly(ply, clkAfter, baseSec, incSec) {
    let clkBeforeSec;
    if (ply < 2) clkBeforeSec = baseSec;
    else clkBeforeSec = (clkAfter[ply - 2] ?? baseSec) + incSec;
    const after = clkAfter[ply] ?? clkBeforeSec;
    const thinkSec = Math.max(0, clkBeforeSec - after + incSec);
    return Math.max(MIN_MOVE_DELAY_MS, Math.min(MAX_MOVE_DELAY_MS, Math.round(thinkSec * 1000 / speed)));
  }

  async function startOneScript() {
    const script = db.claimNextPgnScript();
    if (!script) return null;
    const white = db.getUser(script.whiteUserId);
    const black = db.getUser(script.blackUserId);
    if (!white || !black) {
      log(`[pgn-bustling] script ${script.id} missing user(s); skipping`);
      return null;
    }
    let tc;
    try { tc = parseTimeControl(script.timeControl); }
    catch (e) {
      log(`[pgn-bustling] script ${script.id} bad TC ${script.timeControl}: ${e.message}`);
      return null;
    }
    try {
      const challenge = services.createChallenge({
        challengerId: white.id,
        recipientId: black.id,
        stakeCents: script.stakeCents,
        timeControl: script.timeControl
      });
      services.publishChallengeCreated(db.getChallenge(challenge.id));
      const { game } = services.acceptChallenge(challenge, black.id);
      services.publishChallengeUpdated(db.getChallenge(challenge.id));
      services.publishMatchmakingMatched(game);
      services.scheduleClockTimeout(game);
      // The accept randomized colors. Reorient the script to match: figure
      // out which scripted side is on each color in the actual game.
      const whiteSeat = game.players.find((p) => p.color === "white");
      const reversed = whiteSeat.id === black.id;
      // Stash per-ply clock-remaining (ms) on the game so the analysis worker
      // can read realistic clock pressure for fair-play metrics. The Lichess
      // PGN gives us seconds remaining after each ply.
      const clkAfterMs = script.clkAfter.map((s) => Math.round(s * 1000));
      db.saveGame({ ...db.getGame(game.id), clkAfterMs });
      activeScripts.set(game.id, {
        script,
        scriptPly: 0,
        baseSec: Math.floor(tc.baseMs / 1000),
        incSec: Math.floor(tc.incrementMs / 1000),
        reversed
      });
      log(`[pgn-bustling] started ${game.id} (${script.timeControl}, ${white.handle} vs ${black.handle}${reversed ? " — colors reversed" : ""})`);
      scheduleNextMove(game.id);
      return game.id;
    } catch (e) {
      log(`[pgn-bustling] failed to start script ${script.id}: ${e.message}`);
      return null;
    }
  }

  function scheduleNextMove(gameId) {
    if (stopped) return;
    const ctx = activeScripts.get(gameId);
    if (!ctx) return;
    const ply = ctx.scriptPly;
    if (ply >= ctx.script.moves.length) {
      // Script exhausted but no terminal result reached — resolve via the
      // PGN result tag. (Lichess "Normal" termination with no checkmate
      // typically means resignation; treat anything non-draw as resignation
      // of the side that DIDN'T win.)
      finalizeFromScriptTail(gameId);
      return;
    }
    const delay = thinkTimeMsForPly(
      ply,
      ctx.script.clkAfter,
      ctx.baseSec,
      ctx.incSec
    );
    const timer = setTimeout(() => {
      moveTimers.delete(gameId);
      try { playNextMove(gameId); }
      catch (e) { log(`[pgn-bustling] move tick error on ${gameId}: ${e.message}`); }
    }, delay);
    moveTimers.set(gameId, timer);
  }

  function playNextMove(gameId) {
    if (stopped) return;
    const ctx = activeScripts.get(gameId);
    if (!ctx) return;
    const game = db.getGame(gameId);
    if (!game || game.state !== "live") {
      activeScripts.delete(gameId);
      clearMoveTimer(gameId);
      return;
    }
    const scriptedMove = ctx.script.moves[ctx.scriptPly];
    const now = Date.now();
    let result;
    try {
      result = applyMove(
        game.fen,
        { from: scriptedMove.from, to: scriptedMove.to, promotion: scriptedMove.promotion },
        game.moves
      );
    } catch (e) {
      log(`[pgn-bustling] applyMove threw on ${gameId} ply ${ctx.scriptPly}: ${e.message}`);
      activeScripts.delete(gameId);
      forcedResign(game, ctx);
      return;
    }
    const moves = [...game.moves, result.move];
    const nextClock = game.clock ? applyMoveToClock(game.clock, now) : null;
    const turnColor = game.moves.length % 2 === 0 ? "white" : "black";
    const nextDrawOffer = clearOwnOffer(game.drawOffer, turnColor);
    db.transaction(() => {
      db.saveGame({
        ...game,
        fen: result.fen,
        moves,
        clock: nextClock,
        drawOffer: nextDrawOffer
      });
    })();

    ctx.scriptPly += 1;

    if (result.result) {
      const refreshed = db.getGame(gameId);
      try {
        services.finalizeGame(refreshed, {
          result: result.result,
          reason: result.status || "checkmate"
        });
        services.publishGameFinalized(db.getGame(gameId));
      } catch (e) {
        log(`[pgn-bustling] finalizeGame failed on ${gameId}: ${e.message}`);
      }
      activeScripts.delete(gameId);
      clearMoveTimer(gameId);
    } else {
      const refreshed = db.getGame(gameId);
      services.scheduleClockTimeout(refreshed);
      services.publishGameUpdated(refreshed);
      scheduleNextMove(gameId);
    }
  }

  function forcedResign(game, ctx) {
    // The player on the clock when the script broke resigns.
    const turnColor = game.moves.length % 2 === 0 ? "white" : "black";
    const winnerSide = turnColor === "white" ? "black_win" : "white_win";
    try {
      services.finalizeGame(game, { result: winnerSide, reason: "resignation" });
      services.publishGameFinalized(db.getGame(game.id));
    } catch (e) {
      log(`[pgn-bustling] forcedResign failed on ${game.id}: ${e.message}`);
    }
    clearMoveTimer(game.id);
    activeScripts.delete(game.id);
    void ctx;
  }

  function finalizeFromScriptTail(gameId) {
    const ctx = activeScripts.get(gameId);
    if (!ctx) return;
    const game = db.getGame(gameId);
    if (!game || game.state !== "live") {
      activeScripts.delete(gameId);
      return;
    }
    let outcome;
    if (ctx.script.result === "draw") outcome = { result: "draw", reason: "agreement" };
    else outcome = { result: ctx.script.result, reason: "resignation" };
    try {
      services.finalizeGame(game, outcome);
      services.publishGameFinalized(db.getGame(gameId));
    } catch (e) {
      log(`[pgn-bustling] tail-finalize failed on ${gameId}: ${e.message}`);
    }
    activeScripts.delete(gameId);
    clearMoveTimer(gameId);
  }

  async function rebalance() {
    if (stopped) return;
    // Clean up stale activeScripts whose games are no longer live.
    for (const gameId of activeScripts.keys()) {
      const g = db.getGame(gameId);
      if (!g || g.state !== "live") {
        activeScripts.delete(gameId);
        clearMoveTimer(gameId);
      }
    }
    while (activeScripts.size < concurrency && !stopped) {
      const started = await startOneScript();
      if (!started) break;
    }
    const remaining = db.countUnconsumedPgnScripts();
    if (remaining !== lastUnconsumedLog && (remaining === 0 || remaining % 50 === 0)) {
      log(`[pgn-bustling] ${activeScripts.size}/${concurrency} live · ${remaining} scripts remaining`);
      lastUnconsumedLog = remaining;
    }
  }

  await rebalance();
  const tickInterval = setInterval(rebalance, tickMs);
  log(`[pgn-bustling] daemon started — concurrency=${concurrency} speed=${speed}x`);

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(tickInterval);
      for (const t of moveTimers.values()) clearTimeout(t);
      moveTimers.clear();
      activeScripts.clear();
    }
  };
}
