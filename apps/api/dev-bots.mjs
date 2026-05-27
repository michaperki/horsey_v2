// Dev-only bot daemon. Populates the lobby with fake players so the Live now
// feed, Open Tables, and recent history rails aren't empty during local QA.
//
// Lifecycle:
//   - Server boots with HORSEY_ENABLE_DEV_BOTS=1 (and not production).
//   - startBotDaemon() seeds a small bot pool if missing, then runs a tick
//     loop maintaining target open-challenge and live-game counts.
//   - Each live game between bots has a move timer that fires every
//     1-3 seconds, playing the next scripted move.
//
// Move logic is a hardcoded Fool's Mate script (1.f3 e5 2.g4 Qh4#). When a
// bot is forced off-script (e.g. a real user plays a different opener),
// the bot resigns rather than attempting a real chess line. Real engine
// integration is a future enhancement.
//
// Bot data is scoped to the bustling DB (HORSEY_DB_PATH=/tmp/horsey-bustling.db
// in the dev:bustling script) so it never touches your main local or
// production stores.

import { applyMove } from "../../packages/chess/src/board.mjs";
import { applyMoveToClock } from "../../packages/shared/clocks.mjs";
import { clearOwnOffer } from "../../packages/shared/draw-offers.mjs";

const BOTS = [
  { handle: "bot_anna", email: "bot.anna@horsey.bots", rating: 1234 },
  { handle: "bot_carlos", email: "bot.carlos@horsey.bots", rating: 1567 },
  { handle: "bot_demi", email: "bot.demi@horsey.bots", rating: 1789 },
  { handle: "bot_evan", email: "bot.evan@horsey.bots", rating: 1432 },
  { handle: "bot_finch", email: "bot.finch@horsey.bots", rating: 1611 }
];

// Provisional bots cap at $25 stake. Stakes here are in cents.
const STAKE_OPTIONS_CENTS = [100, 500, 1000, 2500];
// Fast time controls so games rotate visibly. The 10-second floor in
// clocks.mjs caps the shortest at 30s.
const TIME_CONTROLS = ["1+0", "30s+0", "45s+0"];

const TARGET_OPEN_TABLES = 3;
const TARGET_LIVE_GAMES = 2;
// 2-second tick keeps the daemon responsive when a real user is in a bot
// game (after their move, the bot picks up within tick + move-delay).
const TICK_MS = 2_000;
const MOVE_DELAY_MIN_MS = 1_000;
const MOVE_DELAY_MAX_MS = 3_000;
// A bot's direct greeting to a new account sits at the bottom of the
// stake range so the new player can accept without burning their bankroll.
const GREETING_STAKE_CENTS = 100;
const GREETING_TIME_CONTROL = "1+0";

const FOOLS_MATE = [
  { color: "white", from: "f2", to: "f3" },
  { color: "black", from: "e7", to: "e5" },
  { color: "white", from: "g2", to: "g4" },
  { color: "black", from: "d8", to: "h4" } // Qh4#
];

// Each new bot-vs-bot game gets a randomly weighted "outcome plan" that
// exercises a different settlement reason. checkmate is the default
// (runs the Fool's Mate script to its natural Qh4#); resign / draw
// short-circuit with an early finalize; timeout just makes the bots
// stop moving and lets the server's clock-timeout scheduler fire.
function pickOutcomePlan() {
  const roll = Math.random();
  if (roll < 0.5) return { type: "checkmate" };
  if (roll < 0.7) return { type: "resign", atPly: 2 + Math.floor(Math.random() * 3) };
  if (roll < 0.9) return { type: "draw", atPly: 2 + Math.floor(Math.random() * 3) };
  return { type: "timeout" };
}

export async function startBotDaemon({ db, services, log = () => {} }) {
  const botIds = await seedBotPool({ db, services, log });
  if (botIds.size < 2) {
    log("[bots] not enough bots seeded; daemon will idle");
  }

  let stopped = false;
  const gameTimers = new Map();
  // Per-game outcome plans (see pickOutcomePlan). Cleared lazily when a
  // game stops being live. On daemon restart, in-progress games default
  // to checkmate, which is fine.
  const gamePlans = new Map();
  // Non-bot users we've already greeted with a direct challenge. Kept in
  // memory so a server restart re-greets everyone (intentional — easy way
  // to retest the greeting flow during local QA).
  const greetedUserIds = new Set();

  const isBot = (id) => botIds.has(id);

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickIdleBot(excludeId = null) {
    const liveBotIds = new Set();
    for (const g of db.listLiveGames()) {
      for (const p of g.players) if (isBot(p.id)) liveBotIds.add(p.id);
    }
    const hostingBotIds = new Set(
      db.listOpenChallenges()
        .filter((c) => isBot(c.challengerId))
        .map((c) => c.challengerId)
    );
    const candidates = [...botIds].filter((id) => {
      if (id === excludeId) return false;
      if (liveBotIds.has(id)) return false;
      if (hostingBotIds.has(id)) return false;
      return true;
    });
    if (candidates.length === 0) return null;
    return db.getUser(candidates[Math.floor(Math.random() * candidates.length)]);
  }

  function rebalance() {
    if (stopped) return;

    // Drop stale plans for games that are no longer live.
    for (const gid of gamePlans.keys()) {
      const g = db.getGame(gid);
      if (!g || g.state !== "live") gamePlans.delete(gid);
    }

    // 0) Schedule a move for every live game where a bot is on the clock
    //    and there's no timer queued. Covers two cases:
    //      - User accepted a bot's open challenge (the accept ran in
    //        server.mjs; the daemon was never told about the new game).
    //      - User made their move in a user-vs-bot game; now the bot
    //        is on the clock.
    //    Skip games on the "timeout" plan — those want to NOT move so
    //    the server's clock-timer fires and finalizes by timeout.
    for (const game of db.listLiveGames()) {
      if (gameTimers.has(game.id)) continue;
      if (!game.players.some((p) => isBot(p.id))) continue;
      const plan = gamePlans.get(game.id);
      if (plan?.type === "timeout") continue;
      const turnColor = game.moves.length % 2 === 0 ? "white" : "black";
      const turnPlayer = game.players.find((p) => p.color === turnColor);
      if (turnPlayer && isBot(turnPlayer.id)) {
        scheduleNextMove(game.id);
      }
    }

    // 1) Top up open tables hosted by bots.
    let botOpenCount = db.listOpenChallenges()
      .filter((c) => isBot(c.challengerId)).length;
    while (botOpenCount < TARGET_OPEN_TABLES) {
      const challenger = pickIdleBot();
      if (!challenger) break;
      try {
        const challenge = services.createChallenge({
          challengerId: challenger.id,
          recipientId: null,
          stakeCents: pickRandom(STAKE_OPTIONS_CENTS),
          timeControl: pickRandom(TIME_CONTROLS)
        });
        services.publishChallengeCreated(db.getChallenge(challenge.id));
        botOpenCount += 1;
      } catch (e) {
        log(`[bots] createChallenge failed: ${e.message}`);
        break;
      }
    }

    // 1b) Send a one-time direct challenge to any non-bot user we
    //     haven't greeted yet. Existing users get greeted on the first
    //     tick after the daemon starts; new signups get greeted on the
    //     first tick after they appear.
    greetNewUsers();

    // 2) Pair up bots into live games until we hit the target.
    let liveBotGames = db.listLiveGames()
      .filter((g) => g.players.every((p) => isBot(p.id))).length;
    while (liveBotGames < TARGET_LIVE_GAMES) {
      const openByBot = db.listOpenChallenges()
        .filter((c) => isBot(c.challengerId));
      if (openByBot.length === 0) break;
      const challenge = openByBot[0];
      const accepter = pickIdleBot(challenge.challengerId);
      if (!accepter) break;
      try {
        const { game } = services.acceptChallenge(challenge, accepter.id);
        services.publishChallengeUpdated(db.getChallenge(challenge.id));
        services.publishMatchmakingMatched(game);
        services.scheduleClockTimeout(game);
        const plan = pickOutcomePlan();
        gamePlans.set(game.id, plan);
        log(`[bots] paired ${game.id} plan=${plan.type}${plan.atPly ? ` atPly=${plan.atPly}` : ""}`);
        if (plan.type !== "timeout") scheduleNextMove(game.id);
        liveBotGames += 1;
      } catch (e) {
        log(`[bots] acceptChallenge failed: ${e.message}`);
        break;
      }
    }
  }

  function greetNewUsers() {
    for (const user of db.listUsers()) {
      if (isBot(user.id)) continue;
      if (greetedUserIds.has(user.id)) continue;
      const challenger = pickIdleBot();
      if (!challenger) {
        // Try again next tick.
        return;
      }
      try {
        const challenge = services.createChallenge({
          challengerId: challenger.id,
          recipientId: user.id,
          stakeCents: GREETING_STAKE_CENTS,
          timeControl: GREETING_TIME_CONTROL
        });
        services.publishChallengeCreated(db.getChallenge(challenge.id));
        greetedUserIds.add(user.id);
        log(`[bots] ${challenger.handle} greeted ${user.handle}`);
      } catch (e) {
        // Most likely the challenger acquired a live game between
        // pickIdleBot() and createChallenge(). Don't mark the user as
        // greeted; we'll try with a different bot on the next tick.
        log(`[bots] greeting ${user.handle} failed: ${e.message}`);
        return;
      }
    }
  }

  function scheduleNextMove(gameId) {
    if (stopped) return;
    if (gameTimers.has(gameId)) {
      clearTimeout(gameTimers.get(gameId));
    }
    const delay =
      MOVE_DELAY_MIN_MS +
      Math.floor(Math.random() * (MOVE_DELAY_MAX_MS - MOVE_DELAY_MIN_MS));
    const timer = setTimeout(() => {
      gameTimers.delete(gameId);
      try {
        playNextMove(gameId);
      } catch (e) {
        log(`[bots] move tick error on ${gameId}: ${e.message}`);
      }
    }, delay);
    gameTimers.set(gameId, timer);
  }

  function resignAs(game, color, reason = "resignation") {
    const winnerSide = color === "white" ? "black_win" : "white_win";
    try {
      services.finalizeGame(game, { result: winnerSide, reason });
      services.publishGameFinalized(db.getGame(game.id));
    } catch (e) {
      log(`[bots] resign failed on ${game.id}: ${e.message}`);
    }
  }

  function playNextMove(gameId) {
    if (stopped) return;
    const game = db.getGame(gameId);
    if (!game || game.state !== "live") return;

    const turnColor = game.moves.length % 2 === 0 ? "white" : "black";
    const turnPlayer = game.players.find((p) => p.color === turnColor);
    if (!turnPlayer) return;
    if (!isBot(turnPlayer.id)) {
      // A real user (or future non-bot) is on the clock. Don't touch.
      // Re-check in a few seconds in case they move.
      scheduleNextMove(gameId);
      return;
    }

    const ply = game.moves.length;
    const plan = gamePlans.get(gameId) || { type: "checkmate" };

    // Plan branches: resign / draw / timeout short-circuit before we play
    // the next scripted move. checkmate (default) falls through to the
    // Fool's Mate script below.
    if (plan.type === "timeout") {
      // Don't move. Don't reschedule. Server's clock-timer will fire
      // settleIfFlagged when this side's clock runs out.
      return;
    }
    if (plan.type === "resign" && ply >= plan.atPly) {
      resignAs(game, turnColor, "resignation");
      return;
    }
    if (plan.type === "draw" && ply >= plan.atPly) {
      try {
        services.finalizeGame(game, { result: "draw", reason: "agreement" });
        services.publishGameFinalized(db.getGame(gameId));
      } catch (e) {
        log(`[bots] draw finalize failed on ${gameId}: ${e.message}`);
      }
      return;
    }

    if (ply >= FOOLS_MATE.length) {
      // Script exhausted — would only happen if real user injected moves
      // before the script could mate. Bot resigns.
      resignAs(game, turnColor);
      return;
    }

    const scripted = FOOLS_MATE[ply];
    if (scripted.color !== turnColor) {
      // Off-script: the move sequence diverged from Fool's Mate. Bot panics.
      resignAs(game, turnColor);
      return;
    }

    const now = Date.now();
    let result;
    try {
      result = applyMove(
        game.fen,
        { from: scripted.from, to: scripted.to },
        game.moves
      );
    } catch (e) {
      log(`[bots] applyMove threw on ${gameId} ply ${ply}: ${e.message}`);
      resignAs(game, turnColor);
      return;
    }

    const moves = [...game.moves, result.move];
    const nextClock = game.clock ? applyMoveToClock(game.clock, now) : null;
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

    if (result.result) {
      const refreshed = db.getGame(gameId);
      const challenge = db.getChallenge(refreshed.challengeId);
      if (challenge?.state === "accepted") {
        try {
          services.finalizeGame(refreshed, {
            result: result.result,
            reason: result.status
          });
        } catch (e) {
          log(`[bots] finalizeGame failed: ${e.message}`);
        }
      }
      services.publishGameFinalized(db.getGame(gameId));
    } else {
      const refreshed = db.getGame(gameId);
      services.scheduleClockTimeout(refreshed);
      services.publishGameUpdated(refreshed);
      scheduleNextMove(gameId);
    }
  }

  // Rehydrate move timers for any live game involving a bot. playNextMove
  // will no-op if a non-bot is on the clock and re-tick on the next sweep.
  for (const game of db.listLiveGames()) {
    if (game.players.some((p) => isBot(p.id))) {
      scheduleNextMove(game.id);
    }
  }

  rebalance();
  const tickInterval = setInterval(rebalance, TICK_MS);

  log(`[bots] daemon started with ${botIds.size} bots`);

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(tickInterval);
      for (const t of gameTimers.values()) clearTimeout(t);
      gameTimers.clear();
    }
  };
}

async function seedBotPool({ db, services, log }) {
  const ids = new Set();
  for (const bot of BOTS) {
    const existing = db.getUserByEmail(bot.email);
    if (existing) {
      ids.add(existing.id);
      continue;
    }
    try {
      const { user } = await services.signupAccount({
        email: bot.email,
        handle: bot.handle,
        password: "bot-pool-password"
      });
      db.updateUserRating(user.id, bot.rating);
      db.markEmailVerified(user.id);
      ids.add(user.id);
      log(`[bots] seeded ${bot.handle}`);
    } catch (e) {
      log(`[bots] failed to seed ${bot.handle}: ${e.message}`);
    }
  }
  return ids;
}
