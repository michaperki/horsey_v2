const state = {
  view: "loading",
  authMode: "login",
  authError: null,
  bootstrap: null,
  activeChallenge: null,
  activeGame: null,
  activeSettlement: null,
  walletLedger: [],
  selectedSquare: null,
  pendingPromotion: null,
  gameError: null,
  actionError: null,
  matchmakingPoll: null,
  route: window.location.hash.replace("#", "") || "lobby",
  rt: {
    ws: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    subscribedGameId: null
  },
  clockTick: null
};

function viewerId() {
  return state.bootstrap?.viewer?.id;
}

const money = (cents) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: cents % 100 === 0 ? 0 : 2
}).format(cents / 100);

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

async function loadBootstrap() {
  const data = await getJson("/api/bootstrap");
  state.bootstrap = data;
  state.activeGame = data.activeGame || data.recentGame || null;
  state.activeSettlement = data.recentSettlement || null;
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
    managePolling();
    syncGameSubscription();
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
  closeRealtime();
  state.bootstrap = null;
  state.activeChallenge = null;
  state.activeGame = null;
  state.activeSettlement = null;
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
    closeRealtime();
    state.bootstrap = null;
    state.activeChallenge = null;
    state.activeGame = null;
    state.activeSettlement = null;
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
  const shouldPoll = state.route === "lobby" && state.bootstrap?.matchmakingTicket && !state.activeGame;
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

function manageClockTick() {
  const wantTicking = state.route === "game" && state.activeGame
    && state.activeGame.state === "live" && state.activeGame.clock;
  if (wantTicking && !state.clockTick) {
    state.clockTick = setInterval(updateClockDom, 250);
  } else if (!wantTicking && state.clockTick) {
    clearInterval(state.clockTick);
    state.clockTick = null;
  }
}

function updateClockDom() {
  const game = state.activeGame;
  if (!game || !game.clock) return;
  const now = Date.now();
  for (const player of game.players) {
    const node = document.querySelector(`[data-clock="${player.color}"] time`);
    if (!node) continue;
    const ms = remainingForSide(game.clock, player.color, now);
    node.textContent = ms == null ? "--:--" : formatClock(ms);
    const strip = node.closest(".player-strip");
    if (strip) strip.classList.toggle("low", ms != null && ms < 30000 && game.state === "live");
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
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleRealtimeMessage(msg);
  });

  ws.addEventListener("close", () => {
    state.rt.subscribedGameId = null;
    scheduleReconnect();
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
        state.activeGame = msg.game;
        if (state.route === "game") render();
      }
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
        state.activeGame = gameResp.game;
        state.activeSettlement = settlementResp.settlement;
        state.bootstrap.viewer = wallet.viewer;
        state.walletLedger = wallet.ledger;
        navigate("settlement");
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
          state.activeGame = msg.game;
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
  state.activeGame = payload.game;
  state.selectedSquare = null;
  state.pendingPromotion = null;
  if (payload.settlement && payload.settlement.state === "finalized") {
    state.activeSettlement = payload.settlement;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    const wallet = await getJson("/api/wallet");
    state.bootstrap.viewer = wallet.viewer;
    state.walletLedger = wallet.ledger;
    navigate("settlement");
    return;
  }
  render();
}

async function resignGame() {
  if (!window.confirm("Resign this game? Your opponent will receive the pot.")) return;
  state.gameError = null;
  try {
    const payload = await postJson(`/api/games/${state.activeGame.id}/resign`, {});
    state.activeGame = payload.game;
    state.activeSettlement = payload.settlement;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    const wallet = await getJson("/api/wallet");
    state.bootstrap.viewer = wallet.viewer;
    state.walletLedger = wallet.ledger;
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
    state.activeGame = payload.game;
    if (action === "draw-accept") {
      state.activeSettlement = payload.settlement;
      if (payload.viewer) state.bootstrap.viewer = payload.viewer;
      const wallet = await getJson("/api/wallet");
      state.bootstrap.viewer = wallet.viewer;
      state.walletLedger = wallet.ledger;
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
    if (payload.game) state.activeGame = payload.game;
    const wallet = await getJson("/api/wallet");
    state.bootstrap.viewer = wallet.viewer;
    state.walletLedger = wallet.ledger;
    if (action === "accept") navigate("game");
    if (action === "decline" || action === "counter") {
      state.activeChallenge = null;
      navigate("lobby");
    }
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
      state.activeGame = payload.game;
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

window.addEventListener("hashchange", () => {
  state.route = window.location.hash.replace("#", "") || "lobby";
  managePolling();
  syncGameSubscription();
  render();
});

function shell(content) {
  const viewer = state.bootstrap.viewer;
  return `
    <header class="topbar">
      <a class="brand" href="#lobby"><span class="mark">♞</span>Horsey</a>
      <nav>
        ${navLink("lobby", "Lobby")}
        ${state.activeChallenge ? navLink("wager", "Wager") : ""}
        ${state.activeGame ? navLink("game", "Game") : ""}
        ${state.activeSettlement ? navLink("settlement", "Settlement") : ""}
        ${navLink("wallet", "Wallet")}
      </nav>
      <div class="viewer-id">
        <small>signed in as <strong>${viewer.handle}</strong></small>
        <button class="link" data-logout>Log out</button>
      </div>
      <div class="wallet-pill">
        <span>${money(viewer.balanceCents)}</span>
        <small>${money(viewer.escrowCents)} escrow</small>
      </div>
    </header>
    <main>${content}</main>
  `;
}

function navLink(id, label) {
  return `<a class="${state.route === id ? "active" : ""}" href="#${id}">${label}</a>`;
}

function renderLobby() {
  const { lobby, incomingChallenges, sentChallenges, matchmakingTicket } = state.bootstrap;
  const me = viewerId();
  const openChallenges = lobby.openChallenges.filter((c) => c.challengerId !== me);

  return `
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
        ${state.actionError ? `<em class="action-error">${state.actionError}</em>` : ""}
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
      <strong>${label}</strong>
      <span>${money(challenge.stakeCents)} · ${challenge.timeControl}</span>
      <em>${challenge.state}</em>
      <span>→</span>
    </button>
  `;
}

function renderWager() {
  const challenge = state.activeChallenge;
  if (!challenge) return `<p class="muted">No active challenge. <a href="#lobby">Pick one.</a></p>`;
  const viewerIsRecipient = viewerId() === challenge.recipientId;
  const viewerIsChallenger = viewerId() === challenge.challengerId;
  const isOpen = !challenge.recipientId;
  const canAct = (viewerIsRecipient || (isOpen && !viewerIsChallenger))
    && (challenge.state === "incoming" || challenge.state === "countered");

  let actionLabel = "Accept and lock";
  if (challenge.state === "accepted") actionLabel = "Escrow locked";
  else if (challenge.state === "declined") actionLabel = "Declined";
  else if (challenge.state === "expired") actionLabel = "Expired";
  else if (viewerIsChallenger) actionLabel = isOpen ? "Awaiting any opponent" : `Awaiting ${challenge.recipient?.handle ?? "recipient"}`;

  const opponent = challenge.opponent;
  const headline = viewerIsChallenger
    ? `<span class="muted">You staked</span> ${money(challenge.stakeCents)}`
    : `<span class="muted">${opponent.handle} wants</span> ${money(challenge.stakeCents)} <span class="muted">from you.</span>`;

  return `
    <section class="grid wager">
      <article class="stack">
        <div>
          <div class="eyebrow danger">${challenge.state} challenge · auto-decline ${challenge.expiresInSeconds}s</div>
          <h1>${headline}</h1>
        </div>
        <article class="card opponent">
          <div class="avatar huge">${opponent.handle[0]}</div>
          <div>
            <h2>${opponent.handle} ${opponent.rating ? `<span>${opponent.rating}</span>` : ""}</h2>
            <p>${opponent.country || "—"} · ${opponent.note || "—"} · reputation ${opponent.reputation || "—"}</p>
            <div class="tag-row">
              <span>${opponent.verified ? "verified ID" : "unverified"}</span>
              <span>h2h ${opponent.h2h || "—"}</span>
            </div>
          </div>
        </article>
      </article>
      <aside class="felt match-card">
        <div class="eyebrow">The match</div>
        <h2>${money(challenge.stakeCents)} each</h2>
        <p>${challenge.timeControl} blitz · ${money(challenge.pot.netPotCents)} pot after ${money(challenge.pot.rakeCents)} rake.</p>
        <div class="escrow">Stakes lock in fake-money escrow for this milestone.</div>
        <button class="primary" ${canAct ? 'data-action="accept"' : "disabled"}>${actionLabel} ${canAct ? money(challenge.stakeCents) : ""}</button>
        <button ${canAct ? 'data-action="counter"' : "disabled"}>Counter same stake</button>
        <button ${canAct ? 'data-action="decline"' : "disabled"}>Decline</button>
        ${state.actionError ? `<em class="action-error">${state.actionError}</em>` : ""}
      </aside>
    </section>
  `;
}

function renderGame() {
  const game = state.activeGame;
  if (!game) return `<p class="muted">No active game. <a href="#lobby">Back to lobby.</a></p>`;
  const white = game.players.find((player) => player.color === "white");
  const black = game.players.find((player) => player.color === "black");
  const viewer = game.players.find((player) => player.id === viewerId());
  const viewerIsPlayer = !!viewer;
  const canResign = viewerIsPlayer && game.state === "live";
  const drawSection = viewerIsPlayer && game.state === "live"
    ? drawControls(game, viewer.color)
    : "";
  return `
    <section class="game-layout">
      <aside class="card">
        <h2>Move history</h2>
        <ol class="moves">
          ${(game.moveRows || []).map((move) => `<li><span>${move[0]}</span><span>${move[1] || ""}</span></li>`).join("") || "<li><span>No moves yet</span><span></span></li>"}
        </ol>
      </aside>
      <article class="board-column">
        ${playerStrip(game, black, game.turn === "black")}
        ${captureTray(game, "black")}
        ${board(game)}
        ${promotionDialog()}
        ${captureTray(game, "white")}
        ${playerStrip(game, white, game.turn === "white")}
        <div class="turn-strip">
          <strong>${game.turn} to move</strong>
          <span>${game.status}${game.inCheck ? " · check" : ""}</span>
          ${state.gameError ? `<em>${state.gameError}</em>` : ""}
        </div>
      </article>
      <aside class="stack">
        <article class="felt pot">
          <div class="eyebrow">The pot</div>
          <h2>${money(game.pot.netPotCents)}</h2>
          <p>Winner takes after fake-money rake.</p>
        </article>
        <article class="card">
          <h2>Momentum</h2>
          <p>Eval and anti-cheat-backed insights are placeholders until the chess core and trust systems land.</p>
        </article>
        ${drawSection}
        ${canResign ? `<button class="danger" data-resign>Resign</button>` : ""}
      </aside>
    </section>
  `;
}

function drawControls(game, viewerColor) {
  const offer = game.drawOffer;
  if (!offer) {
    return `<button data-draw-action="draw-offer">Offer draw</button>`;
  }
  if (offer.offeredBy === viewerColor) {
    return `<div class="card draw-pending"><strong>Draw offered</strong><small>Waiting on opponent. Your offer clears on your next move.</small></div>`;
  }
  const opponent = game.players.find((p) => p.color !== viewerColor)?.handle ?? "Opponent";
  return `
    <div class="card draw-incoming">
      <strong>${opponent} offers a draw</strong>
      <div class="stack">
        <button class="primary" data-draw-action="draw-accept">Accept draw</button>
        <button data-draw-action="draw-decline">Decline</button>
      </div>
    </div>
  `;
}

function playerStrip(game, player, active = false) {
  const ms = remainingForSide(game.clock, player.color, Date.now());
  const display = ms == null ? "--:--" : formatClock(ms);
  const low = ms != null && ms < 30000 && game.state === "live";
  return `
    <div class="player-strip ${active ? "active" : ""} ${low ? "low" : ""}" data-clock="${player.color}">
      <span class="avatar">${player.handle[0]}</span>
      <strong>${player.handle}</strong>
      <small>${player.rating}</small>
      <time>${display}</time>
    </div>
  `;
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

function capturedPieces(game, color) {
  return (game.moves || [])
    .filter((move, index) => move.captured && movingColorForMoveIndex(index) === color)
    .map((move) => ({ color: color === "white" ? "black" : "white", type: move.captured }));
}

function captureTray(game, color) {
  const pieces = capturedPieces(game, color);
  return `
    <div class="capture-tray" aria-label="${color} captured pieces">
      ${pieces.length ? pieces.map((piece) => pieceImg(piece.color, piece.type, "captured-piece")).join("") : "<small>No captures</small>"}
    </div>
  `;
}

function remainingForSide(clock, side, now) {
  if (!clock) return null;
  const stored = side === "white" ? clock.whiteMs : clock.blackMs;
  if (clock.sideToMove !== side) return stored;
  const elapsed = now - Date.parse(clock.lastMoveAt);
  return stored - elapsed;
}

function formatClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
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
    const target = targetMoves.get(square.square);
    const pieceColor = square.color === "w" ? "white" : square.color === "b" ? "black" : null;
    const classes = [
      (square.row + square.col) % 2 ? "dark" : "light",
      square.square === selected ? "selected" : "",
      target ? "target" : "",
      target?.captured ? "target-capture" : target ? "target-quiet" : "",
      lastSquares.has(square.square) ? "last-move" : "",
      checkedKing === square.square ? "king-check" : ""
    ].filter(Boolean).join(" ");
    const showFile = orientation === "white" ? square.row === 7 : square.row === 0;
    const showRank = orientation === "white" ? square.col === 0 : square.col === 7;
    const piece = pieceColor && square.type ? pieceImg(pieceColor, square.type) : "";
    const coords = [
      showRank ? `<span class="coord rank">${square.square[1]}</span>` : "",
      showFile ? `<span class="coord file">${square.square[0]}</span>` : ""
    ].join("");
    return `<button class="${classes}" data-square="${square.square}" aria-label="${square.square}">${piece}${coords}</button>`;
  });
  return `<div class="board ${orientation === "black" ? "flipped" : ""}" aria-label="Chess board">${cells.join("")}</div>`;
}

function boardOrientation(game) {
  const viewer = game.players?.find((player) => player.id === viewerId());
  return viewer?.color === "black" ? "black" : "white";
}

function promotionMoveFor(from, to) {
  return state.activeGame?.legalMoves.find((move) => move.from === from && move.to === to && move.promotion) || null;
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
  if (!settlement) return `<p class="muted">No settlement yet. <a href="#lobby">Back to lobby.</a></p>`;
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
  let headline = `${opponentHandle} took the pot.`;
  let amountClass = "money-loss";
  let amountPrefix = "-";
  let amountCents = game?.pot?.stakeCents || 0;

  if (won) {
    eyebrowClass = "success";
    eyebrowText = "Settlement · auto-credited";
    headline = `You took ${opponentHandle}.`;
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
        <div class="eyebrow ${eyebrowClass}">${eyebrowText}</div>
        <h1>${headline}</h1>
        <div class="${amountClass}">${amountPrefix}${money(amountCents)}</div>
        <p>Pot ${money(settlement.grossPotCents)} minus ${money(settlement.rakeCents)} fake-money rake.</p>
        <div class="metric-grid">
          <div><small>Balance</small><strong>${money(settlement.balanceAfterCents)}</strong></div>
          <div><small>Rating</small><strong>${drew ? "±0" : `${won ? "+" : "−"}${settlement.ratingDelta}`}</strong></div>
          <div><small>Last move</small><strong>${settlement.winningMove || "—"}</strong></div>
        </div>
      </article>
      <aside class="card stack">
        <h2>Queue another</h2>
        ${settlement.rematchChallenge ? `<button class="primary" data-nav="lobby">Find another · ${money(settlement.rematchChallenge.stakeCents)}</button>` : ""}
        <button data-nav="lobby">Find new opponent</button>
      </aside>
    </section>
  `;
}

function renderWallet() {
  const viewer = state.bootstrap.viewer;
  return `
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
              <strong>${entry.type.replaceAll("_", " ")}</strong>
              <span>${money(entry.availableDeltaCents)}</span>
              <small>${entry.escrowDeltaCents ? `${money(entry.escrowDeltaCents)} escrow` : entry.note || ""}</small>
            </div>
          `).join("")}
        </div>
      </article>
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
          ${state.authError ? `<em class="action-error">${state.authError}</em>` : ""}
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
    lobby: renderLobby,
    wager: renderWager,
    game: renderGame,
    settlement: renderSettlement,
    wallet: renderWallet
  };
  const view = routes[state.route] || renderLobby;
  document.querySelector("#app").innerHTML = shell(view());
  manageClockTick();

  document.querySelectorAll("[data-nav]").forEach((b) => {
    b.addEventListener("click", () => navigate(b.dataset.nav));
  });
  document.querySelectorAll("[data-logout]").forEach((b) => {
    b.addEventListener("click", () => logout());
  });
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", () => actOnChallenge(b.dataset.action));
  });
  document.querySelectorAll("[data-resign]").forEach((b) => {
    b.addEventListener("click", () => resignGame());
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
      const clicked = square.dataset.square;
      if (!state.selectedSquare) {
        state.selectedSquare = clicked;
        state.gameError = null;
        render();
        return;
      }
      if (state.selectedSquare === clicked) {
        state.selectedSquare = null;
        state.pendingPromotion = null;
        render();
        return;
      }
      const promotionMove = promotionMoveFor(state.selectedSquare, clicked);
      if (promotionMove) {
        const movingPiece = state.activeGame.board.find((cell) => cell.square === state.selectedSquare);
        state.pendingPromotion = {
          from: state.selectedSquare,
          to: clicked,
          color: movingPiece?.color === "b" ? "black" : "white"
        };
        render();
        return;
      }
      submitMove(state.selectedSquare, clicked).catch((error) => {
        state.gameError = error.message;
        state.selectedSquare = null;
        state.pendingPromotion = null;
        render();
      });
    });
  });
}

load().catch((error) => {
  document.querySelector("#app").innerHTML = `
    <main class="error">
      <h1>Horsey failed to load</h1>
      <pre>${error.message}</pre>
    </main>
  `;
});
