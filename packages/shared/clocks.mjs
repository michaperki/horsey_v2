// Pure clock domain helpers. No I/O, no Date.now() — callers pass `now` so
// tests are deterministic and the server can replay scheduled-time decisions.
//
// Clock state shape:
//   {
//     whiteMs: integer remaining ms when it is white's turn AND lastMoveAt
//              was the moment black completed its move,
//     blackMs: same, symmetric,
//     sideToMove: "white" | "black",
//     lastMoveAt: ISO timestamp string — when the side-to-move's clock started running,
//     incrementMs: integer ms added to a side after that side completes a move
//   }
//
// `whiteMs` / `blackMs` are "remaining at the start of the current turn." To
// get a live remaining-now reading for the side currently to move, subtract
// (now - lastMoveAt). The opponent's clock is paused, so their number is
// already live.

const TIME_CONTROL_RE = /^(\d+)(s?)\+(\d+)$/;
const MIN_BASE_MS = 10_000;

export function parseTimeControl(timeControl) {
  const m = TIME_CONTROL_RE.exec(String(timeControl ?? "").trim());
  if (!m) {
    const error = new RangeError(`time control must look like "min+inc" or "Ns+inc"; got: ${timeControl}`);
    error.code = "invalid_time_control";
    throw error;
  }
  const value = Number(m[1]);
  const inSeconds = m[2] === "s";
  const incrementSeconds = Number(m[3]);
  const baseMs = inSeconds ? value * 1000 : value * 60 * 1000;
  if (baseMs < MIN_BASE_MS) {
    const error = new RangeError(`time control base must be at least 10 seconds; got: ${timeControl}`);
    error.code = "invalid_time_control";
    throw error;
  }
  return {
    baseMs,
    incrementMs: incrementSeconds * 1000
  };
}

export function initClockState(timeControl, now) {
  const { baseMs, incrementMs } = parseTimeControl(timeControl);
  if (baseMs <= 0) {
    const error = new RangeError("time control base must be positive");
    error.code = "invalid_time_control";
    throw error;
  }
  return {
    whiteMs: baseMs,
    blackMs: baseMs,
    sideToMove: "white",
    lastMoveAt: toIso(now),
    incrementMs
  };
}

export function remainingForSide(clock, side, now) {
  if (!clock) return null;
  const stored = side === "white" ? clock.whiteMs : clock.blackMs;
  if (clock.sideToMove !== side) return stored;
  const elapsed = msSince(clock.lastMoveAt, now);
  return stored - elapsed;
}

export function flaggedSide(clock, now) {
  if (!clock) return null;
  const remaining = remainingForSide(clock, clock.sideToMove, now);
  if (remaining <= 0) return clock.sideToMove;
  return null;
}

export function applyMoveToClock(clock, now) {
  if (!clock) return null;
  const moving = clock.sideToMove;
  const elapsed = msSince(clock.lastMoveAt, now);
  const remaining = (moving === "white" ? clock.whiteMs : clock.blackMs) - elapsed;
  if (remaining <= 0) {
    const error = new RangeError(`${moving} flagged before move could be applied`);
    error.code = "clock_flagged";
    error.flaggedSide = moving;
    throw error;
  }
  const next = remaining + clock.incrementMs;
  const opponent = moving === "white" ? "black" : "white";
  return {
    ...clock,
    whiteMs: moving === "white" ? next : clock.whiteMs,
    blackMs: moving === "black" ? next : clock.blackMs,
    sideToMove: opponent,
    lastMoveAt: toIso(now)
  };
}

export function msUntilFlag(clock, now) {
  if (!clock) return null;
  const remaining = remainingForSide(clock, clock.sideToMove, now);
  return Math.max(0, remaining);
}

function msSince(iso, now) {
  const past = Date.parse(iso);
  const present = typeof now === "number" ? now : Date.parse(toIso(now));
  return present - past;
}

function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "number") return new Date(now).toISOString();
  if (typeof now === "string") return now;
  throw new TypeError("now must be a Date, number, or ISO string");
}
