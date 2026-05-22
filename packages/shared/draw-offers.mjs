// Pure draw-offer state machine.
//
// A `drawOffer` is either null or `{ offeredBy: "white" | "black", offeredAt: iso }`.
// The state machine has three actions a player can take (offer, accept, decline)
// plus an implicit "clear-own-offer-on-move" that fires when the offerer plays
// their next move. All actions return either the next drawOffer value or, in
// the accept case, a sentinel telling the caller to finalize the game.
//
// Errors carry a `code` so the HTTP layer can map them to status codes.

function fail(code, message) {
  const error = new RangeError(message);
  error.code = code;
  return error;
}

export function offerDraw(currentOffer, viewerColor, now) {
  assertColor(viewerColor);
  if (currentOffer && currentOffer.offeredBy === viewerColor) {
    throw fail("draw_already_offered", `${viewerColor} already has a pending draw offer`);
  }
  if (currentOffer && currentOffer.offeredBy !== viewerColor) {
    throw fail("draw_should_accept", "opponent already offered a draw; accept or decline instead");
  }
  return { offeredBy: viewerColor, offeredAt: toIso(now) };
}

export function acceptDraw(currentOffer, viewerColor) {
  assertColor(viewerColor);
  if (!currentOffer) throw fail("no_draw_offer", "no pending draw offer to accept");
  if (currentOffer.offeredBy === viewerColor) {
    throw fail("not_your_offer_to_accept", "cannot accept your own draw offer");
  }
  return { settle: true };
}

export function declineDraw(currentOffer, viewerColor) {
  assertColor(viewerColor);
  if (!currentOffer) throw fail("no_draw_offer", "no pending draw offer to decline");
  if (currentOffer.offeredBy === viewerColor) {
    throw fail("not_your_offer_to_decline", "cannot decline your own draw offer");
  }
  return null;
}

export function clearOwnOffer(currentOffer, movingColor) {
  if (!currentOffer) return null;
  if (currentOffer.offeredBy === movingColor) return null;
  return currentOffer;
}

function assertColor(value) {
  if (value !== "white" && value !== "black") {
    throw new TypeError(`color must be "white" or "black"; got ${value}`);
  }
}

function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "number") return new Date(now).toISOString();
  if (typeof now === "string") return now;
  throw new TypeError("now must be a Date, number, or ISO string");
}
