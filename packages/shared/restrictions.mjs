// Shadow-restriction ladder per FAIR_PLAY_NEXT_PASS.md § Enforcement Ladder
// and OPERATIONAL_POLICY.md § 1.14. Ordered softest → hardest.
//
// The order matters: a higher-position restriction is at least as harsh as any
// lower one. Hard ban is terminal and side-effects (auto-void any live game)
// are handled in the server layer, not here.

export const RESTRICTION_LADDER = [
  "lower_trust_score",            // internal only; affects matchmaking + withdrawal review priority
  "reduced_stake_limits",         // user sees a cap when wagering above it; reason stays vague
  "delayed_withdrawals",          // flat hold on all withdrawal requests
  "promotion_ineligibility",      // silently excluded from bonuses/quests/rewards
  "restricted_matchmaking",       // paired only against similar-risk accounts
  "manual_review_required",       // every withdrawal goes to admin queue
  "reduced_visibility",           // open tables not shown to general lobby (shadowban)
  "no_rewards_from_suspicious",   // settlement happens but doesn't count toward quests/streaks/trust
  "hard_ban"                      // terminal — used for high-confidence or repeat offenders
];

export const RESTRICTIONS = new Set(RESTRICTION_LADDER);

export function isValidRestriction(value) {
  return RESTRICTIONS.has(value);
}

// Highest active restriction by ladder position, or null. Useful for surfacing
// the most-severe state in a single chip without listing the full set.
export function severestRestriction(activeRestrictions) {
  if (!Array.isArray(activeRestrictions) || activeRestrictions.length === 0) return null;
  let bestIndex = -1;
  let best = null;
  for (const r of activeRestrictions) {
    const idx = RESTRICTION_LADDER.indexOf(r.restriction ?? r);
    if (idx > bestIndex) {
      bestIndex = idx;
      best = r;
    }
  }
  return best;
}

export function hasRestriction(activeRestrictions, restriction) {
  return (activeRestrictions ?? []).some((r) => (r.restriction ?? r) === restriction);
}

export function isHardBanned(activeRestrictions) {
  return hasRestriction(activeRestrictions, "hard_ban");
}
