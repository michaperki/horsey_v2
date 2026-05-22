import assert from "node:assert/strict";
import test from "node:test";
import { computeRatingChange, DEFAULT_K_FACTOR } from "../packages/shared/rating.mjs";

test("equal ratings: winner gains K/2, loser loses K/2", () => {
  const change = computeRatingChange({ whiteRating: 1500, blackRating: 1500, result: "white_win" });
  assert.equal(change.whiteDelta, DEFAULT_K_FACTOR / 2);
  assert.equal(change.blackDelta, -DEFAULT_K_FACTOR / 2);
  assert.equal(change.whiteAfter, 1500 + change.whiteDelta);
  assert.equal(change.blackAfter, 1500 + change.blackDelta);
});

test("equal ratings draw produces no movement", () => {
  const change = computeRatingChange({ whiteRating: 1500, blackRating: 1500, result: "draw" });
  assert.equal(change.whiteDelta, 0);
  assert.equal(change.blackDelta, 0);
});

test("favorite winning gains less than an upset would", () => {
  const favored = computeRatingChange({ whiteRating: 1700, blackRating: 1500, result: "white_win" });
  const upset = computeRatingChange({ whiteRating: 1500, blackRating: 1700, result: "white_win" });
  assert.ok(favored.whiteDelta > 0 && favored.whiteDelta < DEFAULT_K_FACTOR / 2);
  assert.ok(upset.whiteDelta > DEFAULT_K_FACTOR / 2);
});

test("draw between unequal players favors the underdog", () => {
  const change = computeRatingChange({ whiteRating: 1700, blackRating: 1500, result: "draw" });
  assert.ok(change.whiteDelta < 0, "stronger player loses rating on a draw");
  assert.ok(change.blackDelta > 0, "weaker player gains rating on a draw");
});

test("rating change is zero-sum across both sides", () => {
  for (const result of ["white_win", "black_win", "draw"]) {
    for (const pair of [[1500, 1500], [1700, 1500], [1500, 1900], [800, 2400]]) {
      const change = computeRatingChange({ whiteRating: pair[0], blackRating: pair[1], result });
      assert.equal(change.whiteDelta + change.blackDelta, 0, `result=${result} pair=${pair}`);
    }
  }
});

test("custom k scales the movement", () => {
  const slow = computeRatingChange({ whiteRating: 1500, blackRating: 1500, result: "white_win", k: 10 });
  const fast = computeRatingChange({ whiteRating: 1500, blackRating: 1500, result: "white_win", k: 40 });
  assert.equal(slow.whiteDelta, 5);
  assert.equal(fast.whiteDelta, 20);
});

test("rejects invalid result codes", () => {
  assert.throws(
    () => computeRatingChange({ whiteRating: 1500, blackRating: 1500, result: "abandon" }),
    /result must be one of/
  );
});

test("rejects non-finite ratings and non-positive k", () => {
  assert.throws(() => computeRatingChange({ whiteRating: NaN, blackRating: 1500, result: "draw" }), TypeError);
  assert.throws(() => computeRatingChange({ whiteRating: 1500, blackRating: 1500, result: "draw", k: 0 }), RangeError);
});
