const ROUTE_ALIASES = { "": "play", lobby: "play", wallet: "profile" };

function parseHash() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  const [head = "", ...rest] = raw.split("/");
  const name = ROUTE_ALIASES[head] ?? head;
  const param = rest.join("/") || null;
  return { name, param };
}

const initialRoute = parseHash();

const state = {
  view: "loading",
  authMode: "login",
  authError: null,
  bootstrap: null,
  activeChallenge: null,
  activeGame: null,
  activeSettlement: null,
  liveGame: null,
  historyList: null,
  userProfile: null,
  userRecentGames: null,
  replay: null,
  walletLedger: [],
  selectedSquare: null,
  dragFromSquare: null,
  focusSquare: null,
  pendingPromotion: null,
  resignConfirmOpen: false,
  gameError: null,
  actionError: null,
  accountError: null,
  accountNotice: null,
  inFlight: new Set(),
  matchmakingPoll: null,
  route: initialRoute.name,
  routeParam: initialRoute.param,
  rt: {
    ws: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    subscribedGameId: null
  },
  challengeCountdownTimer: null,
  clockTickFrame: null,
  clockAnchor: null,
  picker: {
    hero: { stakeCents: null, timeControl: null }
  },
  scout: {
    userId: null,
    user: null,
    loading: false,
    error: null,
    anchor: null,
    context: null
  }
};

const STAKE_TIER_DEFAULT_CENTS = 2500;
const TIME_DEFAULT = "3+0";

const CHIP_DENOMS_DOLLARS = [500, 100, 25, 5, 1];

function stakeChipStack(amountCents) {
  let remaining = Math.round(amountCents / 100);
  const stack = [];
  for (const denom of CHIP_DENOMS_DOLLARS) {
    while (remaining >= denom && stack.length < 6) {
      stack.push(denom);
      remaining -= denom;
    }
    if (stack.length >= 6) break;
  }
  return stack;
}

function timeControlKind(tc) {
  if (!tc) return "";
  if (/^(30s|45s|1\+|2\+)/.test(tc)) return "bullet";
  if (/^(3\+|5\+0)/.test(tc)) return "blitz";
  return "rapid";
}

function ensurePickerDefaults() {
  const lobby = state.bootstrap?.lobby;
  if (!lobby) return;
  const validStake = (cents) => lobby.stakes.some((s) => s.amountCents === cents);
  const validTime = (tc) => lobby.timeControls.includes(tc);
  const fallbackStake = validStake(STAKE_TIER_DEFAULT_CENTS)
    ? STAKE_TIER_DEFAULT_CENTS
    : lobby.stakes[0]?.amountCents ?? null;
  const fallbackTime = validTime(TIME_DEFAULT) ? TIME_DEFAULT : lobby.timeControls[0] ?? null;
  const pick = state.picker.hero;
  if (!validStake(pick.stakeCents)) pick.stakeCents = fallbackStake;
  if (!validTime(pick.timeControl)) pick.timeControl = fallbackTime;
}

function viewerId() {
  return state.bootstrap?.viewer?.id;
}

function captureClockAnchor(clock) {
  if (!clock) {
    state.clockAnchor = null;
    return;
  }
  const staleMs = clock.lastMoveAt ? Math.max(0, Date.now() - Date.parse(clock.lastMoveAt)) : 0;
  state.clockAnchor = {
    sideToMove: clock.sideToMove,
    whiteMs: clock.whiteMs,
    blackMs: clock.blackMs,
    anchoredAtMs: performance.now() - staleMs
  };
}

function setActiveGame(game) {
  state.activeGame = game;
  captureClockAnchor(game?.clock ?? null);
}

function liveGameForShell() {
  return state.liveGame?.state === "live" ? state.liveGame : null;
}

function actionKey(scope, id = "") {
  return id ? `${scope}:${id}` : scope;
}

function actionInFlight(scope, id = "") {
  return state.inFlight.has(actionKey(scope, id));
}

function setActionInFlight(scope, id, value) {
  const key = actionKey(scope, id);
  if (value) state.inFlight.add(key);
  else state.inFlight.delete(key);
}

function localRemainingForSide(side) {
  const anchor = state.clockAnchor;
  if (!anchor) return null;
  const stored = side === "white" ? anchor.whiteMs : anchor.blackMs;
  if (anchor.sideToMove !== side) return stored;
  return stored - (performance.now() - anchor.anchoredAtMs);
}

const money = (cents) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: cents % 100 === 0 ? 0 : 2
}).format(cents / 100);

function formatRatingDelta(delta) {
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const pieceNames = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn"
};

function apiFetch(url, options = {}) {
  return fetch(url, { ...options, credentials: "same-origin" });
}

class AuthRequiredError extends Error {
  constructor() { super("sign in required"); this.code = "unauthenticated"; }
}

async function getJson(url) {
  const response = await apiFetch(url);
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(url, body = {}, method = "POST") {
  const response = await apiFetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = response.status === 204 ? {} : await response.json();
  if (response.status === 401 && url !== "/api/auth/login" && url !== "/api/auth/signup") {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(payload.message || `${response.status} ${response.statusText}`);
  return payload;
}

async function loadReplay(gameId) {
  if (!gameId) {
    state.replay = null;
    return;
  }
  try {
    const resp = await getJson(`/api/games/${gameId}/replay`);
    state.replay = {
      gameId,
      startingFen: resp.replay.startingFen,
      moves: resp.replay.moves,
      currentPly: resp.replay.moves.length
    };
  } catch (error) {
    console.warn("failed to load replay", error);
    state.replay = null;
  }
}

async function loadBootstrap() {
  const data = await getJson("/api/bootstrap");
  state.bootstrap = data;
  state.liveGame = data.activeGame?.state === "live" ? data.activeGame : null;
  const viewingHistoryDetail = state.route === "history" && state.routeParam;
  if (!viewingHistoryDetail) {
    setActiveGame(data.activeGame || data.recentGame || null);
    state.activeSettlement = data.recentSettlement || null;
    if (data.recentSettlement?.state === "finalized" && data.recentSettlement.gameId) {
      await loadReplay(data.recentSettlement.gameId);
    } else if (!data.recentSettlement) {
      state.replay = null;
    }
  }
  if (!state.activeChallenge) {
    state.activeChallenge = data.incomingChallenges[0] || data.sentChallenges[0] || data.lobby.openChallenges[0] || null;
  } else {
    const refreshed = [...data.incomingChallenges, ...data.sentChallenges, ...data.lobby.openChallenges]
      .find((c) => c.id === state.activeChallenge.id);
    if (refreshed) state.activeChallenge = refreshed;
  }
  const wallet = await getJson("/api/wallet");
  state.walletLedger = wallet.ledger;
  state.bootstrap.viewer = wallet.viewer;
  ensurePickerDefaults();
}

async function load() {
  try {
    await loadBootstrap();
    state.view = "app";
    connectRealtime();
    await enterRoute(parseHash());
    return;
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      state.view = "auth";
      state.bootstrap = null;
    } else {
      throw error;
    }
  }
  render();
}

async function submitSignup({ email, handle, password }) {
  state.authError = null;
  try {
    await postJson("/api/auth/signup", { email, handle, password });
    await load();
  } catch (error) {
    state.authError = error.message;
    render();
  }
}

async function submitLogin({ email, password }) {
  state.authError = null;
  try {
    await postJson("/api/auth/login", { email, password });
    await load();
  } catch (error) {
    state.authError = error.message;
    render();
  }
}

async function logout() {
  try { await postJson("/api/auth/logout"); } catch { /* ignore */ }
  stopPolling();
  stopChallengeCountdown();
  closeRealtime();
  state.bootstrap = null;
  state.activeChallenge = null;
  setActiveGame(null);
  state.activeSettlement = null;
  state.liveGame = null;
  state.historyList = null;
  state.userProfile = null;
  state.userRecentGames = null;
  state.walletLedger = [];
  closeScout(false);
  state.view = "auth";
  state.authMode = "login";
  state.authError = null;
  render();
}

function setAuthMode(mode) {
  state.authMode = mode;
  state.authError = null;
  render();
}

function authGuard(error) {
  if (error instanceof AuthRequiredError) {
    stopPolling();
    stopChallengeCountdown();
    closeRealtime();
    state.bootstrap = null;
    state.activeChallenge = null;
    setActiveGame(null);
    state.activeSettlement = null;
    state.liveGame = null;
    state.historyList = null;
    state.userProfile = null;
    state.userRecentGames = null;
    state.walletLedger = [];
    closeScout(false);
    state.view = "auth";
    state.authMode = "login";
    state.authError = "Your session ended. Please sign in again.";
    render();
    return true;
  }
  return false;
}

function closeRealtime() {
  if (state.rt.reconnectTimer) {
    clearTimeout(state.rt.reconnectTimer);
    state.rt.reconnectTimer = null;
  }
  if (state.rt.ws) {
    try { state.rt.ws.close(); } catch { /* ignore */ }
    state.rt.ws = null;
  }
  state.rt.subscribedGameId = null;
  state.rt.reconnectAttempts = 0;
}

function navigate(route) { window.location.hash = route; }

function managePolling() {
  const shouldPoll = state.route === "play" && state.bootstrap?.matchmakingTicket && !state.liveGame;
  if (shouldPoll && !state.matchmakingPoll) {
    state.matchmakingPoll = setInterval(async () => {
      try {
        await loadBootstrap();
        if (state.activeGame && state.activeGame.state === "live") {
          stopPolling();
          navigate("game");
          return;
        }
        render();
      } catch (error) { authGuard(error); }
    }, 2000);
  } else if (!shouldPoll && state.matchmakingPoll) {
    stopPolling();
  }
}

function stopPolling() {
  if (state.matchmakingPoll) {
    clearInterval(state.matchmakingPoll);
    state.matchmakingPoll = null;
  }
}

function stopChallengeCountdown() {
  if (state.challengeCountdownTimer) {
    clearInterval(state.challengeCountdownTimer);
    state.challengeCountdownTimer = null;
  }
}

function challengeSecondsRemaining(challenge) {
  if (!challenge || !["incoming", "countered"].includes(challenge.state)) return null;
  const seconds = challenge.expiresInSeconds ?? 0;
  const base = Date.parse(challenge.updatedAt || challenge.createdAt);
  if (!seconds || !Number.isFinite(base)) return null;
  return Math.max(0, Math.ceil((base + seconds * 1000 - Date.now()) / 1000));
}

function visibleCountdownChallenges() {
  if (state.route === "wager" && state.activeChallenge) return [state.activeChallenge];
  if (state.route !== "play" || !state.bootstrap) return [];
  return [
    ...state.bootstrap.incomingChallenges,
    ...state.bootstrap.sentChallenges,
    ...state.bootstrap.lobby.openChallenges
  ];
}

function challengeExpiryLabel(challenge) {
  const remaining = challengeSecondsRemaining(challenge);
  if (remaining == null) return "";
  return remaining > 0 ? ` · auto-decline ${remaining}s` : " · expired";
}

function manageChallengeCountdown() {
  const challengeTicking = visibleCountdownChallenges()
    .some((challenge) => {
      const remaining = challengeSecondsRemaining(challenge);
      return remaining !== null && remaining > 0;
    });
  const queueTicking = state.route === "play" && !!state.bootstrap?.matchmakingTicket;
  const shouldTick = challengeTicking || queueTicking;
  if (shouldTick && !state.challengeCountdownTimer) {
    state.challengeCountdownTimer = setInterval(() => render(), 1000);
  } else if (!shouldTick && state.challengeCountdownTimer) {
    clearInterval(state.challengeCountdownTimer);
    state.challengeCountdownTimer = null;
  }
}

function viewerPendingSent() {
  const sent = state.bootstrap?.sentChallenges;
  if (!sent?.length) return null;
  return sent.find((c) => c.state === "incoming" || c.state === "countered") || null;
}

function lobbyHeroState() {
  if (state.bootstrap?.matchmakingTicket) return "queued";
  if (viewerPendingSent()) return "hosting";
  return "idle";
}

function elapsedSecondsSince(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function formatElapsedShort(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// Mirrors calculatePot in packages/shared/domain.mjs (RAKE_RATE = 0.05).
// Client preview only; the server is the source of truth at game creation.
function previewNetPotCents(stakeCents) {
  if (!Number.isFinite(stakeCents) || stakeCents <= 0) return 0;
  const gross = stakeCents * 2;
  const rake = Math.round(gross * 0.05);
  return gross - rake;
}

function recentOpponentsForPlay(limit = 4) {
  const items = state.historyList;
  if (!Array.isArray(items) || items.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const entry of items) {
    const opp = entry.opponent;
    if (!opp?.id || seen.has(opp.id)) continue;
    if (!entry.stakeCents || !entry.timeControl) continue;
    seen.add(opp.id);
    const deltaCents = entry.result === "win"
      ? Math.max(0, (entry.creditedCents ?? 0) - entry.stakeCents)
      : entry.result === "loss"
        ? -entry.stakeCents
        : Math.max(0, (entry.creditedCents ?? 0) - entry.stakeCents);
    out.push({
      opponentId: opp.id,
      handle: opp.handle,
      stakeCents: entry.stakeCents,
      timeControl: entry.timeControl,
      result: entry.result,
      deltaCents
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function rematchFromHistory({ opponentId, stakeCents, timeControl }) {
  if (!opponentId || !stakeCents || !timeControl) return;
  state.actionError = null;
  try {
    const payload = await postJson("/api/challenges", { recipientId: opponentId, stakeCents, timeControl });
    state.activeChallenge = payload.challenge;
    await loadBootstrap();
    navigate("wager");
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

function scoutTrigger(user, innerHtml, className = "", context = {}) {
  if (!user?.id || user.id === viewerId()) return innerHtml;
  const contextAttrs = [
    context.stakeCents ? `data-scout-stake="${escapeHtml(context.stakeCents)}"` : "",
    context.timeControl ? `data-scout-time="${escapeHtml(context.timeControl)}"` : ""
  ].filter(Boolean).join(" ");
  return `
    <span class="scout-trigger ${escapeHtml(className)}" role="button" tabindex="0"
      data-open-scout="${escapeHtml(user.id)}" ${contextAttrs}>
      ${innerHtml}
    </span>
  `;
}

function closeScout(shouldRender = true) {
  state.scout = {
    userId: null,
    user: null,
    loading: false,
    error: null,
    anchor: null,
    context: null
  };
  if (shouldRender) render();
}

function scoutAnchorFor(element) {
  const rect = element.getBoundingClientRect();
  const width = 340;
  const gap = 10;
  const left = Math.min(
    Math.max(12, rect.left),
    Math.max(12, window.innerWidth - width - 12)
  );
  let top = rect.bottom + gap;
  if (top + 320 > window.innerHeight) {
    top = Math.max(12, rect.top - 320 - gap);
  }
  return { top, left, width };
}

async function openScout(element) {
  const userId = element.dataset.openScout;
  if (!userId || userId === viewerId()) return;
  state.scout = {
    userId,
    user: null,
    loading: true,
    error: null,
    anchor: scoutAnchorFor(element),
    context: {
      stakeCents: Number.parseInt(element.dataset.scoutStake || "", 10) || state.picker.hero.stakeCents,
      timeControl: element.dataset.scoutTime || state.picker.hero.timeControl
    }
  };
  render();
  try {
    const resp = await getJson(`/api/users/${encodeURIComponent(userId)}`);
    if (state.scout.userId !== userId) return;
    state.scout.user = resp.user;
    state.scout.loading = false;
    render();
  } catch (error) {
    if (authGuard(error)) return;
    if (state.scout.userId !== userId) return;
    state.scout.loading = false;
    state.scout.error = error.message;
    render();
  }
}

async function challengeFromScout() {
  const userId = state.scout.userId;
  const stakeCents = state.scout.context?.stakeCents;
  const timeControl = state.scout.context?.timeControl;
  if (!userId || !stakeCents || !timeControl) return;
  state.actionError = null;
  try {
    const payload = await postJson("/api/challenges", { recipientId: userId, stakeCents, timeControl });
    state.activeChallenge = payload.challenge;
    closeScout(false);
    await loadBootstrap();
    navigate("wager");
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

async function challengeFromProfile(button) {
  const userId = button.dataset.profileChallenge;
  const stakeCents = Number.parseInt(button.dataset.profileStake || "", 10);
  const timeControl = button.dataset.profileTime;
  if (!userId || !stakeCents || !timeControl) return;
  state.actionError = null;
  try {
    const payload = await postJson("/api/challenges", { recipientId: userId, stakeCents, timeControl });
    state.activeChallenge = payload.challenge;
    await loadBootstrap();
    navigate("wager");
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

function manageClockTick() {
  const onGameRoute = state.route === "game" && state.activeGame;
  const onPlayWithLive = state.route === "play" && state.activeGame
    && state.liveGame && state.activeGame.id === state.liveGame.id;
  const game = state.activeGame;
  const wantTicking = (onGameRoute || onPlayWithLive)
    && game?.state === "live" && game?.clock;
  if (wantTicking && !state.clockTickFrame) {
    const tick = () => {
      if (!state.clockTickFrame) return;
      if (state.route === "game") updateClockDom();
      if (state.route === "play") updateLiveTableClockDom();
      state.clockTickFrame = requestAnimationFrame(tick);
    };
    state.clockTickFrame = requestAnimationFrame(tick);
  } else if (!wantTicking && state.clockTickFrame) {
    cancelAnimationFrame(state.clockTickFrame);
    state.clockTickFrame = null;
  }
}

function updateLiveTableClockDom() {
  const game = state.activeGame;
  if (!game?.clock || !game.turn) return;
  const node = document.querySelector("[data-live-table-clock] time");
  if (!node) return;
  const ms = localRemainingForSide(game.turn);
  node.textContent = ms == null ? "--:--" : formatClock(ms);
  const module = node.closest(".live-table-module");
  if (module) {
    module.classList.toggle("low", ms != null && ms < 30000);
    module.classList.toggle("critical", ms != null && ms < 10000);
  }
}

function updateClockDom() {
  const game = state.activeGame;
  if (!game?.clock) return;
  for (const player of game.players) {
    const node = document.querySelector(`[data-clock="${player.color}"] time`);
    if (!node) continue;
    const ms = localRemainingForSide(player.color);
    node.textContent = ms == null ? "--:--" : formatClock(ms);
    const strip = node.closest(".player-strip");
    if (strip) {
      strip.classList.toggle("low", ms != null && ms < 30000 && game.state === "live");
      strip.classList.toggle("critical", ms != null && ms < 10000 && game.state === "live");
      const meter = strip.querySelector(".clock-meter span");
      if (meter) meter.style.width = clockPercent(game.clock, ms);
    }
  }
}

function connectRealtime() {
  if (state.rt.ws && (state.rt.ws.readyState === WebSocket.OPEN || state.rt.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.rt.ws = ws;

  ws.addEventListener("open", () => {
    state.rt.reconnectAttempts = 0;
    if (state.activeGame && state.route === "game") {
      sendRealtime({ type: "subscribe", channel: `game:${state.activeGame.id}` });
      state.rt.subscribedGameId = state.activeGame.id;
    }
    if (state.view === "app") render();
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleRealtimeMessage(msg);
  });

  ws.addEventListener("close", () => {
    state.rt.subscribedGameId = null;
    scheduleReconnect();
    if (state.view === "app") render();
  });

  ws.addEventListener("error", () => {
    try { ws.close(); } catch { /* ignore */ }
  });
}

function scheduleReconnect() {
  if (state.rt.reconnectTimer) return;
  const attempt = state.rt.reconnectAttempts++;
  const delay = Math.min(15000, 500 * 2 ** Math.min(attempt, 5));
  state.rt.reconnectTimer = setTimeout(() => {
    state.rt.reconnectTimer = null;
    connectRealtime();
  }, delay);
}

function sendRealtime(payload) {
  const ws = state.rt.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function syncGameSubscription() {
  const want = state.route === "game" && state.activeGame ? state.activeGame.id : null;
  const current = state.rt.subscribedGameId;
  if (current === want) return;
  if (current) sendRealtime({ type: "unsubscribe", channel: `game:${current}` });
  if (want) {
    if (sendRealtime({ type: "subscribe", channel: `game:${want}` })) {
      state.rt.subscribedGameId = want;
    } else {
      state.rt.subscribedGameId = null;
    }
  } else {
    state.rt.subscribedGameId = null;
  }
}

async function handleRealtimeMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "ready":
    case "subscribed":
    case "unsubscribed":
    case "pong":
      return;
    case "error":
      console.warn("realtime error", msg);
      return;
    case "game.updated": {
      if (state.activeGame && msg.game && msg.game.id === state.activeGame.id) {
        setActiveGame(msg.game);
        if (state.liveGame?.id === msg.game.id && msg.game.state !== "live") {
          state.liveGame = null;
        }
        if (state.route === "game") render();
      }
      return;
    }
    case "presence.changed": {
      if (!state.activeGame || !msg.userId) return;
      const target = state.activeGame.players?.find((p) => p.id === msg.userId);
      if (!target) return;
      target.presence = { online: !!msg.online, lastSeenAt: msg.lastSeenAt ?? null };
      if (state.route === "game") render();
      return;
    }
    case "game.finalized": {
      const id = msg.gameId || msg.game?.id;
      if (!id) return;
      if (!state.activeGame || state.activeGame.id !== id) return;
      try {
        const [gameResp, settlementResp, wallet] = await Promise.all([
          getJson(`/api/games/${id}`),
          getJson(`/api/games/${id}/settlement`),
          getJson("/api/wallet")
        ]);
        setActiveGame(gameResp.game);
        if (state.liveGame?.id === id) state.liveGame = null;
        state.activeSettlement = settlementResp.settlement;
        state.bootstrap.viewer = wallet.viewer;
        state.walletLedger = wallet.ledger;
        await loadReplay(id);
        if (state.route === "game") {
          navigate("settlement");
        } else {
          render();
        }
      } catch (error) {
        console.warn("failed to load settlement after finalize", error);
      }
      return;
    }
    case "challenge.created":
    case "challenge.updated":
    case "matchmaking.matched": {
      try {
        await loadBootstrap();
        if (msg.type === "matchmaking.matched" && msg.game) {
          setActiveGame(msg.game);
          stopPolling();
          navigate("game");
          return;
        }
        render();
      } catch (error) {
        console.warn("failed to refresh after realtime event", error);
      }
      return;
    }
    default:
      return;
  }
}

async function submitMove(from, to, promotion = "q") {
  state.gameError = null;
  const response = await apiFetch(`/api/games/${state.activeGame.id}/moves`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, to, promotion })
  });
  if (response.status === 401) { authGuard(new AuthRequiredError()); return; }
  const payload = await response.json();
  if (!response.ok) {
    state.gameError = payload.message || "Illegal move";
    state.selectedSquare = null;
    render();
    return;
  }
  setActiveGame(payload.game);
  state.selectedSquare = null;
  state.pendingPromotion = null;
  if (payload.settlement && payload.settlement.state === "finalized") {
    state.activeSettlement = payload.settlement;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    const wallet = await getJson("/api/wallet");
    state.bootstrap.viewer = wallet.viewer;
    state.walletLedger = wallet.ledger;
    await loadReplay(state.activeGame.id);
    navigate("settlement");
    return;
  }
  render();
}

async function resignGame() {
  const gameId = state.activeGame?.id;
  if (!gameId || actionInFlight("resign", gameId)) return;
  state.gameError = null;
  setActionInFlight("resign", gameId, true);
  render();
  try {
    const payload = await postJson(`/api/games/${gameId}/resign`, {});
    setActiveGame(payload.game);
    state.resignConfirmOpen = false;
    state.activeSettlement = payload.settlement;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    const wallet = await getJson("/api/wallet");
    state.bootstrap.viewer = wallet.viewer;
    state.walletLedger = wallet.ledger;
    await loadReplay(state.activeGame.id);
    navigate("settlement");
  } catch (error) {
    if (authGuard(error)) return;
    state.gameError = error.message;
    render();
  } finally {
    setActionInFlight("resign", gameId, false);
    if (state.view === "app") render();
  }
}

async function submitDrawAction(action) {
  const gameId = state.activeGame?.id;
  if (!gameId || actionInFlight(action, gameId)) return;
  state.gameError = null;
  setActionInFlight(action, gameId, true);
  render();
  try {
    const payload = await postJson(`/api/games/${gameId}/${action}`, {});
    setActiveGame(payload.game);
    if (action === "draw-accept") {
      state.activeSettlement = payload.settlement;
      if (payload.viewer) state.bootstrap.viewer = payload.viewer;
      const wallet = await getJson("/api/wallet");
      state.bootstrap.viewer = wallet.viewer;
      state.walletLedger = wallet.ledger;
      await loadReplay(state.activeGame.id);
      navigate("settlement");
    } else {
      render();
    }
  } catch (error) {
    if (authGuard(error)) return;
    state.gameError = error.message;
    render();
  } finally {
    setActionInFlight(action, gameId, false);
    if (state.view === "app") render();
  }
}

async function actOnChallenge(action) {
  const challengeId = state.activeChallenge?.id;
  if (!challengeId || actionInFlight("challenge", `${challengeId}:${action}`)) return;
  state.actionError = null;
  setActionInFlight("challenge", `${challengeId}:${action}`, true);
  render();
  try {
    const payload = action === "counter"
      ? await postJson(`/api/challenges/${challengeId}/counter`, {
          stakeCents: state.activeChallenge.stakeCents,
          timeControl: state.activeChallenge.timeControl
        })
      : await postJson(`/api/challenges/${challengeId}/${action}`);
    state.activeChallenge = payload.challenge;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    if (payload.game) setActiveGame(payload.game);
    const wallet = await getJson("/api/wallet");
    state.bootstrap.viewer = wallet.viewer;
    state.walletLedger = wallet.ledger;
    if (action === "accept") navigate("game");
    if (action === "decline" || action === "counter") {
      state.activeChallenge = null;
      navigate("play");
    }
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  } finally {
    setActionInFlight("challenge", `${challengeId}:${action}`, false);
    if (state.view === "app") render();
  }
}

async function withdrawChallenge(challengeId) {
  state.actionError = null;
  const id = challengeId ?? state.activeChallenge?.id;
  if (!id) return;
  try {
    const payload = await postJson(`/api/challenges/${id}`, {}, "DELETE");
    if (state.activeChallenge?.id === id) state.activeChallenge = payload.challenge;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    await loadBootstrap();
    if (state.route === "wager") {
      state.activeChallenge = null;
      navigate("play");
    }
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

async function hostOpenInvite({ stakeCents, timeControl }) {
  if (actionInFlight("host-invite")) return;
  state.actionError = null;
  setActionInFlight("host-invite", "", true);
  render();
  try {
    await postJson("/api/challenges", { recipientId: null, stakeCents, timeControl });
    await loadBootstrap();
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  } finally {
    setActionInFlight("host-invite", "", false);
    if (state.view === "app") render();
  }
}

async function joinQuickMatch({ stakeCents, timeControl }) {
  if (actionInFlight("quick-match")) return;
  state.actionError = null;
  setActionInFlight("quick-match", "", true);
  render();
  try {
    const payload = await postJson("/api/matchmaking/quick", { stakeCents, timeControl });
    if (payload.matched && payload.game) {
      setActiveGame(payload.game);
      if (payload.viewer) state.bootstrap.viewer = payload.viewer;
      const wallet = await getJson("/api/wallet");
      state.bootstrap.viewer = wallet.viewer;
      state.walletLedger = wallet.ledger;
      navigate("game");
    } else {
      await loadBootstrap();
      managePolling();
      render();
    }
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  } finally {
    setActionInFlight("quick-match", "", false);
    if (state.view === "app") render();
  }
}

async function leaveQuickMatch() {
  try {
    await postJson("/api/matchmaking/quick", {}, "DELETE");
    await loadBootstrap();
    stopPolling();
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

async function updateAccountEmail({ email, password }) {
  if (actionInFlight("account-email")) return;
  state.accountError = null;
  state.accountNotice = null;
  setActionInFlight("account-email", "", true);
  render();
  try {
    const payload = await postJson("/api/auth/account/email", { email, password }, "PATCH");
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    state.accountNotice = "Email updated.";
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("account-email", "", false);
    if (state.view === "app") render();
  }
}

async function updateAccountPassword({ currentPassword, nextPassword }) {
  if (actionInFlight("account-password")) return;
  state.accountError = null;
  state.accountNotice = null;
  setActionInFlight("account-password", "", true);
  render();
  try {
    await postJson("/api/auth/account/password", { currentPassword, nextPassword }, "PATCH");
    state.accountNotice = "Password updated.";
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("account-password", "", false);
    if (state.view === "app") render();
  }
}

async function logoutOtherSessions() {
  if (actionInFlight("logout-others")) return;
  state.accountError = null;
  state.accountNotice = null;
  setActionInFlight("logout-others", "", true);
  render();
  try {
    await postJson("/api/auth/logout-others");
    state.accountNotice = "Other sessions signed out.";
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("logout-others", "", false);
    if (state.view === "app") render();
  }
}

function selectChallenge(challenge) {
  state.activeChallenge = challenge;
  state.actionError = null;
  navigate("wager");
}

async function requestRematch() {
  const rematch = state.activeSettlement?.rematchChallenge;
  if (!rematch) return;
  state.actionError = null;
  try {
    const payload = await postJson("/api/challenges", {
      recipientId: rematch.opponentId,
      stakeCents: rematch.stakeCents,
      timeControl: rematch.timeControl
    });
    state.activeChallenge = payload.challenge;
    await loadBootstrap();
    navigate("wager");
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

function normalizeHashUrl() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  const [head = "", ...rest] = raw.split("/");
  if (head in ROUTE_ALIASES && ROUTE_ALIASES[head] !== head) {
    const canonical = [ROUTE_ALIASES[head], ...rest].filter(Boolean).join("/");
    window.history.replaceState(null, "", `#${canonical}`);
  }
}

async function enterRoute(parsed) {
  state.route = parsed.name;
  state.routeParam = parsed.param;
  normalizeHashUrl();

  if (state.route === "history" && state.routeParam) {
    state.actionError = null;
    try {
      const gameId = state.routeParam;
      const [gameResp, settlementResp, replayResp] = await Promise.all([
        getJson(`/api/games/${gameId}`),
        getJson(`/api/games/${gameId}/settlement`),
        getJson(`/api/games/${gameId}/replay`)
      ]);
      setActiveGame(gameResp.game);
      state.activeSettlement = settlementResp.settlement;
      state.replay = {
        gameId,
        startingFen: replayResp.replay.startingFen,
        moves: replayResp.replay.moves,
        currentPly: replayResp.replay.moves.length
      };
    } catch (error) {
      if (authGuard(error)) return;
      state.actionError = error.message;
    }
  } else if (state.route === "history") {
    try {
      const resp = await getJson("/api/games/history");
      state.historyList = resp.games;
    } catch (error) {
      if (authGuard(error)) return;
      state.actionError = error.message;
    }
  } else if (state.route === "play") {
    try {
      const resp = await getJson("/api/games/history");
      state.historyList = resp.games;
    } catch (error) {
      if (authGuard(error)) return;
    }
  } else if (state.route === "profile") {
    try {
      const wallet = await getJson("/api/wallet");
      state.walletLedger = wallet.ledger;
      if (state.bootstrap) state.bootstrap.viewer = wallet.viewer;
    } catch (error) {
      if (authGuard(error)) return;
    }
  } else if (state.route === "user" && state.routeParam) {
    closeScout(false);
    state.actionError = null;
    state.userProfile = null;
    state.userRecentGames = null;
    try {
      const [profileResp, recentResp] = await Promise.all([
        getJson(`/api/users/${encodeURIComponent(state.routeParam)}`),
        getJson(`/api/users/${encodeURIComponent(state.routeParam)}/recent-games?limit=10`)
      ]);
      state.userProfile = profileResp.user;
      state.userRecentGames = recentResp.games;
    } catch (error) {
      if (authGuard(error)) return;
      state.actionError = error.message;
    }
  }

  managePolling();
  syncGameSubscription();
  render();
}

window.addEventListener("hashchange", () => {
  enterRoute(parseHash());
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.scout.userId) {
    event.preventDefault();
    closeScout();
    return;
  }
  if (state.resignConfirmOpen) {
    event.preventDefault();
    state.resignConfirmOpen = false;
    render();
    return;
  }
  if (!state.pendingPromotion) return;
  event.preventDefault();
  state.pendingPromotion = null;
  render();
});

document.addEventListener("click", (event) => {
  if (!state.scout.userId) return;
  const target = event.target;
  if (target.closest?.(".scout-popover") || target.closest?.("[data-open-scout]")) return;
  closeScout();
});

function shell(content) {
  const viewer = state.bootstrap.viewer;
  const liveGame = liveGameForShell();
  return `
    <header class="topbar">
      <a class="brand" href="#play"><span class="mark">♞</span>Horsey</a>
      <nav>
        ${navLink("play", "Play")}
        ${navLink("history", "History")}
        ${navLink("profile", "Profile")}
      </nav>
      <div class="topbar-actions">
        ${connectionPill()}
        ${liveGame ? `<a class="resume-pill" href="#game"><span class="dot"></span>Resume game</a>` : ""}
        <a class="wallet-pill" href="#profile" title="Wallet detail in Profile">
          <span>${money(viewer.balanceCents)}</span>
          <small>${money(viewer.escrowCents)} escrow</small>
        </a>
        <div class="viewer-id">
          <small>signed in as <strong>${escapeHtml(viewer.handle)}</strong></small>
          <button class="link" data-logout>Log out</button>
        </div>
      </div>
    </header>
    <main>${content}</main>
    ${renderScoutPopover()}
    ${resignConfirmDialog()}
  `;
}

function navLink(id, label) {
  const active = state.route === id ? "active" : "";
  return `<a class="${active}" href="#${id}">${label}</a>`;
}

function memberSinceLabel(iso) {
  if (!iso) return "new member";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "new member";
  return `joined ${date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}

function scoutWinRate(stats) {
  const games = stats?.finishedGames ?? 0;
  if (!games) return "0%";
  return `${Math.round(((stats.wins ?? 0) / games) * 100)}%`;
}

function scoutStreakLabel(streak) {
  if (!streak?.length) return "No streak";
  const word = streak.kind === "W" ? "win" : streak.kind === "L" ? "loss" : "draw";
  return `${streak.length} ${word}${streak.length === 1 ? "" : "s"}`;
}

function scoutBeads(results = []) {
  if (!results.length) return `<span class="scout-empty">No finished games yet</span>`;
  return results.map((r) => `<span class="scout-bead ${r.toLowerCase()}">${escapeHtml(r)}</span>`).join("");
}

const ESTABLISHED_GAMES_THRESHOLD = 20;

function accountAgeLabel(iso) {
  if (!iso) return "new";
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return "new";
  const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30))}mo`;
  return `${Math.max(1, Math.floor(days / 365))}y`;
}

function scoutNarrative(stats, h2h) {
  const games = stats?.finishedGames ?? 0;
  const tenure = games >= ESTABLISHED_GAMES_THRESHOLD ? "established regular" : "new account";
  const sampleLine = games === 0
    ? "no finished games yet"
    : `${games} finished game${games === 1 ? "" : "s"}`;
  const sharedClause = h2h?.games ? " · shared history" : "";
  return { tenure, frame: `${sampleLine}${sharedClause}` };
}

function renderScoutPopover() {
  const scout = state.scout;
  if (!scout.userId || !scout.anchor) return "";
  const style = `top:${Math.round(scout.anchor.top)}px;left:${Math.round(scout.anchor.left)}px;width:${scout.anchor.width}px`;
  if (scout.loading) {
    return `
      <section class="scout-popover" style="${style}" role="dialog" aria-modal="false" aria-label="Scout card">
        <div class="scout-skeleton"></div>
        <div class="scout-skeleton short"></div>
        <div class="scout-skeleton grid"></div>
      </section>
    `;
  }
  if (scout.error) {
    return `
      <section class="scout-popover" style="${style}" role="dialog" aria-modal="false" aria-label="Scout card">
        <button type="button" class="scout-close" data-close-scout aria-label="Close scout card">×</button>
        <strong>Scout unavailable</strong>
        <p class="muted small">${escapeHtml(scout.error)}</p>
      </section>
    `;
  }
  const user = scout.user;
  if (!user) return "";
  const stats = user.stats ?? {};
  const h2h = user.h2hVsViewer;
  const initial = (user.handle?.[0] ?? "?").toUpperCase();
  const h2hText = h2h
    ? `${h2h.viewerWins}-${h2h.viewerLosses}${h2h.draws ? `-${h2h.draws}` : ""} (${h2h.games})`
    : "No shared games";
  const h2hMoney = h2h?.viewerNetCents ? `<span class="money-win">+${money(h2h.viewerNetCents)}</span>` : "";
  const challengeLabel = scout.context?.stakeCents ? `Challenge ${money(scout.context.stakeCents)}` : "Challenge";
  const challengeDisabled = !scout.context?.stakeCents || !scout.context?.timeControl;
  const narrative = scoutNarrative(stats, h2h);
  return `
    <section class="scout-popover" style="${style}" role="dialog" aria-modal="false" aria-label="Scout card">
      <button type="button" class="scout-close" data-close-scout aria-label="Close scout card">×</button>
      <header class="scout-head">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="scout-identity">
          <strong>${escapeHtml(user.handle)}</strong>
          <small class="mono tnum">${escapeHtml(String(user.rating))}</small>
        </div>
        ${user.presence?.online ? `<span class="status-pill">online</span>` : ""}
      </header>
      <div class="scout-reveal">
        <strong class="scout-label">${escapeHtml(narrative.tenure)}</strong>
        <span class="scout-frame">${escapeHtml(narrative.frame)}</span>
      </div>
      <div class="scout-stat-grid">
        <div><small>Win rate</small><strong>${escapeHtml(scoutWinRate(stats))}</strong></div>
        <div><small>Streak</small><strong>${escapeHtml(scoutStreakLabel(stats.currentStreak))}</strong></div>
        <div><small>Joined</small><strong>${escapeHtml(accountAgeLabel(user.createdAt))}</strong></div>
      </div>
      <div class="scout-section">
        <small>Last 10</small>
        <div class="scout-beads">${scoutBeads(stats.last10)}</div>
      </div>
      <div class="scout-h2h">
        <small>H2H vs you</small>
        <strong>${escapeHtml(h2hText)} ${h2hMoney}</strong>
      </div>
      <div class="scout-actions">
        <button type="button" class="primary" data-scout-challenge ${challengeDisabled ? "disabled" : ""}>${escapeHtml(challengeLabel)}</button>
        <a class="primary-link" href="#user/${escapeHtml(user.id)}">Profile -></a>
      </div>
    </section>
  `;
}

function renderLiveTableModule(game) {
  const viewer = game.players?.find((p) => p.id === viewerId());
  const opponent = game.players?.find((p) => p.id !== viewerId());
  const turnOwner = game.players?.find((p) => p.color === game.turn);
  const yourTurn = turnOwner && viewer && turnOwner.id === viewer.id;
  const stake = game.pot?.stakeCents ?? 0;
  const sideMs = turnOwner ? localRemainingForSide(turnOwner.color) : null;
  const displayClock = sideMs == null ? "--:--" : formatClock(sideMs);
  const lowClock = sideMs != null && sideMs < 30000;
  const criticalClock = sideMs != null && sideMs < 10000;
  const initial = (opponent?.handle?.[0] ?? "?").toUpperCase();
  const eyebrowText = yourTurn
    ? "● LIVE · your move"
    : opponent
      ? `● LIVE · ${opponent.handle}'s move`
      : "● LIVE";
  const stack = stakeChipStack(stake)
    .map((d) => `<span class="chip d-${d}" aria-hidden="true"></span>`)
    .join("");
  const moveLabel = game.moveNumber ? `move ${game.moveNumber}` : "opening";
  const metaParts = [money(stake)];
  if (game.timeControl) metaParts.push(game.timeControl);
  metaParts.push(moveLabel);
  const resignBusy = actionInFlight("resign", game.id);
  const opponentIdentity = `
    <div class="avatar">${escapeHtml(initial)}</div>
    <div class="live-table-id">
      <span class="live-table-handle">${escapeHtml(opponent?.handle || "opponent")}</span>
      ${opponent?.rating ? `<span class="live-table-rating mono tnum">${escapeHtml(String(opponent.rating))}</span>` : ""}
    </div>
  `;
  return `
    <section class="live-table-module ${lowClock ? "low" : ""} ${criticalClock ? "critical" : ""}">
      <div class="live-table-body">
        <div class="live-table-eyebrow">${escapeHtml(eyebrowText)}</div>
        <div class="live-table-row">
          <div class="live-table-opponent">
            ${opponent ? scoutTrigger(opponent, opponentIdentity, "live-table-scout") : opponentIdentity}
          </div>
          <div class="live-table-clock" data-live-table-clock="${escapeHtml(turnOwner?.color || "")}">
            <span class="live-table-clock-icon" aria-hidden="true">⏱</span>
            <time class="mono tnum">${escapeHtml(displayClock)}</time>
          </div>
        </div>
        <div class="live-table-meta">
          <span class="chip-stack">${stack}</span>
          <span class="live-table-meta-text">${escapeHtml(metaParts.join(" · "))}</span>
        </div>
      </div>
      <div class="live-table-actions">
        <button type="button" class="primary live-table-cta" data-return-to-board>
          Return to board <span aria-hidden="true">→</span>
        </button>
        <button type="button" class="live-table-resign" data-live-resign ${resignBusy ? "disabled" : ""}>
          ${resignBusy ? "Resigning..." : `Resign · concede ${money(stake)}`}
        </button>
      </div>
    </section>
  `;
}

function renderStakePicker(formKey, stakes, selectedCents) {
  return `
    <div class="chip-pick-row" data-stake-picker="${formKey}">
      ${stakes
        .map((s) => {
          const active = s.amountCents === selectedCents;
          const stack = stakeChipStack(s.amountCents);
          const chips = stack.map((d) => `<span class="chip d-${d}" aria-hidden="true"></span>`).join("");
          return `
            <button type="button" class="chip-pick ${active ? "active" : ""}"
              data-pick-stake="${formKey}" data-stake-cents="${s.amountCents}"
              aria-pressed="${active ? "true" : "false"}" title="${escapeHtml(s.label)}">
              <span class="chip-stack">${chips}</span>
              <span class="chip-total">${escapeHtml(s.label)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTimePicker(formKey, timeControls, selected) {
  return `
    <div class="time-pill-row" data-time-picker="${formKey}">
      ${timeControls
        .map((tc) => {
          const active = tc === selected;
          const kind = timeControlKind(tc);
          return `
            <button type="button" class="time-pill ${active ? "active" : ""}"
              data-pick-time="${formKey}" data-time="${escapeHtml(tc)}"
              aria-pressed="${active ? "true" : "false"}">
              <span>${escapeHtml(tc)}</span>
              <span class="time-pill-kind">${kind}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderHeroIdle(lobby) {
  const pick = state.picker.hero;
  const quickBusy = actionInFlight("quick-match");
  const hostBusy = actionInFlight("host-invite");
  const viewer = state.bootstrap.viewer;
  const viewerInitial = (viewer.handle?.[0] ?? "?").toUpperCase();
  const potCents = previewNetPotCents(pick.stakeCents ?? 0);
  const opponents = recentOpponentsForPlay(4);
  const rematchStrip = opponents.length === 0 ? "" : `
    <div class="hero-rematch-strip">
      <span class="picker-label">Pick up where you left off</span>
      <div class="hero-rematch-row">
        ${opponents.map((o) => {
          const handleInitial = (o.handle?.[0] ?? "?").toUpperCase();
          // Per project_no_loss_advertising: show positive wins as gold deltas, but
          // never surface a negative number. Loss/draw rows just show time control.
          const secondary = o.deltaCents > 0
            ? `<span class="hero-rematch-delta delta-up mono tnum">+${escapeHtml(money(o.deltaCents))}</span>`
            : `<span class="hero-rematch-delta mono tnum">${escapeHtml(o.timeControl)}</span>`;
          const identity = `
            <div class="avatar sm">${escapeHtml(handleInitial)}</div>
            <div class="hero-rematch-id">
              <span class="hero-rematch-handle">↺ ${escapeHtml(o.handle ?? "opponent")}</span>
              ${secondary}
            </div>
          `;
          return `
            <button type="button" class="hero-rematch-pick"
              data-rematch-from="${escapeHtml(o.opponentId)}"
              data-rematch-stake="${o.stakeCents}"
              data-rematch-time="${escapeHtml(o.timeControl)}">
              ${scoutTrigger(
                { id: o.opponentId, handle: o.handle },
                identity,
                "hero-rematch-scout",
                { stakeCents: o.stakeCents, timeControl: o.timeControl }
              )}
              <span class="hero-rematch-stake mono tnum">${money(o.stakeCents)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;

  return `
    <div class="hero-state-head hero-state-head-row">
      <div>
        <span class="picker-label">Quick match</span>
        <h1>Pick a chip. Sit down.</h1>
      </div>
      <div class="hero-identity-badge">
        <span class="picker-label">You're playing as</span>
        <div class="hero-identity-row">
          <div class="avatar">${escapeHtml(viewerInitial)}</div>
          <strong>${escapeHtml(viewer.handle)}</strong>
          ${viewer.rating ? `<span class="hero-identity-rating mono tnum">${escapeHtml(String(viewer.rating))}</span>` : ""}
        </div>
      </div>
    </div>
    <div>
      <span class="picker-label">Stake</span>
      ${renderStakePicker("hero", lobby.stakes, pick.stakeCents)}
    </div>
    <div>
      <span class="picker-label">Time control</span>
      ${renderTimePicker("hero", lobby.timeControls, pick.timeControl)}
    </div>
    <div class="hero-cta-row">
      <button class="primary hero-cta-primary" type="button"
        data-find-game ${quickBusy || hostBusy ? "disabled" : ""}>
        <span>${quickBusy ? "Joining queue..." : "Find me a game"}</span>
        <span aria-hidden="true">→</span>
      </button>
      <div class="hero-pot-panel" aria-label="Pot if you win">
        <span class="picker-label">Pot if you win</span>
        <span class="hero-pot-amount mono tnum">+${money(potCents)}</span>
        <span class="hero-pot-rake">5% rake · escrowed</span>
      </div>
    </div>
    <button class="hero-cta-secondary" type="button"
      data-host-invite ${quickBusy || hostBusy ? "disabled" : ""}>
      ${hostBusy ? "Posting invite..." : "Host a table at these terms →"}
    </button>
    ${rematchStrip}
  `;
}

function renderHeroQueued(ticket) {
  const elapsed = elapsedSecondsSince(ticket.createdAt);
  return `
    <div class="hero-state-head">
      <span class="picker-label">In the queue</span>
      <h1>Looking for an opponent.</h1>
    </div>
    <div class="hero-locked-row">
      <div class="hero-locked-stake">
        <span class="chip-stack">
          ${stakeChipStack(ticket.stakeCents).map((d) => `<span class="chip d-${d}" aria-hidden="true"></span>`).join("")}
        </span>
        <span class="chip-total">${money(ticket.stakeCents)} · ${escapeHtml(ticket.timeControl)}</span>
      </div>
      <div class="hero-state-meta">
        <span class="lbl-sm">~5s typical wait</span>
        <span class="mono tnum">${formatElapsedShort(elapsed)} elapsed</span>
      </div>
    </div>
    <div class="hero-cta-row">
      <button class="primary hero-cta-primary" type="button" data-leave-queue>Leave queue</button>
    </div>
  `;
}

function renderHeroHosting(challenge) {
  const remaining = challengeSecondsRemaining(challenge);
  const withdrawing = actionInFlight("withdraw-host");
  const recipient = challenge.recipient;
  const headline = recipient
    ? `Waiting for ${escapeHtml(recipient.handle)} to accept.`
    : "You're hosting a table.";
  const subline = recipient
    ? `Targeted invite · they have ${remaining ?? "—"}s.`
    : "You appear in Open Tables to other players.";
  return `
    <div class="hero-state-head">
      <span class="picker-label">Hosting</span>
      <h1>${headline}</h1>
    </div>
    <div class="hero-locked-row">
      <div class="hero-locked-stake">
        <span class="chip-stack">
          ${stakeChipStack(challenge.stakeCents).map((d) => `<span class="chip d-${d}" aria-hidden="true"></span>`).join("")}
        </span>
        <span class="chip-total">${money(challenge.stakeCents)} · ${escapeHtml(challenge.timeControl)}</span>
      </div>
      <div class="hero-state-meta">
        <span class="lbl-sm">${escapeHtml(subline)}</span>
        ${remaining != null ? `<span class="mono tnum">${remaining > 0 ? `${remaining}s left` : "expired"}</span>` : ""}
      </div>
    </div>
    <div class="hero-cta-row">
      <button class="primary hero-cta-primary" type="button"
        data-withdraw-host="${escapeHtml(challenge.id)}" ${withdrawing ? "disabled" : ""}>
        ${withdrawing ? "Withdrawing..." : "Withdraw invite"}
      </button>
    </div>
  `;
}

function renderHero(lobby) {
  const heroState = lobbyHeroState();
  let body = "";
  if (heroState === "queued") body = renderHeroQueued(state.bootstrap.matchmakingTicket);
  else if (heroState === "hosting") body = renderHeroHosting(viewerPendingSent());
  else body = renderHeroIdle(lobby);
  const error = state.actionError ? `<em class="action-error">${escapeHtml(state.actionError)}</em>` : "";
  return `<article class="hero felt hero-state-${heroState}">${body}${error}</article>`;
}

function renderHeartbeatStrip(lobby) {
  const online = Number(lobby.onlineCount ?? 0);
  const active = Number(lobby.activeGames ?? 0);
  return `
    <div class="heartbeat-strip">
      <span class="heartbeat-dot"></span>
      <span class="heartbeat-count"><strong>${online.toLocaleString()}</strong> online</span>
      <span class="heartbeat-sep">·</span>
      <span class="heartbeat-active">${active.toLocaleString()} in active games</span>
    </div>
  `;
}

function renderOpenTableRow(challenge) {
  const opponent = challenge.opponent;
  const initial = (opponent?.handle?.[0] ?? "?").toUpperCase();
  const kind = timeControlKind(challenge.timeControl);
  const termsParts = [money(challenge.stakeCents), challenge.timeControl];
  if (kind) termsParts.push(kind);
  const identity = `
    <span class="avatar sm">${escapeHtml(initial)}</span>
    <span class="open-row-handle">${escapeHtml(opponent?.handle ?? "open seat")}</span>
    ${opponent?.rating ? `<span class="open-row-rating mono tnum">${escapeHtml(String(opponent.rating))}</span>` : ""}
  `;
  return `
    <button class="open-table-row" data-select-challenge="${challenge.id}">
      ${opponent ? scoutTrigger(
        opponent,
        identity,
        "open-row-scout",
        { stakeCents: challenge.stakeCents, timeControl: challenge.timeControl }
      ) : `<span class="open-row-identity">${identity}</span>`}
      <span class="open-row-terms mono tnum">${escapeHtml(termsParts.join(" · "))}</span>
      <span class="open-row-sit">Sit <span aria-hidden="true">→</span></span>
    </button>
  `;
}

function renderOpenTablesList(openChallenges) {
  const viewer = viewerId();
  const others = openChallenges.filter((c) => c.challengerId !== viewer);
  if (others.length === 0) {
    return `<p class="muted small open-tables-empty">No tables open right now. Be the first to sit.</p>`;
  }
  return `<div class="open-tables-list">${others.map(renderOpenTableRow).join("")}</div>`;
}

function renderPlay() {
  const { lobby, incomingChallenges } = state.bootstrap;
  const openChallenges = lobby.openChallenges;
  const liveGame = liveGameForShell();
  const openCount = openChallenges.filter((c) => c.challengerId !== viewerId()).length;

  return `
    ${liveGame ? renderLiveTableModule(liveGame) : ""}
    <section class="grid two">
      ${renderHero(lobby)}
      <aside class="stack">
        ${renderHeartbeatStrip(lobby)}
        ${incomingChallenges.length === 0 ? "" : `
          <article class="card incoming-card">
            <div class="between"><h2>Incoming</h2><small>${incomingChallenges.length}</small></div>
            ${incomingChallenges.map(challengeRow).join("")}
          </article>
        `}
        <article class="card open-tables-card">
          <div class="between"><h2>Open tables</h2><small>${openCount}</small></div>
          ${renderOpenTablesList(openChallenges)}
        </article>
      </aside>
    </section>
  `;
}

function challengeRow(challenge) {
  const opponent = challenge.opponent;
  const isMine = challenge.challengerId === viewerId();
  const label = isMine
    ? (challenge.recipient ? `your invite → ${challenge.recipient.handle}` : "your open invite")
    : `from ${opponent.handle}`;
  const remaining = challengeSecondsRemaining(challenge);
  const timeHint = remaining === null
    ? ""
    : remaining > 0
      ? `${remaining}s left`
      : "expired";
  const identity = opponent?.id ? `
    <span class="table-row-id">
      <span class="avatar sm">${escapeHtml((opponent.handle?.[0] ?? "?").toUpperCase())}</span>
      <strong>${escapeHtml(label)}</strong>
    </span>
  ` : `<strong>${escapeHtml(label)}</strong>`;
  return `
    <button class="table-row" data-select-challenge="${challenge.id}">
      ${opponent?.id ? scoutTrigger(
        opponent,
        identity,
        "table-row-scout",
        { stakeCents: challenge.stakeCents, timeControl: challenge.timeControl }
      ) : identity}
      <span>${money(challenge.stakeCents)} · ${challenge.timeControl}</span>
      <em>${isMine && !challenge.recipientId ? "yours · " : ""}${escapeHtml(challenge.state)}${timeHint ? ` · ${escapeHtml(timeHint)}` : ""}</em>
      <span>→</span>
    </button>
  `;
}

function renderWager() {
  const challenge = state.activeChallenge;
  if (!challenge) return `<p class="muted">No active challenge. <a href="#play">Pick one.</a></p>`;
  const viewerIsRecipient = viewerId() === challenge.recipientId;
  const viewerIsChallenger = viewerId() === challenge.challengerId;
  const isOpen = !challenge.recipientId;
  const expiresRemaining = challengeSecondsRemaining(challenge);
  const isExpired = expiresRemaining === 0;
  const canAct = (viewerIsRecipient || (isOpen && !viewerIsChallenger))
    && (challenge.state === "incoming" || challenge.state === "countered")
    && !isExpired;
  const canWithdraw = viewerIsChallenger
    && (challenge.state === "incoming" || challenge.state === "countered")
    && !isExpired;
  const accepting = actionInFlight("challenge", `${challenge.id}:accept`);
  const countering = actionInFlight("challenge", `${challenge.id}:counter`);
  const declining = actionInFlight("challenge", `${challenge.id}:decline`);

  let actionLabel = "Accept and lock";
  if (challenge.state === "accepted") actionLabel = "Escrow locked";
  else if (challenge.state === "declined") actionLabel = "Declined";
  else if (challenge.state === "expired") actionLabel = "Expired";
  else if (viewerIsChallenger) actionLabel = isOpen ? "Awaiting any opponent" : `Awaiting ${challenge.recipient?.handle ?? "recipient"}`;

  const opponent = challenge.opponent;
  const headline = viewerIsChallenger
    ? `<span class="muted">You staked</span> ${money(challenge.stakeCents)}`
    : `<span class="muted">${escapeHtml(opponent.handle)} wants</span> ${money(challenge.stakeCents)} <span class="muted">from you.</span>`;
  const opponentIdentity = `
    <div class="avatar huge">${escapeHtml(opponent.handle[0] || "?")}</div>
    <div>
      <h2>${escapeHtml(opponent.handle)} ${opponent.rating ? `<span>${escapeHtml(opponent.rating)}</span>` : ""}</h2>
    </div>
  `;

  return `
    <section class="grid wager">
      <article class="stack">
        <div>
          <div class="eyebrow danger">${challenge.state} challenge${challengeExpiryLabel(challenge)}</div>
          <h1>${headline}</h1>
        </div>
        <article class="card opponent">
          ${scoutTrigger(
            opponent,
            opponentIdentity,
            "wager-scout",
            { stakeCents: challenge.stakeCents, timeControl: challenge.timeControl }
          )}
        </article>
      </article>
      <aside class="felt match-card">
        <div class="eyebrow">The match</div>
        <h2>${money(challenge.stakeCents)} each</h2>
        <p>${challenge.timeControl} blitz · ${money(challenge.pot.netPotCents)} pot after ${money(challenge.pot.rakeCents)} rake.</p>
        <div class="escrow">Stakes lock in fake-money escrow for this milestone.</div>
        <button class="primary" ${canAct && !accepting ? 'data-action="accept"' : "disabled"}>${accepting ? "Locking..." : `${escapeHtml(actionLabel)} ${canAct ? money(challenge.stakeCents) : ""}`}</button>
        <button ${canAct && !countering ? 'data-action="counter"' : "disabled"}>${countering ? "Countering..." : "Counter same stake"}</button>
        <button ${canAct && !declining ? 'data-action="decline"' : "disabled"}>${declining ? "Declining..." : "Decline"}</button>
        ${canWithdraw ? `<button class="danger" data-withdraw-challenge>Withdraw invite</button>` : ""}
        ${state.actionError ? `<em class="action-error">${escapeHtml(state.actionError)}</em>` : ""}
      </aside>
    </section>
  `;
}

function renderGame() {
  const game = state.activeGame;
  if (!game) return `<p class="muted">No active game. <a href="#play">Back to lobby.</a></p>`;
  const white = game.players.find((player) => player.color === "white");
  const black = game.players.find((player) => player.color === "black");
  const viewer = viewerPlayer(game);
  const viewerIsPlayer = !!viewer;
  const canResign = viewerIsPlayer && game.state === "live";
  const drawSection = viewerIsPlayer && game.state === "live"
    ? drawControls(game, viewer.color)
    : "";
  const opponent = viewerIsPlayer
    ? game.players.find((player) => player.id !== viewer.id)
    : null;
  const turnOwner = game.players.find((player) => player.color === game.turn);
  const statusText = game.state === "live"
    ? `${turnOwner?.id === viewerId() ? "Your" : `${turnOwner?.handle ?? game.turn}'s`} move`
    : game.status;
  return `
    <section class="game-layout">
      <aside class="card game-panel move-panel">
        <div class="between">
          <h2>Move history</h2>
          <small>${game.moveNumber ? `move ${game.moveNumber}` : "opening"}</small>
        </div>
        <div class="move-head"><span>White</span><span>Black</span></div>
        <ol class="moves" data-move-list>
          ${(game.moveRows || []).map((move, index, rows) => `
            <li class="${index === rows.length - 1 ? "current" : ""}">
              <span class="move-number">${index + 1}.</span>
              <span>${escapeHtml(move[0])}</span>
              <span>${escapeHtml(move[1] || "")}</span>
            </li>
          `).join("") || `<li><span class="move-number">1.</span><span>No moves yet</span><span></span></li>`}
        </ol>
      </aside>
      <article class="board-column">
        ${(() => {
          const orientation = boardOrientation(game);
          const topPlayer = orientation === "black" ? white : black;
          const bottomPlayer = orientation === "black" ? black : white;
          return `
            ${playerStrip(game, topPlayer, game.turn === topPlayer.color)}
            ${captureTray(game, topPlayer.color)}
            ${board(game)}
            ${promotionDialog()}
            ${captureTray(game, bottomPlayer.color)}
            ${playerStrip(game, bottomPlayer, game.turn === bottomPlayer.color)}
          `;
        })()}
        <div class="turn-strip">
          <strong>${escapeHtml(statusText)}</strong>
          <span>${escapeHtml(game.status)}${game.inCheck ? " · check" : ""}</span>
          ${state.gameError ? `<em>${escapeHtml(state.gameError)} <button type="button" class="inline-dismiss" data-dismiss-game-error aria-label="Dismiss game error">Dismiss</button></em>` : ""}
        </div>
      </article>
      <aside class="stack">
        <article class="felt pot game-panel">
          <div class="between">
            <div class="eyebrow">The pot</div>
            <span class="status-pill">escrowed</span>
          </div>
          <h2>${money(game.pot.netPotCents)}</h2>
          <p>Winner takes after ${money(game.pot.rakeCents)} fake-money rake.</p>
          <div class="stake-grid">
            <div><small>Your stake</small><strong>${money(game.pot.stakeCents)}</strong></div>
            <div><small>${opponent ? `${escapeHtml(opponent.handle)} stake` : "Their stake"}</small><strong>${money(game.pot.stakeCents)}</strong></div>
          </div>
        </article>
        <article class="card game-panel live-status">
          <div class="between">
            <h2>Table status</h2>
            ${connectionPill()}
          </div>
          <div class="status-grid">
            <div><small>Side</small><strong>${viewer ? viewer.color : "spectator"}</strong></div>
            <div><small>Last move</small><strong>${game.lastMove ? escapeHtml(game.lastMove.san) : "—"}</strong></div>
            <div><small>Material</small><strong>${viewer ? formatMaterialDelta(materialDelta(game, viewer.color)) : "—"}</strong></div>
            <div><small>State</small><strong>${escapeHtml(game.state)}</strong></div>
          </div>
        </article>
        ${drawSection}
        ${canResign ? `<button class="danger resign-button" data-open-resign ${actionInFlight("resign", game.id) ? "disabled" : ""}>${actionInFlight("resign", game.id) ? "Resigning..." : `Resign · concede ${money(game.pot.stakeCents)}`}</button>` : ""}
      </aside>
    </section>
  `;
}

function drawControls(game, viewerColor) {
  const offer = game.drawOffer;
  const drawOfferBusy = actionInFlight("draw-offer", game.id);
  const drawAcceptBusy = actionInFlight("draw-accept", game.id);
  const drawDeclineBusy = actionInFlight("draw-decline", game.id);
  if (!offer) {
    return `<button class="draw-button" data-draw-action="draw-offer" ${drawOfferBusy ? "disabled" : ""}>${drawOfferBusy ? "Offering..." : "Offer draw"}</button>`;
  }
  if (offer.offeredBy === viewerColor) {
    return `<div class="card draw-pending"><strong>Draw offered</strong><small>Waiting on opponent. Your offer clears on your next move.</small></div>`;
  }
  const opponent = game.players.find((p) => p.color !== viewerColor)?.handle ?? "Opponent";
  return `
    <div class="card draw-incoming">
      <strong>${escapeHtml(opponent)} offers a draw</strong>
      <div class="stack">
        <button class="primary" data-draw-action="draw-accept" ${drawAcceptBusy ? "disabled" : ""}>${drawAcceptBusy ? "Accepting..." : "Accept draw"}</button>
        <button data-draw-action="draw-decline" ${drawDeclineBusy ? "disabled" : ""}>${drawDeclineBusy ? "Declining..." : "Decline"}</button>
      </div>
    </div>
  `;
}

function openResignConfirm() {
  if (!state.activeGame || actionInFlight("resign", state.activeGame.id)) return;
  state.gameError = null;
  state.resignConfirmOpen = true;
  render();
}

function closeResignConfirm() {
  state.resignConfirmOpen = false;
  render();
}

function resignConfirmDialog() {
  const game = state.activeGame;
  if (!state.resignConfirmOpen || !game || game.state !== "live") return "";
  const stake = game.pot?.stakeCents ?? 0;
  const opponent = game.players?.find((player) => player.id !== viewerId());
  const busy = actionInFlight("resign", game.id);
  return `
    <div class="modal-backdrop" role="presentation" data-resign-cancel>
      <section class="card confirm-modal" role="dialog" aria-modal="true" aria-labelledby="resign-title">
        <div class="eyebrow danger">Resign game</div>
        <h2 id="resign-title">Concede this table?</h2>
        <p>${escapeHtml(opponent?.handle || "Your opponent")} receives the pot. You concede your ${money(stake)} stake.</p>
        <div class="modal-actions">
          <button type="button" data-resign-cancel ${busy ? "disabled" : ""}>Keep playing</button>
          <button type="button" class="danger resign-button" data-resign-confirm ${busy ? "disabled" : ""}>${busy ? "Resigning..." : "Resign game"}</button>
        </div>
      </section>
    </div>
  `;
}

function playerStrip(game, player, active = false) {
  const ms = localRemainingForSide(player.color);
  const display = ms == null ? "--:--" : formatClock(ms);
  const low = ms != null && ms < 30000 && game.state === "live";
  const critical = ms != null && ms < 10000 && game.state === "live";
  const isViewer = player.id === viewerId();
  const material = materialDelta(game, player.color);
  const activity = game.state !== "live"
    ? game.state
    : active
      ? (isViewer ? `your turn · move ${game.moveNumber}` : "thinking")
      : "waiting";
  const presence = player.presence;
  const showPresence = !isViewer && presence;
  const onlineLabel = showPresence
    ? presence.online
      ? "online"
      : presence.lastSeenAt
        ? `last seen ${relativeTimeFromNow(presence.lastSeenAt)}`
        : "offline"
    : "";
  const dotClass = showPresence ? (presence.online ? "online" : "offline") : "";
  const identity = `
    <span class="avatar">${escapeHtml(player.handle[0] || "?")}</span>
    <span class="player-main">
      <span>
        <strong>${isViewer ? "You" : escapeHtml(player.handle)}${showPresence ? ` <span class="presence-dot ${dotClass}" title="${escapeHtml(onlineLabel)}" aria-label="${escapeHtml(onlineLabel)}"></span>` : ""}</strong>
        <small>${escapeHtml(player.color)} · ${escapeHtml(player.rating)}${showPresence && !presence.online ? ` · ${escapeHtml(onlineLabel)}` : ""}</small>
      </span>
      <span class="player-subline">
        ${capturedPiecesMarkup(game, player.color, "No captures")}
        <span>${formatMaterialDelta(material)}</span>
        <span>${escapeHtml(activity)}</span>
      </span>
    </span>
  `;
  return `
    <div class="player-strip ${active ? "active" : ""} ${low ? "low" : ""} ${critical ? "critical" : ""}" data-clock="${player.color}">
      ${isViewer ? identity : scoutTrigger(player, identity, "player-strip-scout", { stakeCents: game.pot?.stakeCents, timeControl: game.timeControl })}
      <span class="clock-box">
        <time>${display}</time>
        <span class="clock-meter"><span style="width: ${clockPercent(game.clock, ms)}"></span></span>
      </span>
    </div>
  `;
}

function relativeTimeFromNow(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function connectionPill() {
  const ws = state.rt.ws;
  let label = "offline";
  let cls = "stale";
  if (ws?.readyState === WebSocket.OPEN) {
    label = "live";
    cls = "live";
  } else if (ws?.readyState === WebSocket.CONNECTING || state.rt.reconnectTimer) {
    label = "reconnecting";
    cls = "pending";
  }
  return `<span class="connection-pill ${cls}"><span></span>${label}</span>`;
}

function formatMaterialDelta(delta) {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "even";
}

function movingColorForMoveIndex(index) {
  return index % 2 === 0 ? "white" : "black";
}

function pieceAsset(color, type) {
  return `/assets/pieces/${color[0]}${type.toUpperCase()}.svg`;
}

function pieceAlt(color, type) {
  return `${color} ${pieceNames[type] || "piece"}`;
}

function pieceImg(color, type, className = "piece") {
  return `<img class="${className}" src="${pieceAsset(color, type)}" alt="${pieceAlt(color, type)}" draggable="false">`;
}

const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function capturedPieces(game, color) {
  return (game.moves || [])
    .filter((move, index) => move.captured && movingColorForMoveIndex(index) === color)
    .map((move) => ({ color: color === "white" ? "black" : "white", type: move.captured }));
}

function materialScore(game, color) {
  return capturedPieces(game, color).reduce((sum, piece) => sum + (pieceValues[piece.type] || 0), 0);
}

function materialDelta(game, color) {
  return materialScore(game, color) - materialScore(game, color === "white" ? "black" : "white");
}

function capturedPiecesMarkup(game, color, empty = "No captures") {
  const pieces = capturedPieces(game, color);
  return `
    <span class="capture-inline" aria-label="${color} captured pieces">
      ${pieces.length ? pieces.map((piece) => pieceImg(piece.color, piece.type, "captured-piece")).join("") : `<small>${empty}</small>`}
    </span>
  `;
}

function captureTray(game, color) {
  return `
    <div class="capture-tray" aria-label="${color} captured pieces">
      ${capturedPiecesMarkup(game, color)}
    </div>
  `;
}

function viewerPlayer(game) {
  return game.players?.find((player) => player.id === viewerId()) || null;
}

function isViewerTurn(game) {
  const viewer = viewerPlayer(game);
  return !!viewer && game.state === "live" && game.turn === viewer.color;
}

function colorNameFromBoardPiece(square) {
  return square?.color === "w" ? "white" : square?.color === "b" ? "black" : null;
}

function canMoveFrom(game, squareName) {
  if (!isViewerTurn(game)) return false;
  const square = game.board.find((cell) => cell.square === squareName);
  const viewer = viewerPlayer(game);
  if (!square || colorNameFromBoardPiece(square) !== viewer.color) return false;
  return game.legalMoves.some((move) => move.from === squareName);
}

function legalMoveFor(from, to) {
  return state.activeGame?.legalMoves.find((move) => move.from === from && move.to === to) || null;
}

function squareLabel(game, square, pieceColor, target, isSource, isSelected) {
  const parts = [square.square];
  if (pieceColor && square.type) parts.push(pieceAlt(pieceColor, square.type));
  if (isSelected) parts.push("selected");
  if (isSource) parts.push("legal piece to move");
  if (target) parts.push(target.captured ? "legal capture target" : "legal move target");
  if (game.lastMove && (game.lastMove.from === square.square || game.lastMove.to === square.square)) {
    parts.push("last move");
  }
  return parts.join(", ");
}

function formatClock(ms) {
  if (ms != null && ms > 0 && ms < 10000) {
    return `${(ms / 1000).toFixed(1)}`;
  }
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function clockPercent(clock, ms) {
  if (!clock || ms == null) return "0%";
  const base = Math.max(clock.whiteMs, clock.blackMs, 1);
  return `${Math.max(0, Math.min(100, (ms / base) * 100))}%`;
}

function board(game) {
  const selected = state.selectedSquare;
  const targetMoves = new Map(game.legalMoves.filter((move) => move.from === selected).map((move) => [move.to, move]));
  const lastSquares = new Set(game.lastMove ? [game.lastMove.from, game.lastMove.to] : []);
  const checkedKing = game.inCheck
    ? game.board.find((square) => square.type === "k" && square.color === game.turn[0])?.square
    : null;
  const orientation = boardOrientation(game);
  const displaySquares = orientation === "black" ? [...game.board].reverse() : game.board;
  const cells = displaySquares.map((square) => {
    const isSource = canMoveFrom(game, square.square);
    const target = targetMoves.get(square.square);
    const isSelected = square.square === selected;
    const classes = [
      (square.row + square.col) % 2 ? "dark" : "light",
      isSelected ? "selected" : "",
      isSource ? "source" : "",
      target ? "target" : "",
      target?.captured ? "target-capture" : target ? "target-quiet" : "",
      lastSquares.has(square.square) ? "last-move" : "",
      game.inCheck && square.square === checkedKing ? "king-check" : ""
    ].filter(Boolean).join(" ");
    const pieceColor = colorNameFromBoardPiece(square);
    const piece = pieceColor && square.type ? pieceImg(pieceColor, square.type) : "";
    const showRank = orientation === "white" ? square.col === 0 : square.col === 7;
    const showFile = orientation === "white" ? square.row === 7 : square.row === 0;
    const coords = [
      showRank ? `<span class="coord rank">${square.square[1]}</span>` : "",
      showFile ? `<span class="coord file">${square.square[0]}</span>` : ""
    ].join("");
    return `<button type="button" class="${classes}" data-square="${square.square}" draggable="${isSource ? "true" : "false"}" aria-label="${escapeHtml(squareLabel(game, square, pieceColor, target, isSource, isSelected))}" aria-pressed="${isSelected ? "true" : "false"}">${piece}${coords}</button>`;
  });
  return `<div class="board ${orientation === "black" ? "flipped" : ""}" aria-label="Chess board">${cells.join("")}</div>`;
}

function boardOrientation(game) {
  const viewer = game.players?.find((player) => player.id === viewerId());
  return viewer?.color === "black" ? "black" : "white";
}

function parseBoardFromFen(fen) {
  const placement = fen.split(" ")[0];
  const ranks = placement.split("/");
  const squares = [];
  for (let row = 0; row < 8; row++) {
    const rank = ranks[row];
    let col = 0;
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        const skip = Number(ch);
        for (let i = 0; i < skip; i++) {
          const file = String.fromCharCode("a".charCodeAt(0) + col);
          const rankNumber = 8 - row;
          squares.push({ square: `${file}${rankNumber}`, row, col, color: null, type: null });
          col += 1;
        }
      } else {
        const color = ch === ch.toUpperCase() ? "w" : "b";
        const type = ch.toLowerCase();
        const file = String.fromCharCode("a".charCodeAt(0) + col);
        const rankNumber = 8 - row;
        squares.push({ square: `${file}${rankNumber}`, row, col, color, type });
        col += 1;
      }
    }
  }
  return squares;
}

function replayBoard(fen, orientation, lastMove) {
  const squares = parseBoardFromFen(fen);
  const lastSquares = new Set(lastMove ? [lastMove.from, lastMove.to] : []);
  const displaySquares = orientation === "black" ? [...squares].reverse() : squares;
  const cells = displaySquares.map((square) => {
    const classes = [
      (square.row + square.col) % 2 ? "dark" : "light",
      lastSquares.has(square.square) ? "last-move" : ""
    ].filter(Boolean).join(" ");
    const pieceColor = colorNameFromBoardPiece(square);
    const piece = pieceColor && square.type ? pieceImg(pieceColor, square.type) : "";
    const showRank = orientation === "white" ? square.col === 0 : square.col === 7;
    const showFile = orientation === "white" ? square.row === 7 : square.row === 0;
    const coords = [
      showRank ? `<span class="coord rank">${square.square[1]}</span>` : "",
      showFile ? `<span class="coord file">${square.square[0]}</span>` : ""
    ].join("");
    return `<div class="${classes}" data-square="${square.square}" aria-hidden="true">${piece}${coords}</div>`;
  });
  return `<div class="board replay-board ${orientation === "black" ? "flipped" : ""}" aria-label="Replay board">${cells.join("")}</div>`;
}

function setReplayPly(ply) {
  if (!state.replay) return;
  const total = state.replay.moves.length;
  const clamped = Math.max(0, Math.min(total, ply));
  if (clamped === state.replay.currentPly) return;
  state.replay = { ...state.replay, currentPly: clamped };
  render();
}

function jumpReplay(target) {
  if (!state.replay) return;
  const total = state.replay.moves.length;
  const current = state.replay.currentPly;
  const next = target === "first" ? 0
    : target === "last" ? total
    : target === "prev" ? current - 1
    : target === "next" ? current + 1
    : current;
  setReplayPly(next);
}

function replayPanel() {
  const replay = state.replay;
  if (!replay) return "";
  const ply = replay.currentPly;
  const total = replay.moves.length;
  const fen = ply === 0 ? replay.startingFen : replay.moves[ply - 1].fenAfter;
  const lastMove = ply > 0 ? replay.moves[ply - 1] : null;
  const orientation = boardOrientation(state.activeGame || { players: [] });
  const moveListItems = replay.moves.map((move) => {
    const isActive = move.ply === ply;
    return `<li><button class="replay-move${isActive ? " active" : ""}" type="button" data-replay-ply="${move.ply}">${move.ply}. ${escapeHtml(move.san)}</button></li>`;
  }).join("");
  return `
    <section class="card replay">
      <header class="replay-header">
        <h2>Replay</h2>
        <small class="muted">Ply ${ply} / ${total}</small>
      </header>
      <div class="replay-body">
        ${replayBoard(fen, orientation, lastMove)}
        <aside class="replay-side">
          <div class="replay-controls" role="group" aria-label="Replay controls">
            <button type="button" data-replay-jump="first" aria-label="First position" ${ply === 0 ? "disabled" : ""}>⏮</button>
            <button type="button" data-replay-jump="prev" aria-label="Previous move" ${ply === 0 ? "disabled" : ""}>◀</button>
            <button type="button" data-replay-jump="next" aria-label="Next move" ${ply >= total ? "disabled" : ""}>▶</button>
            <button type="button" data-replay-jump="last" aria-label="Last position" ${ply >= total ? "disabled" : ""}>⏭</button>
          </div>
          <ol class="replay-moves">${moveListItems}</ol>
        </aside>
      </div>
    </section>
  `;
}

function promotionMoveFor(from, to) {
  return state.activeGame?.legalMoves.find((move) => move.from === from && move.to === to && move.promotion) || null;
}

function queueOrSubmitMove(from, to) {
  const game = state.activeGame;
  if (!game || !from || !to) return;
  const move = legalMoveFor(from, to);
  if (!move) {
    state.selectedSquare = canMoveFrom(game, to) ? to : null;
    state.dragFromSquare = null;
    state.pendingPromotion = null;
    render();
    return;
  }
  const promotionMove = promotionMoveFor(from, to);
  if (promotionMove) {
    const movingPiece = game.board.find((cell) => cell.square === from);
    state.pendingPromotion = {
      from,
      to,
      color: movingPiece?.color === "b" ? "black" : "white"
    };
    state.selectedSquare = from;
    state.dragFromSquare = null;
    render();
    return;
  }
  submitMove(from, to).catch((error) => {
    state.gameError = error.message;
    state.selectedSquare = null;
    state.dragFromSquare = null;
    state.pendingPromotion = null;
    render();
  });
}

function handleSquareIntent(clicked) {
  const game = state.activeGame;
  if (!game) return;
  state.focusSquare = clicked;
  if (!state.selectedSquare) {
    if (canMoveFrom(game, clicked)) {
      state.selectedSquare = clicked;
      state.gameError = null;
      render();
    }
    return;
  }
  if (state.selectedSquare === clicked) {
    state.selectedSquare = null;
    state.pendingPromotion = null;
    render();
    return;
  }
  if (canMoveFrom(game, clicked)) {
    state.selectedSquare = clicked;
    state.pendingPromotion = null;
    render();
    return;
  }
  queueOrSubmitMove(state.selectedSquare, clicked);
}

function adjacentSquare(squareName, key, orientation) {
  const file = squareName.charCodeAt(0) - 97;
  const rank = Number(squareName[1]) - 1;
  const deltas = {
    ArrowLeft: orientation === "black" ? [1, 0] : [-1, 0],
    ArrowRight: orientation === "black" ? [-1, 0] : [1, 0],
    ArrowUp: orientation === "black" ? [0, -1] : [0, 1],
    ArrowDown: orientation === "black" ? [0, 1] : [0, -1]
  };
  const delta = deltas[key];
  if (!delta) return null;
  const nextFile = file + delta[0];
  const nextRank = rank + delta[1];
  if (nextFile < 0 || nextFile > 7 || nextRank < 0 || nextRank > 7) return null;
  return `${String.fromCharCode(97 + nextFile)}${nextRank + 1}`;
}

function handleSquareKey(event, squareName) {
  const game = state.activeGame;
  if (!game) return;
  state.focusSquare = squareName;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleSquareIntent(squareName);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    state.selectedSquare = null;
    state.pendingPromotion = null;
    render();
    return;
  }
  const next = adjacentSquare(squareName, event.key, boardOrientation(game));
  if (!next) return;
  event.preventDefault();
  document.querySelector(`[data-square="${next}"]`)?.focus();
}

function promotionDialog() {
  if (!state.pendingPromotion) return "";
  const { from, to, color } = state.pendingPromotion;
  const options = [
    ["q", "Queen"],
    ["r", "Rook"],
    ["b", "Bishop"],
    ["n", "Knight"]
  ];
  return `
    <div class="promotion-backdrop" role="presentation">
      <div class="promotion-dialog" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
        <h2>Promote ${from} to ${to}</h2>
        <div class="promotion-options">
          ${options.map(([piece, label]) => `
            <button data-promote="${piece}" aria-label="${label}">
              ${pieceImg(color, piece, "promotion-piece")}
              <small>${label}</small>
            </button>
          `).join("")}
        </div>
        <button data-cancel-promotion>Cancel</button>
      </div>
    </div>
  `;
}

function renderSettlement() {
  const settlement = state.activeSettlement;
  if (!settlement) return `<p class="muted">No settlement yet. <a href="#play">Back to lobby.</a></p>`;
  const game = state.activeGame;
  const opponentHandle = settlement.rematchChallenge?.opponent || "your opponent";
  const settlementOpponent = settlement.rematchChallenge
    ? { id: settlement.rematchChallenge.opponentId, handle: settlement.rematchChallenge.opponent }
    : null;

  if (settlement.state !== "finalized") {
    return `
      <section class="grid two">
        <article class="felt settlement">
          <div class="eyebrow">Settlement · pending</div>
          <h1>No result yet.</h1>
          <p>Finish the game to release escrow and credit the pot.</p>
        </article>
        <aside class="card stack">
          <button class="primary" data-nav="game">Back to the board</button>
        </aside>
      </section>
    `;
  }

  const won = settlement.result === "win";
  const drew = settlement.result === "draw";
  let eyebrowClass = "danger";
  let eyebrowText = "Settlement · stake taken";
  let headline = `${escapeHtml(opponentHandle)} took the pot.`;
  let amountClass = "money-loss";
  let amountPrefix = "-";
  let amountCents = game?.pot?.stakeCents || 0;

  if (won) {
    eyebrowClass = "success";
    eyebrowText = "Settlement · auto-credited";
    headline = `You took ${escapeHtml(opponentHandle)}.`;
    amountClass = "money-win";
    amountPrefix = "+";
    amountCents = settlement.creditedCents;
  } else if (drew) {
    eyebrowClass = "muted";
    eyebrowText = `Settlement · drawn (${settlement.reason || "agreement"})`;
    headline = "Split the pot.";
    amountClass = "money-draw";
    amountPrefix = "";
    amountCents = settlement.creditedCents;
  }

  return `
    <section class="grid two">
      <article class="felt settlement">
        <div class="eyebrow ${eyebrowClass}">${escapeHtml(eyebrowText)}</div>
        <h1>${headline}</h1>
        <div class="${amountClass}">${amountPrefix}${money(amountCents)}</div>
        <p>Pot ${money(settlement.grossPotCents)} minus ${money(settlement.rakeCents)} fake-money rake.</p>
        <div class="metric-grid">
          <div><small>Balance</small><strong>${money(settlement.balanceAfterCents)}</strong></div>
          ${settlement.ratingDelta !== null ? `<div><small>Rating</small><strong>${formatRatingDelta(settlement.ratingDelta)}${settlement.ratingAfter !== null ? ` <span class="muted">→ ${settlement.ratingAfter}</span>` : ""}</strong></div>` : ""}
          <div><small>Last move</small><strong>${escapeHtml(settlement.winningMove || "—")}</strong></div>
        </div>
      </article>
      <aside class="card stack">
        <h2>Queue another</h2>
        ${settlementOpponent ? scoutTrigger(
          settlementOpponent,
          `<span class="settlement-scout-id"><span class="avatar sm">${escapeHtml((opponentHandle[0] ?? "?").toUpperCase())}</span><span>${escapeHtml(opponentHandle)}</span></span>`,
          "settlement-scout",
          { stakeCents: settlement.rematchChallenge.stakeCents, timeControl: settlement.rematchChallenge.timeControl }
        ) : ""}
        ${settlement.rematchChallenge ? `<button class="primary" data-rematch>Rematch ${escapeHtml(settlement.rematchChallenge.opponent)} · ${money(settlement.rematchChallenge.stakeCents)}</button>` : ""}
        <button data-nav="play">Find new opponent</button>
        ${state.actionError ? `<em class="action-error">${escapeHtml(state.actionError)}</em>` : ""}
      </aside>
    </section>
    ${replayPanel()}
  `;
}

function renderHistoryList() {
  const items = state.historyList;
  if (items === null) {
    return `<p class="muted">Loading history…</p>`;
  }
  if (items.length === 0) {
    return `
      <section class="history-empty">
        <article class="card">
          <h1>No finished games yet</h1>
          <p class="muted">Play a game and it'll show up here.</p>
          <a class="primary-link" href="#play">Find a match</a>
        </article>
      </section>
    `;
  }
  const stats = historyResultStats(items);
  return `
    <section class="history">
      <header class="history-header">
        <h1>History</h1>
        <p class="muted">${items.length} finished game${items.length === 1 ? "" : "s"}</p>
      </header>
      <div class="history-stats" aria-label="History result counts">
        <div><small>Wins</small><strong>${stats.wins}</strong></div>
        <div><small>Losses</small><strong>${stats.losses}</strong></div>
        <div><small>Draws</small><strong>${stats.draws}</strong></div>
      </div>
      <div class="history-list">
        ${items.map(historyRow).join("")}
      </div>
    </section>
  `;
}

function historyResultStats(items) {
  return items.reduce((stats, entry) => {
    if (entry.result === "win") stats.wins += 1;
    else if (entry.result === "loss") stats.losses += 1;
    else if (entry.result === "draw") stats.draws += 1;
    return stats;
  }, { wins: 0, losses: 0, draws: 0 });
}

function historyRow(entry) {
  const opponentHandle = entry.opponent?.handle ?? "—";
  const opponentInitial = (opponentHandle[0] ?? "?").toUpperCase();
  const resultLabel = entry.result === "win" ? "Win" : entry.result === "loss" ? "Loss" : entry.result === "draw" ? "Draw" : entry.result;
  const resultClass = entry.result === "win" ? "money-win" : entry.result === "loss" ? "money-loss" : "money-draw";
  const sign = entry.result === "win" ? "+" : entry.result === "loss" ? "−" : "";
  const credited = entry.result === "loss" ? entry.stakeCents : entry.creditedCents;
  const when = entry.endedAt ? new Date(entry.endedAt).toLocaleString() : "—";
  const endReason = endReasonLabel(entry.endReason);
  const identity = `
    <div class="history-vs">
      <span class="avatar sm">${escapeHtml(opponentInitial)}</span>
      <span>
        <strong>vs ${escapeHtml(opponentHandle)}</strong>
        <small>${escapeHtml(entry.timeControl || "—")} · ${escapeHtml(endReason)}</small>
      </span>
    </div>
  `;
  return `
    <a class="history-row" href="#history/${entry.gameId}">
      <div class="history-result ${resultClass}">${resultLabel}</div>
      ${entry.opponent?.id ? scoutTrigger(
        entry.opponent,
        identity,
        "history-scout",
        { stakeCents: entry.stakeCents, timeControl: entry.timeControl }
      ) : identity}
      <div class="history-credit ${resultClass}">${sign}${money(credited)}</div>
      <small class="history-when">${when}</small>
    </a>
  `;
}

function endReasonLabel(reason) {
  const labels = {
    agreement: "Draw by agreement",
    checkmate: "Checkmate",
    resignation: "Resignation",
    timeout: "Timeout"
  };
  return labels[reason] || reason || "—";
}

function renderProfile() {
  const viewer = state.bootstrap.viewer;
  const ledgerRows = ledgerRowsWithBalances(state.walletLedger);
  const emailBusy = actionInFlight("account-email");
  const passwordBusy = actionInFlight("account-password");
  const logoutBusy = actionInFlight("logout-others");
  return `
    <section class="profile">
      <article class="card profile-header">
        <div class="avatar huge">${escapeHtml(viewer.handle[0]?.toUpperCase() || "?")}</div>
        <div>
          <h1>${escapeHtml(viewer.handle)}</h1>
          <p class="muted">${escapeHtml(viewer.email)}</p>
          <div class="tag-row"><span>rating ${escapeHtml(viewer.rating)}</span></div>
        </div>
      </article>
      <section class="grid two">
        <article class="felt settlement">
          <div class="eyebrow">Fake-money wallet</div>
          <h1>${money(viewer.balanceCents)}</h1>
          <p>${money(viewer.escrowCents)} is currently held in escrow for accepted challenges.</p>
        </article>
        <article class="card account-card">
          <h2>Account settings</h2>
          <form class="stack compact-form" data-account-email>
            <label>Email
              <input name="email" type="email" value="${escapeHtml(viewer.email)}" autocomplete="email" required />
            </label>
            <label>Current password
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <button type="submit" ${emailBusy ? "disabled" : ""}>${emailBusy ? "Updating..." : "Update email"}</button>
          </form>
          <form class="stack compact-form" data-account-password>
            <label>Current password
              <input name="currentPassword" type="password" autocomplete="current-password" required />
            </label>
            <label>New password
              <input name="nextPassword" type="password" autocomplete="new-password" minlength="8" required />
            </label>
            <button type="submit" ${passwordBusy ? "disabled" : ""}>${passwordBusy ? "Updating..." : "Change password"}</button>
          </form>
          <button type="button" data-logout-others ${logoutBusy ? "disabled" : ""}>${logoutBusy ? "Signing out..." : "Log out other sessions"}</button>
          ${state.accountNotice ? `<em class="account-notice">${escapeHtml(state.accountNotice)}</em>` : ""}
          ${state.accountError ? `<em class="account-error">${escapeHtml(state.accountError)}</em>` : ""}
        </article>
      </section>
      <section class="grid one">
        <article class="card ledger-card">
          <h2>Ledger</h2>
          <div class="ledger-list">
            ${ledgerRows.map(({ entry, balanceCents, escrowCents }) => `
              <div class="ledger-row">
                <strong>${escapeHtml(entry.type.replaceAll("_", " "))}</strong>
                <span>${money(entry.availableDeltaCents)}</span>
                <small>${escapeHtml(formatDateTime(entry.createdAt))}</small>
                <small>${entry.escrowDeltaCents ? `${money(entry.escrowDeltaCents)} escrow · ` : ""}${escapeHtml(entry.note || "")}</small>
                <small>Balance ${money(balanceCents)} · escrow ${money(escrowCents)}</small>
              </div>
            `).join("")}
          </div>
        </article>
      </section>
    </section>
  `;
}

function ledgerRowsWithBalances(entries) {
  let balanceCents = 0;
  let escrowCents = 0;
  return entries.map((entry) => {
    balanceCents += entry.availableDeltaCents;
    escrowCents += entry.escrowDeltaCents;
    return { entry, balanceCents, escrowCents };
  }).reverse();
}

function renderAuth() {
  const mode = state.authMode === "signup" ? "signup" : "login";
  const isSignup = mode === "signup";
  return `
    <main class="auth-shell">
      <article class="auth-card felt">
        <a class="brand auth-brand" href="#"><span class="mark">♞</span>Horsey</a>
        <div class="auth-tabs">
          <button class="${mode === "login" ? "active" : ""}" data-auth-mode="login">Log in</button>
          <button class="${mode === "signup" ? "active" : ""}" data-auth-mode="signup">Sign up</button>
        </div>
        <form data-auth-form class="stack">
          <label>Email
            <input name="email" type="email" autocomplete="email" required />
          </label>
          ${isSignup ? `
            <label>Handle
              <input name="handle" type="text" autocomplete="username" minlength="3" maxlength="20" required />
              <small class="muted">3–20 chars; letters, numbers, _ or -</small>
            </label>
          ` : ""}
          <label>Password
            <input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" minlength="${isSignup ? 8 : 1}" required />
            ${isSignup ? `<small class="muted">8+ characters</small>` : ""}
          </label>
          <button class="primary" type="submit">${isSignup ? "Create account" : "Log in"}</button>
          ${state.authError ? `<em class="action-error">${escapeHtml(state.authError)}</em>` : ""}
        </form>
        <p class="muted small">New accounts start with $1,000 in fake-money escrow funds.</p>
      </article>
    </main>
  `;
}

function renderUserProfile() {
  if (state.actionError) {
    return `<p class="muted">${escapeHtml(state.actionError)} <a href="#play">Back to lobby.</a></p>`;
  }
  const user = state.userProfile;
  if (!user) return `<p class="muted">Loading player...</p>`;
  const stats = user.stats ?? {};
  const recent = state.userRecentGames ?? [];
  const initial = (user.handle?.[0] ?? "?").toUpperCase();
  const h2h = user.h2hVsViewer;
  const h2hScore = h2h
    ? `${h2h.viewerWins}-${h2h.viewerLosses}${h2h.draws ? `-${h2h.draws}` : ""}`
    : "No games";
  const h2hMoney = h2h?.viewerNetCents ? `<span class="money-win">+${money(h2h.viewerNetCents)}</span>` : "";
  const challengeStake = state.picker.hero.stakeCents;
  const challengeTime = state.picker.hero.timeControl;
  const narrative = scoutNarrative(stats, h2h);
  return `
    <section class="user-profile">
      <aside class="card user-profile-rail">
        <div class="avatar huge">${escapeHtml(initial)}</div>
        <div>
          <h1>${escapeHtml(user.handle)}</h1>
          <p class="muted">rating ${escapeHtml(user.rating)} · joined ${escapeHtml(accountAgeLabel(user.createdAt))} ago</p>
        </div>
        <div class="profile-reveal">
          <strong class="scout-label">${escapeHtml(narrative.tenure)}</strong>
          <span class="scout-frame">${escapeHtml(narrative.frame)}</span>
        </div>
        <div class="tag-row">
          <span>${user.presence?.online ? "online" : "offline"}</span>
          ${user.liveGame ? `<span>in a live game</span>` : ""}
        </div>
        <div class="profile-h2h">
          <small>H2H vs you</small>
          <strong>${escapeHtml(h2hScore)} ${h2hMoney}</strong>
          <span>${h2h ? `${h2h.games} shared game${h2h.games === 1 ? "" : "s"}` : "No shared history yet"}</span>
        </div>
        <button type="button" class="primary" data-profile-challenge="${escapeHtml(user.id)}"
          data-profile-stake="${escapeHtml(challengeStake ?? "")}"
          data-profile-time="${escapeHtml(challengeTime ?? "")}"
          ${!challengeStake || !challengeTime ? "disabled" : ""}>
          Challenge ${challengeStake ? money(challengeStake) : ""}
        </button>
      </aside>
      <article class="card user-profile-main">
        <header>
          <span class="eyebrow">Player profile</span>
          <h2>Record</h2>
        </header>
        <div class="metric-grid">
          <div><small>Games</small><strong>${escapeHtml(stats.finishedGames ?? 0)}</strong></div>
          <div><small>Wins</small><strong>${escapeHtml(stats.wins ?? 0)}</strong></div>
          <div><small>Losses</small><strong>${escapeHtml(stats.losses ?? 0)}</strong></div>
          <div><small>Draws</small><strong>${escapeHtml(stats.draws ?? 0)}</strong></div>
        </div>
        <div class="profile-section">
          <h3>Recent form</h3>
          <small>Last 10</small>
          <div class="scout-beads">${scoutBeads(stats.last10)}</div>
        </div>
        <div class="profile-section">
          <small>Rating timeline</small>
          <div class="rating-spark">
            ${(stats.ratingTimeline ?? []).map((p) => `<span title="${escapeHtml(p.after)}" style="height:${Math.max(16, Math.min(64, 32 + p.delta))}px"></span>`).join("") || `<em class="muted small">No rating snapshots yet.</em>`}
          </div>
        </div>
      </article>
      <aside class="card user-profile-recent">
        <h2>Recent games</h2>
        ${recent.length ? recent.map((game) => `
          <div class="recent-game-row">
            <strong>${escapeHtml(game.result || "-")}</strong>
            <span>vs ${escapeHtml(game.opponent?.handle ?? "opponent")}</span>
            <small>${escapeHtml(game.timeControl || "-")} · ${escapeHtml(endReasonLabel(game.endReason))}</small>
          </div>
        `).join("") : `<p class="muted small">No finalized games yet.</p>`}
      </aside>
    </section>
  `;
}

function render() {
  if (state.view === "loading") return;
  if (state.view === "auth") {
    document.querySelector("#app").innerHTML = renderAuth();
    document.querySelectorAll("[data-auth-mode]").forEach((b) => {
      b.addEventListener("click", () => setAuthMode(b.dataset.authMode));
    });
    const form = document.querySelector("[data-auth-form]");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const email = fd.get("email");
        const password = fd.get("password");
        if (state.authMode === "signup") {
          submitSignup({ email, handle: fd.get("handle"), password });
        } else {
          submitLogin({ email, password });
        }
      });
    }
    return;
  }
  if (!state.bootstrap) return;
  const routes = {
    play: renderPlay,
    wager: renderWager,
    game: renderGame,
    settlement: renderSettlement,
    history: state.routeParam ? renderSettlement : renderHistoryList,
    profile: renderProfile,
    user: renderUserProfile
  };
  const view = routes[state.route] || renderPlay;
  document.querySelector("#app").innerHTML = shell(view());
  manageChallengeCountdown();
  manageClockTick();
  const moveList = document.querySelector("[data-move-list]");
  if (moveList) moveList.scrollTop = moveList.scrollHeight;

  document.querySelectorAll("[data-nav]").forEach((b) => {
    b.addEventListener("click", () => navigate(b.dataset.nav));
  });
  document.querySelectorAll("[data-logout]").forEach((b) => {
    b.addEventListener("click", () => logout());
  });
  document.querySelectorAll("[data-dismiss-game-error]").forEach((b) => {
    b.addEventListener("click", () => {
      state.gameError = null;
      render();
    });
  });
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", () => actOnChallenge(b.dataset.action));
  });
  document.querySelectorAll("[data-withdraw-challenge]").forEach((b) => {
    b.addEventListener("click", () => withdrawChallenge());
  });
  document.querySelectorAll("[data-open-resign]").forEach((b) => {
    b.addEventListener("click", () => openResignConfirm());
  });
  document.querySelectorAll("[data-resign-confirm]").forEach((b) => {
    b.addEventListener("click", () => resignGame());
  });
  document.querySelectorAll("[data-resign-cancel]").forEach((b) => {
    b.addEventListener("click", (event) => {
      if (event.target === b || b.tagName === "BUTTON") closeResignConfirm();
    });
  });
  document.querySelectorAll("[data-rematch]").forEach((b) => {
    b.addEventListener("click", () => requestRematch());
  });
  document.querySelectorAll("[data-open-scout]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openScout(node);
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      openScout(node);
    });
  });
  document.querySelectorAll("[data-close-scout]").forEach((b) => {
    b.addEventListener("click", () => closeScout());
  });
  document.querySelectorAll("[data-scout-challenge]").forEach((b) => {
    b.addEventListener("click", () => challengeFromScout());
  });
  document.querySelectorAll("[data-profile-challenge]").forEach((b) => {
    b.addEventListener("click", () => challengeFromProfile(b));
  });
  document.querySelectorAll("[data-replay-jump]").forEach((b) => {
    b.addEventListener("click", () => jumpReplay(b.dataset.replayJump));
  });
  document.querySelectorAll("[data-replay-ply]").forEach((b) => {
    b.addEventListener("click", () => setReplayPly(Number(b.dataset.replayPly)));
  });
  document.querySelectorAll("[data-draw-action]").forEach((b) => {
    b.addEventListener("click", () => submitDrawAction(b.dataset.drawAction));
  });
  document.querySelectorAll("[data-promote]").forEach((b) => {
    b.addEventListener("click", () => {
      const pending = state.pendingPromotion;
      if (!pending) return;
      submitMove(pending.from, pending.to, b.dataset.promote).catch((error) => {
        state.gameError = error.message;
        state.selectedSquare = null;
        state.pendingPromotion = null;
        render();
      });
    });
  });
  document.querySelectorAll("[data-cancel-promotion]").forEach((b) => {
    b.addEventListener("click", () => {
      state.pendingPromotion = null;
      render();
    });
  });
  document.querySelectorAll("[data-select-challenge]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.selectChallenge;
      const all = [
        ...state.bootstrap.incomingChallenges,
        ...state.bootstrap.sentChallenges,
        ...state.bootstrap.lobby.openChallenges
      ];
      const challenge = all.find((c) => c.id === id);
      if (challenge) selectChallenge(challenge);
    });
  });
  document.querySelectorAll("[data-pick-stake]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const formKey = btn.dataset.pickStake;
      const cents = Number(btn.dataset.stakeCents);
      if (!state.picker[formKey]) return;
      if (state.picker[formKey].stakeCents === cents) return;
      state.picker[formKey].stakeCents = cents;
      render();
    });
  });
  document.querySelectorAll("[data-pick-time]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const formKey = btn.dataset.pickTime;
      const tc = btn.dataset.time;
      if (!state.picker[formKey]) return;
      if (state.picker[formKey].timeControl === tc) return;
      state.picker[formKey].timeControl = tc;
      render();
    });
  });
  document.querySelectorAll("[data-find-game]").forEach((b) => {
    b.addEventListener("click", () => {
      const pick = state.picker.hero;
      if (!pick.stakeCents || !pick.timeControl) return;
      joinQuickMatch({ stakeCents: pick.stakeCents, timeControl: pick.timeControl });
    });
  });
  document.querySelectorAll("[data-host-invite]").forEach((b) => {
    b.addEventListener("click", () => {
      const pick = state.picker.hero;
      if (!pick.stakeCents || !pick.timeControl) return;
      hostOpenInvite({ stakeCents: pick.stakeCents, timeControl: pick.timeControl });
    });
  });
  document.querySelectorAll("[data-withdraw-host]").forEach((b) => {
    b.addEventListener("click", () => {
      withdrawChallenge(b.dataset.withdrawHost);
    });
  });
  document.querySelectorAll("[data-leave-queue]").forEach((b) => {
    b.addEventListener("click", () => leaveQuickMatch());
  });
  document.querySelectorAll("[data-return-to-board]").forEach((b) => {
    b.addEventListener("click", () => navigate("game"));
  });
  document.querySelectorAll("[data-live-resign]").forEach((b) => {
    b.addEventListener("click", () => openResignConfirm());
  });
  document.querySelectorAll("[data-rematch-from]").forEach((b) => {
    b.addEventListener("click", () => {
      rematchFromHistory({
        opponentId: b.dataset.rematchFrom,
        stakeCents: Number(b.dataset.rematchStake),
        timeControl: b.dataset.rematchTime
      });
    });
  });
  const emailForm = document.querySelector("[data-account-email]");
  if (emailForm) {
    emailForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(emailForm);
      updateAccountEmail({ email: fd.get("email"), password: fd.get("password") });
    });
  }
  const passwordForm = document.querySelector("[data-account-password]");
  if (passwordForm) {
    passwordForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(passwordForm);
      updateAccountPassword({
        currentPassword: fd.get("currentPassword"),
        nextPassword: fd.get("nextPassword")
      });
    });
  }
  document.querySelectorAll("[data-logout-others]").forEach((b) => {
    b.addEventListener("click", () => logoutOtherSessions());
  });
  document.querySelectorAll("[data-square]").forEach((square) => {
    square.addEventListener("click", () => {
      handleSquareIntent(square.dataset.square);
    });
    square.addEventListener("keydown", (event) => {
      handleSquareKey(event, square.dataset.square);
    });
    square.addEventListener("dragstart", (event) => {
      const from = square.dataset.square;
      if (!canMoveFrom(state.activeGame, from)) {
        event.preventDefault();
        return;
      }
      state.dragFromSquare = from;
      state.selectedSquare = from;
      state.gameError = null;
      square.classList.add("dragging");
      const piece = square.querySelector(".piece");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", from);
        if (piece && event.dataTransfer.setDragImage) {
          const rect = piece.getBoundingClientRect();
          event.dataTransfer.setDragImage(piece, rect.width / 2, rect.height / 2);
        }
      }
    });
    square.addEventListener("dragend", () => {
      state.dragFromSquare = null;
      square.classList.remove("dragging", "drop-ready");
      document.querySelectorAll(".drop-ready").forEach((node) => {
        node.classList.remove("drop-ready");
      });
    });
    square.addEventListener("dragover", (event) => {
      const from = state.dragFromSquare;
      if (from && legalMoveFor(from, square.dataset.square)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        square.classList.add("drop-ready");
      }
    });
    square.addEventListener("dragleave", () => {
      square.classList.remove("drop-ready");
    });
    square.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = event.dataTransfer.getData("text/plain") || state.dragFromSquare;
      const to = square.dataset.square;
      state.dragFromSquare = null;
      document.querySelectorAll(".drop-ready, .dragging").forEach((node) => {
        node.classList.remove("drop-ready", "dragging");
      });
      queueOrSubmitMove(from, to);
    });
  });
  if (state.focusSquare) {
    document.querySelector(`[data-square="${state.focusSquare}"]`)?.focus({ preventScroll: true });
  }
}

load().catch((error) => {
  document.querySelector("#app").innerHTML = `
    <main class="error">
      <h1>Horsey failed to load</h1>
      <pre>${error.message}</pre>
    </main>
  `;
});
