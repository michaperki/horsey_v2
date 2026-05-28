import {
  getSoundMode,
  initSound,
  playMilestoneSound,
  playSettlementSound,
  playSound,
  setSoundMode
} from "./sound.mjs";

// Defer the first paint past module evaluation so the `let state = ...`
// declaration further down is initialized before render reads it.
Promise.resolve().then(() => render());

const ROUTE_ALIASES = { "": "play", lobby: "play", wallet: "profile" };

// Bump alongside packages/shared/tos.mjs TOS_VERSION. The signup form
// needs this at submit time, before there's an authenticated bootstrap
// payload to read it from. For re-acceptance after a version bump, we
// read viewer.tos.currentVersion from the bootstrap instead.
const TOS_VERSION = 1;

// Curated-avatar renderer. Each user has an equipped avatar id (from the
// catalog in packages/shared/avatars.mjs) and a trust tier; we render a
// tier-bordered frame with the avatar PNG and an initial-letter fallback
// behind it. See docs/PROJECT_SOUL.md § Avatar semantics.
const DEFAULT_AVATAR_ID = "base";
const VALID_TRUST_TIERS = new Set(["provisional", "claimed", "verified", "established"]);
function renderAvatar(user, opts = {}) {
  const avatarId = user?.equippedAvatar || DEFAULT_AVATAR_ID;
  const tier = VALID_TRUST_TIERS.has(user?.trustTier) ? user.trustTier : "provisional";
  const initial = escapeHtml((user?.handle?.[0] || "?").toUpperCase());
  const sizeClass = opts.size ? ` ${escapeHtml(opts.size)}` : "";
  const src = `/assets/avatars/${escapeHtml(avatarId)}.png`;
  return (
    `<span class="avatar tier-${tier}${sizeClass}" aria-hidden="true">` +
      `<span class="avatar-fallback">${initial}</span>` +
      `<img class="avatar-img" src="${src}" alt="" loading="lazy" />` +
    `</span>`
  );
}

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
  wagerOpponent: null,
  wagerOpponentLoading: false,
  wagerCounter: { open: false },
  replay: null,
  walletLedger: [],
  avatarCatalog: null,
  selectedSquare: null,
  dragFromSquare: null,
  focusSquare: null,
  pendingPromotion: null,
  resignConfirmOpen: false,
  cashierOpen: false,
  cashierError: null,
  gameError: null,
  actionError: null,
  accountError: null,
  accountNotice: null,
  devAccounts: null,
  devAccountsLoading: false,
  onboardingError: null,
  verifying: { accountId: null, claimToken: null, expiresAt: null, error: null },
  verifyEmail: null,
  passwordReset: null,
  resetRequest: null,
  verifyBanner: { sending: false, sent: false, error: null },
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
    hero: { stakeCents: null, timeControl: null },
    counter: { stakeCents: null, timeControl: null }
  },
  matchTierPref: "any",
  milestones: [],
  scout: {
    userId: null,
    user: null,
    loading: false,
    error: null,
    anchor: null
  }
};

const STAKE_TIER_DEFAULT_CENTS = 2500;
const TIME_DEFAULT = "3+0";

const CHIP_DENOMS_DOLLARS = [500, 100, 25, 5, 1];
let lastGameStartAudioId = null;
let lastGameEndAudioId = null;
const playedSettlementAudioFor = new Set();
const completedMoneyTweenKeys = new Set();

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
  const cap = state.bootstrap?.viewer?.stakeCapCents ?? Infinity;
  const withinCap = (cents) => cents != null && cents <= cap;
  const validStake = (cents) => lobby.stakes.some((s) => s.amountCents === cents);
  const allowableStakes = lobby.stakes.filter((s) => s.amountCents <= cap);
  const validTime = (tc) => lobby.timeControls.includes(tc);
  const fallbackStake = (validStake(STAKE_TIER_DEFAULT_CENTS) && withinCap(STAKE_TIER_DEFAULT_CENTS))
    ? STAKE_TIER_DEFAULT_CENTS
    : (allowableStakes[0]?.amountCents ?? lobby.stakes[0]?.amountCents ?? null);
  const fallbackTime = validTime(TIME_DEFAULT) ? TIME_DEFAULT : lobby.timeControls[0] ?? null;
  const pick = state.picker.hero;
  if (!validStake(pick.stakeCents) || !withinCap(pick.stakeCents)) pick.stakeCents = fallbackStake;
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
    firstMovesMade: clock.firstMovesMade ?? 2,
    anchoredAtMs: performance.now() - staleMs
  };
}

function setActiveGame(game) {
  // Detect new moves to fire chess interaction sound. Compare against the
  // prior game's move count for the same game id; firing only when count
  // grew avoids replaying sound on bootstrap/reconnect snapshots.
  const prior = state.activeGame;
  const sameGame = prior && game && prior.id === game.id;
  const priorMoves = sameGame ? (prior.moves?.length ?? 0) : null;
  const newMoves = game?.moves?.length ?? 0;
  state.activeGame = game;
  captureClockAnchor(game?.clock ?? null);
  if (game?.state === "live" && game.id !== lastGameStartAudioId && (!sameGame || prior?.state !== "live")) {
    lastGameStartAudioId = game.id;
    playSound("game_start");
  }
  if (sameGame && priorMoves != null && newMoves > priorMoves) {
    const last = game.moves[newMoves - 1];
    playMoveSound(last, game);
  }
}

function maybePlayGameEndAudio(gameId, settlement) {
  if (!gameId || !settlement || settlement.state !== "finalized") return;
  if (gameId === lastGameEndAudioId) return;
  lastGameEndAudioId = gameId;
  playedSettlementAudioFor.add(gameId);
  const result = settlement.result === "draw" ? "draw" : settlement.result === "loss" ? "loss" : "win";
  playSound(`game_end_${result}`);
}

// Fire the right chess-interaction sound for a just-played move. Order
// of precedence: mate > check > capture > regular drop. Mate is handled
// by the settlement audio cue instead (it triggers via game.finalized),
// so we play check on a checking move and the drop sound otherwise.
function playMoveSound(move, game) {
  if (!move) return;
  if (game?.inCheck && game.state === "live") {
    playSound("check_chime");
    return;
  }
  if (move.captured) {
    playSound("piece_capture");
    return;
  }
  playSound("piece_drop");
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
  // Mirror the server: while either side still owes their first move, the
  // side-to-move's main clock is paused.
  if (anchor.firstMovesMade < 2) return stored;
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

async function loadFinalizedGame(gameId, { game = null, settlement = null } = {}) {
  const [gameResp, settlementResp, wallet] = await Promise.all([
    game ? Promise.resolve({ game }) : getJson(`/api/games/${gameId}`),
    settlement ? Promise.resolve({ settlement }) : getJson(`/api/games/${gameId}/settlement`),
    getJson("/api/wallet")
  ]);
  setActiveGame(gameResp.game);
  if (state.liveGame?.id === gameId) state.liveGame = null;
  state.activeSettlement = settlementResp.settlement;
  state.bootstrap.viewer = wallet.viewer;
  if (wallet.ledger) state.walletLedger = wallet.ledger;
  await loadReplay(gameId);
  maybePlayGameEndAudio(gameId, state.activeSettlement);
}

async function watchLiveGame(gameId) {
  if (!gameId) return;
  state.gameError = null;
  try {
    const resp = await getJson(`/api/games/${encodeURIComponent(gameId)}`);
    setActiveGame(resp.game);
    state.activeSettlement = null;
    state.replay = null;
    navigate(`game/${gameId}`);
  } catch (error) {
    if (authGuard(error)) return;
    state.gameError = error.message;
    render();
  }
}

async function loadBootstrap() {
  const data = await getJson("/api/bootstrap");
  state.bootstrap = data;
  state.notifications = {
    unreadCount: data.notifications?.unreadCount ?? 0,
    recent: data.notifications?.recent ?? [],
    dropdownOpen: state.notifications?.dropdownOpen ?? false
  };
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
  const initial = parseHash();
  if (initial.name === "verify-email" && initial.param) {
    state.view = "verify-email";
    state.verifyEmail = { token: initial.param, status: "verifying", message: null };
    render();
    confirmEmailVerificationFromHash(initial.param);
    return;
  }
  if (initial.name === "password-reset" && initial.param) {
    state.view = "password-reset";
    state.passwordReset = { token: initial.param, status: "form", error: null };
    render();
    return;
  }
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

async function confirmEmailVerificationFromHash(token) {
  try {
    await postJson("/api/auth/verify-email/confirm", { token });
    state.verifyEmail = { token, status: "success", message: null };
  } catch (error) {
    state.verifyEmail = { token, status: "error", message: error.message };
  }
  render();
}

async function resendVerificationEmail() {
  if (state.verifyBanner.sending) return;
  state.verifyBanner = { sending: true, sent: false, error: null };
  render();
  try {
    await postJson("/api/auth/verify-email/send");
    state.verifyBanner = { sending: false, sent: true, error: null };
  } catch (error) {
    state.verifyBanner = { sending: false, sent: false, error: error.message };
  }
  render();
}

async function submitPasswordResetRequest(email) {
  state.resetRequest = { status: "submitting", error: null };
  render();
  try {
    await postJson("/api/auth/password/reset/request", { email });
    state.resetRequest = { status: "success", error: null };
  } catch (error) {
    state.resetRequest = { status: "form", error: error.message };
  }
  render();
}

async function submitPasswordResetConfirm({ token, newPassword }) {
  state.passwordReset = { token, status: "submitting", error: null };
  render();
  try {
    await postJson("/api/auth/password/reset/confirm", { token, newPassword });
    state.passwordReset = { token, status: "success", error: null };
    render();
  } catch (error) {
    state.passwordReset = { token, status: "form", error: error.message };
    render();
  }
}

async function submitSignup({ email, handle, password, acceptedTosVersion }) {
  state.authError = null;
  try {
    await postJson("/api/auth/signup", { email, handle, password, acceptedTosVersion });
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

async function loadDevAccounts() {
  if (state.devAccounts || state.devAccountsLoading) return;
  state.devAccountsLoading = true;
  try {
    const resp = await getJson("/api/dev/accounts");
    state.devAccounts = Array.isArray(resp.accounts) ? resp.accounts : [];
  } catch {
    state.devAccounts = [];
  } finally {
    state.devAccountsLoading = false;
    if (state.view === "auth") render();
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
  if (mode === "reset-request") {
    state.resetRequest = { status: "form", error: null };
  }
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

function expiryUrgencyClass(remaining) {
  if (remaining == null) return "";
  if (remaining <= 0) return "expired";
  if (remaining <= 10) return "critical";
  if (remaining <= 30) return "low";
  return "";
}

function renderExpiryChip(challenge, variant = "inline") {
  const remaining = challengeSecondsRemaining(challenge);
  if (remaining == null) return "";
  const urgency = expiryUrgencyClass(remaining);
  const text = remaining > 0 ? `${remaining}s` : "expired";
  const verb = variant === "wager" ? "Accept in" : "auto-decline";
  const base = Date.parse(challenge.updatedAt || challenge.createdAt);
  const seconds = challenge.expiresInSeconds ?? 0;
  return `
    <span class="expiry-chip expiry-${variant} ${urgency}" data-expiry-base="${base}" data-expiry-seconds="${seconds}">
      <span class="expiry-icon" aria-hidden="true">⏱</span>
      <span class="expiry-verb">${escapeHtml(verb)}</span>
      <strong class="expiry-time mono tnum" data-expiry-time>${escapeHtml(text)}</strong>
    </span>
  `;
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
    // Targeted updates only — a full render() every second would blow
    // away the onboarding modal's focused input. See updateExpiryCountdownsDom.
    state.challengeCountdownTimer = setInterval(updateExpiryCountdownsDom, 1000);
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
      deltaCents,
      id: opp.id,
      trustTier: opp.trustTier
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

function scoutTrigger(user, innerHtml, className = "") {
  if (!user?.id || user.id === viewerId()) return innerHtml;
  return `
    <span class="scout-trigger ${escapeHtml(className)}" role="button" tabindex="0"
      data-open-scout="${escapeHtml(user.id)}">
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
    anchor: null
  };
  if (shouldRender) render();
}

function scoutAnchorFor(element) {
  const rect = element.getBoundingClientRect();
  // Clamp width to viewport so the popover fits on 320-class phones; the
  // mobile sheet variant in styles.css overrides positioning entirely under
  // 720px, but this still guards desktop browsers resized narrow.
  const width = Math.min(340, window.innerWidth - 24);
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
    anchor: scoutAnchorFor(element)
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

async function loadWagerOpponent() {
  const opponentId = state.activeChallenge?.opponent?.id;
  if (!opponentId) {
    state.wagerOpponent = null;
    state.wagerOpponentLoading = false;
    return;
  }
  if (state.wagerOpponent?.id === opponentId) return;
  state.wagerOpponent = null;
  state.wagerOpponentLoading = true;
  try {
    const resp = await getJson(`/api/users/${encodeURIComponent(opponentId)}`);
    if (state.activeChallenge?.opponent?.id !== opponentId) return;
    state.wagerOpponent = resp.user;
  } catch (error) {
    if (authGuard(error)) return;
  } finally {
    state.wagerOpponentLoading = false;
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
    case "spectators.changed": {
      if (!state.activeGame || msg.gameId !== state.activeGame.id) return;
      state.activeGame.watcherCount = msg.watcherCount ?? 0;
      if (state.route === "game") updateWatcherChipDom();
      return;
    }
    case "milestone.unlocked": {
      if (!msg.milestone) return;
      enqueueMilestone(msg.milestone);
      return;
    }
    case "game.finalized": {
      const id = msg.gameId || msg.game?.id;
      if (!id) return;
      if (!state.activeGame || state.activeGame.id !== id) return;
      if (!viewerPlayer(state.activeGame)) {
        if (msg.game) setActiveGame(msg.game);
        if (state.route === "game") render();
        return;
      }
      try {
        await loadFinalizedGame(id);
        render();
      } catch (error) {
        console.warn("failed to load settlement after finalize", error);
      }
      return;
    }
    case "lobby.heartbeat": {
      if (!state.bootstrap?.lobby) return;
      const before = state.bootstrap.lobby;
      const countsChanged = before.onlineCount !== msg.onlineCount || before.activeGames !== msg.activeGames;
      const liveGamesChanged = Array.isArray(msg.liveGames)
        && JSON.stringify(before.liveGames) !== JSON.stringify(msg.liveGames);
      if (!countsChanged && !liveGamesChanged) return;
      state.bootstrap.lobby = {
        ...before,
        onlineCount: msg.onlineCount ?? before.onlineCount,
        activeGames: msg.activeGames ?? before.activeGames,
        liveGames: Array.isArray(msg.liveGames) ? msg.liveGames : before.liveGames
      };
      if (countsChanged) updateHeartbeatDom();
      if (liveGamesChanged) updateLiveGamesFeedDom();
      return;
    }
    case "notification.created": {
      applyNotificationEvent(msg.notification, true);
      return;
    }
    case "notification.updated": {
      applyNotificationEvent(msg.notification, false);
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
        // Avoid blowing away the DOM (and any focused input — e.g., the
        // lichess link modal on Profile) on routes that don't render
        // challenge rails. Bots create challenges every couple seconds in
        // bustling mode; only Play and Wager actually depend on this data.
        if (state.route === "play") {
          updatePlayChallengeRailsDom();
          return;
        }
        if (state.route === "wager") {
          render();
        }
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
    await loadFinalizedGame(state.activeGame.id, {
      game: payload.game,
      settlement: payload.settlement
    });
    render();
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
    state.resignConfirmOpen = false;
    await loadFinalizedGame(gameId, {
      game: payload.game,
      settlement: payload.settlement
    });
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
      await loadFinalizedGame(gameId, {
        game: payload.game,
        settlement: payload.settlement
      });
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
    const payload = await postJson(`/api/challenges/${challengeId}/${action}`);
    state.activeChallenge = payload.challenge;
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    if (payload.game) setActiveGame(payload.game);
    const wallet = await getJson("/api/wallet");
    state.bootstrap.viewer = wallet.viewer;
    state.walletLedger = wallet.ledger;
    if (action === "accept") navigate("game");
    if (action === "decline") {
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

function openCounter() {
  const c = state.activeChallenge;
  if (!c) return;
  state.picker.counter = { stakeCents: c.stakeCents, timeControl: c.timeControl };
  state.wagerCounter = { open: true };
  state.actionError = null;
  render();
}

function closeCounter() {
  state.wagerCounter = { open: false };
  state.actionError = null;
  render();
}

async function submitCounter() {
  const c = state.activeChallenge;
  if (!c) return;
  const pick = state.picker.counter;
  if (!pick.stakeCents || !pick.timeControl) return;
  if (pick.stakeCents === c.stakeCents && pick.timeControl === c.timeControl) return;
  const key = `${c.id}:counter`;
  if (actionInFlight("challenge", key)) return;
  state.actionError = null;
  setActionInFlight("challenge", key, true);
  render();
  try {
    const payload = await postJson(`/api/challenges/${c.id}/counter`, {
      stakeCents: pick.stakeCents,
      timeControl: pick.timeControl
    });
    state.activeChallenge = payload.challenge;
    state.wagerCounter = { open: false };
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
    render();
  } finally {
    setActionInFlight("challenge", key, false);
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

async function joinQuickMatch({ stakeCents, timeControl, tierPref }) {
  if (actionInFlight("quick-match")) return;
  state.actionError = null;
  setActionInFlight("quick-match", "", true);
  render();
  try {
    const payload = await postJson("/api/matchmaking/quick", {
      stakeCents,
      timeControl,
      tierPref: tierPref || state.matchTierPref || "any"
    });
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

async function equipAvatar(avatarId) {
  if (!avatarId || actionInFlight("avatar-equip", avatarId)) return;
  state.accountError = null;
  state.accountNotice = null;
  setActionInFlight("avatar-equip", avatarId, true);
  render();
  try {
    const payload = await postJson("/api/avatars/equip", { avatarId });
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    state.accountNotice = `Equipped ${avatarId}.`;
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("avatar-equip", avatarId, false);
    if (state.view === "app") render();
  }
}

async function purchaseAvatar(avatarId) {
  if (!avatarId || actionInFlight("avatar-purchase", avatarId)) return;
  state.accountError = null;
  state.accountNotice = null;
  setActionInFlight("avatar-purchase", avatarId, true);
  render();
  try {
    const payload = await postJson("/api/avatars/purchase", { avatarId });
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    state.accountNotice = `Unlocked ${avatarId}.`;
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("avatar-purchase", avatarId, false);
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

async function linkExternalAccount({ provider, username, source = "settings" }) {
  if (actionInFlight("external-link")) return;
  state.accountError = null;
  state.accountNotice = null;
  state.onboardingError = null;
  setActionInFlight("external-link", "", true);
  render();
  try {
    const payload = await postJson("/api/external-accounts", { provider, username });
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    const seedNote = payload.seededTo
      ? ` Rating seeded to ${payload.seededTo}.`
      : "";
    if (source === "settings") {
      state.accountNotice = `Linked ${formatProvider(provider)} @${payload.externalAccount.username}.${seedNote}`;
    }
    render();
  } catch (error) {
    if (authGuard(error)) return;
    if (source === "onboarding") state.onboardingError = error.message;
    else state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("external-link", "", false);
    if (state.view === "app") render();
  }
}

async function startVerification(accountId, { regenerate = false } = {}) {
  if (!accountId || actionInFlight("verify-start", accountId)) return;
  state.accountError = null;
  state.accountNotice = null;
  if (!regenerate) state.verifying = { accountId, claimToken: null, expiresAt: null, error: null };
  setActionInFlight("verify-start", accountId, true);
  render();
  try {
    const payload = await postJson(
      `/api/external-accounts/${encodeURIComponent(accountId)}/verify/start`,
      { regenerate }
    );
    state.verifying = {
      accountId,
      claimToken: payload.claimToken,
      expiresAt: payload.claimTokenExpiresAt,
      error: null
    };
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.verifying = { accountId: null, claimToken: null, expiresAt: null, error: null };
    state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("verify-start", accountId, false);
    if (state.view === "app") render();
  }
}

async function checkVerification(accountId) {
  if (!accountId || actionInFlight("verify-check", accountId)) return;
  state.verifying.error = null;
  setActionInFlight("verify-check", accountId, true);
  render();
  try {
    const payload = await postJson(`/api/external-accounts/${encodeURIComponent(accountId)}/verify/check`);
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    const seedNote = payload.seededTo ? ` Rating updated to ${payload.seededTo}.` : "";
    state.accountNotice = `Verified ${formatProvider(payload.externalAccount.provider)} @${payload.externalAccount.username}.${seedNote}`;
    state.verifying = { accountId: null, claimToken: null, expiresAt: null, error: null };
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.verifying.error = error.message;
    render();
  } finally {
    setActionInFlight("verify-check", accountId, false);
    if (state.view === "app") render();
  }
}

function cancelVerification() {
  state.verifying = { accountId: null, claimToken: null, expiresAt: null, error: null };
  render();
}

async function skipOnboarding() {
  if (actionInFlight("onboarding-skip")) return;
  state.onboardingError = null;
  setActionInFlight("onboarding-skip", "", true);
  render();
  try {
    const payload = await postJson("/api/auth/onboarding/complete");
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.onboardingError = error.message;
    render();
  } finally {
    setActionInFlight("onboarding-skip", "", false);
    if (state.view === "app") render();
  }
}

async function unlinkExternalAccount(accountId) {
  if (!accountId || actionInFlight("external-unlink", accountId)) return;
  state.accountError = null;
  state.accountNotice = null;
  setActionInFlight("external-unlink", accountId, true);
  render();
  try {
    const payload = await postJson(`/api/external-accounts/${encodeURIComponent(accountId)}`, {}, "DELETE");
    if (payload.viewer) state.bootstrap.viewer = payload.viewer;
    state.accountNotice = "Linked account removed.";
    render();
  } catch (error) {
    if (authGuard(error)) return;
    state.accountError = error.message;
    render();
  } finally {
    setActionInFlight("external-unlink", accountId, false);
    if (state.view === "app") render();
  }
}

function formatProvider(provider) {
  return provider === "lichess" ? "Lichess" : provider === "chesscom" ? "Chess.com" : provider;
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
  } else if (state.route === "game" && state.routeParam) {
    state.gameError = null;
    state.activeSettlement = null;
    state.replay = null;
    try {
      const resp = await getJson(`/api/games/${encodeURIComponent(state.routeParam)}`);
      setActiveGame(resp.game);
    } catch (error) {
      if (authGuard(error)) return;
      state.gameError = error.message;
    }
  } else if (state.route === "profile") {
    try {
      const [wallet, avatars] = await Promise.all([
        getJson("/api/wallet"),
        getJson("/api/avatars")
      ]);
      state.walletLedger = wallet.ledger;
      if (state.bootstrap) state.bootstrap.viewer = wallet.viewer;
      state.avatarCatalog = avatars.catalog;
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
  } else if (state.route === "wager") {
    loadWagerOpponent();
  } else if (state.route === "admin") {
    const viewer = state.bootstrap?.viewer;
    if (viewer?.isAdmin) {
      await loadAdminData(state.adminTab || "users");
    }
  }

  if (state.route !== "wager") {
    state.wagerOpponent = null;
    state.wagerOpponentLoading = false;
    state.wagerCounter = { open: false };
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
  if (state.cashierOpen) {
    event.preventDefault();
    state.cashierOpen = false;
    state.cashierError = null;
    render();
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

document.addEventListener("click", (event) => {
  if (!state.notifications?.dropdownOpen) return;
  const target = event.target;
  if (target.closest?.(".bell-wrap")) return;
  state.notifications.dropdownOpen = false;
  render();
});

// Initialize the WebAudio context on the first user gesture. The browser
// blocks audio playback until a user gesture has occurred; this captures
// the first click and resumes/creates the context for subsequent
// playSound calls. Idempotent — safe to call on every click.
document.addEventListener("click", () => initSound(), { capture: true });
document.addEventListener("keydown", () => initSound(), { capture: true });

// === Board drag (unified pointer events) ===================================
// Mouse and touch share one code path here. Native HTML5 DnD doesn't fire on
// iOS Safari, so we drive everything from pointerdown/move/up. A tap that
// never moves past DRAG_THRESHOLD pixels falls through to the regular `click`
// handler (handleSquareIntent); a drag short-circuits clicks via the
// `boardDrag.moved` flag. Touch drags lift the ghost piece above the finger
// so the source square stays visible. See docs/MOBILE_NEXT_PASS.md.
const DRAG_THRESHOLD = 6;
const DRAG_TOUCH_LIFT = 44;
let boardDrag = null;
// Set briefly after a drag that committed a move so the trailing `click`
// event the browser fires on pointerup doesn't double-route through
// handleSquareIntent. Cleared on the next animation frame.
let suppressBoardClickUntil = 0;

function squareAtPoint(x, y) {
  const el = typeof document.elementFromPoint === "function"
    ? document.elementFromPoint(x, y)
    : null;
  return el?.closest?.("[data-square]")?.dataset.square || null;
}

function highlightDragTarget(square) {
  for (const n of document.querySelectorAll(".drop-ready")) {
    n.classList.remove("drop-ready");
  }
  if (!square || !boardDrag) return;
  if (legalMoveFor(boardDrag.from, square)) {
    document.querySelector(`[data-square="${square}"]`)?.classList.add("drop-ready");
  }
}

function cleanupBoardDrag() {
  for (const n of document.querySelectorAll(".drop-ready, .dragging")) {
    n.classList.remove("drop-ready", "dragging");
  }
  if (boardDrag?.ghost) {
    boardDrag.ghost.remove();
    boardDrag.ghost = null;
  }
}

document.addEventListener("pointermove", (event) => {
  if (!boardDrag || event.pointerId !== boardDrag.pointerId) return;
  const dx = event.clientX - boardDrag.startX;
  const dy = event.clientY - boardDrag.startY;
  if (!boardDrag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  if (!boardDrag.moved) {
    boardDrag.moved = true;
    state.dragFromSquare = boardDrag.from;
    state.selectedSquare = boardDrag.from;
    state.gameError = null;
    try {
      boardDrag.sourceEl.setPointerCapture(boardDrag.pointerId);
    } catch (_) { /* element may have re-rendered; tolerate */ }
    boardDrag.sourceEl.classList.add("dragging");
    const piece = boardDrag.sourceEl.querySelector(".piece");
    if (piece) {
      const rect = piece.getBoundingClientRect();
      const ghost = piece.cloneNode(true);
      ghost.classList.add("piece-ghost");
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      boardDrag.ghost = ghost;
    }
  }
  const lift = event.pointerType === "touch" ? DRAG_TOUCH_LIFT : 0;
  if (boardDrag.ghost) {
    boardDrag.ghost.style.transform =
      `translate(${event.clientX}px, ${event.clientY - lift}px) translate(-50%, -50%)`;
  }
  highlightDragTarget(squareAtPoint(event.clientX, event.clientY - lift));
  // Suppress page scroll once we've committed to a drag on touch.
  if (event.cancelable && event.pointerType === "touch") event.preventDefault();
}, { passive: false });

document.addEventListener("pointerup", (event) => {
  if (!boardDrag || event.pointerId !== boardDrag.pointerId) return;
  if (!boardDrag.moved) {
    // Pure tap — let the existing click handler resolve via handleSquareIntent.
    boardDrag = null;
    return;
  }
  const lift = event.pointerType === "touch" ? DRAG_TOUCH_LIFT : 0;
  const target = squareAtPoint(event.clientX, event.clientY - lift);
  const from = boardDrag.from;
  cleanupBoardDrag();
  // Browsers fire `click` on pointerup; without this the click would route
  // through handleSquareIntent and try to re-interpret the gesture as a tap.
  suppressBoardClickUntil = performance.now() + 400;
  if (target && legalMoveFor(from, target)) {
    boardDrag = null;
    queueOrSubmitMove(from, target);
  } else {
    state.dragFromSquare = null;
    boardDrag = null;
    render();
  }
});

document.addEventListener("pointercancel", (event) => {
  if (!boardDrag || event.pointerId !== boardDrag.pointerId) return;
  const wasMoved = boardDrag.moved;
  cleanupBoardDrag();
  state.dragFromSquare = null;
  boardDrag = null;
  if (wasMoved) render();
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
        ${viewer.isAdmin ? navLink("admin", "Admin") : ""}
      </nav>
      <div class="topbar-actions">
        ${connectionPill()}
        ${renderSoundToggle()}
        ${renderBell()}
        ${liveGame ? `<a class="resume-pill" href="#game"><span class="dot"></span>Resume game</a>` : ""}
        <a class="wallet-pill" href="#profile" title="Wallet detail in Profile">
          <span>${money(viewer.balanceCents)}</span>
          <small>${money(viewer.escrowCents)} escrow</small>
        </a>
        <button class="cashier-btn" type="button" data-cashier-open title="Cashier" aria-label="Open cashier">+</button>
        <div class="viewer-id">
          <small>signed in as <strong>${escapeHtml(viewer.handle)}</strong></small>
          <button class="link" data-logout>Log out</button>
        </div>
      </div>
    </header>
    ${renderVerifyBanner(viewer)}
    <main>${content}</main>
    ${renderTabBar()}
    ${renderMilestoneStack()}
    ${renderScoutPopover()}
    ${resignConfirmDialog()}
    ${renderOnboardingModal()}
    ${renderTosModal()}
    ${renderCashierModal()}
  `;
}

function renderVerifyBanner(viewer) {
  if (!viewer || viewer.emailVerifiedAt) return "";
  const banner = state.verifyBanner || { sending: false, sent: false, error: null };
  let action;
  if (banner.sent) {
    action = `<span class="verify-banner-status">Sent — check your inbox.</span>`;
  } else if (banner.sending) {
    action = `<button type="button" class="link" disabled>Sending…</button>`;
  } else {
    action = `<button type="button" class="link" data-resend-verify>Resend verification email</button>`;
  }
  return `
    <div class="verify-banner" role="status">
      <strong>Verify your email.</strong>
      <span>We sent a link to ${escapeHtml(viewer.email)}. Click it to keep your account active for future real-money features.</span>
      ${action}
      ${banner.error ? `<em class="verify-banner-error">${escapeHtml(banner.error)}</em>` : ""}
    </div>
  `;
}

// === Milestone overlays ===
// See docs/MILESTONES_NEXT_PASS.md for the intensity tier system.
// Tier 1 = toast (top-right chip, 2s)
// Tier 2 = callout (banner, 3s)
// Tier 3 = burst (callout + contained chip-burst on the settlement card, 1.2s pre-burst then dismisses)
//
// Multiple concurrent unlocks stack — we render the most recent on top,
// each with its own auto-dismiss timer. Click to dismiss.
const MILESTONE_DURATIONS = { 1: 2200, 2: 3200, 3: 3600 };

function enqueueMilestone(milestone) {
  if (!milestone) return;
  state.milestones = [...state.milestones, milestone];
  render();
  playMilestoneSound(milestone.tier);
  const dur = MILESTONE_DURATIONS[milestone.tier] ?? 2500;
  setTimeout(() => dismissMilestone(milestone.id), dur);
}

function dismissMilestone(id) {
  const before = state.milestones.length;
  state.milestones = state.milestones.filter((m) => m.id !== id);
  if (state.milestones.length !== before) render();
}

function milestoneCopy(milestone) {
  const md = milestone.metadata ?? {};
  switch (milestone.eventKey) {
    case "first_win":
      return { eyebrow: "First win", headline: "You took your first pot." };
    case "win_streak_3":
      return { eyebrow: "3 in a row", headline: "Streak: three straight wins." };
    case "win_streak_5":
      return { eyebrow: "5 in a row", headline: "Five-win heater." };
    case "win_streak_7":
      return { eyebrow: "7 in a row", headline: "Seven wins on the bounce." };
    case "win_streak_10":
      return { eyebrow: "10 in a row", headline: "Ten straight. The room is watching." };
    case "win_streak_15":
      return { eyebrow: "15 in a row", headline: "Fifteen. Untouchable run." };
    default:
      return { eyebrow: milestone.eventKey, headline: `Unlocked — ${milestone.eventKey} (streak ${md.streak ?? ""})` };
  }
}

function renderMilestoneStack() {
  if (!state.milestones?.length) return "";
  const items = state.milestones.map((m) => renderMilestoneCard(m)).join("");
  return `<div class="milestone-stack" data-milestone-stack>${items}</div>`;
}

function renderMilestoneCard(milestone) {
  const tier = milestone.tier ?? 1;
  const copy = milestoneCopy(milestone);
  const burst = tier >= 3 ? `<div class="milestone-burst" aria-hidden="true">${
    Array.from({ length: 6 }, (_, i) => `<span class="milestone-burst-chip" data-i="${i}"></span>`).join("")
  }</div>` : "";
  return `
    <button type="button"
      class="milestone-card milestone-tier-${tier}"
      data-milestone-dismiss="${escapeHtml(milestone.id)}"
      aria-label="Milestone — ${escapeHtml(copy.headline)}. Click to dismiss.">
      ${burst}
      <span class="milestone-eyebrow">${escapeHtml(copy.eyebrow)}</span>
      <span class="milestone-headline">${escapeHtml(copy.headline)}</span>
    </button>
  `;
}

// Sound-mode toggle in the topbar. Cycles full → essentials → mute on
// click. See docs/SOUNDSCAPE_NEXT_PASS.md § Reduced sensory intensity.
function renderBell() {
  const n = state.notifications || { unreadCount: 0, recent: [], dropdownOpen: false };
  const count = n.unreadCount || 0;
  const badge = count > 0 ? `<span class="bell-badge">${count > 99 ? "99+" : count}</span>` : "";
  const dropdown = n.dropdownOpen ? renderBellDropdown(n.recent) : "";
  return `
    <div class="bell-wrap">
      <button class="bell" data-bell-toggle title="Notifications" aria-label="Notifications (${count} unread)">
        🔔${badge}
      </button>
      ${dropdown}
    </div>
  `;
}

function renderBellDropdown(items) {
  if (!items.length) {
    return `<div class="bell-dropdown">
      <header><strong>Notifications</strong></header>
      <p class="muted small">No notifications yet.</p>
    </div>`;
  }
  const rows = items.slice(0, 12).map(notificationRow).join("");
  const readAllDisabled = (state.notifications?.unreadCount ?? 0) === 0;
  return `
    <div class="bell-dropdown">
      <header>
        <strong>Notifications</strong>
        <button class="link" data-notifications-read-all ${readAllDisabled ? "disabled" : ""}>Mark all read</button>
      </header>
      <ul class="notification-list">${rows}</ul>
    </div>
  `;
}

function notificationRow(n) {
  const route = n.data?.route ? `#${escapeHtml(n.data.route)}` : "#play";
  const unreadCls = n.readAt ? "" : "unread";
  const statusCls = `status-${escapeHtml(n.status || "pending")}`;
  return `
    <li class="notification-item ${unreadCls} ${statusCls}">
      <a href="${route}" data-notification-link data-notification-id="${escapeHtml(n.id)}">
        <div class="notification-title">${escapeHtml(n.title)}</div>
        <div class="notification-meta">
          <span class="notification-status">${escapeHtml(n.status)}</span>
          <span class="notification-time muted small">${formatRelativeTimestamp(n.updatedAt)}</span>
        </div>
      </a>
    </li>
  `;
}

function formatRelativeTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function toggleBellDropdown() {
  if (!state.notifications) state.notifications = { unreadCount: 0, recent: [], dropdownOpen: false };
  state.notifications.dropdownOpen = !state.notifications.dropdownOpen;
  render();
}

async function markNotificationRead(id) {
  if (!state.notifications) return;
  const row = state.notifications.recent.find((n) => n.id === id);
  if (row && !row.readAt) {
    row.readAt = new Date().toISOString();
    state.notifications.unreadCount = Math.max(0, state.notifications.unreadCount - 1);
    render();
  }
  try {
    await postJson(`/api/notifications/${encodeURIComponent(id)}/read`);
  } catch (error) {
    if (authGuard(error)) return;
  }
}

async function markAllNotificationsRead() {
  if (!state.notifications) return;
  for (const n of state.notifications.recent) {
    if (!n.readAt) n.readAt = new Date().toISOString();
  }
  state.notifications.unreadCount = 0;
  render();
  try {
    await postJson("/api/notifications/read-all");
  } catch (error) {
    if (authGuard(error)) return;
  }
}

function applyNotificationEvent(notification, isCreated) {
  if (!notification) return;
  if (!state.notifications) {
    state.notifications = { unreadCount: 0, recent: [], dropdownOpen: false };
  }
  const list = state.notifications.recent;
  const idx = list.findIndex((n) => n.id === notification.id);
  const wasUnread = idx >= 0 ? !list[idx].readAt : false;
  const nowUnread = !notification.readAt;
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(notification);
  if (list.length > 20) list.length = 20;
  // Recompute unread count: easiest correct way is to ask the server, but
  // for the common case we can derive locally — server is the source of
  // truth on reload.
  if (isCreated && nowUnread) {
    state.notifications.unreadCount += 1;
  } else if (idx >= 0) {
    // Update: row may have flipped unread state.
    if (!wasUnread && nowUnread) state.notifications.unreadCount += 1;
    else if (wasUnread && !nowUnread) {
      state.notifications.unreadCount = Math.max(0, state.notifications.unreadCount - 1);
    }
  }
  if (isCreated && nowUnread) {
    playSound("notification_arrived");
  }
  // If the bell isn't open we still want the badge to update — render does
  // both. Cost is low (small DOM) and avoids a stale topbar.
  render();
}

// Mobile-only "Session" panel on Profile. On mobile the topbar drops the
// connection pill, sound toggle, and "signed in as" — those still need a home,
// and Profile is where the wallet detail already lives. Hidden via CSS on
// desktop (where the topbar still carries the same controls).
function renderProfileSessionCard() {
  const viewer = state.bootstrap?.viewer;
  if (!viewer) return "";
  const m = getSoundMode();
  const nextMode = m === "full" ? "essentials" : m === "essentials" ? "mute" : "full";
  const soundLabel = m === "full"
    ? "Sound: full"
    : m === "essentials"
      ? "Sound: essentials only"
      : "Sound: muted";
  const soundCta = m === "full"
    ? "Switch to essentials"
    : m === "essentials"
      ? "Mute"
      : "Enable full sound";
  return `
    <article class="card mobile-only profile-session-card">
      <h2>Session</h2>
      <div class="profile-session-row">
        <div>
          <small class="muted">Signed in as</small>
          <strong>${escapeHtml(viewer.handle)}</strong>
        </div>
        <button type="button" data-logout>Sign out</button>
      </div>
      <div class="profile-session-row">
        <div>
          <small class="muted">${escapeHtml(soundLabel)}</small>
        </div>
        <button type="button" data-sound-mode="${escapeHtml(nextMode)}">${escapeHtml(soundCta)}</button>
      </div>
    </article>
  `;
}

function renderSoundToggle() {
  const m = getSoundMode();
  const next = m === "full" ? "essentials" : m === "essentials" ? "mute" : "full";
  const label = m === "full" ? "🔊" : m === "essentials" ? "🔉" : "🔇";
  const title = m === "full"
    ? "Sound: full. Click for essentials only."
    : m === "essentials"
      ? "Sound: essentials only (settlement, milestones). Click to mute."
      : "Sound: muted. Click to enable.";
  return `<button class="sound-toggle" data-sound-mode="${escapeHtml(next)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${label}</button>`;
}

function shouldShowOnboardingModal() {
  const viewer = state.bootstrap?.viewer;
  if (!viewer) return false;
  if (viewer.onboardingCompletedAt) return false;
  // Don't stack modals: ToS re-acceptance takes priority over onboarding.
  if (shouldShowTosModal()) return false;
  return state.route === "play";
}

function shouldShowTosModal() {
  const viewer = state.bootstrap?.viewer;
  if (!viewer) return false;
  // Show only when an *existing* user needs to re-accept a bumped version.
  // Fresh signups have already accepted via the signup form.
  return viewer.tos?.needsAcceptance === true;
}

function renderTosModal() {
  if (!shouldShowTosModal() && !state.tosViewerOpen) return "";
  const tos = state.tosBody || null;
  const busy = actionInFlight("tos-accept");
  const isReadOnly = !shouldShowTosModal();
  const sections = tos
    ? tos.sections.map((s) => `
      <section class="tos-section">
        <h4>${escapeHtml(s.heading)}</h4>
        <p>${escapeHtml(s.body)}</p>
      </section>
    `).join("")
    : `<p class="muted">Loading…</p>`;
  return `
    <div class="modal-backdrop tos-backdrop" role="presentation">
      <section class="card tos-modal" role="dialog" aria-modal="true" aria-labelledby="tos-title">
        <h2 id="tos-title">${escapeHtml(tos?.title || "Horsey Terms")}</h2>
        <p class="muted small">Version ${tos?.version ?? TOS_VERSION}.</p>
        <div class="tos-body">${sections}</div>
        <div class="tos-actions">
          ${isReadOnly
            ? `<button type="button" class="primary" data-tos-close>Close</button>`
            : `
              <button type="button" class="primary" data-tos-accept ${busy ? "disabled" : ""}>
                ${busy ? "Saving…" : "I have read and accept"}
              </button>
              <button type="button" class="link" data-logout>Log out</button>
            `}
        </div>
      </section>
    </div>
  `;
}

async function loadTosBody() {
  if (state.tosBody) return;
  try {
    state.tosBody = await getJson("/api/tos");
    render();
  } catch (error) {
    if (authGuard(error)) return;
  }
}

async function acceptTos() {
  setActionInFlight("tos-accept", true);
  render();
  try {
    const version = state.tosBody?.version || TOS_VERSION;
    const resp = await postJson("/api/tos/accept", { tosVersion: version });
    if (state.bootstrap) state.bootstrap.viewer = resp.viewer;
    state.tosViewerOpen = false;
  } catch (error) {
    if (authGuard(error)) return;
    state.actionError = error.message;
  } finally {
    setActionInFlight("tos-accept", false);
    render();
  }
}

function renderOnboardingModal() {
  if (!shouldShowOnboardingModal()) return "";
  const linkBusy = actionInFlight("external-link");
  const skipBusy = actionInFlight("onboarding-skip");
  return `
    <div class="modal-backdrop onboarding-backdrop" role="presentation">
      <section class="card onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <span class="picker-label">Welcome to Horsey</span>
        <h1 id="onboarding-title">Link a chess account to start calibrated.</h1>
        <p class="muted">We'll fetch your public Lichess or Chess.com stats and seed your starting rating from your blitz strength. Optional — you can skip and play right away.</p>
        <form class="stack" data-onboarding-link>
          <label>Provider
            <select name="provider">
              <option value="lichess">Lichess</option>
              <option value="chesscom">Chess.com</option>
            </select>
          </label>
          <label>Handle
            <input name="username" type="text" autocomplete="off" minlength="2" maxlength="30" required autofocus />
            <small class="muted">No password needed — public data only.</small>
          </label>
          ${state.onboardingError ? `<em class="account-error">${escapeHtml(state.onboardingError)}</em>` : ""}
          <div class="onboarding-actions">
            <button type="submit" class="primary" ${linkBusy || skipBusy ? "disabled" : ""}>
              ${linkBusy ? "Linking..." : "Link account"}
            </button>
            <button type="button" class="link" data-onboarding-skip ${linkBusy || skipBusy ? "disabled" : ""}>
              ${skipBusy ? "Skipping..." : "Skip for now"}
            </button>
          </div>
          <p class="muted small">You can link any time from Profile → Linked chess accounts.</p>
        </form>
      </section>
    </div>
  `;
}

function navLink(id, label) {
  const active = state.route === id ? "active" : "";
  return `<a class="${active}" href="#${id}">${label}</a>`;
}

// Mobile bottom tab bar. Renders the same destinations as the topbar nav so
// the two stay in lockstep; CSS toggles which one is visible based on the
// 720px breakpoint (see styles.css § Mobile tab bar). Admin appears only for
// admin viewers, matching the topbar.
function renderTabBar() {
  const viewer = state.bootstrap?.viewer;
  if (!viewer) return "";
  const tab = (id, label, glyph) => {
    const active = state.route === id ? "active" : "";
    return `<a class="tabbar-link ${active}" href="#${id}" aria-label="${escapeHtml(label)}">
      <span class="tabbar-glyph" aria-hidden="true">${glyph}</span>
      <span class="tabbar-label">${escapeHtml(label)}</span>
    </a>`;
  };
  return `
    <nav class="tabbar" aria-label="Primary">
      ${tab("play", "Play", "♞")}
      ${tab("history", "History", "≡")}
      ${tab("profile", "Profile", "◐")}
      ${viewer.isAdmin ? tab("admin", "Admin", "★") : ""}
    </nav>
  `;
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

// Reliability label per SCOUTING § 5. Bands are coarse so the published
// signal is "low / moderate / high" not a misleading precise percentage.
function reliabilityLabelForTimeout(rate) {
  if (rate === null || rate === undefined) return null;
  if (rate <= 5) return "low";
  if (rate <= 15) return "moderate";
  return "high";
}

function formatStakeBand(evidence) {
  if (!evidence?.stakeBand) return null;
  const verb = (evidence.stakeBandShare ?? 0) >= 50 ? "mostly" : "often";
  return `${verb} ${evidence.stakeBand} tables`;
}

function formatTimeoutNote(evidence) {
  const label = reliabilityLabelForTimeout(evidence?.timeoutRate);
  return label ? `${label} timeout rate` : null;
}

// One-line evidence summary for the Scout Card's "risk notes" slot. Returns
// null when nothing surfaces, so the slot stays empty rather than misleads.
function scoutEvidenceLine(evidence) {
  if (!evidence) return null;
  const parts = [formatTimeoutNote(evidence), formatStakeBand(evidence)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// Full-profile "Wager profile" block. Skips the whole section when no signal
// has crossed the sample-size threshold — missing block beats a fake one
// (SCOUTING § 3).
function renderProfileWagerEvidence(evidence) {
  const bandLine = formatStakeBand(evidence);
  const biggest = evidence?.biggestPotCents;
  if (!bandLine && !biggest) return "";
  return `
    <div class="profile-section profile-evidence">
      <h3>Wager profile</h3>
      <div class="evidence-grid">
        ${bandLine ? `<div><small>Stake comfort</small><strong>${escapeHtml(bandLine)}</strong></div>` : ""}
        ${biggest ? `<div><small>Biggest pot won</small><strong>${money(biggest)}</strong></div>` : ""}
      </div>
    </div>
  `;
}

// Full-profile "Reliability" block. Disconnect rate intentionally omitted
// per IMPLEMENTATION_PLAN § Trust — disconnect-rate ships only after the
// event-policy slice lands.
function renderProfileReliability(evidence) {
  const label = reliabilityLabelForTimeout(evidence?.timeoutRate);
  if (!label) return "";
  const rate = evidence.timeoutRate;
  return `
    <div class="profile-section profile-evidence">
      <h3>Reliability</h3>
      <div class="evidence-grid">
        <div><small>Timeout rate</small><strong>${escapeHtml(label)} <span class="muted">(${escapeHtml(String(rate))}%)</span></strong></div>
      </div>
    </div>
  `;
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
  const h2hText = h2h
    ? `${h2h.viewerWins}-${h2h.viewerLosses}${h2h.draws ? `-${h2h.draws}` : ""} (${h2h.games})`
    : "No shared games";
  const h2hMoney = h2h?.viewerNetCents ? `<span class="money-win">+${money(h2h.viewerNetCents)}</span>` : "";
  const narrative = scoutNarrative(stats, h2h);
  return `
    <section class="scout-popover" style="${style}" role="dialog" aria-modal="false" aria-label="Scout card">
      <button type="button" class="scout-close" data-close-scout aria-label="Close scout card">×</button>
      <header class="scout-head">
        ${renderAvatar(user, { surface: "scout" })}
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
      ${(() => {
        const line = scoutEvidenceLine(user.evidence);
        return line ? `<p class="scout-evidence muted small">${escapeHtml(line)}</p>` : "";
      })()}
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
        <a class="primary scout-profile-link" href="#user/${escapeHtml(user.id)}">View profile <span aria-hidden="true">-></span></a>
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
    ${renderAvatar(opponent, { surface: "live_table_module" })}
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
  const cap = state.bootstrap?.viewer?.stakeCapCents ?? Infinity;
  return `
    <div class="chip-pick-row" data-stake-picker="${formKey}">
      ${stakes
        .map((s) => {
          const active = s.amountCents === selectedCents;
          const overCap = s.amountCents > cap;
          const stack = stakeChipStack(s.amountCents);
          const chips = stack.map((d) => `<span class="chip d-${d}" aria-hidden="true"></span>`).join("");
          const title = overCap
            ? `Above your trust-tier cap (${money(cap)}). Verify a chess account to raise the limit.`
            : s.label;
          return `
            <button type="button" class="chip-pick ${active ? "active" : ""} ${overCap ? "over-cap" : ""}"
              data-pick-stake="${formKey}" data-stake-cents="${s.amountCents}"
              ${overCap ? "disabled" : ""}
              aria-pressed="${active ? "true" : "false"}" title="${escapeHtml(title)}">
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

const TIER_PREF_OPTIONS = [
  { value: "any", label: "Anyone", hint: "Match the first opponent waiting." },
  { value: "claimed", label: "Linked", hint: "Match only players who linked Lichess or Chess.com." },
  { value: "verified", label: "Verified", hint: "Match only players who proved ownership of a linked account." }
];

function renderTierPrefPicker(selected) {
  const choice = selected || "any";
  return `
    <div>
      <span class="picker-label">Opponent tier</span>
      <div class="tier-pref-row" data-tier-pref-picker>
        ${TIER_PREF_OPTIONS.map((opt) => {
          const active = opt.value === choice;
          return `
            <button type="button"
              class="tier-pref-pill ${active ? "active" : ""}"
              data-pick-tier-pref="${escapeHtml(opt.value)}"
              aria-pressed="${active ? "true" : "false"}"
              title="${escapeHtml(opt.hint)}">
              ${escapeHtml(opt.label)}
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderHeroIdle(lobby) {
  const pick = state.picker.hero;
  const quickBusy = actionInFlight("quick-match");
  const hostBusy = actionInFlight("host-invite");
  const viewer = state.bootstrap.viewer;
  const potCents = previewNetPotCents(pick.stakeCents ?? 0);
  const opponents = recentOpponentsForPlay(4);
  const rematchStrip = opponents.length === 0 ? "" : `
    <div class="hero-rematch-strip">
      <span class="picker-label">Pick up where you left off</span>
      <div class="hero-rematch-row">
        ${opponents.map((o) => {
          // Per project_no_loss_advertising: show positive wins as gold deltas, but
          // never surface a negative number. Loss/draw rows just show time control.
          const secondary = o.deltaCents > 0
            ? `<span class="hero-rematch-delta delta-up mono tnum">+${escapeHtml(money(o.deltaCents))}</span>`
            : `<span class="hero-rematch-delta mono tnum">${escapeHtml(o.timeControl)}</span>`;
          const identity = `
            ${renderAvatar(o, { surface: "dense_row" })}
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
                "hero-rematch-scout"
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
          ${renderAvatar(viewer, { surface: "topnav" })}
          <strong>${escapeHtml(viewer.handle)}</strong>
          ${viewer.rating ? `<span class="hero-identity-rating mono tnum">${escapeHtml(String(viewer.rating))}</span>` : ""}
          ${renderTrustTierChip(viewer)}
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
    ${renderTierPrefPicker(state.matchTierPref)}
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
  const startedAt = Date.parse(ticket.createdAt);
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
        <span class="mono tnum" data-ticket-elapsed="${startedAt}">${formatElapsedShort(elapsed)} elapsed</span>
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

function renderLiveGameRow(game) {
  const players = game.players || [];
  const a = players[0];
  const b = players[1];
  const identity = (p) => {
    if (!p) return "";
    const inner = `
      ${renderAvatar(p, { surface: "dense_row" })}
      <span class="live-feed-handle">${escapeHtml(p.handle ?? "player")}</span>
      ${renderTierPip(p)}
      ${p.rating ? `<span class="live-feed-rating mono tnum">${escapeHtml(String(p.rating))}</span>` : ""}
    `;
    return scoutTrigger(p, inner, "live-feed-scout");
  };
  const kind = timeControlKind(game.timeControl);
  const elapsed = elapsedSecondsSince(game.startedAt);
  const elapsedText = elapsed < 30
    ? "just started"
    : `${formatElapsedShort(elapsed)} elapsed`;
  const termsBits = [money(game.stakeCents)];
  if (game.timeControl) termsBits.push(`${game.timeControl}${kind ? ` ${kind}` : ""}`);
  termsBits.push(elapsedText);
  const watcherCount = game.watcherCount ?? 0;
  const watcherChip = watcherCount > 0
    ? `<span class="watcher-chip" title="${watcherCount} watching">
        <span class="watcher-eye" aria-hidden="true">👁</span>
        <span class="watcher-count mono tnum">${watcherCount}</span>
      </span>`
    : "";
  return `
    <div class="live-feed-row" data-live-game-id="${escapeHtml(game.id)}" data-live-game-started="${escapeHtml(game.startedAt ?? "")}">
      <div class="live-feed-players">
        ${identity(a)}
        <span class="live-feed-vs" aria-hidden="true">vs</span>
        ${identity(b)}
      </div>
      <div class="live-feed-row-bottom">
        <div class="live-feed-meta mono tnum">${escapeHtml(termsBits.join(" · "))}</div>
        <div class="live-feed-row-actions">
          ${watcherChip}
          <button type="button" class="quiet watch-button" data-watch-game="${escapeHtml(game.id)}">Watch</button>
        </div>
      </div>
    </div>
  `;
}

function renderLiveGamesCard(liveGames) {
  const games = liveGames || [];
  return `
    <article class="card live-games-card" data-live-games-card>
      <div class="between">
        <h2><span class="live-feed-dot" aria-hidden="true"></span>Live now</h2>
        <small data-live-games-count>${games.length}</small>
      </div>
      <div data-live-games-feed>
        ${games.length === 0
          ? `<p class="muted small">No tables in play yet. Be the first to start one.</p>`
          : games.map(renderLiveGameRow).join("")}
      </div>
    </article>
  `;
}

function updateLiveGamesFeedDom() {
  if (typeof document === "undefined") return;
  const lobby = state.bootstrap?.lobby;
  if (!lobby) return;
  const card = document.querySelector("[data-live-games-card]");
  if (!card) return;
  const games = lobby.liveGames || [];
  const feed = card.querySelector("[data-live-games-feed]");
  const counter = card.querySelector("[data-live-games-count]");
  if (counter) counter.textContent = String(games.length);
  if (feed) {
    const next = games.length === 0
      ? `<p class="muted small">No tables in play yet. Be the first to start one.</p>`
      : games.map(renderLiveGameRow).join("");
    // Skip the innerHTML swap when nothing changed — otherwise click
    // targets briefly disappear/reappear under the cursor on every tick.
    if (feed.dataset.lastRender !== next) {
      feed.innerHTML = next;
      feed.dataset.lastRender = next;
    }
  }
}

function renderHeartbeatStrip(lobby) {
  const online = Number(lobby.onlineCount ?? 0);
  const active = Number(lobby.activeGames ?? 0);
  return `
    <div class="heartbeat-strip">
      <span class="heartbeat-dot"></span>
      <span class="heartbeat-count"><strong data-heartbeat-online>${online.toLocaleString()}</strong> online</span>
      <span class="heartbeat-sep">·</span>
      <span class="heartbeat-active"><span data-heartbeat-active>${active.toLocaleString()}</span> in active games</span>
    </div>
  `;
}

function updateWatcherChipDom() {
  if (typeof document === "undefined") return;
  const game = state.activeGame;
  if (!game) return;
  const count = Number(game.watcherCount ?? 0);
  document.querySelectorAll("[data-watcher-count]").forEach((node) => {
    node.textContent = String(count);
  });
}

function updateExpiryCountdownsDom() {
  if (typeof document === "undefined") return;
  const now = Date.now();
  const urgencyClasses = ["expired", "critical", "low"];

  // Expiry chips (wager screen + anywhere renderExpiryChip is used).
  document.querySelectorAll("[data-expiry-base]").forEach((node) => {
    const base = Number(node.dataset.expiryBase);
    const seconds = Number(node.dataset.expirySeconds);
    if (!Number.isFinite(base) || !Number.isFinite(seconds) || seconds <= 0) return;
    const remaining = Math.max(0, Math.ceil((base + seconds * 1000 - now) / 1000));
    const timeNode = node.querySelector("[data-expiry-time]");
    if (timeNode) timeNode.textContent = remaining > 0 ? `${remaining}s` : "expired";
    const next = expiryUrgencyClass(remaining);
    for (const c of urgencyClasses) node.classList.remove(c);
    if (next) node.classList.add(next);
  });

  // Inline "Xs left" hints on challenge rows.
  document.querySelectorAll("[data-row-time-hint]").forEach((node) => {
    const base = Number(node.dataset.rowTimeHintBase);
    const seconds = Number(node.dataset.rowTimeHintSeconds);
    if (!Number.isFinite(base) || !Number.isFinite(seconds) || seconds <= 0) return;
    const remaining = Math.max(0, Math.ceil((base + seconds * 1000 - now) / 1000));
    node.textContent = remaining > 0 ? `${remaining}s left` : "expired";
  });

  // Matchmaking queue "Ns elapsed".
  document.querySelectorAll("[data-ticket-elapsed]").forEach((node) => {
    const startedAt = Number(node.dataset.ticketElapsed);
    if (!Number.isFinite(startedAt)) return;
    const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
    node.textContent = `${formatElapsedShort(elapsed)} elapsed`;
  });
}

function updateHeartbeatDom() {
  if (typeof document === "undefined") return;
  const lobby = state.bootstrap?.lobby;
  if (!lobby) return;
  const online = Number(lobby.onlineCount ?? 0);
  const active = Number(lobby.activeGames ?? 0);
  document.querySelectorAll("[data-heartbeat-online]").forEach((node) => {
    node.textContent = online.toLocaleString();
  });
  document.querySelectorAll("[data-heartbeat-active]").forEach((node) => {
    node.textContent = active.toLocaleString();
  });
}

function renderOpenTableRow(challenge) {
  const opponent = challenge.opponent;
  const kind = timeControlKind(challenge.timeControl);
  const termsParts = [money(challenge.stakeCents), challenge.timeControl];
  if (kind) termsParts.push(kind);
  const identity = `
    ${renderAvatar(opponent, { surface: "dense_row" })}
    <span class="open-row-handle">${escapeHtml(opponent?.handle ?? "open seat")}</span>
    ${opponent ? renderTierPip(opponent) : ""}
    ${opponent?.rating ? `<span class="open-row-rating mono tnum">${escapeHtml(String(opponent.rating))}</span>` : ""}
  `;
  return `
    <button class="open-table-row" data-select-challenge="${challenge.id}">
      ${opponent ? scoutTrigger(
        opponent,
        identity,
        "open-row-scout"
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
      <aside class="stack" data-play-rails>
        ${renderHeartbeatStrip(lobby)}
        <div data-incoming-rail>${renderIncomingRail(incomingChallenges)}</div>
        ${renderLiveGamesCard(lobby.liveGames)}
        <article class="card open-tables-card" data-open-tables-card>
          <div class="between"><h2>Open tables</h2><small data-open-tables-count>${openCount}</small></div>
          <div data-open-tables-body>${renderOpenTablesList(openChallenges)}</div>
        </article>
      </aside>
    </section>
  `;
}

function renderIncomingRail(incomingChallenges) {
  if (!incomingChallenges || incomingChallenges.length === 0) return "";
  return `
    <article class="card incoming-card">
      <div class="between"><h2>Incoming</h2><small data-incoming-count>${incomingChallenges.length}</small></div>
      <div data-incoming-body>${incomingChallenges.map(challengeRow).join("")}</div>
    </article>
  `;
}

function updatePlayChallengeRailsDom() {
  if (typeof document === "undefined") return;
  if (state.route !== "play" || !state.bootstrap) return;
  const { lobby, incomingChallenges } = state.bootstrap;
  if (!lobby) return;

  // Incoming card: replace the whole article when transitioning between
  // empty/non-empty; otherwise patch its body + count.
  const incomingRail = document.querySelector("[data-incoming-rail]");
  if (incomingRail) {
    const hadIncomingCard = !!incomingRail.querySelector(".incoming-card");
    const hasIncoming = incomingChallenges.length > 0;
    if (hadIncomingCard !== hasIncoming) {
      incomingRail.innerHTML = renderIncomingRail(incomingChallenges);
      bindPlayRailEventHandlers();
    } else if (hasIncoming) {
      const countNode = incomingRail.querySelector("[data-incoming-count]");
      if (countNode) countNode.textContent = String(incomingChallenges.length);
      const body = incomingRail.querySelector("[data-incoming-body]");
      if (body) {
        const next = incomingChallenges.map(challengeRow).join("");
        if (body.dataset.lastRender !== next) {
          body.innerHTML = next;
          body.dataset.lastRender = next;
          bindPlayRailEventHandlers();
        }
      }
    }
  }

  // Open tables: patch the body + count. Skip when unchanged to keep
  // click targets stable under the cursor.
  const openChallenges = lobby.openChallenges || [];
  const openCount = openChallenges.filter((c) => c.challengerId !== viewerId()).length;
  const countNode = document.querySelector("[data-open-tables-count]");
  if (countNode) countNode.textContent = String(openCount);
  const body = document.querySelector("[data-open-tables-body]");
  if (body) {
    const next = renderOpenTablesList(openChallenges);
    if (body.dataset.lastRender !== next) {
      body.innerHTML = next;
      body.dataset.lastRender = next;
      bindPlayRailEventHandlers();
    }
  }
}

function bindPlayRailEventHandlers() {
  // The only interactive elements inside the rails are the row buttons
  // tagged `data-select-challenge`. Re-attach handlers to anything not
  // yet bound (rebinding is cheap; we mark with `dataset.bound` so a
  // patched row from a prior render isn't double-bound).
  const railRoot = document.querySelector("[data-play-rails]");
  if (!railRoot) return;
  railRoot.querySelectorAll("[data-select-challenge]").forEach((b) => {
    if (b.dataset.bound === "1") return;
    b.dataset.bound = "1";
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
}

function challengeRow(challenge) {
  const opponent = challenge.opponent;
  const isMine = challenge.challengerId === viewerId();
  const label = isMine
    ? (challenge.recipient ? `your invite → ${challenge.recipient.handle}` : "your open invite")
    : `from ${opponent.handle}`;
  const remaining = challengeSecondsRemaining(challenge);
  const base = Date.parse(challenge.updatedAt || challenge.createdAt);
  const seconds = challenge.expiresInSeconds ?? 0;
  const timeHintText = remaining === null
    ? ""
    : remaining > 0
      ? `${remaining}s left`
      : "expired";
  const timeHintSpan = remaining === null
    ? ""
    : ` · <span data-row-time-hint data-row-time-hint-base="${base}" data-row-time-hint-seconds="${seconds}">${escapeHtml(timeHintText)}</span>`;
  const identity = opponent?.id ? `
    <span class="table-row-id">
      ${renderAvatar(opponent, { surface: "dense_row" })}
      <strong>${escapeHtml(label)}</strong>
    </span>
  ` : `<strong>${escapeHtml(label)}</strong>`;
  return `
    <button class="table-row" data-select-challenge="${challenge.id}">
      ${opponent?.id ? scoutTrigger(
        opponent,
        identity,
        "table-row-scout"
      ) : identity}
      <span>${money(challenge.stakeCents)} · ${challenge.timeControl}</span>
      <em>${isMine && !challenge.recipientId ? "yours · " : ""}${escapeHtml(challenge.state)}${timeHintSpan}</em>
      <span>→</span>
    </button>
  `;
}

function renderWagerDossier(opponent, dossier) {
  const identityBlock = `
    <div class="dossier-identity">
      ${renderAvatar(opponent, { surface: "wager" })}
      <div>
        <h2>${escapeHtml(opponent.handle)}</h2>
        ${opponent.rating ? `<p class="muted mono tnum">${escapeHtml(String(opponent.rating))}</p>` : ""}
      </div>
    </div>
  `;
  if (state.wagerOpponentLoading || !dossier) {
    return `
      <article class="card wager-dossier">
        ${scoutTrigger(opponent, identityBlock, "wager-scout")}
        <div class="dossier-skeleton"></div>
        <div class="dossier-skeleton short"></div>
      </article>
    `;
  }
  const stats = dossier.stats ?? {};
  const h2h = dossier.h2hVsViewer;
  const narrative = scoutNarrative(stats, h2h);
  const h2hScore = h2h
    ? `${h2h.viewerWins}-${h2h.viewerLosses}${h2h.draws ? `-${h2h.draws}` : ""}`
    : "No shared games";
  const h2hMoney = h2h?.viewerNetCents ? `<span class="money-win">+${money(h2h.viewerNetCents)}</span>` : "";
  return `
    <article class="card wager-dossier">
      ${scoutTrigger(opponent, identityBlock, "wager-scout")}
      <div class="dossier-reveal">
        <strong class="scout-label">${escapeHtml(narrative.tenure)}</strong>
        <span class="scout-frame">${escapeHtml(narrative.frame)}</span>
      </div>
      ${(() => {
        const line = scoutEvidenceLine(dossier.evidence);
        return line ? `<p class="dossier-evidence muted small">${escapeHtml(line)}</p>` : "";
      })()}
      <div class="dossier-stats">
        <div><small>Win rate</small><strong>${escapeHtml(scoutWinRate(stats))}</strong></div>
        <div><small>Streak</small><strong>${escapeHtml(scoutStreakLabel(stats.currentStreak))}</strong></div>
        <div><small>Joined</small><strong>${escapeHtml(accountAgeLabel(dossier.createdAt))}</strong></div>
      </div>
      <div class="dossier-section">
        <small>Last 10</small>
        <div class="scout-beads">${scoutBeads(stats.last10)}</div>
      </div>
      <div class="dossier-h2h">
        <small>H2H vs you</small>
        <strong>${escapeHtml(h2hScore)} ${h2hMoney}</strong>
        <span>${h2h ? `${h2h.games} shared game${h2h.games === 1 ? "" : "s"}` : "No shared history yet"}</span>
      </div>
    </article>
  `;
}

function renderWager() {
  const challenge = state.activeChallenge;
  if (!challenge) return `<p class="muted">No active challenge. <a href="#play">Pick one.</a></p>`;
  const viewerIsRecipient = viewerId() === challenge.recipientId;
  const viewerIsChallenger = viewerId() === challenge.challengerId;
  const isOpen = !challenge.recipientId;
  const isIncoming = challenge.state === "incoming";
  const isCountered = challenge.state === "countered";
  const expiresRemaining = challengeSecondsRemaining(challenge);
  const isExpired = expiresRemaining === 0;
  const canAct = !isExpired && (
    (isIncoming && (viewerIsRecipient || (isOpen && !viewerIsChallenger))) ||
    (isCountered && viewerIsChallenger)
  );
  const canCounter = !isExpired && isIncoming && viewerIsRecipient && !isOpen;
  const canWithdraw = viewerIsChallenger && (isIncoming || isCountered) && !isExpired;

  const opponent = challenge.opponent;
  const hasNamedOpponent = !!opponent?.id;
  let headline;
  if (isCountered && viewerIsChallenger) {
    headline = `<span class="muted">${escapeHtml(opponent.handle)} countered with</span> ${money(challenge.stakeCents)}`;
  } else if (isCountered && viewerIsRecipient) {
    headline = `<span class="muted">You countered with</span> ${money(challenge.stakeCents)}`;
  } else if (viewerIsChallenger) {
    headline = `<span class="muted">You staked</span> ${money(challenge.stakeCents)}`;
  } else {
    headline = `<span class="muted">${escapeHtml(opponent.handle)} wants</span> ${money(challenge.stakeCents)} <span class="muted">from you.</span>`;
  }

  const dossier = hasNamedOpponent ? renderWagerDossier(opponent, state.wagerOpponent) : "";
  const tcKind = timeControlKind(challenge.timeControl);
  const matchActions = renderWagerActions({
    challenge,
    canAct,
    canCounter,
    canWithdraw,
    isCountered,
    viewerIsChallenger,
    viewerIsRecipient,
    opponent
  });
  const expiryChip = canAct ? renderExpiryChip(challenge, "wager") : "";

  return `
    <section class="grid wager">
      <article class="stack wager-left">
        <div class="wager-headline">
          <div class="wager-headline-row">
            <div class="eyebrow danger">${challenge.state} challenge</div>
            ${expiryChip}
          </div>
          <h1>${headline}</h1>
        </div>
        ${dossier}
      </article>
      <aside class="felt match-card">
        <div class="eyebrow">The match</div>
        <h2>${money(challenge.stakeCents)} each</h2>
        <p>${challenge.timeControl}${tcKind ? ` ${tcKind}` : ""} · ${money(challenge.pot.netPotCents)} pot after ${money(challenge.pot.rakeCents)} rake</p>
        ${matchActions}
        ${state.actionError ? `<em class="action-error">${escapeHtml(state.actionError)}</em>` : ""}
      </aside>
    </section>
  `;
}

function renderWagerActions({ challenge, canAct, canCounter, canWithdraw, isCountered, viewerIsChallenger, viewerIsRecipient, opponent }) {
  if (state.wagerCounter.open) return renderCounterPicker(challenge);

  const accepting = actionInFlight("challenge", `${challenge.id}:accept`);
  const declining = actionInFlight("challenge", `${challenge.id}:decline`);
  const blocks = [];

  if (canAct) {
    blocks.push(`<button class="primary" data-action="accept" ${accepting ? "disabled" : ""}>${accepting ? "Locking..." : `Accept and lock ${money(challenge.stakeCents)}`}</button>`);
    if (canCounter) {
      blocks.push(`<button class="quiet" data-action="counter-open">Counter terms</button>`);
    }
    blocks.push(`<button class="quiet" data-action="decline" ${declining ? "disabled" : ""}>${declining ? "Declining..." : "Decline"}</button>`);
  } else {
    let statusText = "";
    if (challenge.state === "accepted") statusText = "Escrow locked";
    else if (challenge.state === "declined") statusText = "Declined";
    else if (challenge.state === "expired") statusText = "Expired";
    else if (isCountered && viewerIsRecipient) statusText = `You countered — waiting on ${opponent?.handle ?? "them"}`;
    else if (viewerIsChallenger) statusText = challenge.recipientId ? `Awaiting ${opponent?.handle ?? "recipient"}` : "Awaiting any opponent";
    if (statusText) blocks.push(`<div class="match-status">${escapeHtml(statusText)}</div>`);
  }

  if (canWithdraw) {
    blocks.push(`<button class="danger" data-withdraw-challenge>Withdraw invite</button>`);
  }
  return blocks.join("");
}

function renderCounterPicker(challenge) {
  const lobby = state.bootstrap?.lobby;
  if (!lobby) return "";
  const pick = state.picker.counter;
  const unchanged = pick.stakeCents === challenge.stakeCents && pick.timeControl === challenge.timeControl;
  const submitting = actionInFlight("challenge", `${challenge.id}:counter`);
  return `
    <div class="counter-picker">
      <strong class="counter-picker-label">Counter with</strong>
      ${renderStakePicker("counter", lobby.stakes, pick.stakeCents)}
      ${renderTimePicker("counter", lobby.timeControls, pick.timeControl)}
      <div class="counter-picker-actions">
        <button class="primary" data-action="counter-submit" ${unchanged || submitting ? "disabled" : ""}>${submitting ? "Sending..." : "Send counter"}</button>
        <button class="quiet" data-action="counter-cancel">Cancel</button>
      </div>
    </div>
  `;
}

function spectatorSettlementPanel(game) {
  const white = game.players.find((p) => p.color === "white");
  const black = game.players.find((p) => p.color === "black");
  const winner = game.winnerId
    ? game.players.find((p) => p.id === game.winnerId)
    : null;
  const isAborted = game.state === "aborted";
  const isDraw = !isAborted && !game.winnerId;
  const reasonLabel = endReasonLabel(game.endReason);
  const eyebrowClass = isAborted || isDraw ? "muted" : "success";
  const eyebrowText = isAborted
    ? "Aborted · no first move"
    : isDraw
      ? `Settlement · drawn (${reasonLabel.toLowerCase()})`
      : `Settlement · ${reasonLabel.toLowerCase()}`;
  const headline = isAborted
    ? "Table aborted before the first move."
    : isDraw
      ? "The table drew."
      : `${escapeHtml(winner?.handle ?? "Winner")} took the pot.`;
  const pot = game.pot ?? {};
  const grossPot = pot.stakeCents != null ? pot.stakeCents * 2 : null;
  const rc = game.ratingChange;
  const ratingRow = rc
    ? `
      <div>
        <small>${escapeHtml(white?.handle ?? "White")}</small>
        <strong>${formatRatingDelta(rc.whiteDelta)}${rc.whiteAfter != null ? ` <span class="muted">→ ${rc.whiteAfter}</span>` : ""}</strong>
      </div>
      <div>
        <small>${escapeHtml(black?.handle ?? "Black")}</small>
        <strong>${formatRatingDelta(rc.blackDelta)}${rc.blackAfter != null ? ` <span class="muted">→ ${rc.blackAfter}</span>` : ""}</strong>
      </div>
    `
    : "";
  const lastMove = game.lastMove?.san ? `<div><small>Last move</small><strong>${escapeHtml(game.lastMove.san)}</strong></div>` : "";
  const moveCount = game.moves?.length ?? 0;

  return `
    <article class="felt settlement settlement-${isDraw ? "draw" : "win"} game-panel">
      <div class="between">
        <div class="eyebrow ${eyebrowClass}">${escapeHtml(eyebrowText)}</div>
        ${connectionPill()}
      </div>
      <h2>${headline}</h2>
      ${grossPot != null ? `<p>Pot ${money(grossPot)}${pot.rakeCents != null ? ` minus ${money(pot.rakeCents)} fake-money rake` : ""}.</p>` : ""}
      <div class="metric-grid">
        <div><small>Moves</small><strong>${moveCount}</strong></div>
        ${lastMove}
        ${ratingRow}
      </div>
      <div class="settlement-actions">
        <button data-nav="play">Find a table</button>
      </div>
    </article>
  `;
}

function finalizedGameSettlementPanel(game) {
  const settlement = state.activeSettlement;
  if (!settlement || settlement.state !== "finalized") {
    if (!viewerPlayer(game)) return spectatorSettlementPanel(game);
    return `
      <article class="card game-panel live-status">
        <div class="between">
          <h2>Table settled</h2>
          ${connectionPill()}
        </div>
        <p class="muted small">Loading pot settlement...</p>
      </article>
    `;
  }

  const opponentHandle = settlement.rematchChallenge?.opponent || "your opponent";
  const won = settlement.result === "win";
  const drew = settlement.result === "draw";
  const aborted = settlement.result === "aborted";
  const slideMode = aborted ? "draw" : won ? "win" : drew ? "draw" : "loss";
  let eyebrowClass = "danger";
  let eyebrowText = "Settlement · stake taken";
  let headline = `${escapeHtml(opponentHandle)} took the pot.`;
  let amountClass = "money-loss";
  let amountPrefix = "-";
  let amountCents = game?.pot?.stakeCents || 0;

  if (aborted) {
    eyebrowClass = "muted";
    eyebrowText = "Aborted · stake returned";
    headline = "No first move. Stakes returned.";
    amountClass = "money-draw";
    amountPrefix = "";
    amountCents = settlement.creditedCents;
  } else if (won) {
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

  const balanceAfterCents = settlement.balanceAfterCents;
  const stakeCents = game?.pot?.stakeCents ?? 0;
  const balanceBeforeCents = (won || drew || aborted)
    ? balanceAfterCents - (settlement.creditedCents ?? 0)
    : balanceAfterCents + stakeCents;
  const amountTweenAttr = (won || drew || aborted)
    ? `data-amount-tween="${amountCents}" data-amount-prefix="${escapeHtml(amountPrefix)}" data-tween-key="amount:${escapeHtml(game?.id ?? settlement.gameId ?? "")}"`
    : "";
  const firstReveal = isFirstSettlementRenderFor(game?.id);
  const gateClass = firstReveal ? " settlement-rematch-gate" : "";
  const ratingRevealAttr = firstReveal ? " data-rating-reveal" : "";

  return `
    <article class="felt settlement settlement-${escapeHtml(slideMode)} game-panel">
      <div class="between">
        <div class="eyebrow ${eyebrowClass}">${escapeHtml(eyebrowText)}</div>
        ${connectionPill()}
      </div>
      <h2>${headline}</h2>
      <div class="${amountClass}" ${amountTweenAttr}>${amountPrefix}${money(amountCents)}</div>
      <p>${aborted ? "Both stakes returned. No rake." : `Pot ${money(settlement.grossPotCents)} minus ${money(settlement.rakeCents)} fake-money rake.`}</p>
      <div class="metric-grid">
        <div>
          <small>Balance</small>
          <strong data-bankroll-tween data-from="${balanceBeforeCents}" data-to="${balanceAfterCents}" data-tween-key="balance:${escapeHtml(game?.id ?? settlement.gameId ?? "")}">${money(balanceAfterCents)}</strong>
        </div>
        ${settlement.ratingDelta !== null ? `<div><small>Rating</small><strong${ratingRevealAttr}>${formatRatingDelta(settlement.ratingDelta)}</strong></div>` : ""}
        <div><small>Last move</small><strong>${aborted ? "No moves" : escapeHtml(settlement.winningMove || "—")}</strong></div>
      </div>
      <div class="settlement-actions">
        ${settlement.rematchChallenge ? `<button class="primary${gateClass}" data-rematch>Rematch ${escapeHtml(settlement.rematchChallenge.opponent)} · ${money(settlement.rematchChallenge.stakeCents)}</button>` : ""}
        <button class="${gateClass.trim()}" data-nav="play">Find new opponent</button>
        ${settlement.rematchChallenge ? `<button type="button" class="mini-button" data-report-user="${escapeHtml(settlement.rematchChallenge.opponentId)}" data-report-game="${escapeHtml(settlement.gameId)}" data-report-category="bug_settlement">Report this game</button>` : ""}
      </div>
      ${state.actionError ? `<em class="action-error">${escapeHtml(state.actionError)}</em>` : ""}
    </article>
  `;
}

function renderGame() {
  const game = state.activeGame;
  if (!game) return `<p class="muted">No active game. <a href="#play">Back to lobby.</a></p>`;
  const white = game.players.find((player) => player.color === "white");
  const black = game.players.find((player) => player.color === "black");
  const viewer = viewerPlayer(game);
  const viewerIsPlayer = !!viewer;
  const opponent = viewerIsPlayer ? game.players.find((player) => player.id !== viewer.id) : null;
  const canResign = viewerIsPlayer && game.state === "live";
  const drawSection = viewerIsPlayer && game.state === "live"
    ? drawControls(game, viewer.color)
    : "";
  const turnOwner = game.players.find((player) => player.color === game.turn);
  const statusText = game.state === "live"
    ? `${turnOwner?.id === viewerId() ? "Your" : `${turnOwner?.handle ?? game.turn}'s`} move`
    : game.status;
  const whiteStakeLabel = viewer?.color === "white" ? "Your stake" : `${white?.handle ?? "White"} stake`;
  const blackStakeLabel = viewer?.color === "black" ? "Your stake" : `${black?.handle ?? "Black"} stake`;

  const replay = game.state === "finalized" && state.replay ? state.replay : null;
  const replayPly = replay ? replay.currentPly : 0;
  const replayTotal = replay ? replay.moves.length : 0;
  const replayFen = replay
    ? (replayPly === 0 ? replay.startingFen : replay.moves[replayPly - 1].fenAfter)
    : null;
  const replayLastMove = replay && replayPly > 0 ? replay.moves[replayPly - 1] : null;
  const replayCurrentSan = replay && replayPly > 0 ? replay.moves[replayPly - 1].san : null;

  return `
    <section class="game-layout">
      <aside class="card game-panel move-panel">
        <div class="between">
          <h2>Move history</h2>
          <small>${replay ? `ply ${replayPly} / ${replayTotal}` : (game.moveNumber ? `move ${game.moveNumber}` : "opening")}</small>
        </div>
        <div class="move-head"><span>White</span><span>Black</span></div>
        <ol class="moves" data-move-list>
          ${(game.moveRows || []).map((move, index, rows) => {
            const whitePly = index * 2 + 1;
            const blackPly = index * 2 + 2;
            const isLastRow = index === rows.length - 1;
            const liveCurrent = !replay && isLastRow ? "current" : "";
            const whiteCell = replay
              ? `<button class="move-cell-button${replayPly === whitePly ? " active" : ""}" type="button" data-replay-ply="${whitePly}">${escapeHtml(move[0])}</button>`
              : `<span>${escapeHtml(move[0])}</span>`;
            const blackCell = move[1]
              ? (replay
                  ? `<button class="move-cell-button${replayPly === blackPly ? " active" : ""}" type="button" data-replay-ply="${blackPly}">${escapeHtml(move[1])}</button>`
                  : `<span>${escapeHtml(move[1])}</span>`)
              : `<span></span>`;
            return `
              <li class="${liveCurrent}">
                <span class="move-number">${index + 1}.</span>
                ${whiteCell}
                ${blackCell}
              </li>
            `;
          }).join("") || `<li><span class="move-number">1.</span><span>No moves yet</span><span></span></li>`}
        </ol>
      </aside>
      <article class="board-column">
        ${(() => {
          const orientation = boardOrientation(game);
          const topPlayer = orientation === "black" ? white : black;
          const bottomPlayer = orientation === "black" ? black : white;
          if (replay) {
            return `
              ${playerStrip(game, topPlayer, false)}
              ${replayBoard(replayFen, orientation, replayLastMove)}
              ${playerStrip(game, bottomPlayer, false)}
            `;
          }
          return `
            ${playerStrip(game, topPlayer, game.turn === topPlayer.color)}
            ${captureTray(game, topPlayer.color)}
            ${board(game)}
            ${promotionDialog()}
            ${captureTray(game, bottomPlayer.color)}
            ${playerStrip(game, bottomPlayer, game.turn === bottomPlayer.color)}
          `;
        })()}
        ${replay ? `
          <div class="turn-strip replay-nav" role="group" aria-label="Replay controls">
            <button type="button" class="replay-nav-button" data-replay-jump="first" aria-label="First position" ${replayPly === 0 ? "disabled" : ""}>⏮</button>
            <button type="button" class="replay-nav-button" data-replay-jump="prev" aria-label="Previous move" ${replayPly === 0 ? "disabled" : ""}>◀</button>
            <strong class="replay-ply-indicator">${replayPly === 0 ? "Start" : escapeHtml(replayCurrentSan)}</strong>
            <button type="button" class="replay-nav-button" data-replay-jump="next" aria-label="Next move" ${replayPly >= replayTotal ? "disabled" : ""}>▶</button>
            <button type="button" class="replay-nav-button" data-replay-jump="last" aria-label="Last position" ${replayPly >= replayTotal ? "disabled" : ""}>⏭</button>
          </div>
        ` : `
          <div class="turn-strip">
            <strong>${escapeHtml(statusText)}</strong>
            <span>${escapeHtml(game.status)}${game.inCheck ? " · check" : ""}</span>
            ${state.gameError ? `<em>${escapeHtml(state.gameError)} <button type="button" class="inline-dismiss" data-dismiss-game-error aria-label="Dismiss game error">Dismiss</button></em>` : ""}
          </div>
        `}
      </article>
      <aside class="stack">
        ${(game.state === "finalized" || game.state === "aborted") ? finalizedGameSettlementPanel(game) : `
          <article class="felt pot game-panel">
            <div class="between">
              <div class="eyebrow">The pot</div>
              <span class="status-pill">escrowed</span>
            </div>
            <h2>${money(game.pot.netPotCents)}</h2>
            <p>Winner takes after ${money(game.pot.rakeCents)} fake-money rake.</p>
            <div class="stake-grid">
              <div><small>${escapeHtml(whiteStakeLabel)}</small><strong>${money(game.pot.stakeCents)}</strong></div>
              <div><small>${escapeHtml(blackStakeLabel)}</small><strong>${money(game.pot.stakeCents)}</strong></div>
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
              <div><small>Watching</small><strong data-watcher-count>${game.watcherCount ?? 0}</strong></div>
            </div>
            ${viewerIsPlayer ? "" : `<p class="muted small">Spectator mode is read-only for live games.</p>`}
          </article>
          ${opponent ? `<button type="button" class="mini-button" data-report-user="${escapeHtml(opponent.id)}" data-report-game="${escapeHtml(game.id)}" data-report-category="engine_assistance">Report ${escapeHtml(opponent.handle)}</button>` : ""}
          ${drawSection}
          ${canResign ? `<button class="danger resign-button" data-open-resign ${actionInFlight("resign", game.id) ? "disabled" : ""}>${actionInFlight("resign", game.id) ? "Resigning..." : `Resign · concede ${money(game.pot.stakeCents)}`}</button>` : ""}
        `}
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
  const movesPlayed = (game.moves || []).length;
  const inFirstMoveWindow = game.state === "live" && active && movesPlayed < 2;
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
    ${renderAvatar(player, { surface: "game_strip" })}
    <span class="player-main">
      <span>
        <strong>${isViewer ? "You" : escapeHtml(player.handle)}${showPresence ? ` <span class="presence-dot ${dotClass}" title="${escapeHtml(onlineLabel)}" aria-label="${escapeHtml(onlineLabel)}"></span>` : ""}${renderTierPip(player)}</strong>
        <small>${escapeHtml(player.color)} · ${escapeHtml(player.rating)}${showPresence && !presence.online ? `<span class="player-offline-label"> · ${escapeHtml(onlineLabel)}</span>` : ""}</small>
      </span>
      <span class="player-subline">
        ${capturedPiecesMarkup(game, player.color, "No captures")}
        <span>${formatMaterialDelta(material)}</span>
        <span>${escapeHtml(activity)}</span>
        ${inFirstMoveWindow ? `<span class="first-move-pill" title="If no move is made within 15 seconds, the game aborts and both stakes are returned.">first move · 15s</span>` : ""}
      </span>
    </span>
  `;
  return `
    <div class="player-strip ${active ? "active" : ""} ${low ? "low" : ""} ${critical ? "critical" : ""}" data-clock="${player.color}">
      ${isViewer ? identity : scoutTrigger(player, identity, "player-strip-scout")}
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
    return `<button type="button" class="${classes}" data-square="${square.square}" aria-label="${escapeHtml(squareLabel(game, square, pieceColor, target, isSource, isSelected))}" aria-pressed="${isSelected ? "true" : "false"}">${piece}${coords}</button>`;
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

// Settlement chrome stays text-driven: the headline, the big +/- amount
// (counter-tween), and the bankroll counter (counter-tween) carry the
// result. Earlier attempts at an animated chip-slide visualization read
// as gimmicky on screen even when the spec sounded right on paper.
// Asymmetric outcome weight is now expressed through:
//   - loss-settle keyframe on the amount line (heavy landing)
//   - bankroll counter only tweens on win/draw (loss snaps — no movement
//     because the escrow was already taken at game start)
//   - settlement chip-cascade SFX from sound.mjs paired with the moment

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

  const slideMode = won ? "win" : drew ? "draw" : "loss";

  // Bankroll tween: the metric-grid Balance ticks up on win/draw (escrow
  // release + winnings). On loss the escrow already left the available
  // balance at game start, but the user sees no movement at settlement
  // unless we span the dip ourselves — so for losses the tween runs from
  // "balance before staking" → "balance after settle," which mirrors the
  // money leaving on screen. See ARENA_NEXT_PASS § Phase 4.
  const balanceAfterCents = settlement.balanceAfterCents;
  const stakeCents = game?.pot?.stakeCents ?? 0;
  const balanceBeforeCents = (won || drew)
    ? balanceAfterCents - (settlement.creditedCents ?? 0)
    : balanceAfterCents + stakeCents;
  const amountTweenAttr = won || drew
    ? `data-amount-tween="${amountCents}" data-amount-prefix="${escapeHtml(amountPrefix)}" data-tween-key="amount:${escapeHtml(settlement.gameId ?? game?.id ?? "")}"`
    : "";
  const firstReveal = isFirstSettlementRenderFor(settlement.gameId);
  const gateClass = firstReveal ? " settlement-rematch-gate" : "";
  const ratingRevealAttr = firstReveal ? " data-rating-reveal" : "";

  return `
    <section class="grid two">
      <article class="felt settlement settlement-${escapeHtml(slideMode)}">
        <div class="eyebrow ${eyebrowClass}">${escapeHtml(eyebrowText)}</div>
        <h1>${headline}</h1>
        <div class="${amountClass}" ${amountTweenAttr}>${amountPrefix}${money(amountCents)}</div>
        <p>Pot ${money(settlement.grossPotCents)} minus ${money(settlement.rakeCents)} fake-money rake.</p>
        <div class="metric-grid">
          <div>
            <small>Balance</small>
            <strong data-bankroll-tween data-from="${balanceBeforeCents}" data-to="${balanceAfterCents}" data-tween-key="balance:${escapeHtml(settlement.gameId ?? game?.id ?? "")}">${money(balanceAfterCents)}</strong>
          </div>
          ${settlement.ratingDelta !== null ? `<div><small>Rating</small><strong${ratingRevealAttr}>${formatRatingDelta(settlement.ratingDelta)}${settlement.ratingAfter !== null ? ` <span class="muted">→ ${settlement.ratingAfter}</span>` : ""}</strong></div>` : ""}
          <div><small>Last move</small><strong>${escapeHtml(settlement.winningMove || "—")}</strong></div>
        </div>
      </article>
      <aside class="card stack">
        <h2>Queue another</h2>
        ${settlementOpponent ? scoutTrigger(
          settlementOpponent,
          `<span class="settlement-scout-id">${renderAvatar(settlementOpponent, { surface: "dense_row" })}<span>${escapeHtml(opponentHandle)}</span></span>`,
          "settlement-scout"
        ) : ""}
        ${settlement.rematchChallenge ? `<button class="primary${gateClass}" data-rematch>Rematch ${escapeHtml(settlement.rematchChallenge.opponent)} · ${money(settlement.rematchChallenge.stakeCents)}</button>` : ""}
        <button class="${gateClass.trim()}" data-nav="play">Find new opponent</button>
        ${settlement.rematchChallenge ? `<button type="button" class="mini-button" data-report-user="${escapeHtml(settlement.rematchChallenge.opponentId)}" data-report-game="${escapeHtml(settlement.gameId)}" data-report-category="bug_settlement">Report this game</button>` : ""}
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
  const resultLabel = entry.result === "win" ? "Win" : entry.result === "loss" ? "Loss" : entry.result === "draw" ? "Draw" : entry.result;
  const resultClass = entry.result === "win" ? "money-win" : entry.result === "loss" ? "money-loss" : "money-draw";
  const sign = entry.result === "win" ? "+" : entry.result === "loss" ? "−" : "";
  const credited = entry.result === "loss" ? entry.stakeCents : entry.creditedCents;
  const when = entry.endedAt ? new Date(entry.endedAt).toLocaleString() : "—";
  const endReason = endReasonLabel(entry.endReason);
  const identity = `
    <div class="history-vs">
      ${renderAvatar(entry.opponent, { surface: "history_row" })}
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
        "history-scout"
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
    timeout: "Timeout",
    stalemate: "Stalemate",
    threefold_repetition: "Threefold repetition",
    insufficient_material: "Insufficient material",
    aborted_pre_move: "Aborted — no first move"
  };
  return labels[reason] || reason || "—";
}

function renderVerifyPanel(account) {
  const v = state.verifying;
  if (!v || v.accountId !== account.id || !v.claimToken) return "";
  const checkBusy = actionInFlight("verify-check", account.id);
  const instructions = "Open Lichess → Edit profile → paste this into your bio (or First name / Last name / Location). Save.";
  return `
    <div class="verify-panel">
      <p class="muted small">${escapeHtml(instructions)}</p>
      <code class="verify-token mono" title="Click to select">${escapeHtml(v.claimToken)}</code>
      <p class="muted small">Token expires ${escapeHtml(formatDateTime(v.expiresAt))}.</p>
      ${v.error ? `<em class="account-error">${escapeHtml(v.error)}</em>` : ""}
      <div class="verify-actions">
        <button type="button" class="primary" data-verify-check="${escapeHtml(account.id)}" ${checkBusy ? "disabled" : ""}>
          ${checkBusy ? "Checking..." : "Check now"}
        </button>
        <button type="button" class="link" data-verify-regenerate="${escapeHtml(account.id)}" ${checkBusy ? "disabled" : ""}>Get new token</button>
        <button type="button" class="link" data-verify-cancel ${checkBusy ? "disabled" : ""}>Cancel</button>
      </div>
    </div>
  `;
}

function renderLinkedAccountsCard(viewer) {
  const accounts = viewer.externalAccounts ?? [];
  const linkBusy = actionInFlight("external-link");
  const linkedProviders = new Set(accounts.map((a) => a.provider));
  const availableProviders = ["lichess", "chesscom"].filter((p) => !linkedProviders.has(p));
  const rows = accounts.map((account) => {
    const blitz = account.ratings?.blitz;
    const rapid = account.ratings?.rapid;
    const bullet = account.ratings?.bullet;
    const headline = blitz != null ? `blitz ${blitz}` : rapid != null ? `rapid ${rapid}` : bullet != null ? `bullet ${bullet}` : "no rated games";
    const unlinkBusy = actionInFlight("external-unlink", account.id);
    const verifyStartBusy = actionInFlight("verify-start", account.id);
    const showVerifyButton = account.status !== "verified" && account.provider === "lichess";
    const statusChipClass = account.status === "verified" ? "linked-chip" : "muted";
    const statusLabel = account.status === "verification_pending" ? "verifying" : account.status;
    return `
      <div class="linked-account-row">
        <div class="linked-account-identity">
          <strong>${escapeHtml(formatProvider(account.provider))}</strong>
          <span class="muted">@${escapeHtml(account.username)}</span>
        </div>
        <div class="linked-account-tag-row">
          <span class="trust-chip ${statusChipClass}">${escapeHtml(statusLabel)}</span>
          <span class="linked-account-stats">${escapeHtml(headline)}</span>
        </div>
        <div class="linked-account-actions">
          ${showVerifyButton ? `
            <button type="button" data-verify-start="${escapeHtml(account.id)}" ${verifyStartBusy ? "disabled" : ""}>
              ${verifyStartBusy ? "Starting..." : "Verify"}
            </button>
          ` : ""}
          <button type="button" data-unlink-external="${escapeHtml(account.id)}" ${unlinkBusy ? "disabled" : ""}>
            ${unlinkBusy ? "Removing..." : "Unlink"}
          </button>
        </div>
      </div>
      ${renderVerifyPanel(account)}
    `;
  }).join("");
  const form = availableProviders.length === 0 ? "" : `
    <form class="stack compact-form" data-link-external>
      <label>Provider
        <select name="provider">
          ${availableProviders.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(formatProvider(p))}</option>`).join("")}
        </select>
      </label>
      <label>Handle
        <input name="username" type="text" autocomplete="off" minlength="2" maxlength="30" required />
        <small class="muted">We'll fetch public stats. No password needed.</small>
      </label>
      <button type="submit" ${linkBusy ? "disabled" : ""}>${linkBusy ? "Linking..." : "Link account"}</button>
    </form>
  `;
  return `
    <section class="grid one">
      <article class="card account-card">
        <h2>Linked chess accounts</h2>
        <p class="muted small">Lichess or Chess.com handles seed your initial Horsey rating from your blitz strength.</p>
        ${rows ? `<div class="linked-accounts-list">${rows}</div>` : `<p class="muted small">No accounts linked yet.</p>`}
        ${form}
      </article>
    </section>
  `;
}

function renderProfile() {
  const viewer = state.bootstrap.viewer;
  const ledgerRows = ledgerRowsWithBalances(state.walletLedger);
  const emailBusy = actionInFlight("account-email");
  const passwordBusy = actionInFlight("account-password");
  const logoutBusy = actionInFlight("logout-others");
  const stats = viewer.stats ?? {};
  const calibratingChip = viewer.calibrating
    ? `<span class="trust-chip muted" title="Rating identity is still calibrating from your first Horsey games">calibrating · ${escapeHtml(viewer.finishedGames ?? 0)}/${escapeHtml(viewer.calibratingThreshold ?? 10)}</span>`
    : "";
  return `
    <section class="profile">
      <article class="card profile-header">
        ${renderAvatar(viewer, { surface: "user_profile" })}
        <div>
          <h1>${escapeHtml(viewer.handle)}</h1>
          <p class="muted">${escapeHtml(viewer.email)}</p>
          <div class="tag-row"><span>rating ${escapeHtml(viewer.rating)}</span>${calibratingChip}</div>
        </div>
      </article>
      <article class="card profile-quick-card">
        <header>
          <span class="eyebrow">At a glance</span>
          <h2>Account state</h2>
        </header>
        <div class="metric-grid profile-quick-grid">
          <div><small>Rating</small><strong>${escapeHtml(viewer.rating)}</strong></div>
          <div><small>Win rate</small><strong>${escapeHtml(scoutWinRate(stats))}</strong></div>
          <div><small>Wallet</small><strong>${money(viewer.balanceCents)}</strong></div>
          <div><small>Escrow</small><strong>${money(viewer.escrowCents)}</strong></div>
          <div><small>Games</small><strong>${escapeHtml(stats.finishedGames ?? 0)}</strong></div>
          <div><small>Verification</small><strong>${escapeHtml(profileVerificationLabel(viewer))}</strong></div>
        </div>
      </article>
      ${renderAchievementsPanel(viewer)}
      ${renderAvatarPickerCard(viewer)}
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
      ${renderProfileSessionCard()}
      ${renderLinkedAccountsCard(viewer)}
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

function renderBuyChipsSection() {
  const payments = state.bootstrap?.payments;
  if (!payments) return "";
  const packages = payments.packages || [];
  const enabled = payments.enabled && !payments.geoBlocked;
  const busy = actionInFlight("payments-checkout");
  const statusLine = !payments.enabled
    ? `<p class="muted small">Buy Chips opens later. Tiles are locked in this environment.</p>`
    : payments.geoBlocked
    ? `<p class="muted small">Chip purchases aren't available in your region.</p>`
    : `<p class="muted small">Payment in stablecoins (USDT, USDC). Chips are entertainment credit — no cashout in v1.</p>`;
  const tiles = packages.map((pkg) => {
    const bonusLabel = pkg.bonusPct > 0 ? `<span class="bonus">+${pkg.bonusPct}% bonus</span>` : "";
    const disabled = !enabled || busy;
    const label = !enabled ? "Coming soon" : busy ? "Opening…" : "Buy";
    return `
      <article class="chip-tile ${enabled ? "" : "locked"}">
        <header>
          <strong>${escapeHtml(pkg.label)}</strong>
          ${bonusLabel}
        </header>
        <div class="chip-tile-price">${money(pkg.priceUsdCents)}</div>
        <div class="chip-tile-chips">→ ${money(pkg.chipsCents)} in chips</div>
        <button type="button" class="primary" data-buy-package="${escapeHtml(pkg.id)}" ${disabled ? "disabled" : ""}>
          ${label}
        </button>
      </article>
    `;
  }).join("");
  const errorLine = state.cashierError
    ? `<em class="account-error cashier-error">${escapeHtml(state.cashierError)}</em>`
    : "";
  return `
    <section class="cashier-section buy-chips-section">
      <h3>Buy chips</h3>
      ${statusLine}
      <div class="chip-tiles">${tiles}</div>
      ${errorLine}
    </section>
  `;
}

function renderCashoutWaitlistSection() {
  const payments = state.bootstrap?.payments;
  if (!payments) return "";
  const waitlist = state.cashoutWaitlist || { status: "form", error: null };
  const viewer = state.bootstrap.viewer;
  let body;
  if (waitlist.status === "submitted") {
    body = `<p class="muted">You're on the list. We'll email you if cashout opens in your region.</p>`;
  } else {
    const busy = waitlist.status === "submitting";
    body = `
      <form class="stack compact-form" data-cashout-waitlist>
        <p class="muted small">Cashout is deferred to a later phase. Join the waitlist to be notified if and when it opens in your region.</p>
        <label>Email
          <input name="email" type="email" value="${escapeHtml(viewer?.email || "")}" required />
        </label>
        ${waitlist.error ? `<em class="account-error">${escapeHtml(waitlist.error)}</em>` : ""}
        <button type="submit" ${busy ? "disabled" : ""}>${busy ? "Submitting…" : "Notify me when cashout opens"}</button>
      </form>
    `;
  }
  return `
    <section class="cashier-section cashout-waitlist-section">
      <h3>Cashout · coming soon</h3>
      ${body}
    </section>
  `;
}

function renderCashierModal() {
  if (!state.cashierOpen) return "";
  const viewer = state.bootstrap?.viewer;
  if (!viewer) return "";
  return `
    <div class="modal-backdrop cashier-backdrop" role="presentation" data-cashier-backdrop>
      <section class="card cashier-modal" role="dialog" aria-modal="true" aria-labelledby="cashier-title">
        <header class="cashier-header">
          <div>
            <span class="eyebrow">Cashier</span>
            <h2 id="cashier-title">Wallet · ${money(viewer.balanceCents)}</h2>
          </div>
          <button type="button" class="cashier-close" data-cashier-close aria-label="Close cashier">×</button>
        </header>
        ${renderBuyChipsSection()}
        ${renderCashoutWaitlistSection()}
      </section>
    </div>
  `;
}

async function submitCashoutWaitlist(email) {
  if (!state.cashoutWaitlist) state.cashoutWaitlist = {};
  state.cashoutWaitlist = { status: "submitting", error: null };
  render();
  try {
    await postJson("/api/cashout-waitlist", { email });
    state.cashoutWaitlist = { status: "submitted", error: null };
  } catch (error) {
    if (authGuard(error)) return;
    state.cashoutWaitlist = { status: "form", error: error.message };
  } finally {
    render();
  }
}

async function startChipPurchase(packageId) {
  if (actionInFlight("payments-checkout")) return;
  setActionInFlight("payments-checkout", true);
  state.cashierError = null;
  render();
  try {
    const resp = await postJson("/api/payments/checkout", { packageId });
    if (resp?.invoiceUrl) {
      window.location.assign(resp.invoiceUrl);
      return;
    }
    state.cashierError = "Checkout did not return an invoice URL.";
  } catch (error) {
    if (authGuard(error)) return;
    state.cashierError = error.message;
  } finally {
    setActionInFlight("payments-checkout", false);
    render();
  }
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
  if (state.authMode === "reset-request") return renderResetRequest();
  const mode = state.authMode === "signup" ? "signup" : "login";
  const isSignup = mode === "signup";
  if (state.devAccounts === null && !state.devAccountsLoading) {
    loadDevAccounts();
  }
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
          ${isSignup ? `
            <label class="tos-checkbox">
              <input type="checkbox" name="tos" required />
              <span>I have read and accept the Horsey Terms — chips are entertainment credit, no cashout in v1. <button type="button" class="link" data-tos-show>Read</button></span>
            </label>
          ` : ""}
          <button class="primary" type="submit">${isSignup ? "Create account" : "Log in"}</button>
          ${state.authError ? `<em class="action-error">${escapeHtml(state.authError)}</em>` : ""}
        </form>
        ${!isSignup ? `<button type="button" class="link auth-forgot" data-auth-mode="reset-request">Forgot password?</button>` : ""}
        ${renderDevAccountPicker()}
        <p class="muted small">New accounts start with $1,000 in fake-money escrow funds.</p>
      </article>
    </main>
  `;
}

function renderResetRequest() {
  const flow = state.resetRequest || { status: "form", error: null };
  if (flow.status === "success") {
    return `
      <main class="auth-shell">
        <article class="auth-card felt">
          <a class="brand auth-brand" href="#"><span class="mark">♞</span>Horsey</a>
          <h2>Check your inbox.</h2>
          <p>If an account exists for that email, we sent a password-reset link. The link expires in 1 hour.</p>
          <button type="button" class="primary" data-auth-mode="login">Back to log in</button>
        </article>
      </main>
    `;
  }
  const submitting = flow.status === "submitting";
  return `
    <main class="auth-shell">
      <article class="auth-card felt">
        <a class="brand auth-brand" href="#"><span class="mark">♞</span>Horsey</a>
        <h2>Reset your password</h2>
        <p class="muted small">We'll send a link to your email. The link expires in 1 hour.</p>
        <form data-reset-request-form class="stack">
          <label>Email
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <button class="primary" type="submit" ${submitting ? "disabled" : ""}>${submitting ? "Sending…" : "Send reset link"}</button>
          ${flow.error ? `<em class="action-error">${escapeHtml(flow.error)}</em>` : ""}
        </form>
        <button type="button" class="link auth-forgot" data-auth-mode="login">Back to log in</button>
      </article>
    </main>
  `;
}

function renderVerifyEmail() {
  const flow = state.verifyEmail || { status: "verifying", message: null };
  let body;
  if (flow.status === "verifying") {
    body = `<p>Verifying your email…</p>`;
  } else if (flow.status === "success") {
    body = `
      <h2>Email verified.</h2>
      <p>Your account is now fully active.</p>
      <button type="button" class="primary" data-verify-continue>Continue to Horsey</button>
    `;
  } else {
    body = `
      <h2>That link didn't work.</h2>
      <p>${escapeHtml(flow.message || "The verification link is invalid or has expired.")}</p>
      <p class="muted small">Log in and use the banner action to request a fresh link.</p>
      <button type="button" class="primary" data-verify-continue>Back to Horsey</button>
    `;
  }
  return `
    <main class="auth-shell">
      <article class="auth-card felt">
        <a class="brand auth-brand" href="#"><span class="mark">♞</span>Horsey</a>
        ${body}
      </article>
    </main>
  `;
}

function renderPasswordResetView() {
  const flow = state.passwordReset || { status: "form", error: null, token: null };
  if (flow.status === "success") {
    return `
      <main class="auth-shell">
        <article class="auth-card felt">
          <a class="brand auth-brand" href="#"><span class="mark">♞</span>Horsey</a>
          <h2>Password updated.</h2>
          <p>Sign in with your new password.</p>
          <button type="button" class="primary" data-reset-continue>Go to log in</button>
        </article>
      </main>
    `;
  }
  const submitting = flow.status === "submitting";
  return `
    <main class="auth-shell">
      <article class="auth-card felt">
        <a class="brand auth-brand" href="#"><span class="mark">♞</span>Horsey</a>
        <h2>Choose a new password</h2>
        <form data-password-reset-form class="stack">
          <label>New password
            <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
            <small class="muted">8+ characters</small>
          </label>
          <button class="primary" type="submit" ${submitting ? "disabled" : ""}>${submitting ? "Updating…" : "Set new password"}</button>
          ${flow.error ? `<em class="action-error">${escapeHtml(flow.error)}</em>` : ""}
        </form>
      </article>
    </main>
  `;
}

function renderDevAccountPicker() {
  const accounts = state.devAccounts || [];
  if (accounts.length === 0) return "";
  return `
    <section class="dev-account-picker" aria-label="Dev account picker">
      <div class="between">
        <strong>Dev accounts</strong>
        <span class="muted small">QA mode</span>
      </div>
      <div class="dev-account-list">
        ${accounts.map((account) => `
          <button type="button" class="dev-account" data-dev-login="${escapeHtml(account.email)}" data-dev-password="${escapeHtml(account.password)}">
            ${renderAvatar(account, { size: "sm" })}
            <span>
              <strong>${escapeHtml(account.handle)}</strong>
              <small>${escapeHtml(account.email)}</small>
            </span>
            <em class="tier-${escapeHtml(account.trustTier)}">${escapeHtml(account.trustTier)}</em>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderTrustTierChip(user) {
  const tier = user?.trustTier;
  if (!tier) return "";
  const cap = user.stakeCapCents != null ? ` · cap ${money(user.stakeCapCents)}` : "";
  const title = `Trust tier: ${tier}${cap}. Verify a chess account to raise your tier and stake cap.`;
  return `<span class="trust-chip tier-chip tier-${escapeHtml(tier)}" title="${escapeHtml(title)}">${escapeHtml(tier)}</span>`;
}

// Compact one-letter pip used inline beside opponent handles in dense rows
// (live feed, open tables, player strips). Hidden for provisional since
// "everyone is provisional by default" → showing it adds noise.
function renderTierPip(user) {
  const tier = user?.trustTier;
  if (!tier || tier === "provisional") return "";
  const letter = tier === "claimed" ? "C" : tier === "verified" ? "V" : tier === "established" ? "E" : tier[0].toUpperCase();
  return `<span class="tier-pip tier-${escapeHtml(tier)}" title="Trust tier: ${escapeHtml(tier)}">${escapeHtml(letter)}</span>`;
}

function renderProfileLinkedChips(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return "";
  const chips = accounts.map((account) => {
    const blitz = account.ratings?.blitz;
    const rapid = account.ratings?.rapid;
    const headline = blitz != null ? `${blitz} blitz` : rapid != null ? `${rapid} rapid` : "no rated games";
    return `<span class="trust-chip linked-chip"><strong>${escapeHtml(formatProvider(account.provider))} ${escapeHtml(account.status)}</strong> · ${escapeHtml(headline)}</span>`;
  }).join("");
  return `<div class="profile-linked-chips">${chips}</div>`;
}

function profileVerificationLabel(user) {
  const accounts = user?.externalAccounts || [];
  if (accounts.some((account) => account.status === "verified")) return "Verified";
  if (accounts.length) return "Linked";
  return "Unlinked";
}

const MILESTONE_TRACKS = [
  { key: "first_win", label: "First win", detail: "win one Horsey game" },
  { key: "win_streak_3", label: "3-win streak", detail: "reach a 3-win streak" },
  { key: "win_streak_5", label: "5-win streak", detail: "reach a 5-win streak" }
];

function milestoneSet(user) {
  return new Set((user?.milestones || []).map((m) => m.eventKey));
}

function renderAchievementTrack(user) {
  const earned = milestoneSet(user);
  const currentStreak = user?.stats?.currentStreak;
  const streak = currentStreak?.kind === "W" ? Number(currentStreak.length || 0) : 0;
  return `
    <div class="achievement-track">
      <div class="unlock-list">
        ${MILESTONE_TRACKS.map((track) => {
          const unlocked = earned.has(track.key);
          const progress = track.key.startsWith("win_streak_")
            ? Math.min(streak, Number(track.key.split("_").at(-1)))
            : unlocked ? 1 : 0;
          const target = track.key.startsWith("win_streak_") ? Number(track.key.split("_").at(-1)) : 1;
          return `
            <div class="unlock-row ${unlocked ? "unlocked" : ""}">
              <span>${unlocked ? "Unlocked" : `${escapeHtml(String(progress))}/${escapeHtml(String(target))}`}</span>
              <div>
                <strong>${escapeHtml(track.label)}</strong>
                <small>${escapeHtml(track.detail)}</small>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderAchievementsPanel(user) {
  const earned = milestoneSet(user);
  return `
    <article class="card achievements-card">
      <header>
        <span class="eyebrow">Achievements</span>
        <h2>${escapeHtml(String(earned.size))} unlock${earned.size === 1 ? "" : "s"} earned</h2>
      </header>
      ${renderAchievementTrack(user)}
    </article>
  `;
}

const MILESTONE_LABELS = {
  first_win: "First win",
  win_streak_3: "3-win streak",
  win_streak_5: "5-win streak",
  win_streak_7: "7-win streak",
  win_streak_10: "10-win streak",
  win_streak_15: "15-win streak"
};

function avatarUnlockLabel(acquisition) {
  if (!acquisition) return "";
  if (acquisition.type === "default") return "Starter";
  if (acquisition.type === "milestone") {
    return `Unlock: ${MILESTONE_LABELS[acquisition.eventKey] || acquisition.eventKey}`;
  }
  if (acquisition.type === "purchase") {
    return `Buy: ${money(acquisition.priceCents)}`;
  }
  return "";
}

function renderAvatarPickerCard(viewer) {
  const catalog = state.avatarCatalog;
  if (!catalog) {
    return `
      <article class="card avatar-picker-card">
        <header><span class="eyebrow">Avatar</span><h2>Loading…</h2></header>
      </article>
    `;
  }
  const owned = new Set(viewer.ownedAvatarIds || []);
  const equipped = viewer.equippedAvatar || DEFAULT_AVATAR_ID;
  const balanceCents = viewer.balanceCents ?? 0;
  const tiles = catalog.map((avatar) => {
    const isOwned = owned.has(avatar.id);
    const isEquipped = avatar.id === equipped;
    const equipBusy = actionInFlight("avatar-equip", avatar.id);
    const buyBusy = actionInFlight("avatar-purchase", avatar.id);
    const previewUser = { ...viewer, equippedAvatar: avatar.id };
    let action = "";
    if (isEquipped) {
      action = `<span class="avatar-tile-status">Equipped</span>`;
    } else if (isOwned) {
      action = `<button type="button" data-avatar-equip="${escapeHtml(avatar.id)}" ${equipBusy ? "disabled" : ""}>${equipBusy ? "..." : "Equip"}</button>`;
    } else if (avatar.acquisition.type === "purchase") {
      const canAfford = balanceCents >= avatar.acquisition.priceCents;
      action = `<button type="button" data-avatar-buy="${escapeHtml(avatar.id)}" ${(!canAfford || buyBusy) ? "disabled" : ""} title="${canAfford ? "" : "Not enough fake-money"}">${buyBusy ? "..." : `Buy ${money(avatar.acquisition.priceCents)}`}</button>`;
    } else {
      action = `<span class="avatar-tile-locked">Locked</span>`;
    }
    return `
      <div class="avatar-tile rarity-${escapeHtml(avatar.rarity)} ${isOwned ? "owned" : "locked"} ${isEquipped ? "equipped" : ""}">
        ${renderAvatar(previewUser, { size: "huge" })}
        <strong>${escapeHtml(avatar.id)}</strong>
        <small class="muted">${escapeHtml(avatarUnlockLabel(avatar.acquisition))}</small>
        ${action}
      </div>
    `;
  }).join("");
  return `
    <article class="card avatar-picker-card">
      <header>
        <span class="eyebrow">Avatar</span>
        <h2>Pick your face</h2>
        <p class="muted small">Borders are set by trust tier. Buy or unlock new looks below.</p>
      </header>
      <div class="avatar-grid">${tiles}</div>
    </article>
  `;
}

const ADMIN_TABS = [
  { id: "users", label: "Users", endpoint: "/api/admin/users" },
  { id: "games", label: "Games", endpoint: "/api/admin/games" },
  { id: "reports", label: "Reports", endpoint: "/api/admin/reports?limit=200" },
  { id: "stuck", label: "Stuck", endpoint: "/api/admin/stuck-games" },
  { id: "ledger", label: "Ledger", endpoint: "/api/admin/ledger?limit=200" },
  { id: "challenges", label: "Challenges", endpoint: "/api/admin/challenges?limit=100" },
  { id: "externals", label: "External", endpoint: "/api/admin/external-accounts" },
  { id: "purchases", label: "Purchases", endpoint: "/api/admin/purchases?limit=200" },
  { id: "audit", label: "Audit", endpoint: "/api/admin/audit?limit=200" }
];

const ADMIN_RESTRICTIONS = [
  "lower_trust_score",
  "reduced_stake_limits",
  "delayed_withdrawals",
  "promotion_ineligibility",
  "restricted_matchmaking",
  "manual_review_required",
  "reduced_visibility",
  "no_rewards_from_suspicious",
  "hard_ban"
];

async function loadAdminData(tabId) {
  const tab = ADMIN_TABS.find((t) => t.id === tabId) || ADMIN_TABS[0];
  state.adminTab = tab.id;
  state.adminLoading = true;
  state.adminError = null;
  try {
    const resp = await getJson(tab.endpoint);
    state.adminData = { ...(state.adminData || {}), [tab.id]: resp };
  } catch (error) {
    if (authGuard(error)) return;
    state.adminError = error.message;
  } finally {
    state.adminLoading = false;
  }
}

function switchAdminTab(tabId) {
  loadAdminData(tabId).then(() => render());
  render();
}

function renderAdmin() {
  const viewer = state.bootstrap?.viewer;
  if (!viewer?.isAdmin) {
    return `<article class="card"><h2>Admin only</h2><p class="muted">This page requires an admin account.</p></article>`;
  }
  const activeTab = state.adminTab || "users";
  const tabBar = ADMIN_TABS.map((t) =>
    `<button class="admin-tab ${t.id === activeTab ? "active" : ""}" data-admin-tab="${t.id}">${t.label}</button>`
  ).join("");
  const body = state.adminLoading
    ? `<p class="muted">Loading…</p>`
    : state.adminError
    ? `<p class="error">${escapeHtml(state.adminError)}</p>`
    : renderAdminBody(activeTab);
  const analysisPanel = state.adminAnalysisFor ? renderAdminAnalysisPanel() : "";
  return `
    <article class="card admin-panel">
      <header>
        <h2>Admin</h2>
        <p class="muted small">Privileged actions require a reason and write audit rows plus append-only ledger corrections.</p>
      </header>
      <nav class="admin-tabs">${tabBar}</nav>
      <div class="admin-body">${body}</div>
    </article>
    ${analysisPanel}
  `;
}

function renderAdminAnalysisPanel() {
  const gameId = state.adminAnalysisFor;
  const data = state.adminAnalysisData || {};
  const job = data.job;
  const analysis = data.analysis;
  const moves = data.moves || [];
  const header = `
    <header class="analysis-header">
      <h3>Game ${escapeHtml(gameId.slice(0, 16))} · analysis</h3>
      <button class="mini-button" data-admin-analysis-close>Close</button>
    </header>`;

  const body = (() => {
    if (state.adminAnalysisLoading) return `<p class="muted">Loading…</p>`;
    if (state.adminAnalysisError) return `<p class="error">${escapeHtml(state.adminAnalysisError)}</p>`;
    if (!job && !analysis) {
      return `
        <p class="muted">No analysis run yet for this game.</p>
        <button class="primary" data-admin-game-analyze="${escapeHtml(gameId)}">Enqueue analysis</button>
      `;
    }
    const jobLine = job
      ? `<p class="muted small">Job: <strong>${escapeHtml(job.status)}</strong> · attempts ${job.attempts}${job.lastError ? ` · ${escapeHtml(job.lastError)}` : ""}</p>`
      : "";
    if (!analysis) {
      return `
        ${jobLine}
        <p class="muted">Analysis pending.</p>
        <button class="mini-button" data-admin-game-analyze="${escapeHtml(gameId)}">Re-enqueue</button>
      `;
    }
    return `
      ${jobLine}
      <p class="muted small">${escapeHtml(analysis.engineVersion)} · depth ${analysis.depth} · ${escapeHtml(analysis.source)}</p>
      ${renderAdminAnalysisSummary(analysis)}
      ${renderAdminAnalysisMoves(moves)}
      <button class="mini-button" data-admin-game-analyze="${escapeHtml(gameId)}">Re-analyze</button>
    `;
  })();

  return `<article class="card admin-analysis-panel">${header}${body}</article>`;
}

function renderAdminAnalysisSummary(a) {
  const row = (label, white, black) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(white))}</td><td>${escapeHtml(String(black))}</td></tr>`;
  return `
    <table class="admin-analysis-summary">
      <thead><tr><th></th><th>White</th><th>Black</th></tr></thead>
      <tbody>
        ${row("ACPL", a.whiteAcpl, a.blackAcpl)}
        ${row("Blunders", a.whiteBlunders, a.blackBlunders)}
        ${row("Mistakes", a.whiteMistakes, a.blackMistakes)}
        ${row("Inaccuracies", a.whiteInaccuracies, a.blackInaccuracies)}
        ${row("Top-move match", `${a.whiteTopMoveMatchPct}%`, `${a.blackTopMoveMatchPct}%`)}
      </tbody>
    </table>
  `;
}

function renderAdminAnalysisMoves(moves) {
  if (!moves.length) return `<p class="muted small">No move-level rows.</p>`;
  const rows = moves.map((m) => `
    <tr class="analysis-move analysis-${escapeHtml(m.classification || (m.isBook ? "book" : "good"))}">
      <td>${m.ply}</td>
      <td>${escapeHtml(m.side[0].toUpperCase())}</td>
      <td>${escapeHtml(m.playedSan)}</td>
      <td>${escapeHtml(m.bestSan || "—")}</td>
      <td>${m.playedEvalCp != null ? formatEvalCp(m.playedEvalCp) : "—"}</td>
      <td>${m.cpLoss != null ? m.cpLoss : "—"}</td>
      <td>${escapeHtml(m.isBook ? "book" : (m.classification || ""))}</td>
    </tr>
  `).join("");
  return `
    <table class="admin-analysis-moves">
      <thead><tr><th>#</th><th></th><th>Played</th><th>Best</th><th>Eval</th><th>Loss</th><th>Class</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function formatEvalCp(cp) {
  if (Math.abs(cp) >= 29000) return cp > 0 ? "+M" : "-M";
  const sign = cp >= 0 ? "+" : "";
  return `${sign}${(cp / 100).toFixed(2)}`;
}

function renderAdminBody(tabId) {
  const data = state.adminData?.[tabId];
  if (!data) return `<p class="muted">No data yet.</p>`;
  if (tabId === "users") return renderAdminUsers(data.users || []);
  if (tabId === "games") return renderAdminGames(data);
  if (tabId === "reports") return renderAdminReports(data.reports || []);
  if (tabId === "stuck") return renderAdminStuck(data.stuck || []);
  if (tabId === "ledger") return renderAdminLedger(data.entries || []);
  if (tabId === "challenges") return renderAdminChallenges(data.challenges || []);
  if (tabId === "externals") return renderAdminExternals(data.accounts || []);
  if (tabId === "purchases") return renderAdminPurchases(data.purchases || []);
  if (tabId === "audit") return renderAdminAudit(data.actions || []);
  return "";
}

function renderAdminReports(reports) {
  return adminTable(
    ["When", "Status", "Category", "Reporter", "Target", "Game", "Note", "Actions"],
    reports.map((r) => [
      escapeHtml(formatShortTimestamp(r.createdAt)),
      escapeHtml(r.status),
      escapeHtml(reportCategoryLabel(r.category)),
      escapeHtml(r.reporter?.handle || r.reporterUserId.slice(0, 12)),
      r.target
        ? `<a href="#user/${escapeHtml(r.target.id)}">${escapeHtml(r.target.handle)}</a>`
        : `<span class="muted">none</span>`,
      r.gameId ? `<a href="${escapeHtml(r.game?.state === "live" ? `#game/${r.gameId}` : `#history/${r.gameId}`)}">${escapeHtml(r.gameId.slice(0, 12))}</a>` : "",
      escapeHtml(r.note),
      adminReportActionsCell(r)
    ])
  );
}

function adminReportActionsCell(r) {
  const statuses = ["open", "reviewing", "resolved", "dismissed"].filter((s) => s !== r.status);
  return `<div class="admin-actions">${statuses.map((status) =>
    `<button class="mini-button" data-admin-report-status="${escapeHtml(r.id)}" data-status="${escapeHtml(status)}">${escapeHtml(status)}</button>`
  ).join("")}</div>`;
}

function adminTable(headers, rows) {
  if (!rows.length) return `<p class="muted">Empty.</p>`;
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="admin-table-scroll"><table class="admin-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderAdminUsers(users) {
  return adminTable(
    ["Handle", "Email", "Rating", "Tier", "Balance", "Escrow", "Games", "Restrictions", "Admin", "Created", "Actions"],
    users.map((u) => [
      escapeHtml(u.handle),
      escapeHtml(u.email),
      u.rating,
      u.trustTier,
      money(u.balanceCents),
      money(u.escrowCents),
      u.finishedGames,
      adminRestrictionsCell(u),
      u.isAdmin ? "yes" : "",
      escapeHtml(formatShortTimestamp(u.createdAt)),
      adminUserActionsCell(u)
    ])
  );
}

function renderAdminGames(data) {
  const liveRows = (data.live || []).map((g) => adminGameRow(g));
  const finalizedRows = (data.recentFinalized || []).map((g) => adminGameRow(g));
  return `
    <section>
      <h3>Live (${(data.live || []).length})</h3>
      ${adminTable(["Id", "Players", "TC", "Moves", "Pot", "Updated", "Actions"], liveRows)}
    </section>
    <section>
      <h3>Recent finalized</h3>
      ${adminTable(["Id", "Players", "TC", "Moves", "End", "Winner", "Ended", "Actions"], finalizedRows.map((_, i) => {
        const g = data.recentFinalized[i];
        return [
          escapeHtml(g.id),
          adminPlayersCell(g),
          escapeHtml(g.timeControl || ""),
          g.moveCount,
          escapeHtml(g.endReason || ""),
          escapeHtml(playerHandle(g, g.winnerId) || (g.winnerId ? g.winnerId.slice(0, 10) : "draw")),
          escapeHtml(formatShortTimestamp(g.endedAt || g.updatedAt)),
          adminGameActionsCell(g)
        ];
      }))}
    </section>
  `;
}

function adminGameRow(g) {
  return [
    escapeHtml(g.id),
    adminPlayersCell(g),
    escapeHtml(g.timeControl || ""),
    g.moveCount,
    g.pot?.stakeCents != null ? money(g.pot.stakeCents * 2) : "—",
    escapeHtml(formatShortTimestamp(g.updatedAt)),
    adminGameActionsCell(g)
  ];
}

function adminGameActionsCell(g) {
  const voidButton = `<button class="mini-button danger" data-admin-game-void="${escapeHtml(g.id)}">Void</button>`;
  const adjustButton = g.state === "finalized"
    ? `<button class="mini-button" data-admin-game-adjust="${escapeHtml(g.id)}">Adjust</button>`
    : "";
  const analyzeButton = g.state === "finalized"
    ? `<button class="mini-button" data-admin-game-analysis="${escapeHtml(g.id)}">Analysis</button>`
    : "";
  return `<div class="admin-actions">${voidButton}${adjustButton}${analyzeButton}</div>`;
}

function adminRestrictionsCell(u) {
  const active = u.restrictions || [];
  if (!active.length) return `<span class="muted">none</span>`;
  return active.map((r) => escapeHtml(r.restriction)).join("<br>");
}

function adminUserActionsCell(u) {
  const clearButtons = (u.restrictions || []).map((r) =>
    `<button class="mini-button" data-admin-clear-restriction="${escapeHtml(u.id)}" data-restriction="${escapeHtml(r.restriction)}">Clear ${escapeHtml(r.restriction)}</button>`
  ).join("");
  return `<div class="admin-actions"><button class="mini-button" data-admin-restrict-user="${escapeHtml(u.id)}">Restrict</button>${clearButtons}</div>`;
}

function adminPlayersCell(g) {
  return (g.players || [])
    .map((p) => `${escapeHtml(p.handle || p.id.slice(0, 8))} (${p.color[0]})`)
    .join(" vs ");
}

function playerHandle(g, userId) {
  const p = (g.players || []).find((x) => x.id === userId);
  return p?.handle ?? null;
}

function renderAdminStuck(stuck) {
  return adminTable(
    ["Id", "Players", "TC", "Flagged side", "Idle (s)", "Updated"],
    stuck.map((g) => [
      escapeHtml(g.id),
      adminPlayersCell(g),
      escapeHtml(g.timeControl || ""),
      g.flaggedSide ? `<span class="error">${g.flaggedSide}</span>` : "—",
      g.idleMs != null ? Math.round(g.idleMs / 1000) : "—",
      escapeHtml(formatShortTimestamp(g.updatedAt))
    ])
  );
}

function renderAdminLedger(entries) {
  return adminTable(
    ["When", "User", "Type", "Available Δ", "Escrow Δ", "Ref", "Note"],
    entries.map((e) => [
      escapeHtml(formatShortTimestamp(e.createdAt)),
      escapeHtml(e.userId.slice(0, 14)),
      escapeHtml(e.type),
      money(e.availableDeltaCents),
      money(e.escrowDeltaCents),
      escapeHtml(e.refId || ""),
      escapeHtml(e.note || "")
    ])
  );
}

function renderAdminChallenges(challenges) {
  return adminTable(
    ["Id", "State", "From", "To", "Stake", "TC", "Game", "Created"],
    challenges.map((c) => [
      escapeHtml(c.id.slice(0, 14)),
      escapeHtml(c.state),
      escapeHtml(c.challengerId.slice(0, 12)),
      escapeHtml(c.recipientId ? c.recipientId.slice(0, 12) : "open"),
      money(c.stakeCents),
      escapeHtml(c.timeControl || ""),
      escapeHtml(c.gameId ? c.gameId.slice(0, 14) : ""),
      escapeHtml(formatShortTimestamp(c.createdAt))
    ])
  );
}

function renderAdminExternals(accounts) {
  return adminTable(
    ["User", "Provider", "Handle", "Status", "Verified", "Created"],
    accounts.map((a) => [
      escapeHtml(a.userId.slice(0, 14)),
      escapeHtml(a.provider),
      escapeHtml(a.externalUsername),
      escapeHtml(a.status),
      escapeHtml(formatShortTimestamp(a.verifiedAt)),
      escapeHtml(formatShortTimestamp(a.createdAt))
    ])
  );
}

function renderAdminPurchases(purchases) {
  return adminTable(
    ["When", "User", "Package", "USD", "Chips", "Status", "Pay", "Provider id", "Credited?"],
    purchases.map((p) => [
      escapeHtml(formatShortTimestamp(p.createdAt)),
      p.user
        ? `<a href="#user/${escapeHtml(p.user.id)}">${escapeHtml(p.user.handle)}</a>`
        : escapeHtml(p.userId.slice(0, 12)),
      escapeHtml(p.packageId),
      money(p.amountUsdCents),
      money(p.chipsCreditedCents),
      escapeHtml(p.status),
      p.payCurrency ? escapeHtml(`${p.payCurrency}${p.payAmount ? ` · ${p.payAmount}` : ""}`) : `<span class="muted">—</span>`,
      escapeHtml(p.providerPaymentId || p.providerSessionId || ""),
      p.ledgerEntryId ? "yes" : `<span class="muted">no</span>`
    ])
  );
}

function renderAdminAudit(actions) {
  return adminTable(
    ["When", "Actor", "Action", "Target", "Reason"],
    actions.map((a) => [
      escapeHtml(formatShortTimestamp(a.createdAt)),
      escapeHtml(a.actorUserId.slice(0, 14)),
      escapeHtml(a.action),
      `${escapeHtml(a.targetType)}:${escapeHtml(a.targetId.slice(0, 14))}`,
      escapeHtml(a.reason)
    ])
  );
}

function reportCategoryLabel(category) {
  const labels = {
    engine_assistance: "Engine assistance",
    stalling_disconnect: "Stalling / disconnect",
    abuse_harassment: "Abuse / harassment",
    payment_wallet: "Payment / wallet",
    bug_settlement: "Bug / settlement",
    other: "Other"
  };
  return labels[category] || category || "Other";
}

async function adminVoidGame(gameId) {
  const reason = window.prompt("Reason for voiding this game?");
  if (!reason) return;
  state.adminLoading = true;
  render();
  try {
    await postJson(`/api/admin/games/${encodeURIComponent(gameId)}/void`, { reason });
    await Promise.all([loadAdminData("games"), loadAdminData("audit")]);
    state.adminTab = "games";
  } catch (error) {
    state.adminError = error.message;
  } finally {
    state.adminLoading = false;
    render();
  }
}

async function adminOpenAnalysis(gameId) {
  state.adminAnalysisFor = gameId;
  state.adminAnalysisLoading = true;
  state.adminAnalysisError = null;
  render();
  try {
    const data = await getJson(`/api/admin/games/${encodeURIComponent(gameId)}/analysis`);
    state.adminAnalysisData = data;
  } catch (error) {
    state.adminAnalysisError = error.message;
  } finally {
    state.adminAnalysisLoading = false;
    render();
  }
}

function adminCloseAnalysis() {
  state.adminAnalysisFor = null;
  state.adminAnalysisData = null;
  state.adminAnalysisError = null;
  render();
}

async function adminEnqueueAnalysis(gameId) {
  state.adminAnalysisLoading = true;
  render();
  try {
    await postJson(`/api/admin/games/${encodeURIComponent(gameId)}/analyze`, {});
    const data = await getJson(`/api/admin/games/${encodeURIComponent(gameId)}/analysis`);
    state.adminAnalysisData = data;
  } catch (error) {
    state.adminAnalysisError = error.message;
  } finally {
    state.adminAnalysisLoading = false;
    render();
  }
}

async function adminAdjustGame(gameId) {
  const result = window.prompt("New result: white_win, black_win, or draw?");
  if (!result) return;
  const reason = window.prompt("Reason for adjusting this settlement?");
  if (!reason) return;
  state.adminLoading = true;
  render();
  try {
    await postJson(`/api/admin/games/${encodeURIComponent(gameId)}/adjust`, { result, reason });
    await Promise.all([loadAdminData("games"), loadAdminData("ledger"), loadAdminData("audit")]);
    state.adminTab = "games";
  } catch (error) {
    state.adminError = error.message;
  } finally {
    state.adminLoading = false;
    render();
  }
}

async function adminRestrictUser(userId) {
  const raw = window.prompt(`Restrictions, comma-separated:\n${ADMIN_RESTRICTIONS.join(", ")}`);
  if (!raw) return;
  const restrictions = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const reason = window.prompt("Reason for applying restriction(s)?");
  if (!reason) return;
  state.adminLoading = true;
  render();
  try {
    await postJson(`/api/admin/users/${encodeURIComponent(userId)}/restrictions`, { restrictions, reason });
    await Promise.all([loadAdminData("users"), loadAdminData("games"), loadAdminData("audit")]);
    state.adminTab = "users";
  } catch (error) {
    state.adminError = error.message;
  } finally {
    state.adminLoading = false;
    render();
  }
}

async function adminClearRestriction(userId, restriction) {
  const reason = window.prompt(`Reason for clearing ${restriction}?`);
  if (!reason) return;
  state.adminLoading = true;
  render();
  try {
    await postJson(
      `/api/admin/users/${encodeURIComponent(userId)}/restrictions/${encodeURIComponent(restriction)}/clear`,
      { reason }
    );
    await Promise.all([loadAdminData("users"), loadAdminData("audit")]);
    state.adminTab = "users";
  } catch (error) {
    state.adminError = error.message;
  } finally {
    state.adminLoading = false;
    render();
  }
}

async function adminUpdateReportStatus(reportId, status) {
  const adminNote = window.prompt(`Admin note for marking this report ${status}?`) || "";
  state.adminLoading = true;
  render();
  try {
    await postJson(`/api/admin/reports/${encodeURIComponent(reportId)}/status`, { status, adminNote });
    await loadAdminData("reports");
    state.adminTab = "reports";
  } catch (error) {
    state.adminError = error.message;
  } finally {
    state.adminLoading = false;
    render();
  }
}

async function submitReport({ targetUserId = null, gameId = null, category = "other" } = {}) {
  if (!targetUserId && !gameId) return;
  const note = window.prompt("What should support review?");
  if (!note) return;
  const key = `report:${targetUserId || ""}:${gameId || ""}`;
  setActionInFlight(key, true);
  try {
    await postJson("/api/reports", { targetUserId, gameId, category, note });
    state.actionError = "Report sent to support.";
  } catch (error) {
    state.actionError = error.message;
  } finally {
    setActionInFlight(key, false);
    render();
  }
}

function formatShortTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\..+$/, "");
}

function renderUserProfile() {
  if (state.actionError) {
    return `<p class="muted">${escapeHtml(state.actionError)} <a href="#play">Back to lobby.</a></p>`;
  }
  const user = state.userProfile;
  if (!user) return `<p class="muted">Loading player...</p>`;
  const stats = user.stats ?? {};
  const recent = state.userRecentGames ?? [];
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
        ${renderAvatar(user, { surface: "user_profile" })}
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
          ${renderTrustTierChip(user)}
          ${user.calibrating ? `<span class="trust-chip muted">calibrating</span>` : ""}
        </div>
        ${renderProfileLinkedChips(user.externalAccounts)}
        <div class="profile-h2h">
          <small>H2H vs you</small>
          <strong>${escapeHtml(h2hScore)} ${h2hMoney}</strong>
          <span>${h2h ? `${h2h.games} shared game${h2h.games === 1 ? "" : "s"}` : "No shared history yet"}</span>
        </div>
        <button type="button" class="primary" data-profile-challenge="${escapeHtml(user.id)}"
          data-profile-stake="${escapeHtml(challengeStake ?? "")}"
          data-profile-time="${escapeHtml(challengeTime ?? "")}"
          ${!challengeStake || !challengeTime ? "disabled" : ""}>
          ${h2h?.games ? "Rematch" : "Challenge"} ${escapeHtml(user.handle)}${challengeStake ? ` · ${money(challengeStake)}` : ""}
        </button>
        ${user.id !== viewerId() ? `<button type="button" class="mini-button" data-report-user="${escapeHtml(user.id)}" data-report-category="other">Report player</button>` : ""}
        ${state.actionError ? `<em class="action-error">${escapeHtml(state.actionError)}</em>` : ""}
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
        ${renderProfileWagerEvidence(user.evidence)}
        ${renderProfileReliability(user.evidence)}
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
  if (state.view === "verify-email") {
    document.querySelector("#app").innerHTML = renderVerifyEmail();
    document.querySelectorAll("[data-verify-continue]").forEach((b) => {
      b.addEventListener("click", () => {
        window.location.hash = "#play";
        window.location.reload();
      });
    });
    return;
  }
  if (state.view === "password-reset") {
    document.querySelector("#app").innerHTML = renderPasswordResetView();
    const form = document.querySelector("[data-password-reset-form]");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        submitPasswordResetConfirm({
          token: state.passwordReset?.token || "",
          newPassword: fd.get("newPassword")
        });
      });
    }
    document.querySelectorAll("[data-reset-continue]").forEach((b) => {
      b.addEventListener("click", () => {
        window.location.hash = "";
        window.location.reload();
      });
    });
    return;
  }
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
          submitSignup({
            email,
            handle: fd.get("handle"),
            password,
            acceptedTosVersion: TOS_VERSION
          });
        } else {
          submitLogin({ email, password });
        }
      });
    }
    const resetForm = document.querySelector("[data-reset-request-form]");
    if (resetForm) {
      resetForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(resetForm);
        submitPasswordResetRequest(fd.get("email"));
      });
    }
    document.querySelectorAll("[data-dev-login]").forEach((b) => {
      b.addEventListener("click", () => {
        state.authMode = "login";
        submitLogin({ email: b.dataset.devLogin, password: b.dataset.devPassword });
      });
    });
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
    user: renderUserProfile,
    admin: renderAdmin
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
  document.querySelectorAll("[data-admin-tab]").forEach((b) => {
    b.addEventListener("click", () => switchAdminTab(b.dataset.adminTab));
  });
  document.querySelectorAll("[data-admin-game-void]").forEach((b) => {
    b.addEventListener("click", () => adminVoidGame(b.dataset.adminGameVoid));
  });
  document.querySelectorAll("[data-admin-game-adjust]").forEach((b) => {
    b.addEventListener("click", () => adminAdjustGame(b.dataset.adminGameAdjust));
  });
  document.querySelectorAll("[data-admin-game-analysis]").forEach((b) => {
    b.addEventListener("click", () => adminOpenAnalysis(b.dataset.adminGameAnalysis));
  });
  document.querySelectorAll("[data-admin-game-analyze]").forEach((b) => {
    b.addEventListener("click", () => adminEnqueueAnalysis(b.dataset.adminGameAnalyze));
  });
  document.querySelectorAll("[data-admin-analysis-close]").forEach((b) => {
    b.addEventListener("click", () => adminCloseAnalysis());
  });
  document.querySelectorAll("[data-admin-restrict-user]").forEach((b) => {
    b.addEventListener("click", () => adminRestrictUser(b.dataset.adminRestrictUser));
  });
  document.querySelectorAll("[data-admin-clear-restriction]").forEach((b) => {
    b.addEventListener("click", () => adminClearRestriction(b.dataset.adminClearRestriction, b.dataset.restriction));
  });
  document.querySelectorAll("[data-admin-report-status]").forEach((b) => {
    b.addEventListener("click", () => adminUpdateReportStatus(b.dataset.adminReportStatus, b.dataset.status));
  });
  document.querySelectorAll("[data-report-user], [data-report-game]").forEach((b) => {
    b.addEventListener("click", () => submitReport({
      targetUserId: b.dataset.reportUser || null,
      gameId: b.dataset.reportGame || null,
      category: b.dataset.reportCategory || "other"
    }));
  });
  document.querySelectorAll("[data-bell-toggle]").forEach((b) => {
    b.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleBellDropdown();
    });
  });
  document.querySelectorAll("[data-tos-show]").forEach((b) => {
    b.addEventListener("click", () => {
      state.tosViewerOpen = true;
      loadTosBody();
      render();
    });
  });
  document.querySelectorAll("[data-tos-close]").forEach((b) => {
    b.addEventListener("click", () => {
      state.tosViewerOpen = false;
      render();
    });
  });
  document.querySelectorAll("[data-tos-accept]").forEach((b) => {
    b.addEventListener("click", () => acceptTos());
  });
  if (shouldShowTosModal() || state.tosViewerOpen) loadTosBody();
  document.querySelectorAll("[data-cashier-open]").forEach((b) => {
    b.addEventListener("click", (event) => {
      event.preventDefault();
      state.cashierOpen = true;
      state.cashierError = null;
      render();
    });
  });
  document.querySelectorAll("[data-cashier-close]").forEach((b) => {
    b.addEventListener("click", () => {
      state.cashierOpen = false;
      state.cashierError = null;
      render();
    });
  });
  document.querySelectorAll("[data-cashier-backdrop]").forEach((el) => {
    el.addEventListener("click", (event) => {
      if (event.target !== el) return;
      state.cashierOpen = false;
      state.cashierError = null;
      render();
    });
  });
  document.querySelectorAll("[data-buy-package]").forEach((b) => {
    b.addEventListener("click", () => startChipPurchase(b.dataset.buyPackage));
  });
  const cashoutForm = document.querySelector("[data-cashout-waitlist]");
  if (cashoutForm) {
    cashoutForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(cashoutForm);
      submitCashoutWaitlist(fd.get("email"));
    });
  }
  document.querySelectorAll("[data-notification-link]").forEach((a) => {
    a.addEventListener("click", () => {
      const id = a.dataset.notificationId;
      // Best-effort mark-read; navigation continues via the href.
      if (id) markNotificationRead(id);
      if (state.notifications) state.notifications.dropdownOpen = false;
    });
  });
  document.querySelectorAll("[data-notifications-read-all]").forEach((b) => {
    b.addEventListener("click", () => markAllNotificationsRead());
  });
  document.querySelectorAll("[data-logout]").forEach((b) => {
    b.addEventListener("click", () => logout());
  });
  document.querySelectorAll("[data-resend-verify]").forEach((b) => {
    b.addEventListener("click", () => resendVerificationEmail());
  });
  document.querySelectorAll("[data-dismiss-game-error]").forEach((b) => {
    b.addEventListener("click", () => {
      state.gameError = null;
      render();
    });
  });
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", () => {
      const action = b.dataset.action;
      if (action === "counter-open") return openCounter();
      if (action === "counter-cancel") return closeCounter();
      if (action === "counter-submit") return submitCounter();
      actOnChallenge(action);
    });
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
  document.querySelectorAll("[data-pick-tier-pref]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pref = btn.dataset.pickTierPref;
      if (!pref || pref === state.matchTierPref) return;
      state.matchTierPref = pref;
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
  document.querySelectorAll("[data-watch-game]").forEach((b) => {
    b.addEventListener("click", () => watchLiveGame(b.dataset.watchGame));
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
  document.querySelectorAll("[data-avatar-equip]").forEach((b) => {
    b.addEventListener("click", () => equipAvatar(b.dataset.avatarEquip));
  });
  document.querySelectorAll("[data-avatar-buy]").forEach((b) => {
    b.addEventListener("click", () => purchaseAvatar(b.dataset.avatarBuy));
  });
  const linkExternalForm = document.querySelector("[data-link-external]");
  if (linkExternalForm) {
    linkExternalForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(linkExternalForm);
      linkExternalAccount({
        provider: fd.get("provider"),
        username: String(fd.get("username") || "").trim(),
        source: "settings"
      });
    });
  }
  document.querySelectorAll("[data-unlink-external]").forEach((b) => {
    b.addEventListener("click", () => unlinkExternalAccount(b.dataset.unlinkExternal));
  });
  document.querySelectorAll("[data-verify-start]").forEach((b) => {
    b.addEventListener("click", () => startVerification(b.dataset.verifyStart));
  });
  document.querySelectorAll("[data-verify-check]").forEach((b) => {
    b.addEventListener("click", () => checkVerification(b.dataset.verifyCheck));
  });
  document.querySelectorAll("[data-verify-cancel]").forEach((b) => {
    b.addEventListener("click", () => cancelVerification());
  });
  document.querySelectorAll("[data-verify-regenerate]").forEach((b) => {
    b.addEventListener("click", () => startVerification(b.dataset.verifyRegenerate, { regenerate: true }));
  });
  const onboardingForm = document.querySelector("[data-onboarding-link]");
  if (onboardingForm) {
    onboardingForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(onboardingForm);
      linkExternalAccount({
        provider: fd.get("provider"),
        username: String(fd.get("username") || "").trim(),
        source: "onboarding"
      });
    });
  }
  document.querySelectorAll("[data-onboarding-skip]").forEach((b) => {
    b.addEventListener("click", () => skipOnboarding());
  });
  document.querySelectorAll("[data-square]").forEach((square) => {
    square.addEventListener("click", () => {
      if (performance.now() < suppressBoardClickUntil) return;
      handleSquareIntent(square.dataset.square);
    });
    square.addEventListener("keydown", (event) => {
      handleSquareKey(event, square.dataset.square);
    });
    square.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const from = square.dataset.square;
      if (!canMoveFrom(state.activeGame, from)) return;
      boardDrag = {
        pointerId: event.pointerId,
        from,
        sourceEl: square,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        ghost: null
      };
    });
  });
  if (state.focusSquare) {
    document.querySelector(`[data-square="${state.focusSquare}"]`)?.focus({ preventScroll: true });
  }
  runBankrollTweens();
  runAmountTweens();
  maybePlaySettlementAudio();
  document.querySelectorAll("[data-milestone-dismiss]").forEach((b) => {
    b.addEventListener("click", () => dismissMilestone(b.dataset.milestoneDismiss));
  });
  document.querySelectorAll("[data-sound-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      setSoundMode(b.dataset.soundMode);
      // Click triggers initSound via the document-level capture handler,
      // so the user immediately hears confirmation if going to full mode.
      if (b.dataset.soundMode !== "mute") playSound("chip_click");
      render();
    });
  });
}

// Animated counter tween for money displays on settlement.
//
// Two elements are tween-eligible:
//   [data-bankroll-tween][data-from][data-to] — the metric-grid balance.
//     Tweens from previous balance to post-settlement balance.
//   [data-amount-tween][data-amount-prefix]   — the big amount line.
//     Counts up from 0 to the credited total (win/draw only — losses
//     stay steady because the loss narrative is the chip slide weight).
//
// Both honor prefers-reduced-motion (snap to final). Both are idempotent —
// adding a `data-tween-done` marker after run so re-renders mid-tween
// don't restart them.
function isReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function tweenCents(node, fromCents, toCents, durationMs, formatFn) {
  if (!node) return;
  const reduced = isReducedMotion();
  if (reduced || fromCents === toCents) {
    node.textContent = formatFn(toCents);
    node.setAttribute("data-tween-done", "1");
    return;
  }
  const start = performance.now();
  function frame(now) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    const eased = easeOutCubic(t);
    const value = Math.round(fromCents + (toCents - fromCents) * eased);
    node.textContent = formatFn(value);
    if (t < 1) requestAnimationFrame(frame);
    else node.setAttribute("data-tween-done", "1");
  }
  node.textContent = formatFn(fromCents);
  requestAnimationFrame(frame);
}

function runBankrollTweens() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-bankroll-tween]:not([data-tween-done])").forEach((node) => {
    const from = Number(node.dataset.from ?? 0);
    const to = Number(node.dataset.to ?? 0);
    const key = node.dataset.tweenKey || `balance:${from}:${to}`;
    if (completedMoneyTweenKeys.has(key)) {
      node.textContent = money(to);
      node.setAttribute("data-tween-done", "1");
      return;
    }
    completedMoneyTweenKeys.add(key);
    if (from !== to && !isReducedMotion()) {
      // Bankroll counter tick — paired sportsbook-style audio. The tick
      // descends in pitch on a downward balance change so the audio is
      // honest about direction (SOUNDSCAPE § Economic layer).
      const direction = to >= from ? "up" : "down";
      playSound("bankroll_tick", { count: 6, spacingMs: 110, direction });
    }
    tweenCents(node, from, to, 800, money);
  });
}

// Settlement chip audio is event-scoped. Re-rendering an existing settlement
// for scout/profile/history UI should not replay the economic result.
function maybePlaySettlementAudio() {
  if (typeof document === "undefined") return;
  if (state.route !== "settlement") return;
  const settlement = state.activeSettlement;
  if (!settlement || settlement.state !== "finalized") return;
  const gameId = state.activeGame?.id ?? state.routeParam;
  if (!gameId || playedSettlementAudioFor.has(gameId)) return;
  playedSettlementAudioFor.add(gameId);
  playSettlementSound(settlement.result);
}

// Track which settlement we've already shown the rematch-CTA gate animation
// for so realtime-triggered re-renders during the same view don't replay it.
// Returns true exactly once per gameId; the renderer omits the gate class on
// subsequent renders.
const settlementRenderedFor = new Set();
function isFirstSettlementRenderFor(gameId) {
  if (!gameId) return false;
  if (settlementRenderedFor.has(gameId)) return false;
  settlementRenderedFor.add(gameId);
  return true;
}

function runAmountTweens() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-amount-tween]:not([data-tween-done])").forEach((node) => {
    const target = Number(node.dataset.amountTween ?? 0);
    const prefix = node.dataset.amountPrefix ?? "";
    const key = node.dataset.tweenKey || `amount:${prefix}:${target}`;
    if (completedMoneyTweenKeys.has(key)) {
      node.textContent = `${prefix}${money(target)}`;
      node.setAttribute("data-tween-done", "1");
      return;
    }
    completedMoneyTweenKeys.add(key);
    tweenCents(node, 0, target, 700, (c) => `${prefix}${money(c)}`);
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
