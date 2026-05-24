import assert from "node:assert/strict";
import test from "node:test";
import { resolveAvatarForUser, resolveBasePieceForUser } from "../apps/api/cosmetics.mjs";

function account(rating, status = "claimed") {
  return {
    provider: "lichess",
    status,
    importedStats: {
      ratings: {
        blitz: { rating }
      }
    }
  };
}

test("base piece maps rating strength into the starter family", () => {
  assert.equal(resolveBasePieceForUser({ rating: 800 }, [], 1).piece, "pawn");
  assert.equal(resolveBasePieceForUser({ rating: 1200 }, [], 1).piece, "knight");
  assert.equal(resolveBasePieceForUser({ rating: 1500 }, [], 1).piece, "bishop");
  assert.equal(resolveBasePieceForUser({ rating: 1850 }, [], 1).piece, "rook");
  assert.equal(resolveBasePieceForUser({ rating: 2200 }, [], 1).piece, "queen");
});

test("linked rating drives the provisional base piece before Horsey games exist", () => {
  const base = resolveBasePieceForUser({ rating: 1200 }, [account(2180)], 0);
  assert.equal(base.piece, "queen");
  assert.equal(base.source, "linked_account");
  assert.equal(base.rating, 2180);
});

test("Horsey rating takes over the base piece once a user has finalized games", () => {
  const base = resolveBasePieceForUser({ rating: 1510 }, [account(2180)], 4);
  assert.equal(base.piece, "bishop");
  assert.equal(base.source, "horsey_rating");
  assert.equal(base.rating, 1510);
});

test("avatar resolver exposes identity metadata and live-state headwear priority", () => {
  const games = [
    { state: "finalized", winnerId: "usr_a" },
    { state: "finalized", winnerId: "usr_a" },
    { state: "finalized", winnerId: "usr_a" }
  ];
  const db = {
    getUser: () => ({ id: "usr_a", rating: 1740 }),
    listFinalizedGamesForUser: () => games,
    listExternalAccountsForUser: () => [],
    countUserMilestoneByKey: () => 1
  };
  const avatar = resolveAvatarForUser(db, "usr_a");
  assert.equal(avatar.base, "base__piece__rook");
  assert.equal(avatar.headwear, "milestone__headwear__flame_crown");
  assert.equal(avatar.identity.base_piece, "rook");
  assert.equal(avatar.identity.adornments.first_win_laurel, true);
  assert.equal(avatar.identity.adornments.win_streak, 3);
});
