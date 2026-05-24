# Cosmetics formalization — runtime architecture, v1 launch set, and reconciliation

Companion docs: [`COSMETICS_NEXT_PASS.md`](COSMETICS_NEXT_PASS.md) (original research/proposal), [`COSMETICS_INVENTORY_AUDIT.md`](COSMETICS_INVENTORY_AUDIT.md) (asset audit), [`PROJECT_SOUL.md`](PROJECT_SOUL.md) (intentional casino energy), [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md) (celebration licensing), [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md) (audio layer), [`ARENA_NEXT_PASS.md`](ARENA_NEXT_PASS.md) (atmosphere thesis), [`SCOUTING_TRUST_NEXT_PASS.md`](SCOUTING_TRUST_NEXT_PASS.md) (trust ladder).

Status: **formalization proposal**. Bridges the audit's findings into a production-ready architecture. § 7 contains the explicit reconciliation matrix against `COSMETICS_NEXT_PASS.md` (no rewrite of that doc yet — this doc is the diff).

---

## 0. The pivot

The audit confirmed: **we do not have "a cosmetic system" yet.** We have ~119 raster files spanning three incompatible visual languages and four different intent classes — runtime atoms, emote scenes, design exhibits, faction art — that the original proposal treated as one population.

The pivot codified here:

> Horsey is converging on a **high-signal identity system with selective spectacle**, not a large-scale cosmetic content economy.

Practical consequences:

- The catalog stays small and meaningful. ~17 cosmetic atoms at v1 launch. ~22 emote slots. ~30 wardrobe-only showcase pieces. The other ~50 finalized assets are either piece-coupled scenes (repurposed as wardrobe preview / kit-complete trophy art) or retired entirely.
- The runtime renderer composes only **composable atoms**. Piece-coupled scenes do not equip; they exhibit.
- The **anchor + canvas problem is Phase 0**, not Phase A. Without a normalized canvas + anchor metadata, layered composition is impossible. Progression logic can wait; the renderer can't.
- Tilt is **emotional vocabulary, not a player tool**. Event-fired only, with policy gates.

---

## 1. Canonical runtime avatar architecture

### 1.1 Canvas

**256 × 256 transparent square, sRGB, RGBA, PNG-8 with full alpha** (or PNG-24 — the existing pipeline outputs PNG-24, fine to keep).

Why 256:
- Largest display surface (spectator HUD, featured table) renders at ~200 px; 256 gives ~25% retina headroom at 1× DPR without re-export.
- Smallest display surface (Open Tables row) renders at ~40 px; downscale 6.4× is fine in any modern browser.
- Sprite-sheet packing later (Phase H) at 8 × 4 = 32 atoms per 1024×2048 sheet is convenient.

Why square, not piece-shaped:
- Pieces are tall; headwear is wide; auras are widest. A piece-shaped canvas (say 160 × 240) leaves no room for sunglasses (244 wide today) or aura rings (228+ wide today). Square canvas with the piece centered low gives every layer the same coordinate system.

### 1.2 Layer stack & z-order

Nine z-bands inside the avatar canvas, plus two surfaces outside it:

```
INSIDE canvas (rendered as composed avatar):
  z = -10   back_aura          aura_ring_gold, halo behind piece
  z =   0   base                knight_tactical, queen_elite (piece body)
  z =  10   border              chip-style frame (B4 design language)
  z =  20   outerwear           hoodie, royal_cape, fur_coat, scarf
  z =  30   accent              chain, chip_stack, diamond, opening_book
  z =  40   facewear            sunglasses, eye_glow, tired_eyes
  z =  50   headwear            crown, hat, laurel, flame_crown
  z =  60   front_aura          verified_halo over head, rage_flame
  z =  70   attached_badge      small ribbon below avatar (veteran_badge)

OUTSIDE canvas (rendered beside avatar on dossier surfaces only):
  banner                         stable banner, large crest
  title                          text string under handle ("Honorable", "Grinder")
```

Single-occupancy: one asset per z-band per user. The renderer enforces.

Live-state cosmetics (e.g., `flame_crown` while win-streak ≥ 3) are evaluated per render, not equipped manually. They occupy their slot until state clears.

### 1.3 Anchor system

Within the 256 × 256 canvas, eight canonical anchors. Every cosmetic declares which anchor it pins to and a `(dx, dy)` offset:

```
back_aura      (128, 128)   z<0 halo behind piece
piece_base     (128, 230)   feet of piece
piece_center   (128, 160)   center of piece body
chest          (128, 155)   chain / scarf / chest badge attach
eye_line       (128, 100)   glasses / eyes
head_top       (128, 50)    crown / hat / band attach
canvas_outer   (128, 128)   borders + halos at canvas boundary
below_avatar   (128, 250)   ribbons hanging off bottom edge
```

Numbers are seed values; tune once with one designer pass on the v1 launch set.

Renderer math: position an asset at `(anchor.x + dx - asset.w/2, anchor.y + dy - asset.h/2)` on the 256×256 canvas. That's the entire composition algebra.

Per-piece offsets (knight vs queen): some assets need different anchor offsets per base piece (a queen is shorter than a knight; the head_top isn't at the same y). Solution: each piece base declares its **own anchor overrides** in the manifest. The renderer applies piece-specific anchors before placing other layers.

```
knight_tactical: { anchor_overrides: { head_top: { x:128, y:48 } } }
queen_elite:     { anchor_overrides: { head_top: { x:128, y:62 } } }
```

### 1.4 Composition rules

1. **One slot, one asset.** Trying to equip two headwear items is a no-op; the equip API rejects.
2. **Piece-coupled "scenes" are not atoms.** They cannot be selected as Layer 0. They render only as wardrobe preview thumbnails or as kit-complete trophy art on the profile.
3. **Tier-bound items are immutable.** A user cannot unequip their trust-tier border; trust tier changes auto-update it.
4. **Live-state items are derived, not equipped.** The renderer evaluates `live_state.kind` against current user state each render.
5. **Compatibility list is a hard constraint.** If item A declares `incompatible_with: [B]`, the renderer drops B silently when A is also equipped (with A taking priority by declaration order).
6. **Surface eligibility filters.** Each asset declares `surfaces` it's allowed on. Dense rows skip non-eligible cosmetics.

### 1.5 Density modes & small-size degradation

Four modes, picked by the rendering surface, not the user:

| Mode | Avatar size | z-bands rendered | Animation |
|---|---|---|---|
| `minimal` | ≤ 48 px (dense rows, mobile compressed) | base (0), border (10) | no |
| `compact` | 49 – 96 px (scout card, lobby live games feed) | base, border, headwear (50) | no |
| `standard` | 97 – 180 px (wager dossier, game strip, settlement, mobile broadcast) | base, border, outerwear (20), accent (30), facewear (40), headwear (50), front_aura (60), attached_badge (70) | reduced (single subtle pulse only) |
| `broadcast` | > 180 px (spectator HUD, featured table, desktop settlement hero) | all bands (-10 through 70) | full |

Surfaces declare their density mode (one of the four). The renderer picks the highest-fidelity composition the surface allows.

**Small-size degradation rules** (locked):

- At `minimal`: every other slot is dropped silently. Border and base alone tell the trust story. Tier-pip already exists as a separate UI chip — that's the small-size identity signal.
- At `compact`: headwear renders as a *silhouette* (no internal detail). Sunglasses, eye_glow, persona-kit accents are all dropped — they smudge below 96 px.
- At `standard` and below: animation is reduced or muted entirely. Auras pulse only at `broadcast`.
- Mobile collapses one density tier vs desktop on the same surface. Desktop wager dossier = `standard`; mobile wager dossier = `compact`.

### 1.6 Density mode per existing surface

| Surface | Density | Notes |
|---|---|---|
| Open Tables row | `minimal` | tier-pip + base + border only |
| Live Games feed row | `minimal` (desktop), `minimal` (mobile) | two avatars per row; budget-constrained |
| Live-Table Module hero | `compact` (mobile), `compact` (desktop) | own-avatar prominence; small enough that full kit reads as noise |
| Scout Card popover | `compact` | the 2-second read; headwear silhouette is the only flex |
| Wager Dossier | `standard` (desktop), `compact` (mobile) | decision-time identity moment; "standard" gives full equip |
| Game page player strips | `standard` (desktop), `compact` (mobile) | mid-game ID; mobile drops to silhouette-only |
| Settlement (in-place after game) | `broadcast` (desktop), `standard` (mobile) | climax moment; full equip + animation on desktop |
| Profile own | `broadcast` | this is the player's wardrobe; show everything |
| User Profile (other player) | `standard` | full equip but reduced animation budget |
| Spectator HUD | `broadcast` | the broadcast register; full kit + animation + banner |
| Featured Table card | `broadcast` | the highest spectacle surface |
| Top-nav identity badge | `minimal` | persistent chrome; quiet |

### 1.7 Composition strategy at runtime

For the launch system: **per-element `<img>` stack with absolute positioning**, one wrapper `<div class="avatar avatar--{density}">` per render site. Eight `<img>` elements max per `broadcast` avatar, two for `minimal`. Modern browsers handle this trivially; on dense rows (~16 avatars × `minimal`) we're at ~32 DOM elements — negligible.

Sprite-sheet packing is deferred until measured performance demands it.

Spectator HUD's `broadcast` animations (aura rotate, flame flicker) use CSS keyframes; the `prefers-reduced-motion` query and the `essentials/mute` sound mode both clamp them.

---

## 2. Hard category split with explicit asset assignments

Six hard categories. Every existing finalized asset is assigned to exactly one. This is the canonical list; the runtime renderer **only** consumes Category A. Categories B–F live in separate render paths and storage namespaces.

### Category A — Composable runtime atoms

The only category the layered renderer touches. ~25 assets total, of which ~17 are launch-eligible.

**L0 base — pieces (2 launch + 3 latent flavor):**
- `base__piece__knight` ← `horsey_002_knight_tactical.png` ✓ launch
- `base__piece__queen` ← `horsey_005_queen_elite.png` ✓ launch (verify it's not the same file as `queen_verified_halo` per audit § 4.4)
- `base__piece__pawn` ← `horsey_001_pawn_rookie.png` (latent; not equipped at launch)
- `base__piece__bishop` ← `horsey_003_bishop_strategist.png` (latent)
- `base__piece__rook` ← `horsey_004_rook_guardian.png` (latent)

**L1 border — chip-style frames only (B4 design language):**
- `trust__border__provisional` ← `horsey_052_border_provisional.png` ✓ launch
- `trust__border__verified` ← `horsey_053_border_verified.png` ✓ launch
- `trust__border__gold` ← `horsey_059_border_gold.png` ✓ launch (maps to `trusted` tier)
- `trust__border__diamond` ← `horsey_060_border_diamond.png` (latent — reserve for milestone tier, not trust ladder)
- `trust__border__claimed` ← **MISSING — must be authored**
- `trust__border__silver` ← **MISSING transparent** (raw is non-transparent preview)
- `trust__border__mythic` ← **MISSING transparent**
- `trust__border__arcane` ← **MISSING transparent**

**L2 outerwear (5 latent, 0 launch):**
- `base__outerwear__scarf_blue` ← `horsey_011_blue_scarf.png`
- `base__outerwear__cape_royal` ← `horsey_012_royal_cape.png`
- `grindset__outerwear__hoodie` ← `horsey_004_grindset_hoodie.png`
- `highroller__outerwear__furcoat` ← `horsey_020_highroller_furcoat.png`

**L3 accent (8 latent, 0 launch):**
- `highroller__accent__goldchain` ← `horsey_013_highroller_goldchain.png`
- `highroller__accent__diamond_token` ← `horsey_018_diamond_token.png`
- `highroller__accent__chip_stack` ← `horsey_019_chip_stack.png`
- `grindset__accent__coffee` ← `horsey_002_grindset_coffee.png`
- `grindset__accent__ramen` ← `horsey_005_grindset_ramen.png`
- `grindset__accent__opening_book` ← `horsey_009_opening_book.png`
- `grindset__accent__elo_notebook` ← `horsey_007_elo_goals_notebook.png`
- `grindset__accent__protein_shaker` ← `horsey_008_protein_shaker.png`

**L4 facewear (4 latent, 0 launch):**
- `base__facewear__sunglasses` ← `horsey_009_sunglasses.png`
- `highroller__facewear__sunglasses` ← `horsey_014_highroller_sunglasses.png`
- `tilt__facewear__cracked_glasses` ← `horsey_034_tilt_crackedsunglasses.png` (event-fired only)
- `grindset__facewear__tired_eyes` ← `horsey_006_grindset_tired.png`
- `??__facewear__eye_glow_purple` ← `horsey_010_eye_glow_purple.png` (**HOLD: no earn path, no semantics, retire or assign**)

**L5 headwear (11 latent, 2 launch):**
- `milestone__headwear__laurel` ← `horsey_028_trust_laurel.png` ✓ launch (first-win trophy)
- `milestone__headwear__flame_crown` ← `horsey_015_highroller_flamecrown.png` ✓ launch (live-state during streak ≥3)
- `milestone__headwear__broken_crown` ← `horsey_032_tilt_brokencrown.png` (event-fired trophy on upset)
- `base__headwear__crown` ← `horsey_006_crown.png` (latent shop)
- `base__headwear__top_hat` ← `horsey_007_top_hat.png` (latent shop)
- `base__headwear__captain_hat` ← `horsey_008_captain_hat.png` (latent shop)
- `grindset__headwear__headphones` ← `horsey_003_grindset_headphones.png`
- `grindset__headwear__sweatband` ← `horsey_010_grindset_sweatband.png`
- `highroller__headwear__vr_visor` ← `horsey_012_highroller_vrvisor.png`

**L6 aura (5 latent, 1 launch):**
- `trust__aura__verified_halo` ← composed from `horsey_022_queen_verified_halo` + `horsey_020_knight_verified_halo` ✓ launch (piece-aware)
- `honor__aura__fairplay_halo` ← `horsey_022_fairplay_halo.png` (Phase 6 gated)
- `tilt__aura__rage_flames` ← `horsey_033_tilt_rageflame.png` (event-fired only)
- `tilt__aura__stormcloud` ← `horsey_038_tilt_stormcloud.png` (event-fired only)
- `flex__aura__ring_gold` ← `horsey_014_aura_ring_gold.png` (latent — reserve as champion-tier overlay later)
- `flex__aura__ring_purple` ← `horsey_015_aura_ring_purple.png` (**HOLD: no earn path, assign or retire**)

**L7 attached_badge (5 latent, 1 launch):**
- `trust__badge__veteran` ← `horsey_029_veteran_badge.png` ✓ launch (auto at established)
- `honor__badge__verified` ← `horsey_023_fairplay_verifiedbadge.png` (Phase 6 gated)
- `honor__badge__fairplay` ← `horsey_024_fairplay_shield.png` (Phase 6 gated)
- `base__badge__shield` ← `horsey_013_shield_badge.png` (latent)
- ~~`honor__badge__review_shield` ← `horsey_025_fairplay_reviewshield.png`~~ (**duplicate of fairplay_shield — retire**)

**Category A launch-eligible total: 12 items** (2 piece + 3 border + 2 headwear + 1 aura + 1 badge + claimed border missing + 2 milestone live-state).

### Category B — Event/emote assets

Fire as ephemeral overlays via a different render path (transient layer above the avatar canvas, not part of the equip stack). ~10 launch-eligible.

**Manual emote palette (launch: 2; needs 1–2 authored to reach a 4-item palette):**
- `manual__emote__wave` ← `horsey_021_emote_wave.png` ✓ launch
- `manual__emote__gg` ← `horsey_022_emote_gg.png` ✓ launch
- `manual__emote__bow` ← **needs authoring**
- `manual__emote__salute` ← **needs authoring**

**Event-fired emote pool (launch: 4):**
- `event__emote__chip_explosion` ← `horsey_017_queen_chip_explosion.png` (queen variant exists; generic + knight pending) ✓ launch with queen-only-fallback
- `event__emote__salt` ← `horsey_035_tilt_salt.png` ✓ launch
- `event__emote__meltdown` ← `horsey_039_tilt_meltdown.png` ✓ launch
- `event__emote__honor_handshake` ← `horsey_027_trust_handshake.png` ✓ launch (post-game gentleman play)

**Piece-coupled emote scene variants** (used when player has matching base piece + the event fires):
- queen variants: `queen_chip_explosion`, `queen_meltdown`, `queen_table_flip`, `queen_rage_chat`, `queen_stormcloud`, `queen_rage_flames`, `queen_ggez_emote`
- knight variants: `knight_salt_emote`, `knight_meltdown`, `knight_tableflip_emote`, `knight_rage_flames`, `knight_ggez_emote`

**Retired from this category (never fire at launch):**
- ~~`tilt__emote__ggez`~~ (toxic-coded, ggez retired from manual palette entirely)
- ~~`tilt__emote__rage_chat`~~ (target-directed; if it ships ever, event-fired only)
- ~~`tilt__emote__table_flip`~~ (held back at launch; event-fire policy needs proving)
- `tilt__emote__tilt` (`horsey_023_emote_tilt.png` — event-fired only when authored)
- `tilt__emote__sweat` (`horsey_025_emote_sweat.png` — event-fired only when authored)
- `event__emote__honorable` (`horsey_026_honorable_emote.png` — Phase 6 gated)

### Category C — Profile / showcase art

Wardrobe tile thumbnails + kit-complete trophy display. Not equipped on the avatar; rendered in the wardrobe panel and as the "kit unlocked" celebration art. ~30 assets — every batch_3 knight scene + every batch_4 queen scene that isn't already classified as an event emote.

- All `knight_grindset_*` (5 items) → Grindset kit thumbnails (knight version)
- All `queen_grindset_*` / `queen_headphones` / `queen_hoodie` / `queen_ramen` / `queen_tired_eyes` / `queen_sweatband` (6 items) → Grindset kit thumbnails (queen version)
- `high_roller_knight`, `knight_flamevisor`, `knight_casino_sunglasses`, `knight_chip_crown`, `knight_jackpot_aura`, `knight_diamond_token` (6 items) → High Roller kit thumbnails (knight)
- `queen_vr_visor`, `queen_gold_chain`, `queen_sunglasses`, `queen_flame_crown`, `queen_fur_coat` (5 items) → High Roller kit thumbnails (queen)
- `knight_veteran_badge`, `knight_broken_crown` (2 items) → trust/tilt thumbnails (knight)
- `queen_honorable`, `queen_laurel`, `queen_veteran_badge`, `queen_broken_crown`, `queen_cracked_glasses` (5 items) → trust/tilt thumbnails (queen)

### Category D — Faction / stable identity art

Rendered beside the avatar at dossier scale, never on it. ~7 assets.

- `stable__banner__blue` ← `horsey_030_stable_banner_blue.png` ✓ launch-candidate
- `stable__banner__red__knight`, `stable__banner__green__knight`, `stable__banner__purple__knight` ← knight-coupled batch_3 stable variants (latent until generic standalone banners ship)
- `stable__crest__gold__queen` ← `horsey_046_queen_crest_gold.png` (latent)
- `stable__crest__knight_mascot__queen` ← `horsey_047_queen_knight_mascot.png` (latent)
- `stable__crest__team_three__queen` ← `horsey_049_queen_team_three.png` (latent)
- `stable__identity__knight` ← `horsey_037_stable_knight_identity.png` (latent)

**Standalone generic banners for red/green/purple are missing** — until authored, only `stable_banner_blue` is launch-viable. Launch with **one stable** or **defer all stables to Phase E** as a result.

### Category E — Reward / reveal art

High-spectacle composites that play during settlement / milestone moments. Render once, then fade. ~3 assets.

- `reveal__jackpot__knight` ← `horsey_015_knight_jackpot_aura.png` (PB-pot settlement composite)
- `reveal__chip_explosion__queen` ← `horsey_017_queen_chip_explosion.png` (PB-pot settlement composite, queen version)
- `reveal__highroller_arrival` ← `horsey_010_high_roller_knight.png` (held back; future "elite enters room" reveal)

These overlap with Category B (event emotes) for `chip_explosion` — that's fine. The same asset can serve two render paths if its `kind` array includes both.

### Category F — Concept / mockup / non-runtime art

Design exhibits. Never imported by the catalog. Physically moves to `scripts/reference/`. ~15 assets.

- 5 batch_2 cluster reference sheets (all "no transparency" finalized files)
- 9 batch_4 `_equipped` and `_base` previews (062–070)
- 3 batch_4 high-tier border previews (`border_silver`, `border_mythic`, `border_arcane`) — until redrawn as transparent atoms
- `usage_example`, `queen_base`, `high_roller_queen` (queen-on-felt mockups)

### Retired entirely (no category)

Removed from the asset pipeline. Either delete or quarantine.

- `horsey_016_slot_machine.png` — literal mobile-casino anti-reference per `ARENA_NEXT_PASS.md`
- `horsey_017_casino_chips.png` — drifts toward casino aesthetic
- `horsey_025_fairplay_reviewshield.png` — duplicate of fairplay_shield
- All 5 B1 full-frame borders (`horsey_016` – `horsey_020` of batch_1) — incompatible design language; the B4 chip-style is canonical
- All 3 ggez variants (`tilt_ggez`, `knight_ggez_emote`, `queen_ggez_emote`) — canonical chess.com toxic phrase

---

## 3. Launch-safe emotional loop — the first 10 minutes

A concrete walkthrough showing where cosmetics appear, where identity forms, where spectacle happens, and where restraint is enforced. Every artifact named is a v1 launch atom.

### t=0 — Signup

User creates account `sam@example.com` / handle `Sam`. Server seeds:
- `users` row with `rating=1200`, `balance=$1000`, `trust_tier=provisional`
- `user_cosmetics`: auto-grant `trust__border__provisional` (tier-bound, source=`tier_grant`)
- `user_cosmetic_equip`: slot=`base`→`base__piece__knight`, slot=`border`→`trust__border__provisional`, other slots NULL

User lands on `#play`.

### t=0:15 — Onboarding modal (optional external account link)

The existing modal renders. Sam picks "Skip for now." No cosmetic at this step — verification is a process, not a free unlock. Modal closes; `users.onboarding_completed_at` is set.

### t=0:30 — Lobby — what Sam sees

```
Topbar:   [♞ Horsey]   Play   History   Profile       [$1,000.00]   [Sam▾]
Hero:     "You're playing as Sam · 1200"          ← his avatar: knight + provisional border. Nothing else.
          Pick a chip. Sit down.
          STAKE  [chip stack]
          TIME   [pill picker]
          [ Find me a game → ]   pot +$48 · 5% rake
          Host a table at these terms →
Right rail:
   ● 47 online · 12 in active games        ← heartbeat
   Incoming     (empty — hidden)
   Live now    [knight·1411] vs [queen·1842] · $50 · 3+0 · 22 watching
                                              ↑ that queen has a FLAME_CROWN — visible streak signal
   Open Tables
     [knight·1184] $5 · 3+0 blitz · provisional               Sit →
     [knight·1356] $10 · 3+0 blitz · provisional              Sit →
     [queen·1947]  $100 · 5+0 blitz · verified  Veterans ✦    Sit →
                                                  ↑ this queen has a VETERAN_BADGE + crest
```

**Identity signals Sam sees in the first 30 seconds:**
- His own avatar (knight + grey provisional border) — modest, honest
- Another knight with a flame crown — implicit message: "people are achieving things here"
- A queen with a veteran badge — implicit message: "tenure exists"

**Restraint observed:**
- No "Welcome! Claim your starter pack!" modal
- No locked-cosmetic carousel
- No "log in tomorrow for more!" prompt
- No premium currency anywhere visible
- The provisional border is **uncommented** — no chip says "lowest tier!"

### t=1:00 — Sam picks $5 / 3+0 and clicks Find

Queue spinner. Stake-locked SFX (`chip_rack_settle`) fires on hero state transition to `Queued`. After ~6s, paired with `Vish · 1200 · provisional`.

### t=1:10 — Wager screen (auto-navigated)

```
Headline:        "Vish wants $250 from you"   ← (placeholder; actually $5 in this flow)
Opponent dossier:
   [knight + provisional border]   Vish · 1200    new account
   ★ 3 stat tiles: Win rate / Streak / Joined
   Last 10: (empty — new account)
   H2H vs you: No shared games yet

Match card:
   STAKE  $5
   TIME   3+0 (blitz)
   POT    $9.50
   [Accept]   Decline   Counter terms
```

**Identity signals at decision time:**
- Same border treatment on Vish — visible parity. Sam isn't being matched into something stratified.
- Provisional + new account chips on both sides. "still calibrating" message lands.

### t=1:25 — Sam clicks Accept. Game begins

Both sides escrowed. Clock starts. Game page renders with player strips (both knights + provisional borders, no headwear yet). Board is unadorned.

Audio: `game_start` chime (already shipped in `sound.mjs`). Piece-drop sounds on each move. Clock-tension pulse if either side dips under 30s.

### t=3:45 — Sam wins on time pressure

Server detects timeout → `settleGame(winnerId=sam)`. Pushes `game.finalized` over the realtime broker.

Client transitions from board → in-place settlement (already shipped behavior).

### t=3:46 — Settlement, **first milestone**

Settlement card composes:

1. **Base settlement physicality** (per `ARENA_NEXT_PASS.md` § Phase 4): chip cascade from Sam's escrow toward Sam's bankroll. Brisk timing (~700ms). Bankroll counter ticks up from $999.75 to $1,004.25. Rake chip splits off to "house." Audio: `chip_cascade` + `bankroll_tick_up` (both already wired).

2. **Milestone overlay** (per `MILESTONES_NEXT_PASS.md` § Composition): the server fired `first_win` at tier 3. Client receives `milestone.unlocked` over WS. Tier-3 burst composes on top of the base settlement:
   - Audio: `milestone_unlock_t3` (already wired, replaces base settlement SFX at equivalent priority)
   - **Contained chip-burst from the settlement card** (not the viewport)
   - Banner text: `FIRST WIN`

3. **Cosmetic grant** (new for this pass): server inserts `user_cosmetics` row, source=`milestone:first_win`, cosmetic_id=`milestone__headwear__laurel`. Publishes `cosmetic.granted` over WS.

4. **Cosmetic reveal animation**: the laurel asset emerges from the chip-burst (a poker chip flips, revealing the laurel), then settles onto Sam's avatar in the settlement card. **Contained to the card**. 1.2s total. Then static.

5. **Rematch CTA gate** (per arena doc): 1.2s after settlement animation finishes, `Rematch Vish · $5` and `Back to Play` appear.

**Identity moment**: Sam's avatar permanently has a small `laurel` headwear from this moment on. Every future Open Tables row, Live Games row, wager screen, profile, and spectator HUD includes it.

### t=4:30 — Back to lobby

Sam clicks `Back to Play`. Lobby renders. Top-right identity badge now shows:

```
You're playing as Sam · 1208 · provisional      ← rating ticked +8
    [knight + provisional border + laurel notch on the border]
```

The wardrobe section on Profile (if Sam visits) shows:
- Equipped: knight, provisional border, laurel
- Owned: (same three)
- Locked: silhouettes for `flame_crown`, `verified_halo`, `veteran_badge`, etc., each labeled with their *earn condition* (not progress)

### t=4:45 — Sam queues again, wins again

Second win settles. Bankroll up, rating up. **No celebration** — streak counter is at 2. The `MILESTONES_NEXT_PASS.md` ladder declares streak 3/5/7/10/15 as thresholds. Settlement is brisk and grounded; no milestone fires.

### t=7:30 — Third win — **second milestone**

Server fires `win_streak_3` at tier 2 (per `milestones.mjs` code). Cosmetic grant: `milestone__headwear__flame_crown` (live-state, kind=`win_streak`, min=3).

Settlement composes:
- Base chip cascade (brisk win timing)
- Tier-2 callout banner: `3-WIN STREAK`
- Audio: `milestone_unlock_t2`
- Flame crown reveal: emerges from chip stack, settles on Sam's head **replacing the laurel** (z=50 single-occupancy; laurel and flame crown both occupy headwear slot). The laurel is *temporarily hidden* while live-state crown burns; it re-renders when the streak breaks.

Wait — that conflict is real. The renderer rule should be: **live-state cosmetics take priority over earned cosmetics in the same slot**. Laurel returns when flame_crown's live_state evaluates false.

### t=7:35 — Back to lobby, fourth queue

Sam's identity badge in the hero now shows:

```
You're playing as Sam · 1224 · provisional      ← rating ticked further
    [knight + provisional border + LIVE FLAME CROWN]
```

Every Open Tables row Sam appears in now shows the flame_crown (well, would, if Sam were hosting). Every Live Games row Sam plays in shows the flame_crown. Spectators on Sam's table see a flame_crown nameplate.

**This is the first spectacle / status moment.** And it's also the first "I need to queue one more" hook: the moment Sam loses, the flame goes out.

### The 10-minute checkpoint — what Sam has

- `knight_tactical` base
- `trust__border__provisional` (+ a small permanent laurel-notch detail)
- `milestone__headwear__flame_crown` (live-state, on until streak breaks)
- 3 wins, +$15
- A starting identity entirely from real play. Zero purchases. Zero quest checkboxes.

### Where restraint matters (the silence inventory)

In the first 10 minutes, the system **does not**:

- Push a single "claim your reward" CTA
- Show a single FOMO timer on a cosmetic purchase
- Fire confetti on an ordinary win (only at first-win, only at streak milestones)
- Allow Sam to spam emotes at Vish (mute-opponent default-on for first 5 games per § 4.4)
- Light up tilt on Vish's avatar after Sam's wins (event-fired tilt requires actual losing-game signal, not just "you lost")
- Surface a "you're 2 wins from a 5-streak!" pre-celebration
- Show a battle-pass progress bar or daily-quest list
- Display Sam's loss total or net P&L (per `project_no_loss_advertising`)

### Where spectacle happens (the noise inventory)

In the first 10 minutes, the system **does**:

- Show the lobby is alive (heartbeat, watcher counts, live games feed, one flame_crown visible on another player) within 30 seconds of landing
- Land the first-win tier-3 burst at settlement only
- Reveal the laurel via a poker-chip flip animation
- Light up the flame_crown at streak 3 with tier-2 callout
- Compose live-state flame_crown across every surface Sam appears on

That's three spectacle moments and ~9.5 minutes of restraint, total.

---

## 4. Emotional volatility philosophy

The audit confirmed: **the tilt cluster is oversized.** Twenty-two assets representing rage, salt, meltdown, table flip, stormcloud, cracked glasses, broken crown, ggez. The catalog *can* express all of those states. The product *should not* express most of them at launch.

This section operationalizes which emotional states to ship and how.

### 4.1 The state map

Emotional states sorted by intended frequency (events per typical session), default visibility, and player controllability.

| State | Trigger | Frequency / session | Who sees it | Player controllable? |
|---|---|---|---|---|
| **Sitting at a public table** (ambient room presence) | always-on | continuous | everyone | n/a (it's the lobby itself) |
| **Being watched** | watcher count > 0 on your live game | per spectated game | both players + spectators | n/a |
| **Heartbeat** (room is alive) | N online, M in games | continuous | everyone in lobby | n/a |
| **Clock pressure** | own clock < 30s / < 10s | per timed game phase | self primarily, opponent visible | n/a |
| **Settlement (ordinary win)** | game finalized in your favor | 1 per win | both | n/a |
| **Settlement (ordinary loss)** | game finalized against you | 1 per loss | both | n/a |
| **Greeting** (wave / gg) | manual emote | up to 3 per game per side | both | **yes, manual palette** |
| **Acknowledgment** (bow / salute) | manual emote (when authored) | up to 3 per game per side | both | yes |
| **First-win laurel reveal** | first finalized win ever | once, ever | self + spectators | no |
| **Streak heat (flame_crown)** | win streak ≥ 3 | rare | everyone (live-state) | no |
| **Personal-best pot (chip_explosion)** | win biggest pot of career | a handful per career | self + spectators | no |
| **Upset victory (broken_crown)** | win vs much higher rating | rare | self + spectators | no |
| **Comeback win (stormcloud_cleared)** | win after being down material | rare | self + spectators | no (asset missing — must author) |
| **Honor handshake** | drew or resigned from a winning position; post-game gesture | rare | both | no (event-fired) |
| **Mate-while-down (salt)** | lost by mate while down ≥5 points material | rare | self + spectators (only) | no |
| **Resign-from-winning (meltdown)** | resigned from a position with material advantage | rare | self + spectators (only) | no |
| **Active losing position (stormcloud)** | currently down material in a live game | mid-game, transient | self + spectators | no (live-state) |
| **Rage flames** | RESERVED — not fired at launch | n/a | n/a | no |
| **Table flip** | RESERVED — not fired at launch | n/a | n/a | no |
| **Rage chat** | NEVER FIRES | n/a | n/a | no |
| **GGEZ** | NEVER FIRES | n/a | n/a | no |

### 4.2 Categorization

**Event-fired only (no manual trigger ever):**
All tilt cluster states (salt, meltdown, stormcloud), all "trophy" states (laurel, flame_crown, broken_crown, chip_explosion), the honor handshake. Player has no UI to invoke these.

**Manual palette (player-triggered, rate-limited):**
Wave, gg, bow (when authored), salute (when authored). Up to 3 fires per game per side. Mute-opponent setting default-on for the first 5 games per account.

**Reserved (in catalog, not fired at v1):**
Rage flames, table flip. Held back until the event-fire policy has shipped data on whether the gentler tilt items (salt, meltdown) are creating acceptable emotional texture without weaponization. Roll forward in a later wave only if the data supports it.

**Never fires (retired):**
Rage chat (target-directed by definition). GGEZ (canonical toxic phrase across the chess community; no benign interpretation exists in this context).

### 4.3 Visibility rules

- **Self-tilt is visible to the loser themselves and to spectators**, not just to the opponent. The intent is emotional release reflected on the player's own avatar, not a weapon aimed at the opponent. The opponent may have their **mute-opponent-emotes** setting on (default for first 5 games).
- **Trophy moments (laurel, flame_crown, broken_crown, chip_explosion) are visible to everyone.** These are *celebrations of real signal*, and the room is supposed to read them.
- **Live-state cosmetics (flame_crown active, stormcloud during losing position) are visible to everyone** by definition — they're "current state."
- **Handshake fires visible to both, no mute override** — refusing the visual of "the loser conceded honorably" is hostile to the social contract we want. Honor is non-mutable.

### 4.4 Toxicity controls (locked rules)

1. **All manual emotes are rate-limited**: 3 per game per side. No further fires allowed regardless of equip.
2. **Mute opponent emotes**: setting persists on the user. Defaults **ON** for the first 5 games of any new account. After 5 games the user is asked once whether to flip the default. (Per § 6.2 in the original COSMETICS_NEXT_PASS.md, refined here to "off by default after 5 games with an explicit one-time prompt.")
3. **Event-fired tilt requires evidence**: server-side detection only fires `salt` when material delta ≥5 + mate, only fires `meltdown` when resignation while material delta ≤ -3. No client trigger can spoof these.
4. **Audit log**: every fire writes to `game_events` (the table already exists in `db.mjs`). Admin queue (Phase 6) can review reported patterns.
5. **No "almost-tilted" UI**: we never surface "your opponent is on a losing streak" to the active player. Tilt visualizes after the fact; never as a weaponizable signal mid-game.
6. **Spectator emotes are isolated**: spectator manual reactions render only in the spectator emote bar, transient bubble, never on the player's avatar nameplate.

### 4.5 The social tone target

What the product should feel like over long sessions:

- **Lobby**: a high-stakes poker room at 9pm. Crowded. Live. Other players are visible flexing real state (a flame crown there, a veteran badge here). Nobody is shouting; the energy is in the *room*, not in any single emote.
- **Wager moment**: a mutual sizing-up. The dossier on both sides gives a fair, honest read. Both sides know what they're walking into.
- **Live game**: focused. Quiet at the action layer. Audio is tactile (chip clacks, piece drops, clock pulses). Emotes are uncommon mid-game; they happen post-game more.
- **Settlement**: a financial event. Restrained for ordinary outcomes; spectacle only for milestones. Losses feel heavy and honest. Wins feel earned.
- **Post-game**: a brief social beat. GG, handshake on a clean win, occasional salt from the loser when warranted by the position. Then back to the lobby.
- **Long arc**: every cosmetic on your avatar points to a specific past event. Six months in, you can look at your wardrobe and see the history of your play. No FOMO. No grind exhaustion. No irony poisoning. The system remembers what you did.

### 4.6 What we are NOT trying to be

- Twitch chat for chess (no text chat at launch; emote vocabulary stays small)
- Slot-machine casino (no chests, no sparkle rolls, no premium currency)
- TikTok / mobile-game irony pile (no exaggerated rage spam, no "lol you tilted")
- Duolingo (no streak shields, no daily quest)
- Discord clan platform (no member counts, no clan wars, no kick mechanics)

---

## 5. The v1 launch set

### 5.0 Identity semantics — base piece, frame, adornments

Decision update: the base chess piece is not a generic skin slot and not a shop reward. It is the player's chess-strength identity read.

The avatar vocabulary now has three separate meanings:

- **Base piece = chess rating class / competitive strength.** Pawn, knight, bishop, rook, queen are the canonical starter-piece family. New unknown players may begin at knight provisionally, but linked Chess.com / Lichess ratings and later Horsey rating calibration should be able to move the user into a lower or higher piece class. Base piece reflects chess strength, not purchase power.
- **Frame / border = trust and account status.** Provisional, claimed, verified, gold / established, etc. remain owned by the trust ladder. They cannot be bought, manually overridden, or minted by a shop / stable path.
- **Adornments = earned history, reward, and expression.** Laurel, flame crown, badges, auras, emotes, future token / milestone rewards, and shop-safe cosmetics live here. These can express play history, achievement, stable identity, limited events, or paid taste, but they must not impersonate chess strength or trust.

This avoids conflating three different public signals. A queen base should mean "strong chess identity," not "spent money." A verified border should mean "verified account," not "earned enough XP." A flame crown should mean "currently on a streak," not "higher level."

There is still no positive plan for an XP bar, battle-pass bar, daily-quest bar, or "80% to queen" pressure loop. Rating-class movement can be visualized as calibration / placement if needed, but should be grounded in rating evidence and phrased as identity calibration, not manufactured progress. The wardrobe may show locked earn conditions; it should not nag near-misses or convert chess identity into a grind meter.

Implications for implementation:

- The manifest should include all five starter base pieces as composable base atoms.
- The avatar resolver maps rating evidence to base piece with conservative initial thresholds: `<1000` pawn, `1000-1399` knight, `1400-1699` bishop, `1700-2099` rook, `2100+` queen. Before any Horsey games, the strongest linked Chess.com / Lichess rating may drive placement; after finalized Horsey games exist, `users.rating` owns the class.
- Profile / onboarding copy should distinguish "rating class" from "trust tier."
- Shop and reward systems must not sell or grant base-piece upgrades except as an explicit, documented product exception.

Opinionated. Smaller than the audit's "launch-safe subset" (~22) because we're tightening further: ship enough to feel like a system, hide everything else.

### 5.1 What ships at v1

**Category A — Composable runtime atoms (15 items):**

| ID | Slot | Source | Earn |
|---|---|---|---|
| `base__piece__pawn` | base (0) | `horsey_001_pawn_rookie.png` | rating-class base |
| `base__piece__knight` | base (0) | `horsey_002_knight_tactical.png` | provisional/default rating-class base |
| `base__piece__bishop` | base (0) | `horsey_003_bishop_strategist.png` | rating-class base |
| `base__piece__rook` | base (0) | `horsey_004_rook_guardian.png` | rating-class base |
| `base__piece__queen` | base (0) | `horsey_005_queen_elite.png` | rating-class base |
| `trust__border__provisional` | border (10) | `horsey_052_border_provisional.png` (B4) | auto on signup |
| `trust__border__claimed` | border (10) | **author** | auto on external account link |
| `trust__border__verified` | border (10) | `horsey_053_border_verified.png` (B4) | auto on verified tier |
| `trust__border__gold` | border (10) | `horsey_059_border_gold.png` (B4) | auto on trusted tier (proposed name shift; see § 7) |
| `milestone__headwear__laurel` | headwear (50) | `horsey_028_trust_laurel.png` | first-win milestone |
| `milestone__headwear__flame_crown` | headwear (50) | `horsey_015_highroller_flamecrown.png` | live-state, win-streak ≥3 |
| `milestone__headwear__broken_crown` | headwear (50) | `horsey_032_tilt_brokencrown.png` | event-fired on upset (200+ rating gap) |
| `trust__aura__verified_halo` | front_aura (60) | piece-specific (`horsey_022_queen_verified_halo` + `horsey_020_knight_verified_halo`) | auto on verified tier |
| `trust__badge__veteran` | attached_badge (70) | `horsey_029_veteran_badge.png` | auto on established tier |
| `milestone__reveal__chip_explosion` | event/reveal | `horsey_017_queen_chip_explosion.png` (queen-only at v1) | personal-best pot |

**Category B — Emote pool (6 items):**

| ID | Kind | Source | Trigger |
|---|---|---|---|
| `manual__emote__wave` | manual | `horsey_021_emote_wave.png` | manual palette |
| `manual__emote__gg` | manual | `horsey_022_emote_gg.png` | manual palette |
| `event__emote__chip_explosion` | event-fired | shares asset with reveal above | PB pot |
| `event__emote__salt` | event-fired | `horsey_035_tilt_salt.png` | loss by mate while down ≥5 material |
| `event__emote__meltdown` | event-fired | `horsey_039_tilt_meltdown.png` | resignation while ahead ≥3 material |
| `event__emote__honor_handshake` | event-fired | `horsey_027_trust_handshake.png` | post-game on clean win/draw |

**Category D — Stable (held at v1):**
- Defer all stables to Phase E. `stable__banner__blue` exists but launching with 1 stable is awkward; better to wait until 3+ are authored.

**Total at v1: 15 atoms + 6 emote slots + 5 categories of asset organization = ~21 visible-to-user items.**

### 5.2 What gets hidden (in catalog with `enabled=false`)

The full list of Category A composable atoms that exist but don't ship at v1: top_hat, captain_hat, crown (base, non-flame), grindset accents, highroller accent set, persona-kit pieces, sunglasses variants, all auras except verified_halo, shield_badge, scarf, royal_cape, fur_coat.

These remain in the manifest. The DB seeds them with `enabled=false`. Phase B/C/G can flip them on as content waves.

### 5.3 What gets retired (not in catalog)

| Asset | Reason |
|---|---|
| `slot_machine` | literal anti-reference per `ARENA_NEXT_PASS.md` |
| `casino_chips` (standalone) | drifts toward mobile casino aesthetic |
| `fairplay_reviewshield` | duplicate of `fairplay_shield` |
| 5 B1 full-frame borders | incompatible design language vs B4 chip-style |
| 3 `*_ggez_emote` variants | canonical toxic phrase, no benign interpretation |
| `tilt_ragechat` (+ queen variant) | target-directed by definition |
| 5 batch_2 reference cluster sheets | not real cosmetic atoms; relocate to `scripts/reference/` |
| 9 batch_4 `_equipped` previews | design exhibits; relocate to `scripts/reference/` |

### 5.4 What needs redraws before promotion

Hard prerequisites for the v1 launch:

1. **`trust__border__claimed`** — author from scratch. B4 chip-style design language. Muted treatment with a "?" connotation (per `SCOUTING_TRUST_NEXT_PASS.md` claimed-tier UX).
2. **Transparent atom versions** of `border_silver`, `border_mythic`, `border_arcane` — currently only exist as non-transparent queen-on-felt previews. Redraw as standalone 256×256 overlays.
3. **Generic `chip_explosion`** + **knight variant** — currently only queen variant exists.
4. **`stormcloud_cleared`** — comeback emblem; named in the system, asset missing entirely.
5. **`crowd_cheer`** — spectator reaction emote; named in spec, asset missing.
6. **`manual__emote__bow`** + **`manual__emote__salute`** — to bring the manual palette to 4 items.
7. **Verify `queen_verified_halo` is not an accidental duplicate of `queen_elite`** (matching 96×131 / 21,477 byte metadata in audit § 4.4).

### 5.5 What needs transparent variants (separate from § 5.4)

Already counted above (silver / mythic / arcane). The other "_equipped" previews don't need transparent variants — they shouldn't exist in the pipeline at all.

### 5.6 What needs animation support later

Animation-friendly subset, all CSS-animatable today:

- All borders (subtle pulse on tier transition, on first appearance)
- `flame_crown` (flicker; respect `prefers-reduced-motion`)
- `verified_halo` (one-time pulse on first appearance + slow rotate on broadcast surfaces)
- `chip_explosion` (frame-by-frame would be ideal; CSS scale+opacity at v1)
- `aura_ring_gold` (slow rotate at broadcast scale)

Not animated at v1:
- Headwear (laurel, broken_crown) — static
- Outerwear, accents, facewear — static
- Manual emotes — bounce-in then fade (CSS animation, ~600ms)

Vector / SVG redraws to schedule for the post-v1 wave (per audit § 12.6): the 4 borders, `flame_crown`, `verified_halo`, both base pieces. These are the highest-frequency renderers and benefit most from clean scaling + recolor.

---

## 6. Production manifest & schema

The contract between art, server, and client. One JSON manifest, three DB tables, one render path.

### 6.1 Manifest structure

`scripts/cosmetics/manifest.json` — single source of truth, regenerated by the asset pipeline.

```jsonc
{
  "$schema": "horsey-cosmetics/v1",
  "version": 1,
  "generated_at": "2026-05-24T18:00:00Z",

  "canvas": {
    "width": 256,
    "height": 256,
    "anchors": {
      "back_aura":    { "x": 128, "y": 128 },
      "piece_base":   { "x": 128, "y": 230 },
      "piece_center": { "x": 128, "y": 160 },
      "chest":        { "x": 128, "y": 155 },
      "eye_line":     { "x": 128, "y": 100 },
      "head_top":     { "x": 128, "y": 50 },
      "canvas_outer": { "x": 128, "y": 128 },
      "below_avatar": { "x": 128, "y": 250 }
    }
  },

  "z_order": [
    { "z": -10, "name": "back_aura" },
    { "z":   0, "name": "base" },
    { "z":  10, "name": "border" },
    { "z":  20, "name": "outerwear" },
    { "z":  30, "name": "accent" },
    { "z":  40, "name": "facewear" },
    { "z":  50, "name": "headwear" },
    { "z":  60, "name": "front_aura" },
    { "z":  70, "name": "attached_badge" }
  ],

  "density_modes": {
    "minimal":   { "max_px":  48, "allowed_z": [0, 10],                             "animation": false },
    "compact":   { "max_px":  96, "allowed_z": [0, 10, 50],                         "animation": false },
    "standard":  { "max_px": 180, "allowed_z": [0,10,20,30,40,50,60,70],            "animation": "reduced" },
    "broadcast": { "max_px": null,"allowed_z": [-10,0,10,20,30,40,50,60,70],        "animation": "full" }
  },

  "items": [
    {
      "id": "trust__border__provisional",
      "kind": ["atom"],
      "slot": "border",
      "z": 10,
      "coupling": "generic",
      "piece": null,
      "persona": "trust",
      "function": "trust_signal",

      "rarity": "tier_locked",
      "acquisition": {
        "mode": "auto_tier_grant",
        "trust_tier": "provisional",
        "auto_revoke_on_tier_change": true
      },
      "trust_exclusivity": true,
      "phase": "v1",
      "enabled": true,

      "asset": {
        "src": "/assets/cosmetics/trust/border/provisional.png",
        "natural_size": { "w": 256, "h": 256 },
        "anchor": "canvas_outer",
        "offset": { "dx": 0, "dy": 0 }
      },

      "compatibility": {
        "incompatible_with": [
          "trust__border__claimed",
          "trust__border__verified",
          "trust__border__gold",
          "trust__border__diamond"
        ]
      },

      "rendering": {
        "density_min": "minimal",
        "surfaces": ["dense_row","scout","wager","game_strip","settlement","broadcast","profile","topnav"],
        "animation": null
      }
    },

    {
      "id": "milestone__headwear__flame_crown",
      "kind": ["atom"],
      "slot": "headwear",
      "z": 50,
      "coupling": "generic",
      "persona": "highroller",
      "function": "live_state",

      "rarity": "earned",
      "acquisition": {
        "mode": "milestone_live_state",
        "live_state": { "kind": "win_streak", "min": 3 },
        "first_grant_event_key": "win_streak_3"
      },
      "trust_exclusivity": false,
      "phase": "v1",
      "enabled": true,

      "asset": {
        "src": "/assets/cosmetics/milestone/headwear/flame_crown.png",
        "natural_size": { "w": 256, "h": 256 },
        "anchor": "head_top",
        "offset": { "dx": 0, "dy": 0 }
      },

      "compatibility": {
        "incompatible_with": ["base__headwear__crown","milestone__headwear__broken_crown"],
        "live_state_priority_over": ["milestone__headwear__laurel"]
      },

      "rendering": {
        "density_min": "compact",
        "surfaces": ["scout","wager","game_strip","settlement","broadcast","profile"],
        "animation": {
          "kind": "css_flicker",
          "duration_ms": 2400,
          "iteration": "infinite",
          "broadcast_only": false,
          "respect_reduced_motion": true
        }
      }
    },

    {
      "id": "event__emote__salt",
      "kind": ["emote"],
      "slot": "emote_overlay",
      "z": null,
      "coupling": "generic",
      "persona": "tilt",
      "function": "reaction",

      "rarity": "earned",
      "acquisition": {
        "mode": "event_fire_only",
        "fire_conditions": [
          {
            "trigger": "loss_by_mate",
            "material_delta_lte": -5
          }
        ]
      },
      "trust_exclusivity": false,
      "phase": "v1",
      "enabled": true,

      "asset": {
        "src": "/assets/cosmetics/event/emote/salt.png",
        "natural_size": { "w": 256, "h": 256 },
        "anchor": "piece_center",
        "offset": { "dx": 0, "dy": -30 }
      },

      "policy": {
        "fires_on": "loser_avatar_only",
        "audience": ["self","spectators"],
        "honors_opponent_mute": true,
        "rate_limit_per_game": 1,
        "audit_log_kind": "event_emote"
      },

      "rendering": {
        "density_min": "compact",
        "surfaces": ["game_strip","settlement","broadcast"],
        "render_duration_ms": 1800,
        "animation": { "kind": "css_bounce_fade", "duration_ms": 1800 }
      }
    }
  ]
}
```

Key conventions in the schema:

- **`id` is the canonical key**, `<persona>__<slot>__<variant>[__<piece>]`, snake_case, double-underscore separator.
- **`kind` is an array** because some assets (chip_explosion) serve both as atoms (reward reveal) and emotes (event-fired). Multi-kind keeps a single source of truth.
- **`coupling` is one of `generic` / `piece_coupled` / `scene`**. The runtime renderer accepts only `generic`. Piece-coupled and scene assets live in Categories C–E and route through other paths.
- **`acquisition.mode` is structured**, not free-text — server can evaluate without parsing prose.
- **`trust_exclusivity: true`** means the trust system owns this slot; no other earn class can grant it.
- **`compatibility.live_state_priority_over`** lets a live-state cosmetic (flame_crown) hide a static cosmetic in the same slot (laurel) until state clears.
- **`policy.honors_opponent_mute`** is the toxicity control for emotes. Tilt-cluster emotes always set it true; honor handshake sets it false.
- **`rendering.surfaces`** controls eligibility per surface. A surface filters to items where it's in the list.
- **`rendering.density_min`** is the threshold density at which the asset appears. Anything below that density drops it.
- **`phase`** is a string label (`v1` / `v2` / `phaseE` / `phaseG`) so we can enable/disable in bulk via DB migration.

### 6.2 DB tables

```sql
-- The catalog: seeded from manifest.json on server boot, also queryable.
CREATE TABLE cosmetics (
  id              TEXT PRIMARY KEY,         -- "trust__border__provisional"
  kind            TEXT NOT NULL,            -- "atom" | "emote" | "showcase" | "banner" | "reveal"  (comma-joined if multi)
  slot            TEXT NOT NULL,            -- "border" | "headwear" | ... | "emote_overlay" | "banner"
  z               INTEGER,                  -- nullable for emote/banner
  coupling        TEXT NOT NULL,            -- "generic" | "piece_coupled" | "scene"
  piece           TEXT,                     -- "knight" | "queen" | null
  persona         TEXT,                     -- "trust" | "grindset" | "highroller" | "tilt" | "honor" | "stable" | "base" | null
  function        TEXT NOT NULL,            -- "trust_signal" | "status_flex" | "live_state" | ...
  rarity          TEXT NOT NULL,            -- "common" | "tier_locked" | "earned" | "persona_kit" | "stable" | "honor" | "legacy" | "mythic"
  acquisition_json TEXT NOT NULL,           -- the acquisition object
  trust_exclusive INTEGER NOT NULL DEFAULT 0,
  phase           TEXT NOT NULL,            -- "v1" | "v2" | "phaseE" | "phaseG"
  enabled         INTEGER NOT NULL DEFAULT 1,
  metadata_json   TEXT NOT NULL,            -- the full manifest row, for client and admin
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_cosmetics_slot ON cosmetics(slot);
CREATE INDEX idx_cosmetics_persona ON cosmetics(persona);
CREATE INDEX idx_cosmetics_enabled ON cosmetics(enabled, phase);

-- Ownership: a row per (user, cosmetic, source). The source is the immutable provenance.
CREATE TABLE user_cosmetics (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  cosmetic_id   TEXT NOT NULL,
  source        TEXT NOT NULL,             -- "tier_grant" | "milestone:<id>" | "purchase:<order_id>" | "stable_join:<stable_id>"
  granted_at    TEXT NOT NULL,
  retired_at    TEXT,                       -- non-null if tier downgrade revoked it
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (cosmetic_id) REFERENCES cosmetics(id),
  UNIQUE(user_id, cosmetic_id, source)
);

CREATE INDEX idx_user_cosmetics_user ON user_cosmetics(user_id, retired_at);

-- Equip state: a row per (user, slot). Nullable cosmetic_id = explicitly empty.
CREATE TABLE user_cosmetic_equip (
  user_id       TEXT NOT NULL,
  slot          TEXT NOT NULL,
  cosmetic_id   TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, slot),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (cosmetic_id) REFERENCES cosmetics(id)
);
```

Reuse of existing schema:
- `user_milestones` (already in `db.mjs`) is the source for milestone-class grants. The `source` column in `user_cosmetics` references `milestone:<milestone.id>`.
- `users.trust_tier` (computed via `packages/shared/trust.mjs`) drives tier-bound grants.
- `game_events` (already in `db.mjs`) is the audit log destination for emote fires.

### 6.3 Render path

Single primitive: `renderAvatar(user, { densityMode, size, surface })` on the client.

Server payload shape (added to `viewerPayload`, `enrichGame`, `publicUserProjection`):

```jsonc
{
  "id": "u_abc123",
  "handle": "Sam",
  "rating": 1208,
  "trustTier": "provisional",
  "avatar": {
    "base": "base__piece__knight",
    "border": "trust__border__provisional",
    "outerwear": null,
    "accent": null,
    "facewear": null,
    "headwear": "milestone__headwear__flame_crown",   // live-state evaluated server-side
    "back_aura": null,
    "front_aura": null,
    "attached_badge": null,
    "live_state_flags": { "win_streak": 3 },
    "banner": null,
    "title": null
  }
}
```

Client receives this, looks up each id in the cached manifest, composes the avatar per the density mode declared by the rendering surface, applies CSS animation per the manifest, done.

### 6.4 Trust restrictions in the schema

The `trust_exclusive: true` flag on a cosmetic locks it to a single acquisition path. The server's grant logic checks: if `cosmetic.trust_exclusive` is true and the requested grant source is not `tier_grant`, reject. This prevents a shop purchase or stable join from minting a verified_halo.

### 6.5 Responsive rendering

The client picks a density mode based on the surface and viewport breakpoint:

```javascript
function pickDensityMode(surface, viewportWidth) {
  const surfaceDefaults = {
    open_table_row:     "minimal",
    live_games_row:     "minimal",
    live_table_module:  "compact",
    scout_card:         "compact",
    wager_dossier:      viewportWidth >= 768 ? "standard" : "compact",
    game_strip:         viewportWidth >= 768 ? "standard" : "compact",
    settlement:         viewportWidth >= 1024 ? "broadcast" : "standard",
    profile_own:        "broadcast",
    user_profile:       "standard",
    spectator_hud:      "broadcast",
    featured_table:     "broadcast",
    topnav:             "minimal",
  };
  return surfaceDefaults[surface] || "compact";
}
```

This is the only place the densityMode mapping lives; surfaces never decide their own composition rules.

---

## 7. Reconciliation with COSMETICS_NEXT_PASS.md

No rewrite of that doc yet. This matrix is the diff to apply when promoting any phase to `IMPLEMENTATION_PLAN.md`.

Legend:
- ✅ **survives** — section text is correct as-written
- 🔧 **revision** — section needs architectural rewrite to match this formalization
- ⏸ **art-blocked** — section's claims depend on assets that don't exist yet (§ 5.4)
- ❓ **product-blocked** — section depends on a decision not yet made
- ❌ **delete** — section should be removed; superseded or contradicted

| Section in COSMETICS_NEXT_PASS.md | Status | Action |
|---|---|---|
| § 1 Thesis (real-signal, no lootbox, no daily grind) | ✅ | none |
| § 2.1 Slot model (8 layers, naming) | 🔧 | adopt 9 z-bands (-10 back_aura through 70 attached_badge); banner moves outside avatar canvas |
| § 2.2 Earn class (six exclusive) | ✅ | rename "honor / bestowed" → "honor" only; add explicit `phase` field |
| § 2.3 Function | ✅ | none |
| § 3 Surface map | 🔧 | add density mode column per surface; replace ad-hoc render rules with the density table (§ 1.6) |
| § 4 Onboarding | ✅ | re-confirm: provisional border + default knight base + no claim modal |
| § 5.1 Trust ladder cosmetics | ⏸ | author `border_claimed`, transparent `border_silver/mythic/arcane` before promotion |
| § 5.2 Milestone cosmetics | ✅ + ⏸ | logic survives; ⏸ on `chip_explosion` generic + knight + `stormcloud_cleared` (comeback) |
| § 5.3 Persona-kit cosmetics | 🔧 | reframe: persona-coupled scenes are NOT equipped; they become wardrobe preview thumbnails + kit-complete trophy art (Category C). Equip system grants only the *title* + a generic accent (when authored), not the scene |
| § 5.4 Stable cosmetics | ⏸ | only `stable_banner_blue` exists standalone; author 3 more or defer all stables to Phase E |
| § 5.5 Honor / bestowed | ⏸ | also blocked on Phase 6 trust pipeline (timeout-rate, report-queue) |
| § 5.6 Legacy / retired | ❓ | depends on a product decision: do we want a first arena event? No assets authored |
| § 6 Emote strategy | 🔧 | manual palette is **2 at launch** (wave, gg) not 4–6; bow + salute authoring is prerequisite; ggez retired; mute-opponent default-on for first 5 games refined to "default-on, explicit one-time prompt after 5 games" |
| § 6.1 Manual + event-fired split | ✅ | none |
| § 6.2 Toxicity controls | ✅ | none (see § 4.4 here for refined defaults) |
| § 6.3 Spectator emotes | ⏸ | `crowd_cheer` asset missing; defer this subsection |
| § 7 Spectator presentation | 🔧 | density-mode replaces ad-hoc surface treatment; Featured Table treatment unchanged but separate workstream |
| § 8 Audio / animation integration | ✅ | none (already grounded in `sound.mjs`) |
| § 9 Retention loops | ✅ | none |
| § 10 Trust signaling | ✅ | none |
| § 11 Stable / faction launch model | 🔧 + ⏸ | launch with **0 stables** at v1 (audit found only `stable_banner_blue` standalone); promote stables to Phase E after authoring 3+ banners |
| § 12 Rarity tiers | ✅ | none |
| § 13 Monetization (cosmetic shop) | ✅ | none |
| § 14 Long-arc collectibles | ✅ | trophy room concept survives |
| § 15 Phased rollout (A–J) | 🔧 | insert **Phase 0: anchor + canvas normalization** as prerequisite to Phase A. Phase A becomes "renderer + tier-bound atoms only," ~12 atoms; Phase B (milestones) follows; Phase C (equip mechanic) follows; the rest unchanged |
| § 16 Risk analysis | ✅ | none; refined controls fold into § 4.4 here |
| § 17 Open questions | 🔧 | several answered by this pass (density default = surface-driven, canvas = 256², stable cooldown still 7d, mythic still pre-declared); update or delete |
| § 18 Summary | ✅ | none |

### 7.1 Sections that survive unchanged (no edits needed)

§ 1, § 2.2, § 2.3, § 4, § 6.1, § 6.2, § 8, § 9, § 10, § 12, § 13, § 14, § 16, § 18.

### 7.2 Sections requiring architectural revision

§ 2.1 (slot model → 9 z-bands), § 3 (surface map → density modes), § 5.3 (persona kits don't equip), § 6 (manual palette size), § 7 (spectator density), § 11 (stable launch count), § 15 (Phase 0 anchor prerequisite).

### 7.3 Sections blocked on art production

§ 5.1 (tier ladder borders), § 5.2 (chip_explosion generic+knight, comeback emblem), § 5.4 (3 missing standalone stable banners), § 6 (bow + salute manual emotes), § 6.3 (crowd_cheer).

### 7.4 Sections blocked on product decisions

§ 5.6 (legacy/retired arena — do we want one?), § 17 (open questions remaining).

### 7.5 Sections to delete

None outright. Most contested sections (§ 5.3 persona kits, § 11 stable count) need revision, not deletion.

---

## 8. Next actions

In execution order, not phase order. The immediate objective is to turn cosmetics from aligned PNGs into real account identity. Shop work stays deferred until rating-class identity, trust borders, ownership, and milestone grants are real.

### 8.0 Runtime validation note — May 24, 2026

The first UI-visible renderer pass validated the runtime architecture, but exposed the next constraint: composition quality is now the blocker, not backend logic. The avatar must read as one authored identity object, not as independent PNGs pasted over each other. The immediate tuning target is a cohesive core family before catalog expansion:

- `base__piece__knight`
- `base__piece__queen`
- `trust__border__provisional`
- `trust__border__verified`
- `milestone__headwear__laurel`
- `milestone__headwear__flame_crown`

Future cosmetics work should use the dev composition canvas (`#dev-cosmetics`) to tune offsets, scale, z-index, opacity, density readability, and silhouette before broadening the catalog. Do not keep hand-editing manifest numbers as the main workflow; the remaining work is visual alignment and attached-object feel.

The dev canvas should track the actual `apps/web/assets/cosmetics/` folder, not only stale manifest entries. Deleted PNGs should disappear from active composition and show as missing manifest references; newly added PNGs should appear as uncatalogued assets ready for sorting/classification. As the catalog grows, the editor needs a sorting/filtering layer and likely an explicit recipe/variant model for authored combinations such as `base piece + cosmetic item = piece-specific composite`, instead of pretending every visual relationship is a purely generic overlay.

### 8.1 Progression surface note — May 24, 2026

The app should have visible progress, but not a generic XP economy. Profile should expose rating identity, achievement/adornment unlocks, and practical account state in a compact hierarchy. This gives users a retention surface without implying that base pieces are grind rewards or that trust status can be bought or farmed.

After first visual review, the hierarchy constraint is sharper: the profile should be a player/account page enhanced by avatar identity, not a page about the avatar ontology. The strongest product language is the single interpretation layer, **"What your avatar is saying."** Keep that; collapse repeated taxonomy around it.

Allowed progress visuals:

- **Rating identity calibration** — a meter inside the current rating-class band, sourced from linked account placement before Horsey games and Horsey rating after games exist.
- **Trust-frame ladder** — current trust status and the next account-authenticity step.
- **Achievement unlocks** — first-win laurel, streak flame, and later milestone cosmetics / profile trophies.
- **Collection/loadout** — owned or active expression signals, eventually fed by ownership/equip tables.

Still disallowed:

- Generic XP points.
- Daily quest bars.
- Battle-pass framing.
- “Almost to queen” pressure loops that imply rating class is an unlock grind.

Profile hierarchy rule:

- The hero leads with player identity, rating, and class.
- Avatar interpretation is a compact strip: `Bishop Class · Provisional Frame · No adornments yet`, plus one plain-language sentence.
- Quick stats, wallet/challenge state, and account settings retain higher practical weight than cosmetic taxonomy.
- Achievement unlocks can be visible, but trust/loadout/rating explanations should not repeat across multiple cards.
- Hide or rename "loadout" until users have meaningful cosmetic choices; otherwise it oversells the system.

### 8.2 High-leverage implementation ladder

1. **Lock trust-border semantics.** Decide and document the canonical visual ladder. Current asset direction is `provisional`, `verified`, `trusted`, `elite`, `champion`; product trust tiers are still `provisional`, `claimed`, `verified`, `established`. The app needs one explicit mapping before more public surfaces rely on it.
2. **Implement base-piece resolver.** Map chess strength to `pawn` / `knight` / `bishop` / `rook` / `queen` using `users.rating`, imported external ratings, and calibration state. Start conservative; thresholds can tune later. This is the highest-leverage move because it makes base avatars meaningful across the whole UI.
3. **Add Profile avatar explanation + progression surfaces.** Show the user their avatar large with simple labels: base piece = rating class, border = trust status, adornments = earned history. Profile also needs the non-XP progression surface described above.
4. **Add the three persistence tables** from § 6.2: `cosmetics`, `user_cosmetics`, and `user_cosmetic_equip`. Runtime composition is live, but ownership is still too implicit.
5. **Wire the first-win cosmetic grant.** When the `first_win` milestone fires, grant/equip `milestone__headwear__laurel`. This proves event → grant → owned cosmetic → avatar.
6. **Wire trust-tier border grants.** Trust tier changes should grant and equip the matching border while retiring incompatible old tier-bound borders. This proves trust system → identity.
7. **Wire live-state override from real equip state.** `flame_crown` should override laurel while the streak is active, then release back to laurel when the streak breaks.
8. **Promote the dev editor from alignment tool to catalog tool.** Add sorting/filtering, better uncatalogued-asset intake, and a recipe/variant model for authored composites such as `base piece + item = piece-specific PNG`.
9. **Upgrade scouting/profile data around the avatar.** Rating class, trust status, calibration confidence, recent form, and H2H should reinforce the visual identity on wager/scout surfaces.

### 8.3 Explicit deferrals

- **Item shop.** Defer until ownership/equip state, rating-class base pieces, trust-border grants, and at least one milestone grant are real. The shop should sell expression, not base-piece upgrades or trust signals.
- **Large catalog expansion.** Add assets only as they can be classified, tuned, and explained. More assets without ownership semantics creates noise.
- **Progress bars / XP.** Do not add a battle-pass, daily-quest, or “almost to queen” progress loop. Rating-class movement may be visualized as calibration or placement, but it must be grounded in rating evidence.
- **Stable/faction cosmetics.** Keep deferred until base avatar and trust/milestone loops are stable; stables need their own social/identity rules.

---

## 9. Closing principle

The catalog is small on purpose. Every atom that ships is one that survived three filters: it expresses a real player state, it composes cleanly with the rest of the system, and the moment it appears it carries weight. If a future asset can't pass all three, it doesn't ship.

> Horsey remembers what you did. The cosmetic is the remembering.
> Restraint is what makes the spectacle land.
