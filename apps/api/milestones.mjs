// Milestone detection at game-finalize time.
//
// See docs/MILESTONES_NEXT_PASS.md for the design — what licenses
// celebration intensity, the tier ladder (0–4), and the catalog of
// first-time vs recurring events.
//
// This module is pure detection: given a finalized game + db handle, it
// returns an array of milestone records (event key + tier + metadata)
// for each player whose milestone fired. The caller (server.mjs) is
// responsible for persisting them via db.insertUserMilestone and
// publishing milestone.unlocked over the realtime broker.
//
// Detection is idempotent: a first-time milestone won't fire twice for
// the same user. Recurring milestones (streaks) fire once per threshold
// crossing.

const WIN_STREAK_THRESHOLDS = [3, 5, 7, 10, 15];

function newMilestoneId() {
  return `mst_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

// outcomeForUser: given a finalized game + user id, return "win" | "loss" | "draw"
function outcomeForUser(game, userId) {
  if (!game || game.state !== "finalized") return null;
  if (!game.winnerId) return "draw";
  return game.winnerId === userId ? "win" : "loss";
}

// Count consecutive wins ending at this game (inclusive). Walks the
// user's recent finalized games newest-first and counts wins until the
// first non-win is hit.
function currentWinStreak(db, userId) {
  const games = db.listFinalizedGamesForUser(userId, 30);
  let streak = 0;
  for (const g of games) {
    const o = outcomeForUser(g, userId);
    if (o === "win") streak += 1;
    else break;
  }
  return streak;
}

// Returns true if this is the first milestone of its key for the user.
// Used to gate first-time milestones (countUserMilestoneByKey === 0).
function isFirstTime(db, userId, eventKey) {
  return db.countUserMilestoneByKey(userId, eventKey) === 0;
}

// Returns true if this streak threshold has already fired for this user
// at any point (we don't refire the same threshold within a session).
function streakAlreadyFired(db, userId, threshold) {
  return db.countUserMilestoneByKey(userId, `win_streak_${threshold}`) > 0;
}

// Build a milestone record. Defaults tier 2 (callout) so milestones
// without an explicit tier still register but don't burst.
function makeMilestone({ userId, gameId, eventKey, tier = 2, metadata = {} }) {
  return {
    id: newMilestoneId(),
    userId,
    gameId,
    eventKey,
    tier,
    metadata,
    occurredAt: new Date().toISOString()
  };
}

export function detectMilestonesForGame(db, game) {
  if (!game || game.state !== "finalized") return [];
  const unlocks = [];
  for (const player of game.players ?? []) {
    const outcome = outcomeForUser(game, player.id);
    if (outcome !== "win") continue; // wins-only catalog for the v1 foundation

    // First win — tier 3 (burst). One-time, idempotent.
    if (isFirstTime(db, player.id, "first_win")) {
      unlocks.push(makeMilestone({
        userId: player.id,
        gameId: game.id,
        eventKey: "first_win",
        tier: 3,
        metadata: { opponentId: game.players.find((p) => p.id !== player.id)?.id ?? null }
      }));
    }

    // Win-streak thresholds. Computed against finalized-games history,
    // which already includes the just-finalized game (settleGame committed
    // before detection runs). Fires once per threshold crossing.
    const streak = currentWinStreak(db, player.id);
    for (const threshold of WIN_STREAK_THRESHOLDS) {
      if (streak === threshold && !streakAlreadyFired(db, player.id, threshold)) {
        unlocks.push(makeMilestone({
          userId: player.id,
          gameId: game.id,
          eventKey: `win_streak_${threshold}`,
          tier: threshold >= 5 ? 3 : 2,
          metadata: { streak: threshold }
        }));
      }
    }
  }
  return unlocks;
}

// Surface-facing payload for client renderers. Stable shape — clients key
// on eventKey + tier, render their own copy/visuals.
export function publicMilestonePayload(milestone) {
  if (!milestone) return null;
  return {
    id: milestone.id,
    eventKey: milestone.eventKey,
    tier: milestone.tier,
    gameId: milestone.gameId,
    metadata: milestone.metadata ?? {},
    occurredAt: milestone.occurredAt
  };
}
