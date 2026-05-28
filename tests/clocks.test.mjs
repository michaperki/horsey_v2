import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMoveToClock,
  flaggedSide,
  initClockState,
  msUntilFlag,
  parseTimeControl,
  remainingForSide
} from "../packages/shared/clocks.mjs";

const T0 = "2026-05-21T12:00:00.000Z";
const t0 = Date.parse(T0);

test("parseTimeControl parses min+inc and rejects garbage", () => {
  assert.deepEqual(parseTimeControl("3+0"), { baseMs: 180_000, incrementMs: 0 });
  assert.deepEqual(parseTimeControl("5+3"), { baseMs: 300_000, incrementMs: 3000 });
  assert.deepEqual(parseTimeControl("15+10"), { baseMs: 900_000, incrementMs: 10_000 });

  assert.throws(() => parseTimeControl("nope"), /time control/);
  assert.throws(() => parseTimeControl("3"), /time control/);
});

test("parseTimeControl parses sub-minute Ns+inc bullet formats", () => {
  assert.deepEqual(parseTimeControl("30s+0"), { baseMs: 30_000, incrementMs: 0 });
  assert.deepEqual(parseTimeControl("45s+1"), { baseMs: 45_000, incrementMs: 1000 });
  assert.deepEqual(parseTimeControl("15s+0"), { baseMs: 15_000, incrementMs: 0 });
});

test("parseTimeControl rejects bases shorter than 10 seconds", () => {
  assert.throws(() => parseTimeControl("5s+0"), /at least 10 seconds/);
  assert.throws(() => parseTimeControl("0s+0"), /at least 10 seconds/);
  assert.throws(() => parseTimeControl("0+0"), /at least 10 seconds/);
});

test("initClockState seeds both sides equally and marks no first moves made yet", () => {
  const clock = initClockState("3+0", T0);
  assert.equal(clock.whiteMs, 180_000);
  assert.equal(clock.blackMs, 180_000);
  assert.equal(clock.sideToMove, "white");
  assert.equal(clock.incrementMs, 0);
  assert.equal(clock.lastMoveAt, T0);
  assert.equal(clock.firstMovesMade, 0);
});

// Constructs a clock with both first moves already played, so the remaining
// helpers exercise normal mid-game ticking math. `applyMoveToClock` is used
// twice with a zero-time delta so the stored values stay round.
function startedClock(timeControl, now) {
  let clock = initClockState(timeControl, now);
  clock = applyMoveToClock(clock, now);
  clock = applyMoveToClock(clock, now);
  return clock;
}

test("main clock stays paused for the side-to-move during the first-move window", () => {
  const clock = initClockState("3+0", T0);
  // 5 seconds in — the 15s first-move pill is ticking but the main clock isn't.
  const now = t0 + 5000;
  assert.equal(remainingForSide(clock, "white", now), 180_000);
  assert.equal(remainingForSide(clock, "black", now), 180_000);

  // After white's first move, black is to-move but still hasn't started.
  const afterWhite = applyMoveToClock(clock, now);
  assert.equal(afterWhite.firstMovesMade, 1);
  assert.equal(afterWhite.sideToMove, "black");
  assert.equal(remainingForSide(afterWhite, "black", now + 5000), 180_000);

  // After black's first move, both clocks are running normally.
  const afterBlack = applyMoveToClock(afterWhite, now);
  assert.equal(afterBlack.firstMovesMade, 2);
  assert.equal(afterBlack.sideToMove, "white");
  assert.equal(remainingForSide(afterBlack, "white", now + 5000), 175_000);
});

test("applyMoveToClock credits increment without deducting elapsed for first moves", () => {
  const clock = initClockState("5+3", T0);
  // White spends 4 seconds before move 1 — but the main clock didn't tick.
  const next = applyMoveToClock(clock, t0 + 4000);
  // Stored stays at base + increment (300_000 + 3000), not 299_000.
  assert.equal(next.whiteMs, 303_000);
  assert.equal(next.blackMs, 300_000);
  assert.equal(next.sideToMove, "black");
  assert.equal(next.firstMovesMade, 1);

  // Black's first move also doesn't deduct.
  const next2 = applyMoveToClock(next, t0 + 5000);
  assert.equal(next2.blackMs, 303_000);
  assert.equal(next2.firstMovesMade, 2);
});

test("remainingForSide deducts elapsed only for the side currently to move (post-first-moves)", () => {
  const clock = startedClock("3+0", T0);
  // 5 seconds after both first moves, white is to-move.
  const now = t0 + 5000;
  assert.equal(remainingForSide(clock, "white", now), 175_000);
  assert.equal(remainingForSide(clock, "black", now), 180_000);
});

test("applyMoveToClock deducts elapsed, adds increment, and flips the side (post-first-moves)", () => {
  const clock = startedClock("5+3", T0);
  // Each side picked up one increment from their first move:
  //   whiteMs = blackMs = 300_000 + 3000 = 303_000.
  // White spends 4 seconds, then moves: 303_000 - 4000 + 3000 = 302_000.
  const next = applyMoveToClock(clock, t0 + 4000);
  assert.equal(next.whiteMs, 302_000);
  assert.equal(next.blackMs, 303_000);
  assert.equal(next.sideToMove, "black");
  assert.equal(next.lastMoveAt, new Date(t0 + 4000).toISOString());

  // Now black spends 1 second (elapsed since white's move at t0+4000):
  //   303_000 - 1000 + 3000 = 305_000.
  const next2 = applyMoveToClock(next, t0 + 5000);
  assert.equal(next2.blackMs, 305_000);
  assert.equal(next2.whiteMs, 302_000);
  assert.equal(next2.sideToMove, "white");
});

test("applyMoveToClock throws clock_flagged if the moving side has run out (post-first-moves)", () => {
  const clock = startedClock("3+0", T0);
  assert.throws(
    () => applyMoveToClock(clock, t0 + 181_000),
    (err) => err.code === "clock_flagged" && err.flaggedSide === "white"
  );
});

test("flaggedSide returns the side that has run out, otherwise null (post-first-moves)", () => {
  const clock = startedClock("3+0", T0);
  assert.equal(flaggedSide(clock, t0 + 100), null);
  assert.equal(flaggedSide(clock, t0 + 180_000), "white");
  assert.equal(flaggedSide(clock, t0 + 250_000), "white");
});

test("flaggedSide never reports a flag during the first-move window", () => {
  const clock = initClockState("3+0", T0);
  // Even at t0 + 10 minutes, the side-to-move can't flag against their main
  // clock — the first-move 15s timer is the only constraint there.
  assert.equal(flaggedSide(clock, t0 + 600_000), null);
});

test("msUntilFlag returns ms remaining for the side to move, clamped at 0 (post-first-moves)", () => {
  const clock = startedClock("3+0", T0);
  assert.equal(msUntilFlag(clock, t0), 180_000);
  assert.equal(msUntilFlag(clock, t0 + 100_000), 80_000);
  assert.equal(msUntilFlag(clock, t0 + 200_000), 0);
});

test("missing clock state returns null from accessors instead of throwing", () => {
  assert.equal(remainingForSide(null, "white", t0), null);
  assert.equal(flaggedSide(null, t0), null);
  assert.equal(msUntilFlag(null, t0), null);
  assert.equal(applyMoveToClock(null, t0), null);
});
