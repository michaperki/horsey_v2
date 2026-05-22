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

test("initClockState seeds both sides equally and starts white's clock", () => {
  const clock = initClockState("3+0", T0);
  assert.equal(clock.whiteMs, 180_000);
  assert.equal(clock.blackMs, 180_000);
  assert.equal(clock.sideToMove, "white");
  assert.equal(clock.incrementMs, 0);
  assert.equal(clock.lastMoveAt, T0);
});

test("remainingForSide deducts elapsed only for the side currently to move", () => {
  const clock = initClockState("3+0", T0);
  // 5 seconds later, white's clock has been running
  const now = t0 + 5000;
  assert.equal(remainingForSide(clock, "white", now), 175_000);
  // Black's clock is paused at its stored value
  assert.equal(remainingForSide(clock, "black", now), 180_000);
});

test("applyMoveToClock deducts elapsed, adds increment, and flips the side", () => {
  const clock = initClockState("5+3", T0);
  // White spends 4 seconds, then moves
  const next = applyMoveToClock(clock, t0 + 4000);
  // white had 300_000, minus 4000 elapsed, plus 3000 increment = 299_000
  assert.equal(next.whiteMs, 299_000);
  assert.equal(next.blackMs, 300_000);
  assert.equal(next.sideToMove, "black");
  assert.equal(next.lastMoveAt, new Date(t0 + 4000).toISOString());

  // Now black spends 1 second
  const next2 = applyMoveToClock(next, t0 + 5000);
  assert.equal(next2.blackMs, 300_000 - 1000 + 3000);
  assert.equal(next2.whiteMs, 299_000);
  assert.equal(next2.sideToMove, "white");
});

test("applyMoveToClock throws clock_flagged if the moving side has run out", () => {
  const clock = initClockState("3+0", T0);
  assert.throws(
    () => applyMoveToClock(clock, t0 + 181_000),
    (err) => err.code === "clock_flagged" && err.flaggedSide === "white"
  );
});

test("flaggedSide returns the side that has run out, otherwise null", () => {
  const clock = initClockState("3+0", T0);
  assert.equal(flaggedSide(clock, t0 + 100), null);
  assert.equal(flaggedSide(clock, t0 + 180_000), "white");
  assert.equal(flaggedSide(clock, t0 + 250_000), "white");
});

test("msUntilFlag returns ms remaining for the side to move, clamped at 0", () => {
  const clock = initClockState("3+0", T0);
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
