import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptDraw,
  clearOwnOffer,
  declineDraw,
  offerDraw
} from "../packages/shared/draw-offers.mjs";

const NOW = "2026-05-21T12:00:00.000Z";

test("offerDraw records the offerer and timestamp when no offer is pending", () => {
  assert.deepEqual(offerDraw(null, "white", NOW), { offeredBy: "white", offeredAt: NOW });
});

test("offerDraw rejects a same-side double offer", () => {
  const existing = { offeredBy: "white", offeredAt: NOW };
  assert.throws(
    () => offerDraw(existing, "white", NOW),
    (err) => err.code === "draw_already_offered"
  );
});

test("offerDraw tells the opponent to accept instead of double-offering", () => {
  const existing = { offeredBy: "black", offeredAt: NOW };
  assert.throws(
    () => offerDraw(existing, "white", NOW),
    (err) => err.code === "draw_should_accept"
  );
});

test("acceptDraw signals settlement when the opposite side has an open offer", () => {
  const existing = { offeredBy: "white", offeredAt: NOW };
  assert.deepEqual(acceptDraw(existing, "black"), { settle: true });
});

test("acceptDraw rejects when no offer is pending", () => {
  assert.throws(
    () => acceptDraw(null, "white"),
    (err) => err.code === "no_draw_offer"
  );
});

test("acceptDraw rejects when the offer is your own", () => {
  const existing = { offeredBy: "white", offeredAt: NOW };
  assert.throws(
    () => acceptDraw(existing, "white"),
    (err) => err.code === "not_your_offer_to_accept"
  );
});

test("declineDraw clears the opponent's offer", () => {
  const existing = { offeredBy: "white", offeredAt: NOW };
  assert.equal(declineDraw(existing, "black"), null);
});

test("declineDraw rejects when nothing to decline or when the offer is your own", () => {
  assert.throws(() => declineDraw(null, "black"), (err) => err.code === "no_draw_offer");
  const own = { offeredBy: "black", offeredAt: NOW };
  assert.throws(
    () => declineDraw(own, "black"),
    (err) => err.code === "not_your_offer_to_decline"
  );
});

test("clearOwnOffer clears an offer the moving side made and leaves the opponent's alone", () => {
  const own = { offeredBy: "white", offeredAt: NOW };
  const opponents = { offeredBy: "black", offeredAt: NOW };
  assert.equal(clearOwnOffer(own, "white"), null);
  assert.equal(clearOwnOffer(opponents, "white"), opponents);
  assert.equal(clearOwnOffer(null, "white"), null);
});

test("rejects invalid colors at the boundary", () => {
  assert.throws(() => offerDraw(null, "red", NOW), /color must be/);
  assert.throws(() => acceptDraw({ offeredBy: "white", offeredAt: NOW }, "red"), /color must be/);
  assert.throws(() => declineDraw({ offeredBy: "white", offeredAt: NOW }, "red"), /color must be/);
});
