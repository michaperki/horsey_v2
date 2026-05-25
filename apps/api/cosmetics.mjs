// Server-side cosmetic avatar resolver. See docs/COSMETICS_FORMALIZATION.md.
//
// Given a userId, computes the user's avatar block — the equipped cosmetic id
// per slot plus live-state flags the client uses to evaluate live cosmetics.
//
// First-iteration rules (v1):
//   - Layer 0 base: rating-class piece, derived from strongest available
//     chess-strength signal. New 1200 users remain knight by default.
//   - Layer 1 border: derived from trust tier (provisional/claimed/verified/
//     established → gold), trust-exclusive.
//   - Layer 5 headwear: live-state flame_crown wins (streak ≥ 3), else laurel
//     if the user has any first_win milestone, else null.
//   - Layer 6 front_aura: piece-coupled verified halo for verified/established.
//   - Layer 7 attached_badge: veteran for established.
//
// Other slots (outerwear, accent, facewear, back_aura) are null at v1 —
// they ship later via persona-kit detection + shop. The resolver leaves
// them in the payload so the client renderer can iterate them.

import { computeTrustTier } from "../../packages/shared/trust.mjs";

const PIECE_IDS = {
  knight: "base__piece__knight",
  queen: "base__piece__queen",
  pawn: "base__piece__pawn",
  bishop: "base__piece__bishop",
  rook: "base__piece__rook"
};

const PIECE_LABELS = {
  pawn: "Pawn",
  knight: "Knight",
  bishop: "Bishop",
  rook: "Rook",
  queen: "Queen"
};

const PIECE_THRESHOLDS = [
  { piece: "pawn", min: 0, max: 999, label: "developing" },
  { piece: "knight", min: 1000, max: 1399, label: "tactical" },
  { piece: "bishop", min: 1400, max: 1699, label: "strategic" },
  { piece: "rook", min: 1700, max: 2099, label: "commanding" },
  { piece: "queen", min: 2100, max: Infinity, label: "elite" }
];

function trustBorderCatalogItem(id, tier, label) {
  return {
    id,
    kind: ["atom"],
    slot: "border",
    z: 10,
    coupling: "generic",
    piece: null,
    persona: "trust",
    function: "trust_signal",
    rarity: "tier_locked",
    acquisition: { mode: "auto_tier_grant", trust_tier: tier },
    trustExclusive: true,
    phase: "v1",
    enabled: true,
    metadata: { label }
  };
}

const MINIMAL_CATALOG = {
  milestone__headwear__laurel: {
    id: "milestone__headwear__laurel",
    kind: ["atom"],
    slot: "headwear",
    z: 50,
    coupling: "generic",
    piece: null,
    persona: "milestone",
    function: "achievement_trophy",
    rarity: "earned",
    acquisition: { mode: "milestone", event_key: "first_win" },
    trustExclusive: false,
    phase: "v1",
    enabled: true,
    metadata: {
      label: "First-win laurel",
      note: "Granted and auto-equipped when the first_win milestone fires."
    }
  },
  trust__border__provisional: trustBorderCatalogItem(
    "trust__border__provisional",
    "provisional",
    "Provisional border (also worn at claimed tier — see § 5.1.1)"
  ),
  trust__border__verified: trustBorderCatalogItem(
    "trust__border__verified",
    "verified",
    "Verified border"
  ),
  trust__border__trusted: trustBorderCatalogItem(
    "trust__border__trusted",
    "established",
    "Established trust border"
  )
};

function ensureCatalogItem(db, cosmeticId) {
  const item = MINIMAL_CATALOG[cosmeticId];
  if (!item || typeof db?.upsertCosmeticCatalogItem !== "function") return;
  db.upsertCosmeticCatalogItem(item);
}

export function cosmeticGrantsForMilestone(milestone) {
  if (!milestone) return [];
  if (milestone.eventKey === "first_win") {
    return [{
      userId: milestone.userId,
      cosmeticId: "milestone__headwear__laurel",
      slot: "headwear",
      source: `milestone:${milestone.id}`,
      grantedAt: milestone.occurredAt
    }];
  }
  return [];
}

export function grantCosmeticsForMilestone(db, milestone, { idFactory } = {}) {
  const idFor = idFactory || ((prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`);
  const grants = [];
  for (const grant of cosmeticGrantsForMilestone(milestone)) {
    ensureCatalogItem(db, grant.cosmeticId);
    const inserted = db.grantUserCosmetic({
      id: idFor("ucm"),
      userId: grant.userId,
      cosmeticId: grant.cosmeticId,
      source: grant.source,
      grantedAt: grant.grantedAt
    });
    if (!inserted) continue;
    db.equipUserCosmetic({
      userId: grant.userId,
      slot: grant.slot,
      cosmeticId: grant.cosmeticId,
      updatedAt: grant.grantedAt
    });
    grants.push({ ...grant, id: db.getUserCosmeticBySource?.(grant.userId, grant.cosmeticId, grant.source)?.id ?? null });
  }
  return grants;
}

// Idempotent: ensures the user owns and has equipped the border that matches
// their current trust tier. Returns a publishable grant when a *new* border
// was just put into the user's hands, or null when nothing changed. Any
// previously-equipped tier-bound border that no longer matches the user's
// tier is retired (provenance preserved via the retired_at column).
export function syncTrustBorderForUser(db, userId, tier, { idFactory, now } = {}) {
  if (!db || !userId) return null;
  const targetBorder = borderForTier(tier);
  const ts = now || new Date().toISOString();
  const idFor = idFactory || ((prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`);

  const equipped = typeof db.listUserCosmeticEquipForUser === "function"
    ? db.listUserCosmeticEquipForUser(userId)
    : {};
  const previous = equipped.border ?? null;
  if (previous === targetBorder && typeof db.getUserCosmeticBySource === "function") {
    // Equip is already correct. Confirm ownership row exists & is active;
    // if not, fall through to grant.
    const existing = db.getUserCosmeticBySource(userId, targetBorder, `tier_grant:${tier}`);
    if (existing && !existing.retiredAt) return null;
  }

  // Retire any other tier-bound border the user currently holds active.
  if (typeof db.retireUserCosmeticByCosmeticId === "function") {
    for (const borderId of TIER_BORDER_IDS) {
      if (borderId === targetBorder) continue;
      db.retireUserCosmeticByCosmeticId({ userId, cosmeticId: borderId, retiredAt: ts });
    }
  }

  ensureCatalogItem(db, targetBorder);
  const source = `tier_grant:${tier}`;
  const inserted = db.grantUserCosmetic({
    id: idFor("ucm"),
    userId,
    cosmeticId: targetBorder,
    source,
    grantedAt: ts
  });
  // If the row already existed but was retired (user oscillated back to this
  // tier), reinstate it instead of letting it stay retired.
  if (!inserted && typeof db.reinstateUserCosmeticBySource === "function") {
    db.reinstateUserCosmeticBySource({ userId, cosmeticId: targetBorder, source });
  }
  db.equipUserCosmetic({
    userId,
    slot: "border",
    cosmeticId: targetBorder,
    updatedAt: ts
  });

  // Only announce when something actually changed in what the user wears.
  if (previous === targetBorder) return null;
  const grantRow = typeof db.getUserCosmeticBySource === "function"
    ? db.getUserCosmeticBySource(userId, targetBorder, source)
    : null;
  return {
    id: grantRow?.id ?? null,
    userId,
    cosmeticId: targetBorder,
    slot: "border",
    source,
    grantedAt: ts
  };
}

function outcomeForUser(game, userId) {
  if (!game || game.state !== "finalized") return null;
  if (!game.winnerId) return "draw";
  return game.winnerId === userId ? "win" : "loss";
}

function currentWinStreakFromGames(games, userId) {
  let streak = 0;
  for (const g of games) {
    if (outcomeForUser(g, userId) === "win") streak += 1;
    else break;
  }
  return streak;
}

// Canonical trust-border ladder. Four product tiers map onto three visual
// rungs; the top two asset rungs (elite, champion) are reserved for future
// product tiers (placed/sweeps gate, tournament champion). See
// docs/COSMETICS_FORMALIZATION.md § 5.1.
//
//   provisional → trust__border__provisional (muted ring)
//   claimed     → trust__border__provisional (intentional visual parity —
//                 the claimed distinction lives in the tier-pip text chip)
//   verified    → trust__border__verified    (gold check treatment)
//   established → trust__border__trusted     (premium tenure treatment)
const TIER_BORDER = {
  provisional: "trust__border__provisional",
  claimed:     "trust__border__provisional",
  verified:    "trust__border__verified",
  established: "trust__border__trusted"
};

// All borders this resolver may grant. Used by trust-border retirement to
// know which previously-equipped border to clear when a tier changes.
export const TIER_BORDER_IDS = Object.freeze([...new Set(Object.values(TIER_BORDER))]);

export function borderForTier(tier) {
  return TIER_BORDER[tier] ?? TIER_BORDER.provisional;
}

function frontAuraForTier(tier, piece) {
  if (tier !== "verified" && tier !== "established") return null;
  if (piece === "queen") return "trust__aura__verified_halo__queen";
  return "trust__aura__verified_halo__knight";
}

function badgeForTier(tier) {
  if (tier === "established") return "trust__badge__veteran";
  return null;
}

function headwearFor({ streak, hasFirstWin }) {
  // Live-state priority: flame_crown beats laurel.
  if (streak >= 3) return "milestone__headwear__flame_crown";
  if (hasFirstWin)  return "milestone__headwear__laurel";
  return null;
}

function bestImportedRating(accounts) {
  let best = null;
  for (const account of accounts || []) {
    const ratings = account?.importedStats?.ratings || {};
    for (const timeClass of ["blitz", "rapid", "classical", "bullet"]) {
      const rating = ratings[timeClass]?.rating;
      if (typeof rating !== "number" || rating <= 0) continue;
      if (!best || rating > best.rating) {
        best = {
          rating: Math.round(rating),
          provider: account.provider,
          timeClass,
          status: account.status
        };
      }
    }
  }
  return best;
}

function pieceForRating(rating) {
  const numeric = Number.isFinite(rating) ? rating : 1200;
  return PIECE_THRESHOLDS.find((band) => numeric >= band.min && numeric <= band.max) || PIECE_THRESHOLDS[1];
}

export function resolveBasePieceForUser(user, accounts = [], finishedGames = 0) {
  const imported = bestImportedRating(accounts);
  const horseyRating = Number.isFinite(user?.rating) ? Math.round(user.rating) : 1200;
  const basis = finishedGames === 0 && imported
    ? { rating: imported.rating, source: "linked_account", imported }
    : { rating: horseyRating, source: finishedGames > 0 ? "horsey_rating" : "starting_rating", imported };
  const band = pieceForRating(basis.rating);
  return {
    piece: band.piece,
    itemId: PIECE_IDS[band.piece],
    label: `${PIECE_LABELS[band.piece]} class`,
    band: band.label,
    rating: basis.rating,
    source: basis.source,
    imported: basis.imported,
    calibrated: finishedGames > 0
  };
}

// Resolve everything from a single fetch of recentGames + accounts + the
// first_win milestone count. Three small queries per avatar — fine at v1
// load; batch later if dense surfaces show pressure.
export function resolveAvatarForUser(db, userId) {
  if (!db || !userId) return blankAvatar("knight");
  const user = db.getUser(userId);
  const recentGames = db.listFinalizedGamesForUser(userId, 50);
  const finishedGames = recentGames.length;
  const accounts = db.listExternalAccountsForUser(userId) || [];
  const tier = computeTrustTier({ externalAccounts: accounts, finishedGames });
  const streak = currentWinStreakFromGames(recentGames, userId);
  const equipped = typeof db.listUserCosmeticEquipForUser === "function"
    ? db.listUserCosmeticEquipForUser(userId)
    : {};
  const hasFirstWin = db.countUserMilestoneByKey(userId, "first_win") > 0;
  const basePiece = resolveBasePieceForUser(user, accounts, finishedGames);
  const piece = basePiece.piece;

  // Borders prefer the owned/equipped record, with a computed fallback so
  // legacy accounts (pre-tier-grant rollout) still render the right ring.
  const computedBorder = borderForTier(tier);
  const ownedBorder = equipped.border && TIER_BORDER_IDS.includes(equipped.border)
    ? equipped.border
    : null;
  const borderId = ownedBorder || computedBorder;

  return {
    base: basePiece.itemId || PIECE_IDS.knight,
    border: borderId,
    outerwear: null,
    accent: null,
    facewear: null,
    headwear: streak >= 3
      ? "milestone__headwear__flame_crown"
      : (equipped.headwear || headwearFor({ streak, hasFirstWin })),
    back_aura: null,
    front_aura: frontAuraForTier(tier, piece),
    attached_badge: badgeForTier(tier),
    live_state_flags: {
      win_streak: streak
    },
    identity: {
      base_piece: piece,
      base_piece_label: basePiece.label,
      rating_class: basePiece.band,
      rating_basis: basePiece.rating,
      rating_source: basePiece.source,
      calibrated: basePiece.calibrated,
      imported_rating: basePiece.imported,
      trust_tier: tier,
      trust_border: borderId,
      adornments: {
        first_win_laurel: hasFirstWin,
        win_streak: streak
      }
    }
  };
}

function blankAvatar(piece) {
  const basePiece = pieceForRating(1200);
  const resolvedPiece = PIECE_IDS[piece] ? piece : basePiece.piece;
  return {
    base: PIECE_IDS[resolvedPiece] || PIECE_IDS.knight,
    border: borderForTier("provisional"),
    outerwear: null,
    accent: null,
    facewear: null,
    headwear: null,
    back_aura: null,
    front_aura: null,
    attached_badge: null,
    live_state_flags: { win_streak: 0 },
    identity: {
      base_piece: resolvedPiece,
      base_piece_label: `${PIECE_LABELS[resolvedPiece] || PIECE_LABELS.knight} class`,
      rating_class: basePiece.label,
      rating_basis: 1200,
      rating_source: "starting_rating",
      calibrated: false,
      imported_rating: null,
      trust_tier: "provisional",
      trust_border: borderForTier("provisional"),
      adornments: {
        first_win_laurel: false,
        win_streak: 0
      }
    }
  };
}
