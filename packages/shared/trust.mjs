// Trust-tier model. See docs/IMPLEMENTATION_PLAN.md § Trust Tiers for the
// canonical doc. This module is the single source of truth for which tier a
// user occupies and what stake cap that tier permits. Pure function — no DB
// access, no I/O.

import { cents } from "./domain.mjs";

export const TIERS = ["provisional", "claimed", "verified", "established"];

// Rank used for "minimum tier" floors in matchmaking and challenge filters.
// established sits at the top because it implies real platform history on top
// of (usually) a linked account.
const TIER_RANK = {
  provisional: 0,
  claimed: 1,
  verified: 2,
  established: 3
};

export function tierRank(tier) {
  return TIER_RANK[tier] ?? 0;
}

// "any" is the open floor — every tier qualifies. The named tier values
// raise the floor. Used by quickMatch tier preferences and open-table filters.
export const TIER_FLOORS = ["any", "claimed", "verified"];

export function isValidTierFloor(value) {
  return TIER_FLOORS.includes(value);
}

export function meetsTierFloor(actualTier, requiredFloor) {
  if (!requiredFloor || requiredFloor === "any") return true;
  return tierRank(actualTier) >= tierRank(requiredFloor);
}

export const ESTABLISHED_GAMES_THRESHOLD = 50;

// Per-game play-token stake caps. Tune as the loop calibrates.
const STAKE_CAP_CENTS = {
  provisional: cents(25),
  claimed: cents(100),
  verified: cents(500),
  established: cents(1000)
};

// verification_pending counts as claimed-tier: the public stats are real,
// only the binding proof is in flight.
const CLAIMED_LIKE_STATUSES = new Set(["claimed", "verification_pending"]);

export function computeTrustTier({ externalAccounts = [], finishedGames = 0 } = {}) {
  if (externalAccounts.some((a) => a?.status === "verified")) {
    return finishedGames >= ESTABLISHED_GAMES_THRESHOLD ? "established" : "verified";
  }
  if (externalAccounts.some((a) => CLAIMED_LIKE_STATUSES.has(a?.status))) {
    return finishedGames >= ESTABLISHED_GAMES_THRESHOLD ? "established" : "claimed";
  }
  return finishedGames >= ESTABLISHED_GAMES_THRESHOLD ? "established" : "provisional";
}

export function stakeCapForTier(tier) {
  return STAKE_CAP_CENTS[tier] ?? STAKE_CAP_CENTS.provisional;
}

// When two users are about to wager, the lower cap applies. This protects the
// less-trusted side from being pulled into a stake their tier shouldn't see.
export function effectiveStakeCapCents(viewerTier, opponentTier) {
  const v = stakeCapForTier(viewerTier);
  if (!opponentTier) return v;
  return Math.min(v, stakeCapForTier(opponentTier));
}
