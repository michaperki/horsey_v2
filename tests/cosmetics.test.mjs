import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TIER_BORDER_IDS,
  borderForTier,
  grantCosmeticsForMilestone,
  resolveAvatarForUser,
  resolveBasePieceForUser,
  syncTrustBorderForUser
} from "../apps/api/cosmetics.mjs";
import { openDatabase } from "../apps/api/db.mjs";

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

test("first-win milestone grants and equips the laurel cosmetic", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-cosmetics-"));
  const db = openDatabase(path.join(dir, "test.db"));
  try {
    db.insertUser({
      id: "usr_a",
      email: "a@example.test",
      handle: "Alpha",
      passwordHash: "hash",
      passwordSalt: "salt",
      rating: 1200,
      createdAt: "2026-05-24T00:00:00.000Z"
    });
    const milestone = {
      id: "mst_first",
      userId: "usr_a",
      eventKey: "first_win",
      tier: 3,
      gameId: "game_1",
      metadata: {},
      occurredAt: "2026-05-24T00:01:00.000Z"
    };

    const grants = grantCosmeticsForMilestone(db, milestone, { idFactory: () => "ucm_first" });

    assert.equal(grants.length, 1);
    assert.equal(grants[0].cosmeticId, "milestone__headwear__laurel");
    assert.equal(db.listUserCosmetics("usr_a").length, 1);
    assert.deepEqual(db.listUserCosmeticEquipForUser("usr_a"), {
      headwear: "milestone__headwear__laurel"
    });
    assert.equal(db.getCosmeticCatalogItem("milestone__headwear__laurel").slot, "headwear");
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("trust-border ladder lock — every product tier maps to a known border", () => {
  assert.equal(borderForTier("provisional"), "trust__border__provisional");
  assert.equal(borderForTier("claimed"),     "trust__border__provisional");
  assert.equal(borderForTier("verified"),    "trust__border__verified");
  assert.equal(borderForTier("established"), "trust__border__trusted");
  // Unknown tiers fall back to provisional, not undefined.
  assert.equal(borderForTier("unknown"), "trust__border__provisional");
  // The ladder reserves elite/champion — neither should be in the active set.
  assert.ok(!TIER_BORDER_IDS.includes("trust__border__elite"));
  assert.ok(!TIER_BORDER_IDS.includes("trust__border__champion"));
});

test("trust-border sync grants, equips, retires on upgrade, reinstates on downgrade", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-trust-border-"));
  const db = openDatabase(path.join(dir, "test.db"));
  try {
    db.insertUser({
      id: "usr_a",
      email: "a@example.test",
      handle: "Alpha",
      passwordHash: "hash",
      passwordSalt: "salt",
      rating: 1200,
      createdAt: "2026-05-25T00:00:00.000Z"
    });

    let counter = 0;
    const idFactory = () => `ucm_${++counter}`;

    // 1. Initial provisional grant.
    const grant1 = syncTrustBorderForUser(db, "usr_a", "provisional", { idFactory, now: "2026-05-25T00:01:00.000Z" });
    assert.ok(grant1);
    assert.equal(grant1.cosmeticId, "trust__border__provisional");
    assert.equal(db.listUserCosmeticEquipForUser("usr_a").border, "trust__border__provisional");
    assert.equal(db.listUserCosmetics("usr_a").length, 1);

    // 2. Same tier again — no-op (returns null, doesn't duplicate ownership).
    const grant2 = syncTrustBorderForUser(db, "usr_a", "provisional", { idFactory, now: "2026-05-25T00:02:00.000Z" });
    assert.equal(grant2, null);
    assert.equal(db.listUserCosmetics("usr_a").length, 1);

    // 3. Claimed tier is intentional parity — equip stays on provisional.
    const grant3 = syncTrustBorderForUser(db, "usr_a", "claimed", { idFactory, now: "2026-05-25T00:03:00.000Z" });
    assert.equal(grant3, null);
    assert.equal(db.listUserCosmeticEquipForUser("usr_a").border, "trust__border__provisional");

    // 4. Verified tier — new border granted, equipped; provisional ownership retired.
    const grant4 = syncTrustBorderForUser(db, "usr_a", "verified", { idFactory, now: "2026-05-25T00:04:00.000Z" });
    assert.ok(grant4);
    assert.equal(grant4.cosmeticId, "trust__border__verified");
    assert.equal(db.listUserCosmeticEquipForUser("usr_a").border, "trust__border__verified");
    const owned = db.listUserCosmetics("usr_a");
    assert.equal(owned.length, 1);
    assert.equal(owned[0].cosmeticId, "trust__border__verified");

    // 5. Established tier — trusted border, verified retired.
    const grant5 = syncTrustBorderForUser(db, "usr_a", "established", { idFactory, now: "2026-05-25T00:05:00.000Z" });
    assert.ok(grant5);
    assert.equal(grant5.cosmeticId, "trust__border__trusted");
    assert.equal(db.listUserCosmeticEquipForUser("usr_a").border, "trust__border__trusted");

    // 6. Oscillate back to provisional — reinstates the original ownership row
    //    rather than creating a new tier_grant:provisional row.
    const grant6 = syncTrustBorderForUser(db, "usr_a", "provisional", { idFactory, now: "2026-05-25T00:06:00.000Z" });
    assert.ok(grant6);
    assert.equal(grant6.cosmeticId, "trust__border__provisional");
    const active = db.listUserCosmetics("usr_a");
    assert.equal(active.length, 1);
    assert.equal(active[0].cosmeticId, "trust__border__provisional");
    assert.equal(active[0].source, "tier_grant:provisional");
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolver renders the owned border, falling back to computed for legacy accounts", () => {
  // Legacy: no equip row at all — falls back to computed.
  const legacyDb = {
    getUser: () => ({ id: "usr_legacy", rating: 1200 }),
    listFinalizedGamesForUser: () => [],
    listExternalAccountsForUser: () => [],
    countUserMilestoneByKey: () => 0
  };
  const legacyAvatar = resolveAvatarForUser(legacyDb, "usr_legacy");
  assert.equal(legacyAvatar.border, "trust__border__provisional");

  // Owned: equip row wins even when computed would say otherwise.
  const ownedDb = {
    getUser: () => ({ id: "usr_owned", rating: 1200 }),
    listFinalizedGamesForUser: () => [],
    listExternalAccountsForUser: () => [],
    countUserMilestoneByKey: () => 0,
    listUserCosmeticEquipForUser: () => ({ border: "trust__border__verified" })
  };
  const ownedAvatar = resolveAvatarForUser(ownedDb, "usr_owned");
  assert.equal(ownedAvatar.border, "trust__border__verified");
  assert.equal(ownedAvatar.identity.trust_border, "trust__border__verified");
});

test("equipped laurel renders from ownership even before milestone fallback", () => {
  const db = {
    getUser: () => ({ id: "usr_a", rating: 1400 }),
    listFinalizedGamesForUser: () => [],
    listExternalAccountsForUser: () => [],
    countUserMilestoneByKey: () => 0,
    listUserCosmeticEquipForUser: () => ({ headwear: "milestone__headwear__laurel" })
  };

  const avatar = resolveAvatarForUser(db, "usr_a");

  assert.equal(avatar.headwear, "milestone__headwear__laurel");
});
