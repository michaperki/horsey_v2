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
  replay: null,
  walletLedger: [],
  selectedSquare: null,
  dragFromSquare: null,
  focusSquare: null,
  pendingPromotion: null,
  gameError: null,
  actionError: null,
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
  clockAnchor: null
};

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
  state.walletLedger = [];
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
    state.walletLedger = [];
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

function challengeExpiryLabel(challenge) {
  const remaining = challengeSecondsRemaining(challenge);
  if (remaining == null) return "";
  return remaining > 0 ? ` · auto-decline ${remaining}s` : " · expired";
}

function manageChallengeCountdown() {
  const remaining = challengeSecondsRemaining(state.activeChallenge);
  const shouldTick = state.route === "wager"
    && state.activeChallenge
    && remaining !== null
    && remaining > 0;
  if (shouldTick && !state.challengeCountdownTimer) {
    state.challengeCountdownTimer = setInterval(() => {
      if (state.route !== "wager" || !state.activeChallenge) {
        manageChallengeCountdown();
        return;
      }
      render();
    }, 1000);
  } else if (!shouldTick && state.challengeCountdownTimer) {
    clearInterval(state.challengeCountdownTimer);
    state.challengeCountdownTimer = null;
  }
}

function manageClockTick() {
  const wantTicking = state.route === "game" && state.activeGame
    && state.activeGame.state === "live" && state.activeGame.clock;
  if (wantTicking && !state.clockTickFrame) {
    const tick = () => {
      if (!state.clockTickFrame) return;
      updateClockDom();
      state.clockTickFrame = requestAnimationFrame(tick);
    };
    state.clockTickFrame = requestAnimationFrame(tick);
  } else if (!wantTicking && state.clockTickFrame) {
    cancelAnimationFrame(state.clockTickFrame);
    state.clockTickFrame = null;
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
    if (state.route === "game") render();
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleRealtimeMessage(msg);
  });

  ws.addEventListener("close", () => {
    state.rt.subscribedGameId = null;
    scheduleReconnect();
    if (state.route === "game") render();
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
  const stake = state.activeGame?.pot?.stakeCents;
  const consequence = stake ? ` You concede your ${money(stake)} stake.` : "";
  if (!window.confirm(`Resign this game? Your opponent will receive the pot.${consequence}`)) return;
  state.gameError = null;
  try {
    const payload = await postJson(`/api/games/${state.activeGame.id}/resign`, {});
    setActiveGame(payload.game);
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
  }
}

async function submitDrawAction(action) {
  state.gameError = null;
  try {
    const payload = await postJson(`/api/games/${state.activeGame.id}/${action}`, {});
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
  }
}

async function actOnChallenge(action) {
  state.actionError = null;
  try {
    const challengeId = state.activeChallenge.id;
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
  }
}

async function withdrawChallenge() {
  state.actionError = null;
  try {
    const challengeId = state.activeChallenge.id;
    const payload = await postJson(`/api/challenges/${challengeId}`, {}, "DELETE");
    state.activeChallenge = payload.challenge;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    await loadBootstrap();
    state.activeChallenge = null;
    navigate("play");
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

async function createChallenge({ stakeCents, timeControl }) {
  state.actionError = null;
  try {
    const payload = await postJson("/api/challenges", { recipientId: null, stakeCents, timeControl });
    state.activeChallenge = payload.challenge;
    await loadBootstrap();
    navigate("wager");
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  }
}

async function joinQuickMatch({ stakeCents, timeControl }) {
  state.actionError = null;
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
  } else if (state.route === "profile") {
    try {
      const wallet = await getJson("/api/wallet");
      state.walletLedger = wallet.ledger;
      if (state.bootstrap) state.bootstrap.viewer = wallet.viewer;
    } catch (error) {
      if (authGuard(error)) return;
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
  if (event.key !== "Escape" || !state.pendingPromotion) return;
  event.preventDefault();
  state.pendingPromotion = null;
  render();
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
  `;
}

function navLink(id, label) {
  const active = state.route === id ? "active" : "";
  return `<a class="${active}" href="#${id}">${label}</a>`;
}

function liveGameBanner(game) {
  const viewer = game.players?.find((p) => p.id === viewerId());
  const opponent = game.players?.find((p) => p.id !== viewerId());
  const turnOwner = game.players?.find((p) => p.color === game.turn);
  const yourTurn = turnOwner && viewer && turnOwner.id === viewer.id;
  const stake = game.pot?.stakeCents ?? 0;
  return `
    <section class="live-game-banner felt">
      <div>
        <div class="eyebrow">Live game · ${escapeHtml(yourTurn ? "your move" : opponent ? `${opponent.handle}'s move` : game.status)}</div>
        <h2>vs ${escapeHtml(opponent?.handle || "opponent")} · ${money(stake)}</h2>
      </div>
      <a class="primary" href="#game">Resume game</a>
    </section>
  `;
}

function renderPlay() {
  const { lobby, incomingChallenges, sentChallenges, matchmakingTicket } = state.bootstrap;
  const me = viewerId();
  const openChallenges = lobby.openChallenges.filter((c) => c.challengerId !== me);
  const liveGame = liveGameForShell();

  return `
    ${liveGame ? liveGameBanner(liveGame) : ""}
    <section class="grid two">
      <article class="hero felt">
        <div class="eyebrow">Quick match</div>
        <h1>Pick a stake. Find a game.</h1>
        <p>Pick a stake and time control. Both sides escrow before the first move.</p>
        ${matchmakingTicket ? `
          <div class="escrow">In queue · ${money(matchmakingTicket.stakeCents)} · ${matchmakingTicket.timeControl}</div>
          <button data-leave-queue>Leave queue</button>
        ` : `
          <form data-quick-match class="stack">
            <label>Stake
              <select name="stakeCents">
                ${lobby.stakes.map((s) => `<option value="${s.amountCents}">${s.label}</option>`).join("")}
              </select>
            </label>
            <label>Time
              <select name="timeControl">
                ${lobby.timeControls.map((t) => `<option value="${t}">${t}</option>`).join("")}
              </select>
            </label>
            <button class="primary" type="submit">Join quick match</button>
          </form>
        `}
        ${state.actionError ? `<em class="action-error">${escapeHtml(state.actionError)}</em>` : ""}
      </article>

      <aside class="stack">
        <article class="card">
          <div class="between"><h2>Incoming</h2><small>${incomingChallenges.length}</small></div>
          ${incomingChallenges.length === 0 ? "<p>No challenges waiting on you.</p>" : incomingChallenges.map(challengeRow).join("")}
        </article>
        <article class="card">
          <div class="between"><h2>Open tables</h2><small>${openChallenges.length}</small></div>
          ${openChallenges.length === 0 ? "<p>No open tables. Create one below.</p>" : openChallenges.map(challengeRow).join("")}
        </article>
        ${sentChallenges.length === 0 ? "" : `
          <article class="card">
            <div class="between"><h2>Your sent</h2><small>${sentChallenges.length}</small></div>
            ${sentChallenges.map(challengeRow).join("")}
          </article>
        `}
        <article class="card">
          <h2>Open an invite</h2>
          <p class="muted small">Posted to the open tables; anyone can accept.</p>
          <form data-create-challenge class="stack">
            <label>Stake
              <select name="stakeCents">
                ${lobby.stakes.map((s) => `<option value="${s.amountCents}">${s.label}</option>`).join("")}
              </select>
            </label>
            <label>Time
              <select name="timeControl">
                ${lobby.timeControls.map((t) => `<option value="${t}">${t}</option>`).join("")}
              </select>
            </label>
            <button class="primary" type="submit">Post invite</button>
          </form>
        </article>
      </aside>
    </section>
  `;
}

function challengeRow(challenge) {
  const opponent = challenge.opponent;
  const isMine = challenge.challengerId === viewerId();
  const label = isMine ? `→ ${challenge.recipient ? challenge.recipient.handle : "anyone"}` : `from ${opponent.handle}`;
  return `
    <button class="table-row" data-select-challenge="${challenge.id}">
      <strong>${escapeHtml(label)}</strong>
      <span>${money(challenge.stakeCents)} · ${challenge.timeControl}</span>
      <em>${escapeHtml(challenge.state)}</em>
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

  let actionLabel = "Accept and lock";
  if (challenge.state === "accepted") actionLabel = "Escrow locked";
  else if (challenge.state === "declined") actionLabel = "Declined";
  else if (challenge.state === "expired") actionLabel = "Expired";
  else if (viewerIsChallenger) actionLabel = isOpen ? "Awaiting any opponent" : `Awaiting ${challenge.recipient?.handle ?? "recipient"}`;

  const opponent = challenge.opponent;
  const headline = viewerIsChallenger
    ? `<span class="muted">You staked</span> ${money(challenge.stakeCents)}`
    : `<span class="muted">${escapeHtml(opponent.handle)} wants</span> ${money(challenge.stakeCents)} <span class="muted">from you.</span>`;

  return `
    <section class="grid wager">
      <article class="stack">
        <div>
          <div class="eyebrow danger">${challenge.state} challenge${challengeExpiryLabel(challenge)}</div>
          <h1>${headline}</h1>
        </div>
        <article class="card opponent">
          <div class="avatar huge">${escapeHtml(opponent.handle[0] || "?")}</div>
          <div>
            <h2>${escapeHtml(opponent.handle)} ${opponent.rating ? `<span>${escapeHtml(opponent.rating)}</span>` : ""}</h2>
          </div>
        </article>
      </article>
      <aside class="felt match-card">
        <div class="eyebrow">The match</div>
        <h2>${money(challenge.stakeCents)} each</h2>
        <p>${challenge.timeControl} blitz · ${money(challenge.pot.netPotCents)} pot after ${money(challenge.pot.rakeCents)} rake.</p>
        <div class="escrow">Stakes lock in fake-money escrow for this milestone.</div>
        <button class="primary" ${canAct ? 'data-action="accept"' : "disabled"}>${escapeHtml(actionLabel)} ${canAct ? money(challenge.stakeCents) : ""}</button>
        <button ${canAct ? 'data-action="counter"' : "disabled"}>Counter same stake</button>
        <button ${canAct ? 'data-action="decline"' : "disabled"}>Decline</button>
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
          ${state.gameError ? `<em>${escapeHtml(state.gameError)}</em>` : ""}
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
        ${canResign ? `<button class="danger resign-button" data-resign>Resign · concede ${money(game.pot.stakeCents)}</button>` : ""}
      </aside>
    </section>
  `;
}

function drawControls(game, viewerColor) {
  const offer = game.drawOffer;
  if (!offer) {
    return `<button class="draw-button" data-draw-action="draw-offer">Offer draw</button>`;
  }
  if (offer.offeredBy === viewerColor) {
    return `<div class="card draw-pending"><strong>Draw offered</strong><small>Waiting on opponent. Your offer clears on your next move.</small></div>`;
  }
  const opponent = game.players.find((p) => p.color !== viewerColor)?.handle ?? "Opponent";
  return `
    <div class="card draw-incoming">
      <strong>${escapeHtml(opponent)} offers a draw</strong>
      <div class="stack">
        <button class="primary" data-draw-action="draw-accept">Accept draw</button>
        <button data-draw-action="draw-decline">Decline</button>
      </div>
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
  return `
    <div class="player-strip ${active ? "active" : ""} ${low ? "low" : ""} ${critical ? "critical" : ""}" data-clock="${player.color}">
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
  return `
    <section class="history">
      <header class="history-header">
        <h1>History</h1>
        <p class="muted">${items.length} finished game${items.length === 1 ? "" : "s"}</p>
      </header>
      <div class="history-list">
        ${items.map(historyRow).join("")}
      </div>
    </section>
  `;
}

function historyRow(entry) {
  const opponentHandle = entry.opponent?.handle ?? "—";
  const resultLabel = entry.result === "win" ? "Win" : entry.result === "loss" ? "Loss" : entry.result === "draw" ? "Draw" : entry.result;
  const resultClass = entry.result === "win" ? "money-win" : entry.result === "loss" ? "money-loss" : "money-draw";
  const sign = entry.result === "win" ? "+" : entry.result === "loss" ? "−" : "";
  const credited = entry.result === "loss" ? entry.stakeCents : entry.creditedCents;
  const when = entry.endedAt ? new Date(entry.endedAt).toLocaleString() : "—";
  const endReason = endReasonLabel(entry.endReason);
  return `
    <a class="history-row" href="#history/${entry.gameId}">
      <div class="history-result ${resultClass}">${resultLabel}</div>
      <div class="history-vs">
        <strong>vs ${escapeHtml(opponentHandle)}</strong>
        <small>${escapeHtml(entry.timeControl || "—")} · ${escapeHtml(endReason)}</small>
      </div>
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
        <article class="card ledger-card">
          <h2>Ledger</h2>
          <div class="ledger-list">
            ${state.walletLedger.map((entry) => `
              <div class="ledger-row">
                <strong>${escapeHtml(entry.type.replaceAll("_", " "))}</strong>
                <span>${money(entry.availableDeltaCents)}</span>
                <small>${entry.escrowDeltaCents ? `${money(entry.escrowDeltaCents)} escrow` : escapeHtml(entry.note || "")}</small>
              </div>
            `).join("")}
          </div>
        </article>
      </section>
    </section>
  `;
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
    profile: renderProfile
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
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", () => actOnChallenge(b.dataset.action));
  });
  document.querySelectorAll("[data-withdraw-challenge]").forEach((b) => {
    b.addEventListener("click", () => withdrawChallenge());
  });
  document.querySelectorAll("[data-resign]").forEach((b) => {
    b.addEventListener("click", () => resignGame());
  });
  document.querySelectorAll("[data-rematch]").forEach((b) => {
    b.addEventListener("click", () => requestRematch());
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
  const createForm = document.querySelector("[data-create-challenge]");
  if (createForm) {
    createForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(createForm);
      createChallenge({
        stakeCents: Number(fd.get("stakeCents")),
        timeControl: fd.get("timeControl")
      });
    });
  }
  const quickForm = document.querySelector("[data-quick-match]");
  if (quickForm) {
    quickForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(quickForm);
      joinQuickMatch({
        stakeCents: Number(fd.get("stakeCents")),
        timeControl: fd.get("timeControl")
      });
    });
  }
  document.querySelectorAll("[data-leave-queue]").forEach((b) => {
    b.addEventListener("click", () => leaveQuickMatch());
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
