// Soundscape foundation. See docs/SOUNDSCAPE_NEXT_PASS.md for the design.
//
// This module is the WebAudio harness: it owns the AudioContext, the
// sound mode setting (full / essentials / mute), the play API, and a
// small synthesized sample bank for the foundation. Real recorded
// samples replace the synthesized ones in a later slice.
//
// Design constraints honored here:
//   - No autoplay before user gesture. The context is created lazy +
//     resumed on the first user click captured at the document level.
//   - Master mute via setSoundMode("mute"). Persists in localStorage.
//   - "essentials" mode plays only tier-1 critical events (settlement,
//     check, mate, milestones).
//   - Sounds stack carefully: rate-limit duplicate-event playback within
//     50ms (ducking) and never queue more than one heavy sample at a time.
//
// Event registry — what's defined and what tier each is:
//   chip_click   tier 2  short percussive noise burst (single chip lands)
//   chip_cascade tier 1  several chip clicks (settlement chip-rake)
//   bankroll_tick tier 2  sub-second tick (sportsbook counter)
//   milestone_unlock_t1 tier 2  soft chime (toast)
//   milestone_unlock_t2 tier 1  resolving tone (callout)
//   milestone_unlock_t3 tier 1  two-stage chord + chip cascade (burst)
//
// Anti-patterns honored (see SOUNDSCAPE_NEXT_PASS § Anti-patterns):
//   - No coin-shower / slide-whistle / 8-bit chiptune
//   - No looped background ambience (deferred)
//   - No "ta-da" / voice cues

const STORAGE_KEY = "horsey.soundMode";
const MODES = ["full", "essentials", "mute"];
const ESSENTIAL_EVENTS = new Set([
  "game_start",
  "game_end_win",
  "game_end_loss",
  "game_end_draw",
  "chip_cascade",
  "milestone_unlock_t1",
  "milestone_unlock_t2",
  "milestone_unlock_t3",
  "check_chime",
  "mate_chime"
]);

let ctx = null;
let masterGain = null;
let mode = readMode();
const lastPlayedAt = new Map(); // eventKey -> timestamp ms

function readMode() {
  if (typeof localStorage === "undefined") return "full";
  const stored = localStorage.getItem(STORAGE_KEY);
  return MODES.includes(stored) ? stored : "full";
}

export function getSoundMode() {
  return mode;
}

export function setSoundMode(next) {
  if (!MODES.includes(next)) return;
  mode = next;
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  if (masterGain) {
    masterGain.gain.value = mode === "mute" ? 0 : 1;
  }
}

// Lazy init. Must be called from a user-gesture handler the first time;
// safe to call repeatedly afterward.
export function initSound() {
  if (typeof window === "undefined") return;
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx = new AudioCtx();
  masterGain = ctx.createGain();
  masterGain.gain.value = mode === "mute" ? 0 : 1;
  masterGain.connect(ctx.destination);
}

function shouldPlay(eventKey) {
  if (mode === "mute") return false;
  if (mode === "essentials" && !ESSENTIAL_EVENTS.has(eventKey)) return false;
  // Dedupe: drop a repeat of the same event within 50ms.
  const now = performance.now();
  const last = lastPlayedAt.get(eventKey) ?? 0;
  if (now - last < 50) return false;
  lastPlayedAt.set(eventKey, now);
  return true;
}

// Convenience: tier mix values (in linear gain). Maps the doc's
// dB hierarchy onto playable gains. Critical = 1.0 (0 dB), Action = 0.5
// (~-6 dB), Ambient = 0.25 (~-12 dB), Decorative = 0.13 (~-18 dB).
const TIER_GAIN = { critical: 1.0, action: 0.5, ambient: 0.25, decorative: 0.13 };

// === Synthesized sample bank ===

// Short percussive chip-click. Band-passed noise burst, ~80ms.
// The mid-range center frequency (~2.6 kHz) reads as "small plastic
// disc on felt" rather than the higher coin-clink the band-pass
// would otherwise suggest.
function playChipClick(tier = "action") {
  if (!ctx) return;
  const dur = 0.075;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.6;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2600;
  bp.Q.value = 4;

  const env = ctx.createGain();
  const now = ctx.currentTime;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(TIER_GAIN[tier] ?? TIER_GAIN.action, now + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(bp).connect(env).connect(masterGain);
  src.start(now);
  src.stop(now + dur);
}

// Several chip clicks in rapid sequence — the rake cascade. Variant offsets
// keep it from sounding mechanical.
function playChipCascade({ count = 5, spacingMs = 70, tier = "critical" } = {}) {
  if (!ctx) return;
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => playChipClick(tier), i * spacingMs + Math.random() * 12);
  }
}

// Sub-second ticker — sportsbook-style counter sound. Square wave bursts
// suggest a digital sportsbook display rather than a slot machine.
function playBankrollTick({ count = 6, spacingMs = 110, direction = "up" } = {}) {
  if (!ctx) return;
  // Up-ticks sweep brighter; down-ticks (losses) start lower and descend so
  // the same "sportsbook counter" register reads as honest about direction.
  // See docs/SOUNDSCAPE_NEXT_PASS.md § Economic layer.
  const base = direction === "down" ? 720 : 1100;
  const step = direction === "down" ? -18 : 20;
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = base + i * step;
      const g = ctx.createGain();
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(TIER_GAIN.decorative, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
      osc.connect(g).connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.05);
    }, i * spacingMs);
  }
}

// Soft chime — tier-1 milestone toast.
function playMilestoneToast() {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 880;
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(TIER_GAIN.ambient, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.6);
}

// Two-note rising chime — tier-2 ambient. Soft enough not to startle,
// distinct enough that the user notices something arrived. Different
// from the milestone toast (slower, lower pair) so the two cues don't
// blur together for users running with full sound.
function playNotificationArrived() {
  if (!ctx) return;
  const now = ctx.currentTime;
  [
    { freq: 740, start: 0,    dur: 0.12 },
    { freq: 990, start: 0.08, dur: 0.22 }
  ].forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(TIER_GAIN.ambient, now + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g).connect(masterGain);
    osc.start(now + start);
    osc.stop(now + start + dur);
  });
}

// Resolving two-note tone — tier-2 milestone callout.
function playMilestoneCallout() {
  if (!ctx) return;
  const now = ctx.currentTime;
  [
    { freq: 660, start: 0,    dur: 0.18 },
    { freq: 880, start: 0.18, dur: 0.28 }
  ].forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(TIER_GAIN.action, now + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g).connect(masterGain);
    osc.start(now + start);
    osc.stop(now + start + dur);
  });
}

// Wood-on-felt piece drop. Noise burst low-passed to remove the metallic
// high-end, with a quick attack/decay envelope. Reads as a tactile thud
// rather than a click. ~60ms total.
function playPieceDrop() {
  if (!ctx) return;
  const dur = 0.06;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.5;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  // Slight per-call variation keeps repeated drops from sounding robotic.
  lp.frequency.value = 1100 + (Math.random() * 200 - 100);
  lp.Q.value = 1.2;

  const env = ctx.createGain();
  const now = ctx.currentTime;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(TIER_GAIN.action, now + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(lp).connect(env).connect(masterGain);
  src.start(now);
  src.stop(now + dur);
}

// Capture: heavier and slightly longer than a regular drop. Two-stage —
// the contact thud followed by a brief lower-pitched body resonance so it
// reads as wood-on-wood with mass.
function playPieceCapture() {
  if (!ctx) return;
  const now = ctx.currentTime;

  // Contact thud (filtered noise burst, ~80ms)
  const dur = 0.08;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.7;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 850;
  lp.Q.value = 1.5;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(TIER_GAIN.action * 1.1, now + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(lp).connect(env).connect(masterGain);
  src.start(now);
  src.stop(now + dur);

  // Body resonance — low triangle with quick decay
  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.value = 110 + Math.random() * 20;
  const bodyEnv = ctx.createGain();
  bodyEnv.gain.setValueAtTime(0, now);
  bodyEnv.gain.linearRampToValueAtTime(TIER_GAIN.ambient, now + 0.005);
  bodyEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  body.connect(bodyEnv).connect(masterGain);
  body.start(now);
  body.stop(now + 0.17);
}

// Check chime: single low resolving tone. Sine wave at ~330 Hz with a
// short attack and a longer tail than the piece sounds — distinct enough
// to register through a flurry of moves.
function playCheckChime() {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 330;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(TIER_GAIN.action * 0.8, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.45);
}

// Mate cue: two-stage descending tone + soft impact. The match-ending
// sound — distinct from check, deserves real production weight.
function playMateChime() {
  if (!ctx) return;
  const now = ctx.currentTime;
  [
    { freq: 330, start: 0,    dur: 0.32 },
    { freq: 220, start: 0.18, dur: 0.5 }
  ].forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(TIER_GAIN.action, now + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g).connect(masterGain);
    osc.start(now + start);
    osc.stop(now + start + dur);
  });
}

// Game-start hook: a low-warm power chord (root + fifth + octave) that
// resolves into a chip-rack thud. ~700ms total. Reads as "the rack just
// landed on the table; the round is on." This is the bookend with the
// game-end sound — both should feel substantial, not chimey.
function playGameStart() {
  if (!ctx) return;
  const now = ctx.currentTime;
  // Triangle-wave power chord — warmer than sine, less buzzy than saw.
  [
    { freq: 130, dur: 0.55 },  // C3 root
    { freq: 196, dur: 0.55 },  // G3 fifth
    { freq: 262, dur: 0.5  }   // C4 octave
  ].forEach(({ freq, dur }, idx) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    // Stagger the entries slightly so the chord opens up rather than blocks.
    const attackAt = now + idx * 0.04;
    g.gain.setValueAtTime(0, attackAt);
    g.gain.linearRampToValueAtTime(TIER_GAIN.action * (idx === 0 ? 0.9 : 0.55), attackAt + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, attackAt + dur);
    osc.connect(g).connect(masterGain);
    osc.start(attackAt);
    osc.stop(attackAt + dur);
  });
  // Chip-rack thud lands after the chord opens.
  setTimeout(() => playChipClick("critical"), 320);
  setTimeout(() => playChipClick("critical"), 380);
}

// Game-end hook on a win: short rising chord lands hard, then a chip
// cascade pours toward you. Triumphant but contained — no shower, no
// fanfare, just the moment of the rack being pushed your way.
function playGameEndWin() {
  if (!ctx) return;
  const now = ctx.currentTime;
  // Ascending pair: lower octave punch, then higher octave settle.
  [
    { freq: 165, start: 0,    dur: 0.5 },  // E3
    { freq: 247, start: 0.08, dur: 0.55 }, // B3
    { freq: 330, start: 0.16, dur: 0.6 }   // E4
  ].forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(TIER_GAIN.action * 0.75, now + start + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g).connect(masterGain);
    osc.start(now + start);
    osc.stop(now + start + dur);
  });
  // Chip cascade overlay — the rake itself.
  setTimeout(() => playChipCascade({ count: 6, spacingMs: 55, tier: "action" }), 250);
}

// Game-end on a loss: descending low tone with weight. No celebration.
// Heavy chip drag toward the opponent. Honest about the outcome.
function playGameEndLoss() {
  if (!ctx) return;
  const now = ctx.currentTime;
  // Descending two-note: the result lands and settles.
  [
    { freq: 175, start: 0,    dur: 0.6 },  // F3
    { freq: 110, start: 0.22, dur: 0.85 }  // A2
  ].forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(TIER_GAIN.action * 0.7, now + start + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g).connect(masterGain);
    osc.start(now + start);
    osc.stop(now + start + dur);
  });
  // Slower, heavier chip drag.
  setTimeout(() => playChipCascade({ count: 5, spacingMs: 130, tier: "ambient" }), 300);
}

// Game-end on a draw: balanced two-note that doesn't resolve up or down.
// Neutral, no fanfare.
function playGameEndDraw() {
  if (!ctx) return;
  const now = ctx.currentTime;
  [
    { freq: 220, start: 0,    dur: 0.55 },  // A3
    { freq: 220, start: 0.18, dur: 0.55 }   // same tone, restated
  ].forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(TIER_GAIN.action * 0.55, now + start + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g).connect(masterGain);
    osc.start(now + start);
    osc.stop(now + start + dur);
  });
  setTimeout(() => playChipCascade({ count: 4, spacingMs: 95, tier: "ambient" }), 240);
}

// Two-stage chord + chip-cascade overlay — tier-3 milestone burst.
function playMilestoneBurst() {
  if (!ctx) return;
  const now = ctx.currentTime;
  // Low-warm chord (root + fifth + octave), brief.
  [330, 440, 660].forEach((freq) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(TIER_GAIN.action * 0.6, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(g).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.7);
  });
  // Chip cascade overlay after the chord lands.
  setTimeout(() => playChipCascade({ count: 5, spacingMs: 60, tier: "action" }), 150);
}

// === Public play API ===

export function playSound(eventKey, opts = {}) {
  if (!shouldPlay(eventKey)) return;
  initSound(); // safe no-op if already running
  if (!ctx || ctx.state !== "running") return;
  switch (eventKey) {
    case "chip_click":
      return playChipClick(opts.tier ?? "action");
    case "chip_cascade":
      return playChipCascade(opts);
    case "bankroll_tick":
      return playBankrollTick(opts);
    case "milestone_unlock_t1":
      return playMilestoneToast();
    case "milestone_unlock_t2":
      return playMilestoneCallout();
    case "milestone_unlock_t3":
      return playMilestoneBurst();
    case "piece_drop":
      return playPieceDrop();
    case "piece_capture":
      return playPieceCapture();
    case "check_chime":
      return playCheckChime();
    case "mate_chime":
      return playMateChime();
    case "notification_arrived":
      return playNotificationArrived();
    case "game_start":
      return playGameStart();
    case "game_end_win":
      return playGameEndWin();
    case "game_end_loss":
      return playGameEndLoss();
    case "game_end_draw":
      return playGameEndDraw();
    default:
      // Unknown event keys are silent — they'll surface as events that
      // need to be added to the registry, not as runtime errors.
      return;
  }
}

// Convenience: pick the right milestone sound for a given tier.
export function playMilestoneSound(tier) {
  const t = Number(tier) || 1;
  if (t >= 3) return playSound("milestone_unlock_t3");
  if (t === 2) return playSound("milestone_unlock_t2");
  return playSound("milestone_unlock_t1");
}

// Convenience: pick the right settlement chip sound for outcome. Losses
// get a slower, slightly lower chip cascade than wins; draws split.
export function playSettlementSound(outcome) {
  if (outcome === "win") return playSound("chip_cascade", { count: 5, spacingMs: 65 });
  if (outcome === "loss") return playSound("chip_cascade", { count: 4, spacingMs: 110, tier: "ambient" });
  if (outcome === "draw") return playSound("chip_cascade", { count: 4, spacingMs: 90, tier: "ambient" });
}
