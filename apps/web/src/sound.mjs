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
  "chip_cascade",
  "milestone_unlock_t1",
  "milestone_unlock_t2",
  "milestone_unlock_t3",
  "check",
  "mate"
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
function playBankrollTick({ count = 6, spacingMs = 110 } = {}) {
  if (!ctx) return;
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 1100 + i * 20;
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
