// Avatar catalog — the MVP cosmetic system.
//
// Direction (2026-05-26): a curated set of full-image PNG avatars. Players
// pick from the set; choice is purely cosmetic with no rating gate. Some
// avatars unlock via play milestones (signals of experience); others are
// purchased with play-token currency (signals of taste / wealth). The
// avatar frame border is a separate axis driven by trust tier — see
// packages/shared/trust.mjs and the .avatar.tier-* CSS classes.
//
// Asset files live at apps/web/assets/avatars/{id}.png. The id is the
// canonical key everywhere (DB, payloads, equip endpoint, URL).
//
// See docs/PROJECT_SOUL.md § Avatar semantics and
// docs/IMPLEMENTATION_PLAN.md § Avatar identity and cosmetics workstream.

import { cents } from "./domain.mjs";

export const DEFAULT_AVATAR_ID = "base";

// One entry per avatar.
//   id            — stable string, matches the PNG filename without extension
//   piece         — taxonomy only; not a chess-strength claim
//   rarity        — display ordering + soft pricing tier
//   acquisition   — how a user comes to own it:
//                     { type: "default" }                              owned at signup
//                     { type: "purchase", priceCents }                 buy with play tokens
//                     { type: "milestone", eventKey, minTier? }        granted on milestone fire
const C = (n) => cents(n);

export const AVATAR_CATALOG = Object.freeze([
  { id: "base", piece: "base", rarity: "starter", acquisition: { type: "default" } },

  { id: "knight-01", piece: "knight", rarity: "starter", acquisition: { type: "default" } },
  { id: "knight-02", piece: "knight", rarity: "common", acquisition: { type: "purchase", priceCents: C(100) } },
  { id: "knight-03", piece: "knight", rarity: "common", acquisition: { type: "milestone", eventKey: "first_win" } },

  { id: "bishop-01", piece: "bishop", rarity: "common", acquisition: { type: "purchase", priceCents: C(150) } },
  { id: "bishop-02", piece: "bishop", rarity: "common", acquisition: { type: "purchase", priceCents: C(150) } },
  { id: "bishop-03", piece: "bishop", rarity: "rare", acquisition: { type: "milestone", eventKey: "win_streak_3" } },
  { id: "bishop-04", piece: "bishop", rarity: "rare", acquisition: { type: "purchase", priceCents: C(300) } },

  { id: "rook-01", piece: "rook", rarity: "common", acquisition: { type: "purchase", priceCents: C(200) } },
  { id: "rook-02", piece: "rook", rarity: "common", acquisition: { type: "purchase", priceCents: C(200) } },
  { id: "rook-03", piece: "rook", rarity: "rare", acquisition: { type: "purchase", priceCents: C(400) } },
  { id: "rook-04", piece: "rook", rarity: "rare", acquisition: { type: "milestone", eventKey: "win_streak_5" } },

  { id: "queen-01", piece: "queen", rarity: "rare", acquisition: { type: "purchase", priceCents: C(500) } },
  { id: "queen-02", piece: "queen", rarity: "rare", acquisition: { type: "purchase", priceCents: C(500) } },
  { id: "queen-03", piece: "queen", rarity: "legendary", acquisition: { type: "milestone", eventKey: "win_streak_7" } },
  { id: "queen-04", piece: "queen", rarity: "legendary", acquisition: { type: "purchase", priceCents: C(1000) } },

  { id: "king-01", piece: "king", rarity: "rare", acquisition: { type: "purchase", priceCents: C(750) } },
  { id: "king-02", piece: "king", rarity: "legendary", acquisition: { type: "purchase", priceCents: C(1500) } },
  { id: "king-03", piece: "king", rarity: "legendary", acquisition: { type: "milestone", eventKey: "win_streak_10" } },
  { id: "king-04", piece: "king", rarity: "legendary", acquisition: { type: "purchase", priceCents: C(2000) } }
]);

const BY_ID = new Map(AVATAR_CATALOG.map((a) => [a.id, a]));

export function getAvatar(id) {
  return BY_ID.get(id) || null;
}

export function isValidAvatarId(id) {
  return BY_ID.has(id);
}

export function defaultOwnedAvatarIds() {
  return AVATAR_CATALOG
    .filter((a) => a.acquisition.type === "default")
    .map((a) => a.id);
}

export function avatarUrl(id) {
  if (!isValidAvatarId(id)) return null;
  return `/assets/avatars/${id}.png`;
}

// Avatars whose acquisition fires off a given milestone event key. Used
// at milestone-detection time to mint user_avatars rows alongside the
// existing user_milestones row.
export function avatarsForMilestone(eventKey) {
  if (!eventKey) return [];
  return AVATAR_CATALOG.filter(
    (a) => a.acquisition.type === "milestone" && a.acquisition.eventKey === eventKey
  );
}
