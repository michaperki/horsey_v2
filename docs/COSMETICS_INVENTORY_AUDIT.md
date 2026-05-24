# Cosmetics inventory & audit

Companion to [`COSMETICS_NEXT_PASS.md`](COSMETICS_NEXT_PASS.md). That doc proposed a slot/layer/earn-class model assuming the asset set was roughly complete. This audit grounds the model in what actually exists on disk under `scripts/finalized/assets/` (and what's still raw in `scripts/assets/`).

Status: **inventory / audit**. No code changes. Several findings here will require revising COSMETICS_NEXT_PASS.md before promoting any phase to `IMPLEMENTATION_PLAN.md` — flagged at § 12.

---

## 0. Method

- `find scripts/finalized/assets -name "*.png"` enumerated every finalized PNG (119 files across batches 1–4).
- Compared `scripts/finalized/assets` basenames against `scripts/assets` basenames to find what's still raw vs. finalized.
- Every file was opened with PIL and inspected for `size`, `mode`, and `alpha` extrema to verify transparency consistency.
- Five files in `scripts/finalized/assets/batch_2/` were flagged as having **no transparency** (alpha min=255 across the entire image). These are reference sheets, not composable cosmetic atoms — see § 4.
- All `_equipped` and high-tier border previews in `scripts/assets/batch_4/` (numbers 062–070) likewise have no transparency — they are queen-on-felt mockups, not extractable cosmetic layers.
- Visual content (composition, anchor positions, art quality) was *not* inspected — that needs a designer pass.

**119** transparent-background PNGs are actually usable as cosmetic atoms today, out of **191** raw assets that exist. The gap matters: most of `COSMETICS_NEXT_PASS.md`'s "Phase A foundation" assumptions reference assets that are in raw but not finalized, or in finalized but non-transparent.

---

## 1. Headline findings

These shape everything below. Read these first.

1. **The "Layer 1 border" abstraction does not match the actual asset shape.** All five batch_1 borders (`border_provisional`, `border_verified`, `border_trusted`, `border_elite`, `border_champion`) are **177–219 px wide × 170–194 px tall**, drawn as *full-piece silhouettes* with the rank treatment built in. They are not 32-px-thick ring overlays you can stack on top of a separate piece base. The batch_4 "borders" (`border_provisional`/`border_verified` at ~85×85, and `border_gold`/`border_diamond` at ~95×85) are a *different design*: compact rectangle-with-piece-inside chip-style frames. **Borders are two incompatible design languages right now.** The proposal's "Layer 1 = swappable border overlay" assumption holds for batch_4 borders but not batch_1.
2. **High-tier borders (silver, mythic, arcane, champion_equipped) only exist as queen-on-felt preview mockups with no transparency.** They are not yet usable cosmetic atoms. Trust-tier Phase A as written in COSMETICS_NEXT_PASS.md cannot ship without redrawing them as standalone overlays.
3. **Stable banners are almost entirely piece-coupled, not separable.** Only `stable_banner_blue` exists as a standalone-ish asset (128×143). The red/green/purple variants ship as `knight_stable_red`/`knight_stable_green`/`knight_stable_purple` (knight-coupled) and `queen_banner_red`/etc. (queen-coupled in raw, mostly unfinalized). The "Layer 7 = banner alongside dossier card" plan needs either separable banner art or a pivot to piece-coupled stable kits.
4. **Five finalized files are reference cluster sheets, not cosmetic atoms.** `grindset_cosmetics`, `high_roller_casino`, `fair_play_trust`, `tilt_toxic_fun_only`, `stable_faction_identity` — all in batch_2, all with full-bleed RGB and zero transparency. If a catalog auto-imports `scripts/finalized/assets/**`, these will pollute it. They need to be moved to a `reference/` folder or filtered.
5. **Knight coverage of personas is materially incomplete vs. queen.** Knight has the grindset core (~5 items) + tilt core (~5 items) + a high-roller cluster + a stable trio (red/green/purple). Knight is **missing**: opening book, sweatband, focus mode, chip stack, fair-play shield, clean account, honorable emote, trust laurel, cracked glasses, stormcloud, stable crest gold, stable elite, stable captain, all four rank borders. The queen kit is closer to complete but still missing emote_victory, queen-stable banners as standalone, queen_diamond, queen_chip_stack, queen_opening_book.
6. **There is no canonical art board / anchor system.** Dimensions vary from `89×80` (border_provisional batch_4) to `244×87` (sunglasses) to `181×231` (knight_tactical). Pieces, headwear, and accents have no shared coordinate system. Layered composition without anchor points is brittle — every pair of layers will need hand-tuned offsets.
7. **No SVG / vector source for anything.** Every asset is a raster PNG output from the generation script. There is no vector original. Future re-skinning (color variants, animation, sprite-sheet packing) starts from raster, which limits what's cheaply achievable.
8. **Emote assets exist in two registers — general and piece-coupled — without alignment.** `emote_wave`, `emote_gg`, `emote_tilt`, `emote_sweat` are general emotes (no piece). `knight_salt_emote`, `knight_tableflip_emote`, `queen_meltdown`, `queen_ggez_emote` are piece-coupled emote scenes (the whole composition is an emoting piece). The system needs to commit: **emote = ephemeral floating overlay** (general emote shape) or **emote = piece animation pose** (piece-coupled shape). They are incompatible for the same rendering pipeline.

---

## 2. Full inventory (canonical normalized list)

119 finalized usable + non-usable rows below. Columns: `id` (proposed canonical slug), `batch`, `dims (WxH px)`, `bytes`, `coupling` (piece-coupled / generic / showcase), `slot` (proposed), `usable` (yes / reference-sheet / non-transparent).

### Batch 1 — generic cosmetics + 4 chess piece avatars + 5 batch-1-style borders + 4 general emotes

| id | dims | bytes | coupling | slot (proposed) | usable |
|---|---|---|---|---|---|
| pawn_rookie | 149×206 | 44,776 | piece-base | layer 0 base | yes |
| knight_tactical | 181×231 | 57,855 | piece-base | layer 0 base | yes |
| bishop_strategist | 140×228 | 42,678 | piece-base | layer 0 base | yes |
| rook_guardian | 149×207 | 41,040 | piece-base | layer 0 base | yes |
| queen_elite | 96×131 | 21,477 | piece-base | layer 0 base | yes |
| crown | 196×126 | 40,430 | generic | layer 5 headwear | yes |
| top_hat | 181×148 | 33,060 | generic | layer 5 headwear | yes |
| captain_hat | 203×137 | 39,888 | generic | layer 5 headwear | yes |
| sunglasses | 244×87 | 24,336 | generic | layer 4 facewear | yes |
| eye_glow_purple | 229×87 | 26,712 | generic | layer 4 facewear (overlay) | yes |
| blue_scarf | 185×146 | 37,251 | generic | layer 2 outerwear | yes |
| royal_cape | 214×163 | 53,694 | generic | layer 2 outerwear | yes |
| shield_badge | 130×155 | 33,578 | generic | layer 3 accent OR layer 7 banner | yes |
| aura_ring_gold | 228×147 | 51,938 | generic | layer 6 aura | yes |
| aura_ring_purple | 237×147 | 55,804 | generic | layer 6 aura | yes |
| border_provisional (B1) | 177×170 | 39,784 | full-piece silhouette | full-avatar variant | yes but see § 1.1 |
| border_verified (B1) | 180×185 | 56,365 | full-piece silhouette | full-avatar variant | yes but see § 1.1 |
| border_trusted (B1) | 207×179 | 56,923 | full-piece silhouette | full-avatar variant | yes but see § 1.1 |
| border_elite (B1) | 209×182 | 58,489 | full-piece silhouette | full-avatar variant | yes but see § 1.1 |
| border_champion (B1) | 219×194 | 58,830 | full-piece silhouette | full-avatar variant | yes but see § 1.1 |
| emote_wave | 169×190 | 50,788 | general | manual emote | yes |
| emote_gg | 204×192 | 53,382 | general | manual emote | yes |
| emote_tilt | 145×200 | 45,105 | general | event-fired only | yes |
| (slot 024 missing — likely `emote_clutch` or `emote_focus`) | — | — | — | — | gap |
| emote_sweat | 132×194 | 42,078 | general | event-fired | yes |

### Batch 2 — grindset (10) + high-roller (10) + fair-play/trust (9) + tilt (10) + stable intro

| id | dims | bytes | coupling | slot | usable |
|---|---|---|---|---|---|
| **grindset_cosmetics** | 96×176 | 21,374 | showcase | — | **NO** (reference sheet, no alpha) |
| grindset_coffee | 117×152 | 32,431 | generic-or-queen | accent / handheld | yes |
| grindset_headphones | 125×165 | 35,589 | generic-or-queen | layer 5 headwear | yes |
| grindset_hoodie | 114×163 | 32,262 | generic-or-queen | layer 2 outerwear | yes |
| grindset_ramen | 132×154 | 40,006 | generic-or-queen | accent / handheld | yes |
| grindset_tired | 103×148 | 27,751 | generic-or-queen | layer 4 facewear (eyes) | yes |
| elo_goals_notebook | 122×142 | 34,481 | generic | accent / handheld | yes |
| protein_shaker | 88×145 | 21,574 | generic | accent / handheld | yes |
| opening_book | 133×134 | 35,050 | generic | accent / handheld | yes |
| grindset_sweatband | 125×152 | 32,734 | generic-or-queen | layer 5 (low) | yes |
| **high_roller_casino** | 93×179 | 24,940 | showcase | — | **NO** (reference sheet) |
| highroller_vrvisor | 117×160 | 32,311 | generic | layer 5 headwear | yes |
| highroller_goldchain | 108×160 | 32,350 | generic | layer 3 jewelry | yes |
| highroller_sunglasses | 104×157 | 30,023 | generic | layer 4 facewear | yes |
| highroller_flamecrown | 150×169 | 44,623 | generic | layer 5 headwear (live-state) | yes |
| slot_machine | 141×146 | 39,018 | scene prop | layer 7 banner OR scenery | yes — but on-brand risk, see § 11 |
| casino_chips | 128×150 | 37,677 | scene prop | layer 7 banner OR scenery | yes |
| diamond_token | 112×100 | 18,318 | generic | layer 3 jewelry | yes |
| chip_stack | 138×139 | 39,146 | generic | layer 3 accent | yes |
| highroller_furcoat | 140×155 | 40,323 | generic | layer 2 outerwear | yes |
| **fair_play_trust** | 91×171 | 22,724 | showcase | — | **NO** (reference sheet) |
| fairplay_halo | 111×157 | 28,741 | generic | layer 6 aura | yes |
| fairplay_verifiedbadge | 109×146 | 28,347 | generic | layer 7 badge | yes |
| fairplay_shield | 117×145 | 29,528 | generic | layer 7 badge | yes |
| fairplay_reviewshield | 123×143 | 30,975 | generic | layer 7 badge | yes — near-duplicate of fairplay_shield |
| honorable_emote | 144×151 | 28,400 | generic | event-fired emote | yes |
| trust_handshake | 129×136 | 35,517 | generic | event-fired emote | yes |
| trust_laurel | 126×156 | 35,557 | generic | layer 5 headwear (low-key) | yes |
| veteran_badge | 134×154 | 40,077 | generic | layer 7 badge | yes |
| stable_banner_blue | 128×143 | 26,366 | generic | layer 7 banner | yes (the only standalone stable banner) |
| **tilt_toxic_fun_only** | 92×175 | 23,837 | showcase | — | **NO** (reference sheet) |
| tilt_brokencrown | 107×157 | 30,259 | generic | layer 5 headwear (one-off trophy) | yes |
| tilt_rageflame | 135×170 | 41,017 | generic | layer 6 aura (event-fired) | yes |
| tilt_crackedsunglasses | 121×156 | 32,656 | generic | layer 4 facewear | yes |
| tilt_salt | 118×143 | 26,861 | generic | event-fired emote | yes |
| tilt_ragechat | 148×157 | 32,803 | generic | event-fired emote | yes |
| tilt_tableflip | 138×124 | 32,127 | generic | event-fired emote | yes |
| tilt_stormcloud | 112×161 | 30,203 | generic | layer 6 aura (event-fired) | yes |
| tilt_meltdown | 136×144 | 28,778 | generic | event-fired emote | yes |
| tilt_ggez | 130×146 | 31,714 | generic | manual emote | yes — toxic-coded; see § 11 |
| **stable_faction_identity** | 93×175 | 23,090 | showcase | — | **NO** (reference sheet) |

### Batch 3 — knight-coupled persona kits (partial coverage, 23 items)

Knight kit. **Coupled to the knight piece** — these are not separable accessories; they're knight-with-X scenes.

| id | dims | bytes | persona | slot intent | usable |
|---|---|---|---|---|---|
| knight_grindset_headphones | 140×168 | 38,293 | grindset | knight-equipped scene | yes (piece-coupled) |
| knight_grindset_coffee | 127×170 | 34,752 | grindset | knight-equipped scene | yes (piece-coupled) |
| knight_grindset_hoodie | 134×171 | 33,165 | grindset | knight-equipped scene | yes (piece-coupled) |
| knight_grindset_ramen | 145×174 | 45,469 | grindset | knight-equipped scene | yes (piece-coupled) |
| knight_grindset_tiredeyes | 122×168 | 31,757 | grindset | knight-equipped scene | yes (piece-coupled) |
| high_roller_knight | 138×168 | 34,575 | high-roller | knight-equipped scene | yes |
| knight_flamevisor | 125×176 | 35,800 | high-roller | knight-equipped scene | yes |
| knight_casino_sunglasses | 119×178 | 35,410 | high-roller | knight-equipped scene | yes |
| knight_chip_crown | 115×175 | 31,772 | high-roller | knight-equipped scene | yes |
| knight_jackpot_aura | 148×179 | 49,756 | high-roller | knight + aura | yes |
| knight_diamond_token | 142×161 | 39,009 | high-roller | knight + accent | yes |
| knight_verified_halo | 150×173 | 44,267 | trust | knight + halo | yes |
| knight_veteran_badge | 119×152 | 30,411 | trust | knight + badge | yes |
| knight_broken_crown | 136×164 | 42,635 | tilt | knight + crown | yes |
| knight_rage_flames | 149×167 | 28,776 | tilt | knight + aura | yes |
| knight_salt_emote | 109×165 | 29,685 | tilt | event-fired emote | yes |
| knight_tableflip_emote | 136×171 | 43,964 | tilt | event-fired emote | yes |
| knight_meltdown | 134×167 | 33,327 | tilt | event-fired emote | yes |
| knight_ggez_emote | 140×165 | 37,394 | manual emote | yes | yes |
| stable_knight_identity | 135×142 | 34,711 | stable | knight + crest | yes |
| knight_stable_red | 117×174 | 33,028 | stable | knight + banner | yes |
| knight_stable_green | 130×166 | 33,293 | stable | knight + banner | yes |
| knight_stable_purple | 136×163 | 32,842 | stable | knight + banner | yes |

### Batch 4 — queen-coupled persona kits (25 items) + 4 finalized batch-4-style borders

| id | dims | bytes | persona | slot intent | usable |
|---|---|---|---|---|---|
| queen_grindset_coffee | 116×131 | 29,722 | grindset | queen-equipped | yes |
| queen_headphones | 100×134 | 27,779 | grindset | queen-equipped | yes |
| queen_hoodie | 112×134 | 27,536 | grindset | queen-equipped | yes |
| queen_ramen | 119×136 | 32,115 | grindset | queen-equipped | yes |
| queen_tired_eyes | 90×131 | 25,088 | grindset | queen-equipped | yes |
| queen_sweatband | 187×168 | 26,397 | grindset | queen + headwear | yes — outlier dim |
| queen_vr_visor | 104×127 | 24,837 | high-roller | queen + headwear | yes |
| queen_gold_chain | 90×132 | 24,794 | high-roller | queen + jewelry | yes |
| queen_sunglasses | 98×127 | 24,475 | high-roller | queen + facewear | yes |
| queen_flame_crown | 130×138 | 38,077 | high-roller | queen + headwear (live) | yes |
| queen_chip_explosion | 138×130 | 32,100 | high-roller | event-fired | yes |
| queen_fur_coat | 120×132 | 31,326 | high-roller | queen + outerwear | yes |
| queen_verified_halo | 96×131 | 21,477 | trust | queen + halo | yes — same hash as queen_elite base? |
| queen_honorable | 91×128 | 24,265 | trust | event-fired emote | yes |
| queen_laurel | 119×116 | 29,455 | trust | queen + headwear | yes |
| queen_veteran_badge | 114×128 | 29,737 | trust | queen + badge | yes |
| queen_broken_crown | 93×134 | 26,921 | tilt | queen + crown | yes |
| queen_rage_flames | 124×140 | 36,014 | tilt | queen + aura | yes |
| queen_cracked_glasses | 115×131 | 26,964 | tilt | queen + facewear | yes |
| queen_rage_chat | 117×132 | 31,128 | tilt | event-fired | yes |
| queen_table_flip | 127×119 | 28,692 | tilt | event-fired | yes |
| queen_stormcloud | 111×132 | 25,904 | tilt | queen + aura | yes |
| queen_meltdown | 123×132 | 26,594 | tilt | event-fired | yes |
| queen_ggez_emote | 131×130 | 30,148 | manual emote | yes | yes |
| queen_crest_gold | 86×123 | 22,367 | stable | queen + crest | yes |
| queen_knight_mascot | 91×123 | 22,398 | stable | queen + knight crest | yes |
| queen_team_three | 135×97 | 29,797 | stable | queen + 3-color crest | yes |
| border_provisional (B4) | 89×80 | 10,640 | trust | chip-style frame | yes — **different design from B1** |
| border_verified (B4) | 85×81 | 11,347 | trust | chip-style frame | yes — **different design from B1** |
| border_gold (B4) | 95×85 | 15,218 | high-roller / champion | chip-style frame | yes |
| border_diamond (B4) | 93×93 | 15,518 | mythic / personal-best | chip-style frame | yes |

---

## 3. Categorization matrix

### 3.1 By persona / cluster

| Cluster | Generic | Knight-coupled | Queen-coupled | Total finalized | Coverage notes |
|---|---|---|---|---|---|
| **Base pieces** | 5 (pawn, knight, bishop, rook, queen) | — | — | 5 | only 2 (knight, queen) are heavily kit-supported |
| **Grindset** | 9 (coffee, headphones, hoodie, ramen, tired, sweatband, elo_goals, protein_shaker, opening_book) | 5 (headphones, coffee, hoodie, ramen, tired_eyes) | 6 (coffee, headphones, hoodie, ramen, tired_eyes, sweatband) | 20 | strong; missing knight sweatband, knight opening_book |
| **High roller / casino** | 8 (vrvisor, goldchain, sunglasses, flamecrown, slot_machine, casino_chips, diamond_token, chip_stack, furcoat) | 6 (flamevisor, casino_sunglasses, chip_crown, jackpot_aura, diamond_token, high_roller_knight) | 6 (vr_visor, gold_chain, sunglasses, flame_crown, fur_coat, chip_explosion) | 20 | strong; missing knight_chip_stack standalone, queen_chip_stack standalone |
| **Trust / fair-play / honor** | 5 (fairplay_halo, fairplay_verifiedbadge, fairplay_shield, fairplay_reviewshield, honorable_emote, trust_handshake, trust_laurel, veteran_badge) | 2 (verified_halo, veteran_badge) | 4 (verified_halo, honorable, laurel, veteran_badge) | 13 | **knight pipeline almost empty** — no knight clean_account, fairplay_shield, honorable, trust_laurel, trust_handshake |
| **Tilt** | 9 (brokencrown, rageflame, crackedsunglasses, salt, ragechat, tableflip, stormcloud, meltdown, ggez) | 6 (broken_crown, rage_flames, salt_emote, tableflip_emote, meltdown, ggez_emote) | 8 (broken_crown, rage_flames, cracked_glasses, rage_chat, table_flip, stormcloud, meltdown, ggez_emote) | 23 | **largest cluster** — see § 11 risk |
| **Stables** | 1 (stable_banner_blue) | 4 (identity, red, green, purple) | 3 (crest_gold, knight_mascot, team_three) | 8 | **standalone banners essentially missing** — only blue exists generic |
| **Borders (rank)** | 5 (B1 full-frame: provisional/verified/trusted/elite/champion) | — | — | 5 (B1) + 4 (B4 chip-style: provisional/verified/gold/diamond) = 9 total | **two incompatible design languages** — see § 1.1 |
| **Auras / halos** | 4 (aura_ring_gold, aura_ring_purple, fairplay_halo, eye_glow_purple) | — | 1 (verified_halo) | 5 | underweight relative to "Layer 6 aura" plans |
| **General emotes** | 4 (wave, gg, tilt, sweat) | — | — | 4 | **gap at slot 024** (numbering jump suggests dropped asset) |
| **Showcase / reference sheets** | 5 (grindset_cosmetics, high_roller_casino, fair_play_trust, tilt_toxic_fun_only, stable_faction_identity) | — | — | 5 | **MUST be moved out of /finalized — see § 4** |

### 3.2 By proposed slot

Mapping the inventory to COSMETICS_NEXT_PASS.md § 2.1 layers. The columns count usable transparent atoms only.

| Slot | Layer | Count | Examples | Notes |
|---|---|---|---|---|
| 0 Base | piece body | 5 (generic) + ~23 (knight-coupled scenes) + ~25 (queen-coupled scenes) | knight_tactical, queen_elite, pawn_rookie | piece-coupled "scenes" carry their own L0; they aren't compositable with generic accessories |
| 1 Border | frame | 5 (B1 full-frame) + 4 (B4 chip-style) | border_provisional/verified/trusted/elite/champion (B1), border_provisional/verified/gold/diamond (B4) | **two incompatible languages**, both incomplete |
| 2 Outerwear | hoodie / cape / coat / scarf | 5 | grindset_hoodie, royal_cape, highroller_furcoat, blue_scarf | knight_highroller_cape (raw, unfinalized) is missing |
| 3 Jewelry / accent | chain / token / chips / book | 7 | highroller_goldchain, diamond_token, chip_stack, opening_book, protein_shaker, elo_goals_notebook, casino_chips | only `chip_stack` exists standalone for "Layer 3 accent" core; knight/queen variants pending |
| 4 Facewear | glasses / eyes | 6 | sunglasses, highroller_sunglasses, tilt_crackedsunglasses, eye_glow_purple, grindset_tired (eyes), grindset_sweatband | grindset_tired is "tired eyes overlay" not glasses — re-classify |
| 5 Headwear | crown / hat / band / visor | 11 | crown, top_hat, captain_hat, grindset_headphones, grindset_sweatband, highroller_vrvisor, highroller_flamecrown, tilt_brokencrown, trust_laurel, queen_flame_crown, knight_chip_crown | **strongest slot — but most assets are over-sized vs. piece bases (see § 6)** |
| 6 Aura / halo | ring / glow / flame | 6 | aura_ring_gold, aura_ring_purple, fairplay_halo, tilt_rageflame, tilt_stormcloud, knight_jackpot_aura, queen_verified_halo, knight_verified_halo | **eye_glow_purple is mis-slotted** — it's an overlay on the eye area, not a halo behind the piece |
| 7 Banner / badge | crest / shield / banner | 8 | stable_banner_blue, fairplay_verifiedbadge, fairplay_shield, fairplay_reviewshield, shield_badge, veteran_badge, queen_crest_gold, queen_team_three | **fairplay_shield ≈ fairplay_reviewshield** (probable duplicate) |
| Manual emote | wave / gg / ggez | 5 | emote_wave, emote_gg, tilt_ggez, knight_ggez_emote, queen_ggez_emote | duplicated across generic + piece-coupled |
| Event-fired emote | tilt / honor / chip-explosion | 11+ | salt, meltdown, table_flip, rage_chat, honorable_emote, trust_handshake, knight_*_emote variants, queen_*_emote variants | over-supplied relative to the controlled-fire policy in COSMETICS_NEXT_PASS.md § 6 |

### 3.3 By emotional tone

| Tone | Count | Examples | Use case |
|---|---|---|---|
| **Neutral / dignified** | ~9 | base pieces, top_hat, captain_hat, blue_scarf, royal_cape | onboarding / common defaults |
| **Sweat / grind** | ~20 | grindset_*, opening_book, protein_shaker, elo_goals_notebook | persona kit; profile + scout card narrative |
| **Flex / status** | ~18 | highroller_*, gold_chain, fur_coat, flame_crown, jackpot_aura, diamond_token, chip_stack | wager dossier + broadcast surfaces |
| **Trust / honor** | ~12 | verified_halo, veteran_badge, trust_laurel, honorable_emote, trust_handshake, fairplay_* | trust-tier signaling; scout card |
| **Tilt / rage** | ~22 | broken_crown, rage_flames, stormcloud, meltdown, salt, table_flip, rage_chat, cracked_glasses | event-fired only; spectator emotional vocabulary |
| **Greeting / friendly** | ~5 | emote_wave, emote_gg, *_ggez_emote, trust_handshake | manual emote palette |
| **Showcase (unusable)** | 5 | the 5 cluster reference sheets | trash — see § 4 |

**Observation:** The tilt cluster is the single largest emotional category (22 assets across batches 2–4). For a product committed to "no celebration of losses" and "no targeted toxicity," this is **over-supplied** at the asset level relative to the policy. The launch-safe subset should hold most tilt assets back.

### 3.4 By rarity potential (proposed)

| Tier | Count | Examples |
|---|---|---|
| Common (always available, base vocabulary) | ~12 | knight_tactical, queen_elite, emote_wave, emote_gg, border_provisional (B4), opening_book |
| Earned (real-signal milestone) | ~14 | flame_crown, chip_explosion, broken_crown, laurel, jackpot_aura, veteran_badge |
| Tier-locked (trust ladder) | ~9 | border_provisional/verified/trusted/elite/champion, verified_halo, veteran_badge variants |
| Persona-kit (silent earn) | ~30 | full grindset/high-roller clusters |
| Stable-bound | ~8 | banner_blue, knight_stable_*, queen_crest_gold, queen_team_three |
| Honor / bestowed (Phase 6 gated) | ~6 | fairplay_halo, fairplay_shield, honorable_emote, trust_handshake, trust_laurel |
| Legacy / retired (future) | 0 | not yet authored |
| Mythic / once-in-history (future) | 0 | not yet authored |

### 3.5 By suitability axis (onboarding / spectator / animation / monetization)

| Asset class | Onboarding-friendly | Spectator-friendly | Animation-friendly | Monetization-OK |
|---|---|---|---|---|
| Base pieces | ✅ | ✅ | partial (rasters; would need vector for clean rigs) | ✅ shop-able |
| Borders (B4 chip-style) | ✅ | ✅ | yes (simple ring → easy CSS keyframes) | ✅ |
| Borders (B1 full-frame) | ❌ too elaborate | ✅ | hard (raster baked-in) | ❌ tier-bound only |
| Headwear (crown, hat, laurel) | ✅ via tier | ✅ | partial | ✅ shop-friendly |
| Facewear (sunglasses, eye_glow) | ✅ | partial — small at row scale | hard (raster) | ✅ shop-friendly |
| Auras (gold/purple rings) | partial — feels strong | ✅ | ✅ (low-opacity CSS pulse) | partial — risk of P2W feel |
| Banners / badges | ✅ | ✅ | minimal | ✅ stable pack |
| Manual emotes (wave/gg) | ✅ | ✅ | hard without vector | shop OK if cosmetic-only |
| Tilt emotes | ❌ noisy for newbies | ✅ but rate-limit | hard | ❌ never monetize negative-affect cosmetics |
| Persona kits (grindset/high-roller) | partial — opt-in via stable | ✅ | hard | ✅ as cosmetic packs |
| Showcase sheets | ❌ not real cosmetics | ❌ | n/a | n/a |

---

## 4. Duplicates, near-duplicates, weak / unclear assets

### 4.1 Reference sheets currently in /finalized — must be filtered or moved

Five files in `scripts/finalized/assets/batch_2/` have **no transparency** and are full-bleed cluster reference panels rather than cosmetic atoms:

- `horsey_001_grindset_cosmetics.png`
- `horsey_011_high_roller_casino.png`
- `horsey_021_fair_play_trust.png`
- `horsey_031_tilt_toxic_fun_only.png`
- `horsey_041_stable_faction_identity.png`

**Action:** move to `scripts/finalized/reference/` or filter via manifest convention (e.g., any file with alpha-min ≥ 250 is excluded from the cosmetic catalog importer). The file `horsey_062_usage_example.png` (in raw `assets/batch_4`, never finalized) is the same kind of artifact.

### 4.2 Non-transparent "equipped" previews and high-tier borders (raw only)

In `scripts/assets/batch_4/`, numbers 062–070 are all queen-on-felt mockups with no transparency: `usage_example`, `queen_base`, `queen_gold_chain_equipped`, `queen_flame_crown_equipped`, `queen_sunglasses_equipped`, `queen_chip_explosion_equipped`, `border_champion_equipped`, `queen_banner_purple_equipped`, `high_roller_queen`. These show how cosmetics will *look on the queen* but they are not extractable layers.

**Action:** treat these as design exhibits, not pipeline inputs. They never get finalized.

The high-tier borders `border_silver` (131×111), `border_mythic` (152×111), `border_arcane` (148×115), `border_champion_equipped` (131×115) **also have no transparency** in raw — meaning even if they got "finalized" via the current pipeline, they would still be solid-background queen-with-border previews, not standalone border atoms. **They need to be redrawn as standalone overlays before they can ship.**

### 4.3 Probable duplicates / near-duplicates

| Pair | Note |
|---|---|
| `fairplay_shield` (B2 #024) vs `fairplay_reviewshield` (B2 #025) | both shield-shaped trust accents; pick one, retire the other |
| `border_provisional` (B1 #016, 177×170) vs `border_provisional` (B4 #052, 89×80) | **same name, two designs** — taxonomy collision |
| `border_verified` (B1 #017) vs `border_verified` (B4 #053) | same collision |
| `aura_ring_gold` vs `fairplay_halo` | overlap in semantics; aura_ring_gold reads more "flex," fairplay_halo more "trust" — keep both but be explicit |
| `tilt_ggez` (B2 #040) vs `knight_ggez_emote` (B3 #036) vs `queen_ggez_emote` (B4 #040) | three versions; ggez sits between "manual greeting" and "toxic taunt" — see § 11 |
| `crown` (B1 #006) vs `highroller_flamecrown` vs `knight_chip_crown` vs `tilt_brokencrown` | four crown variants — fine if rarity-tiered (common / flex / earned / one-off), risky if treated interchangeably |
| `knight_verified_halo` (B3 #020) vs `queen_verified_halo` (B4 #022) | piece-coupled; need a *generic* verified_halo for non-knight/queen avatars — see § 5 |
| `stable_knight_identity` (B3 #037) vs `stable_faction_identity` (B2 #041) | the latter is a reference sheet (no alpha); the former is a usable knight-stable crest — rename to avoid confusion |

### 4.4 Weak / unclear assets

- `slot_machine` (B2 #016, 141×146) and `casino_chips` (B2 #017, 128×150) — these are scene props, not avatar accessories. **They drift toward mobile-casino aesthetic** (cf. `ARENA_NEXT_PASS.md` § "From mobile-game casino aesthetic — reject" — slot machine is the literal anti-reference). Recommend: do not ship as wearable cosmetics. Possibly use as backdrop watermarks for the lobby's casino-themed stable's hero, with care.
- `tilt_toxic_fun_only` — the filename itself encodes uncertainty ("fun only"). Already a reference sheet; treat as design exploration, not catalog.
- `eye_glow_purple` — slot is ambiguous. Listed under "facewear" but visually it's likely an aura overlay over both eyes. Without a designer pass, the layering offset is unknown.
- `queen_sweatband` (187×168) — dimensions are wildly outside the queen-kit cluster (which is mostly 90–140 wide). Either a different art board or a cropping issue.
- `queen_verified_halo` (96×131, 21,477 bytes) — **byte-identical-looking metadata to queen_elite** (96×131, 21,477 bytes). This is suspicious: either an accidental duplicate, an export collision, or queen_verified_halo's halo is invisible-on-transparent and the file is functionally just the queen base. Needs visual confirmation.

### 4.5 Naming inconsistency that will bite later

- `highroller_*` (one word) vs `high_roller_*` (two words) — same persona, different prefixes. Compare `highroller_goldchain` (B2 #013) vs `high_roller_knight` (B3 #010). The DB / catalog can't dedupe.
- `tilt_*` prefix in B2 / `queen_*` prefix without `tilt_` in B4 — `tilt_meltdown` (B2 #039) and `queen_meltdown` (B4 #039) have the same numeric slot but different prefix conventions.
- `*_emote` suffix is inconsistent: `emote_gg`, `emote_wave` (prefix), but `knight_ggez_emote`, `queen_table_flip` (no emote suffix), `honorable_emote` (suffix).
- Numbering jumps within a batch suggest dropped assets without backfill (batch_1 jumps from #023 → #025; batch_4 has many gaps).

---

## 5. Missing assets — relative to COSMETICS_NEXT_PASS.md assumptions

What `COSMETICS_NEXT_PASS.md` references vs. what actually exists on disk. **Each row here is a place the proposed system would break if implemented today.**

| COSMETICS_NEXT_PASS reference | Status | Needed |
|---|---|---|
| § 2.1 Layer 1 swappable border overlay | partial — B4 chip-style works; B1 full-frame doesn't compose | redraw rank borders as 256×256 chip-style overlays at full ladder (provisional/claimed/verified/trusted/established/gold/diamond/mythic) |
| § 5.1 `border_claimed` | **missing entirely** — claim tier has no asset | new design needed (muted "?" treatment per scout doc) |
| § 5.1 `border_trusted` standalone ring | only B1 full-frame exists | redraw as overlay |
| § 5.1 high-tier (silver/gold/diamond/mythic/arcane) | only B4 gold + diamond are transparent atoms | silver/mythic/arcane need standalone overlays |
| § 5.2 first-win laurel notch | partial — `trust_laurel` and `queen_laurel` exist | knight variant pending; a "small notch on border" treatment not authored |
| § 5.2 comeback emblem | **missing** | needed (e.g., `comeback_emblem` — companion to stormcloud) |
| § 5.2 hot-table participant flash | partial — `chip_explosion` (queen variant only) | need generic + knight variants |
| § 5.3 grindset kit completion title | data only — no "complete-kit" cosmetic | optional decorative kit-complete trophy needed |
| § 5.3 high-roller kit + verified gate | partial — flame_crown exists | needs explicit high-roller-kit "earned" trophy distinct from flame_crown live-state |
| § 5.5 honor / bestowed | exists in batch_2 (fairplay_halo, fairplay_shield, honorable_emote, trust_handshake) | knight variants entirely missing; queen partial (honorable, laurel) |
| § 6 manual emote palette (4–6) | only 3 friendly options exist: wave, gg, ggez | need 1–2 more low-key reactions (e.g., `bow`, `salute`, `thinking`, `respect`) |
| § 6 event-fired emote `stormcloud_cleared` (comeback) | **missing** — stormcloud exists, "cleared" variant doesn't | new design |
| § 7 Featured Table ESPN-style eyebrow | n/a (UI treatment, not asset) | n/a |
| § 8 cosmetic equip slide animation | n/a (CSS animation, not asset) | n/a |
| § 11 launch stable "Veterans" cosmetic palette | partial — laurel + veteran_badge + crest_gold (queen only) | knight veteran_crest_gold needed |
| § 11 launch stable "High Rollers" palette | OK — chip_stack, gold_chain, fur_coat, sunglasses, diamond present | none — though knight_chip_stack pending |
| § 11 launch stable "Tilt Tavern" palette | **probably too much** — see § 11 risk |
| § 11 launch stable "Honor Guard" palette | knight side empty | knight versions of honorable/laurel/shield/handshake all pending |
| § 11 stable banners (4 distinct) | only blue exists as a standalone generic; red/green/purple/elite exist piece-coupled or in raw queen variants | author standalone generic banners for the 3–4 missing colors |
| § 14 trophy room / pinnable items | n/a (UI, not asset) | n/a |
| § 14 retired seasonal cosmetics | **none authored** | needs a first seasonal arena cosmetic for Phase J |
| § 15 Phase B `flame_crown` live-state | exists as `highroller_flamecrown` (generic) + `queen_flame_crown` | knight_flame_crown is `knight_flamevisor` — different design (flamevisor ≠ flamecrown); naming alignment needed |
| § 15 Phase B PB-pot `chip_explosion` | queen variant only | generic + knight versions needed |
| § 15 Phase D event-fired emote `cheer` (crowd reaction) | **missing entirely** | new spectator-side emote needed |
| § 16 anti-pattern guardrail: a `comeback_cosmetic` granted for losing | not needed — but no asset for "honest survival from a bad position" exists either | optional: `stormcloud_cleared` |

### 5.1 "Bridge" assets where progression jumps awkwardly

The trust-tier ladder needs *visible interpolation* between tiers so the gap from provisional → verified doesn't read as a discontinuity:

- **`border_claimed`** — needed between provisional and verified (claimed tier exists in the trust ladder per `trust.mjs` but has no cosmetic). Without it, claimed users wear the same border as provisional users, which contradicts the trust ladder.
- **Soft-progression headwear at low tiers** — currently the headwear catalog jumps from "nothing" → "crown / top_hat / laurel" (status pieces). Missing: a low-rarity headwear like `simple_cap` or `visor_basic` for fresh accounts who don't yet warrant a crown but should still be able to express identity.
- **Honor-progression chain** — handshake → laurel → veteran_badge is the implied honor ladder. The middle rung (laurel) exists; the entry rung (`first_honor` or `clean_player` simple variant) doesn't.

### 5.2 Missing emotional states / identity archetypes

Reading the existing catalog, these archetypes are *named* but **not represented**:

- **Calm / focused** — no "thinking" or "calm" or "concentration" emote / cosmetic. The catalog skews high-energy (grind + flex + tilt) with no equivalent for the meditative / patient archetype. Chess specifically rewards this; we have nothing for it.
- **Defensive / stalwart** — `rook_guardian` base is the only nod; no shield-equipped defensive-archetype kit.
- **Tactician / book** — `opening_book` and `elo_goals_notebook` exist but no "studied" archetype kit.
- **Comeback / survivor** — tilt cluster covers the *failure* states; nothing for the *recovery* state.
- **Newcomer / wholesome** — by the existing catalog, the only newcomer signals are "provisional border" + base piece. No friendly low-key cosmetics like `welcome_wave` or `learner_book`.
- **Lobby presence** — no "I'm chatty" or "I'm here to watch" cosmetics for railbird identity.

### 5.3 Missing low-tier / common cosmetics

The catalog skews **epic-heavy**. There's a crown, a flame crown, a chip crown, a broken crown — and a laurel, a veteran badge, a halo. Almost everything reads as a *status grant*. Missing: low-rarity neutrals that a fresh account can wear without claiming status.

Suggested low-tier additions:
- `simple_band` (plain headband, no sweat)
- `visor_basic` (clean visor, no flame)
- `glasses_reading` (neutral glasses, not sunglasses)
- `pin_simple` (small accent pin, no shield connotation)
- `pocket_square` (simple cape-alternative, no royalty connotation)

Without these, every cosmetic the user equips reads as "I'm something special," which inflates the visual register of the whole product.

### 5.4 Missing reactive / emotional emotes

The manual emote palette per COSMETICS_NEXT_PASS § 6 needs 4–6 items. Friendly options today: `emote_wave`, `emote_gg`, `*_ggez_emote`. That's 3, and `ggez` is borderline (see § 11 risk). Missing:

- `bow` / `respect` (post-loss honor gesture)
- `salute` (greeting variant)
- `thinking` (signal you're considering a complex position — gives spectators something to react to)
- `nice_move` (acknowledge opponent's good play)

The event-fired emote pool is over-supplied; the manual pool is under-supplied. This imbalance is a product risk.

### 5.5 Missing trust / reputation visuals

- `claimed_badge` (the muted "?" treatment scout doc references)
- `external_account_linked` cosmetic (the small Lichess/Chess.com link icon as an avatar accent)
- `verification_pending` chip (the in-flight state has no visual)
- `placed_badge` (per-time-control placement gate — when that ships, the badge needs to exist)
- `low_timeout_rate` (Phase 6 reliability metric — needs cosmetic surface)

### 5.6 Missing stable / faction assets

- Standalone generic banners for **red**, **green**, **purple** (only blue exists; red/green/purple ship only piece-coupled).
- A 4th stable identity asset — the design assumes 4 launch stables. The current asset for "Tilt Tavern" stable would be drawn from the tilt cluster, which is already over-supplied.
- Stable *captains* / *founders* visual differentiator — referenced as `knight_stable_captain` in raw, not finalized.
- Stable-vs-stable rivalry visual (a clash crest / dual-color banner) — none exist.

### 5.7 Missing celebration / spectator assets

- `crowd_cheer` (crowd reaction emote for spectators) — explicitly named in COSMETICS_NEXT_PASS.md § 7 + 8 but **not authored**.
- `featured_table_badge` / `FEATURED` eyebrow ribbon — text-overlay treatment with no asset.
- `pot_size_milestone` ribbon (e.g., "$1K+ pot") — text overlay, no asset.
- `match_intro_card` — the brief animated card-flip / chip-rack open referenced in `ARENA_NEXT_PASS.md`. No asset; would need motion design.
- `settlement_ribbon` — win/loss/draw banner specific to the settlement card composition.

### 5.8 Missing animation-friendly assets

Because all assets are raster, animation requires either:
- Programmatic CSS keyframes on the whole image (opacity pulse, scale wobble, hue rotate).
- Frame-by-frame sprite sheets (none authored).
- SVG re-draws (none authored).

Assets currently strongest for CSS-only animation: borders (B4 chip-style — pulse / glow), auras (`aura_ring_gold`, `aura_ring_purple` — slow rotate / opacity pulse), flame variants (`highroller_flamecrown`, `tilt_rageflame` — flicker via opacity). Assets that need re-authoring for animation: anything where a *part* needs to move independently (a piece holding a coffee that steams, headphones with a pulse equalizer) — none of these are decomposed.

---

## 6. Layering compatibility — what stacks, what conflicts, what breaks at small sizes

### 6.1 The fundamental constraint: no canonical art board

Dimensions across the catalog (89×80 to 244×87 to 181×231) confirm there is **no shared canvas size and no shared anchor system**. Composition by simple `<img>` overlay will not align without per-asset metadata describing:
- canvas size (target output frame)
- anchor offset (where on the canvas this asset should land)
- z-order

Without that metadata, every layer pair is a hand-tuned `top:-23px; left:12px;` declaration. That's the path to dozens of magic numbers and visual bugs.

**Recommendation:** before composing layers in production, normalize all assets to a canonical art board (suggested: 256×256 square, transparent, with the piece centered at a known anchor — e.g., piece base center at (128, 200), head crown at (128, 60), eye line at (128, 95)). See § 9 for the proposed metadata schema.

### 6.2 Stack-OK pairs (likely to render cleanly)

| Layer A | Layer B | Notes |
|---|---|---|
| Layer 0 piece base (any) | Layer 1 B4 chip-style border | the only border family that's a clean overlay |
| Layer 0 piece base | Layer 6 aura (`aura_ring_gold`, `aura_ring_purple`) | aura goes *behind* piece — z-order matters |
| Layer 0 piece base | Layer 5 headwear (most) | usually fits if piece + headwear share a horizontal axis |
| Layer 0 piece base | Layer 3 jewelry (`gold_chain`, `chip_stack`, `diamond_token`) | small accent; low collision risk |
| Layer 0 piece base | Layer 7 banner (`stable_banner_blue`, `shield_badge`) | banner sits beside, not on, the piece |

### 6.3 Conflict-likely pairs (visual collisions)

| Layer A | Layer B | Problem |
|---|---|---|
| Layer 1 B1 full-frame border | Layer 0 generic piece | B1 border contains its own piece silhouette — placing another piece on top double-stacks bodies |
| Layer 2 outerwear (`royal_cape`, `highroller_furcoat`) | Layer 7 large banner | both want bottom-of-avatar real estate |
| Layer 5 headwear (`crown`, `top_hat`) | Layer 6 aura halo above piece | crown extends *above* the piece silhouette; halo may clip it |
| Layer 4 `sunglasses` (244×87 wide) | Layer 0 small queen base (96×131) | sunglasses wider than queen — needs scaling per-piece |
| Layer 4 `eye_glow_purple` | Layer 4 `sunglasses` | both occupy the eye band — mutually exclusive |
| Layer 5 `tilt_brokencrown` (live trophy) + Layer 5 `crown` (regular) | layer-5 single-slot rule | enforce one-headwear-only |
| Knight-coupled scene (e.g., `knight_grindset_coffee`) | any generic accessory layer | the scene already contains its own piece + theme — adding another headwear or jewelry would compound |

### 6.4 Unreadable at small sizes (dense table rows / mobile)

At Open Tables row scale (~32–48 px avatar), the following lose meaning:

- **All event-fired emotes** (rage_flames, stormcloud, salt, meltdown, ggez) — designed for at least 100+ px display.
- **Persona-kit accents** (coffee, ramen, opening_book, protein_shaker, elo_goals_notebook) — too small to read; just become beige dots.
- **Trust details on badges** (`fairplay_shield` vs `fairplay_reviewshield`) — indistinguishable at 32 px.
- **Stable banner text / icon** (banner_blue, crest_gold) — readable only at 80+ px.
- **B1 full-frame borders** — only the silhouette reads; the rank treatment is lost.
- **`eye_glow_purple`** — fades to a smudge at small scale.

At small scale, the only signals that survive are:
- Layer 0 piece shape (knight vs queen vs pawn) — clearly distinguishable as silhouette.
- Layer 1 B4 chip-style border (provisional/verified/gold/diamond) — designed for chip-scale display, reads cleanly.
- Layer 5 headwear silhouette only (crown ≠ no-crown, flame_crown ≠ regular crown) — readable as silhouette.
- Tier-pip chip already shipped (a separate UI element, not an asset).

**Implication for the density-mode system in COSMETICS_NEXT_PASS § 2.1:** "minimal" should render layer 0 + layer 1 (B4 style) only; "compact" adds layer 5 headwear silhouette; "full" allows everything but only on broadcast surfaces (≥120 px).

### 6.5 Profile-card-scale-only assets

These work at 200+ px and degrade fast below:
- `slot_machine`, `casino_chips` (scene props)
- All persona-kit accents
- `fairplay_verifiedbadge`, `fairplay_shield`, `fairplay_reviewshield`, `veteran_badge`
- `trust_handshake`, `honorable_emote`
- B1 full-frame borders (only useful in dossier card)
- All `_equipped` previews (would need re-authoring anyway)

### 6.6 Spectator / broadcast survival

Spectator HUDs and Featured Tables are large-format. Almost everything is readable here. Live-state cosmetics (`flame_crown`, `chip_explosion`, `rage_flames`) are *designed* for this surface — they're the broadcast register.

---

## 7. Launch-safe subset

A subset of the catalog that can ship under the existing constraints (limited animation, no art-board normalization yet, dense-row readability) and still feel like a coherent system. Everything else stays in the wardrobe but defers until later.

### 7.1 Layer-0 / piece base

- `knight_tactical` — default for all new accounts
- `queen_elite` — unlockable via persona-kit completion later

`pawn_rookie`, `bishop_strategist`, `rook_guardian` — keep them in the catalog as flavor pieces but don't surface yet. They have no kits and no narrative role.

### 7.2 Layer-1 / borders — **B4 chip-style only**

- `border_provisional` (B4)
- `border_verified` (B4)
- `border_gold` (B4) — for `trusted` tier
- `border_diamond` (B4) — for `established` tier (or reserved for PB pot)

B1 full-frame borders **do not ship at launch** — they're a different design language. Either deprecate them (preferred) or restrict to dossier-only treatment until art unification.

`border_claimed` is **missing entirely** and must be authored before claim-tier users have an honest visual.

### 7.3 Layer-5 / headwear — restraint set

- `crown` (common flex, available via shop later)
- `laurel` (trust-tier earned)
- `flame_crown` / `queen_flame_crown` (live-state, streak ≥3)
- `top_hat` (cosmetic shop, Phase G)

Hold from launch: `tilt_brokencrown`, `highroller_chip_crown`, `captain_hat`, `highroller_vrvisor`. These can ship in waves once the rendering pipeline is proven.

### 7.4 Layer-6 / aura

- `verified_halo` (knight + queen variants) — auto-equipped on verified tier
- `aura_ring_gold` — reserved for the highest tier (established / champion)

Hold: `aura_ring_purple` (no clear earn path), `tilt_rageflame` (event-fired only), `tilt_stormcloud` (event-fired only), `fairplay_halo` (waits on Phase 6 trust pipeline).

### 7.5 Layer-7 / banner / badge

- `veteran_badge` (auto on `established` tier)
- `stable_banner_blue` — only stable banner that exists standalone; constrains launch stables to one (or hold stables for Phase E)

Hold: shields, fairplay badges (Phase 6 gated).

### 7.6 Manual emotes

- `emote_wave`
- `emote_gg`

Hold: `*_ggez_emote` (toxic-adjacent — see § 11), `emote_tilt`, `emote_sweat` (event-fired only).

### 7.7 Event-fired emotes (system-only triggers)

- `chip_explosion` (PB pot) — queen variant exists; generic + knight pending
- `tilt_salt` (mate-while-down 5+)
- `tilt_meltdown` (resign from winning position)
- `tilt_stormcloud` (during a clearly losing position)
- `tilt_tableflip` (last-resort, rare conditions only)

The remaining tilt variants (`rage_chat`, `rage_flames`, `cracked_glasses`) stay in the catalog but don't fire at launch.

### 7.8 Total launch-safe usable atoms: ~22

Far smaller than the 119-file finalized catalog. The rest are valuable as **future** content, not launch surface.

---

## 8. High-risk / problematic assets

Assets that are individually finished but pose a systemic risk to the product.

| Asset | Risk | Recommendation |
|---|---|---|
| `slot_machine` (B2 #016) | Anti-reference per `ARENA_NEXT_PASS.md` — literal slot-machine iconography is the candy-crush casino we reject | do not ship as wearable; possibly use as a heavily-skinned backdrop in a "casino-themed stable" identity only, with explicit design review |
| `casino_chips` (B2 #017) | Scene prop, not avatar — drifts toward decorative casino noise | reserved for layer 7 banner usage only, never standalone |
| `tilt_ggez` / `*_ggez_emote` (multiple) | "GGEZ" is the canonical chess.com / esports toxic phrase — even "playful," it punches down | retire from manual emote palette; never allow targeted firing against opponent |
| `tilt_ragechat` (B2 #036) | Implies a chat surface we don't have, and ragechat is target-directed by definition | event-fired only, never manual |
| `tilt_tableflip` (B2 #037, knight #033, queen #037) | Most directly aggressive emote in the set | event-fired only at *low* frequency; per-opponent mute default-on for first 5 games |
| `eye_glow_purple` (B1 #010) | Ambiguous semantics (rage? mystic? skill?) — no clear earn path; risk of feeling "premium aesthetics" | hold from launch; assign a meaning before shipping or retire |
| `aura_ring_purple` (B1 #015) | No clear earn path; visually identical pattern to gold but in another color → reads as "rarity tier" without backing | assign a meaning (mythic? legacy?) before shipping |
| `tilt_brokencrown` (B2 #032) | High emotional weight; if any tilt cosmetic is over-used it dilutes restraint | strictly event-fired upset-loss only; permanent trophy, not live-state |
| B1 full-frame borders (5 items) | Mismatch with B4 design language; same names; different semantics | deprecate or move to a "legacy" namespace; do not import to launch catalog |
| Five batch-2 reference sheets in /finalized | Pollute any automated catalog import | filter at importer; relocate physically |
| `queen_verified_halo` (suspicious metadata match with `queen_elite`) | May be a broken export | designer verification needed; possibly re-render |
| Knight + queen persona-coupled "scenes" (the entire batches 3 + 4) | These are not layer-composable; they're scene art. The proposed layered system can't use them. | repurpose as **wardrobe preview thumbnails** + as **kit-complete trophy art** rather than the equip-target system |

---

## 9. Naming convention + metadata schema

The current `horsey_NNN_<name>.png` convention has problems: numeric prefix unstable across batches, no machine-readable persona / slot / piece coupling, inconsistent word boundaries (`highroller_*` vs `high_roller_*`).

### 9.1 Proposed canonical id convention

```
<persona>__<slot>__<variant>[__<piece>]
```

`__` (double underscore) as separator so it survives shell glob + URL safely. All lowercase. Pieces only suffixed when coupled.

Examples:
- `grindset__headwear__headphones` (generic — composable with any piece)
- `grindset__headwear__headphones__knight` (knight-coupled scene)
- `tilt__emote__tableflip` (event-fired generic emote)
- `trust__border__verified` (tier-locked overlay)
- `highroller__jewelry__goldchain`
- `stable__banner__blue`
- `base__piece__queen_elite`

This solves the `highroller_*` vs `high_roller_*` split (canonical: `highroller`), distinguishes generic vs piece-coupled deterministically, and matches the proposed slot model.

### 9.2 Metadata schema

A single `cosmetics.json` manifest under `scripts/finalized/` is the authoritative catalog. Database `cosmetics` table mirrors a subset.

```jsonc
{
  "version": 1,
  "canvas": { "width": 256, "height": 256 },
  "anchors": {
    // canonical anchor points within the canvas
    "head_top":    { "x": 128, "y": 40 },
    "eye_line":    { "x": 128, "y": 95 },
    "chest":       { "x": 128, "y": 145 },
    "piece_base":  { "x": 128, "y": 205 },
    "border_outer":{ "x": 128, "y": 128 }
  },
  "items": [
    {
      "id": "trust__border__verified",
      "slot": "border",                              // matches Layer 1
      "layer": 1,
      "coupling": "generic",                          // generic | piece-coupled | scene
      "piece": null,                                   // when coupling="piece-coupled"
      "persona": "trust",                              // grindset | highroller | trust | tilt | stable | none
      "earn_class": "tier_bound",                      // tier_bound | milestone | persona_kit | stable | honor | legacy | shop
      "earn_condition": { "kind": "trust_tier", "tier": "verified" },
      "rarity": "tier_locked",
      "function": "trust_signal",                      // trust_signal | status_flex | identity_persona | live_state | trophy | emote
      "live_state": null,                              // e.g., { "kind": "win_streak", "min": 3 } for flame_crown
      "asset": {
        "src": "trust/border/verified.png",
        "normalized_size": { "width": 256, "height": 256 },
        "anchor": "border_outer",
        "offset": { "dx": 0, "dy": 0 },
        "z": 10
      },
      "compatibility": {
        "incompatible_with": [],                       // ids that conflict on the same slot
        "requires_layer": []
      },
      "surface_eligibility": [
        "dense_row", "scout_card", "wager_dossier",
        "game_strip", "settlement", "broadcast"
      ],
      "density_min": "minimal"                         // appears even at minimal density
    }
  ]
}
```

Notes:
- `slot` and `layer` are derived from the same table; both stored for cheap querying.
- `anchor` + `offset` + `normalized_size` together define how to place the layer on the 256×256 canvas — the contract that fixes § 6.1's missing anchor system.
- `surface_eligibility` lists where the cosmetic is allowed to render, so dense-row surfaces can filter to compositable items only.
- `density_min` opts the asset into the minimal/compact/full density mode automatically.
- `earn_condition` is structured (so the server can evaluate without parsing free-text).
- `live_state` is non-null only for live cosmetics (flame_crown active during streak). Renderer checks each render tick.

### 9.3 Database schema

```sql
CREATE TABLE cosmetics (
  id TEXT PRIMARY KEY,                  -- "trust__border__verified"
  slot TEXT NOT NULL,                   -- "border" | "headwear" | "facewear" | ...
  layer INTEGER NOT NULL,               -- 0..7
  coupling TEXT NOT NULL,               -- "generic" | "piece_coupled" | "scene"
  piece TEXT,                           -- "knight" | "queen" | null
  persona TEXT,                         -- "trust" | "grindset" | ...
  earn_class TEXT NOT NULL,             -- "tier_bound" | "milestone" | ...
  rarity TEXT NOT NULL,                 -- "common" | "tier_locked" | ...
  function TEXT NOT NULL,               -- "trust_signal" | ...
  metadata_json TEXT NOT NULL,          -- the full manifest row
  enabled INTEGER NOT NULL DEFAULT 1,   -- soft-retire without deleting
  created_at TEXT NOT NULL
);

CREATE TABLE user_cosmetics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cosmetic_id TEXT NOT NULL,
  source TEXT NOT NULL,                 -- "milestone:<id>" | "tier_grant" | "purchase:<order_id>" | "stable_join"
  granted_at TEXT NOT NULL,
  retired_at TEXT,                      -- non-null if revoked (rare; e.g., tier downgrade)
  UNIQUE(user_id, cosmetic_id, source)
);

CREATE TABLE user_cosmetic_equip (
  user_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  cosmetic_id TEXT,                     -- NULL = explicitly empty
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, slot)
);
```

This integrates with `user_milestones` (source = `milestone:<id>`) and `users` (tier-grants triggered when `computeTrustTier` returns a new value).

---

## 10. Physical layout in repo / CDN / DB

### 10.1 Repo layout

Today:
```
scripts/
  assets/batch_{1..4}/horsey_NNN_<name>.png    # raw, post-crop
  finalized/assets/batch_{1..4}/...            # background-removed
```

Proposed:
```
scripts/
  source/                          # raw drops by date or arc, not by "batch"
  reference/                       # the 5 non-transparent showcase sheets + the _equipped previews
  cosmetics/                       # normalized, canvas-256, named by canonical id
    base/piece/knight_tactical.png
    base/piece/queen_elite.png
    trust/border/provisional.png
    trust/border/verified.png
    trust/halo/verified.png
    highroller/headwear/flamecrown.png
    highroller/jewelry/goldchain.png
    ...
    cosmetics.json                 # the manifest
```

Migration is a one-time renormalization. The asset-finalizer GUI in `scripts/asset_finalizer_gui.py` (and `(1).py`) can be extended to also emit the canonical id + write the manifest row.

### 10.2 CDN serving

Once the catalog stabilizes, cosmetics ship as:
- **Per-asset PNGs at `/assets/cosmetics/<id>.png`** — served by `apps/api/server.mjs` static handler today; behind a CDN later.
- **Sprite sheets** for high-frequency combinations (e.g., `knight + provisional_border + crown`) at small sizes for dense rows. Generated build-time from the manifest. Speeds up Open Tables / live games feed where 8–20 small avatars render simultaneously.
- **A single manifest.json** at `/assets/cosmetics/manifest.json` — small, cacheable, client downloads once on app boot.

### 10.3 Database

The three tables in § 9.3. The `cosmetics` table is seeded from the manifest at server boot (the existing `apps/api/seed.mjs` pattern). The manifest is the source of truth; the DB is a queryable mirror.

User cosmetics live in `user_cosmetics`, granted by:
- `computeTrustTier` transition → tier_bound items auto-granted
- `detectMilestonesForGame` in `apps/api/milestones.mjs` → milestone items auto-granted (the milestone id becomes `source`)
- Persona-kit detection (new module) → persona_kit items
- Stable join → stable items
- Phase G shop → purchase items

Equip state lives in `user_cosmetic_equip`. Default equip is computed server-side at the avatar projection step, so first-render is correct without a separate request.

---

## 11. Rendering / performance implications

### 11.1 Composition strategies, ranked

1. **Per-row composed `<img>` stack** (8 elements). Each layer is one `<img>` with absolute positioning derived from the manifest. Easiest. Costs ~5–10 DOM nodes per avatar. **At Open Tables row scale (~12 rows visible) that's ~120 nodes — fine.** At live games feed scale (~8 rows × 2 players = 16 avatars × 5–8 layers = ~128 nodes) — fine. At lobby + Live floor combined (~50 avatars) — borderline but still cheap on modern browsers. Recommended for launch.

2. **CSS sprite sheets** per density mode. Pre-composed PNGs for common equip combos at small / medium sizes. Best perf for dense surfaces but adds build complexity. Defer until launch composition shows real performance pressure.

3. **Server-rendered composite** (one PNG per user-avatar at a specific size). Cleanest perf but adds a CDN/cache invalidation problem. Defer.

4. **SVG with `<use>` references**. Cleanest math + animation but requires SVG re-draws of every raster — large content cost. Defer.

### 11.2 Bundle size

All 119 finalized PNGs total **~3.9 MB** (rough sum of stat-c bytes). After moving showcase sheets out: **~3.8 MB**. Launch-safe subset (~22 assets): roughly **~600 KB** uncompressed. Through HTTP/2 + gzip, cacheable, this is fine.

But: rasters of small layer-7 banners (~30 KB each) at ~100 KB per dense-row render add up. Sprite sheets dominate here once the catalog grows past ~50 launched items.

### 11.3 Animation cost

CSS-only animation on auras / borders / flames is essentially free. Multi-element keyframe motion across all visible avatars in the lobby is not — limit live-state animations (`flame_crown` flicker) to **broadcast surfaces and player strips**, never on dense-row Open Tables / live games feed where ~16 simultaneous flickers would tax low-end devices. The density-mode setting can carry this constraint.

### 11.4 Memory / cache

Each PNG is independently cached by the browser. Service worker caching the manifest + the launch-safe subset on first load is the cheap win. Don't pre-cache the full ~3.8 MB catalog; lazy-load on wardrobe entry.

### 11.5 Mobile

WSL/dev tests aren't representative. Real mobile concerns:
- Avatar sizes need to scale (currently no responsive size map).
- Heavy effects (auras, flame flicker) should respect `prefers-reduced-motion` AND `prefers-reduced-data` once we can detect it.
- Tap targets on emote pickers need at least 44×44 px per touch standard — most emote assets are larger than that natively, so OK.

---

## 12. Recommendations for future asset creation

Locking these now prevents the next 100 assets from inheriting today's inconsistencies.

### 12.1 Canonical art board

- All cosmetic atoms authored on **256×256 transparent canvas** with anchor points defined in the manifest.
- Pieces center at `(128, 200)`; headwear at `(128, 60)`; eye line at `(128, 95)`; chest at `(128, 145)`.
- Borders + auras at `(128, 128)` outer, sized to the canvas.
- Re-export existing assets through a re-canvas script that pads-to-256 + records the existing center offset. The current `asset_finalizer_gui.py` can be extended to do this.

### 12.2 Naming

Use `<persona>__<slot>__<variant>[__<piece>]` per § 9.1. Retire `horsey_NNN_*` numeric ids for catalog purposes; keep them as artifact IDs in the source/audit log.

### 12.3 Coupling decisions

When commissioning a new asset, choose explicitly:
- **Generic** — composes on any base piece. Highest reuse.
- **Piece-coupled scene** — entire asset is the avatar (e.g., `knight_grindset_coffee`). Cannot stack with other accessories. Best for wardrobe preview thumbnails and kit-complete trophy art.
- **Scene prop** — never an avatar layer (e.g., `slot_machine`). Used only in banners/scenery.

Default to generic. Only commission piece-coupled scenes when the storytelling requires it (kit completion, trophy display).

### 12.4 Slot exclusivity

One asset per slot per user. The manifest declares the slot; the equip system enforces single-occupancy.

### 12.5 Animation-friendly authoring

When an asset is going to animate, author it with the *animated part separated*:
- Headphones with a pulsing equalizer → separate the equalizer pulse as a 2nd file.
- Flame crown → separate the flame as a frame-by-frame strip.
- Stormcloud → separate the lightning crack.

Without this, all animation has to be on the whole-image opacity / scale axis.

### 12.6 SVG / vector re-draws (later phase)

Identify the 12–15 assets that will animate or scale across many sizes (borders, halos, flame, common headwear, base pieces) and commission SVG redraws. Raster works for kit accents that ship at a single size; vector pays off for anything that scales.

### 12.7 Restraint: where silence matters

Lock these as design rules going forward — explicit "do not author" lists matter as much as the "to author" list:

- **No more tilt assets** until launch product feedback. The tilt cluster is the largest emotional category and already over-supplied. Adding more deepens the toxicity-tooling problem.
- **No more reference / showcase sheets in /finalized.** Reference art belongs in `scripts/reference/`.
- **No `_equipped` previews in pipeline folders.** They are design docs, not assets.
- **No premium-currency / slot-machine / chest / box / sparkle assets.** Per `ARENA_NEXT_PASS.md`.
- **No targeted-toxicity emotes.** GGEZ retires from the manual palette.
- **No "almost-earned" UI assets.** Don't commission progress-bar art for cosmetics.

### 12.8 Where spectacle should live

Conversely, **commission more** for the moments that *deserve* spectacle, where the catalog is thin:

- **Featured Table treatment** — currently nothing.
- **Match intro card / chip-rack open** — currently nothing.
- **Hand summary recap** — currently nothing.
- **Crowd cheer / railbird reaction** — only one slot, missing.
- **Comeback emblem / stormcloud_cleared** — the recovery state has no representation.
- **Calm / focused archetype** — chess specifically rewards this and we have zero.
- **Settlement-card victor ribbon** — bind to milestone tier.

These are the moments `ARENA_NEXT_PASS.md` and `MILESTONES_NEXT_PASS.md` already license for spectacle. The art catalog should support that ladder before it adds more identity flex.

---

## 13. Bridge back to COSMETICS_NEXT_PASS.md

What this audit changes about the proposal:

### 13.1 Hard revisions needed

1. **Layer 1 border** — proposal assumes one design language. Reality has two (full-frame B1, chip-style B4). **Pick B4 chip-style as canonical**; deprecate B1 or move to a "legacy / dossier-only" namespace. Update § 2.1 + § 5.1.
2. **§ 5.1 trust ladder cosmetics** — `border_claimed`, `border_trusted` (overlay), `border_silver`, `border_mythic`, `border_arcane` are all missing or non-transparent. Phase A in § 15 must include "author the missing tier overlays" as a prerequisite.
3. **§ 11 stable banners** — only `stable_banner_blue` exists generic. Either: (a) launch with one stable; (b) author 3 more standalone banners; (c) pivot stables to piece-coupled identity kits using the knight/queen variants that exist.
4. **§ 5.3 persona kit completion trophy** — currently the catalog grants kit *accents* but no "kit-complete" trophy item. Reuse the kit-complete *scene* assets (`knight_grindset_coffee`, `queen_grindset_coffee`, etc.) as preview thumbnails and kit-complete badges in the wardrobe.
5. **§ 6 manual emote palette of 4–6** — only 3 friendly options exist (wave, gg, ggez), and ggez is risky. **Either ship 2 emotes at launch** (wave, gg) or **author 2 more** (bow, salute) before Phase D.
6. **§ 7 spectator crowd reactions** — `crowd_cheer` is named but unauthored. Phase H (spectator broadcast) blocks on at least one crowd-reaction asset.

### 13.2 Soft revisions

- The proposal's "Layer 6 aura" assumed multiple auras with clear semantics. In reality, `aura_ring_purple` and `eye_glow_purple` lack earn paths — assign meaning before shipping.
- The proposal's "Phase B `chip_explosion` for PB pot" only exists in the queen variant. Generic + knight versions need to be authored or piece-coupled fallback applied.
- Persona-coupled scenes (~50 of the 119 assets) don't fit the layered model. They become **wardrobe preview art + kit-complete trophy art**, not composable equip items. Update § 5.3.

### 13.3 No-revisions-needed

- The taxonomy axes (slot / earn class / function) hold.
- The anti-patterns (no loot boxes, no daily streaks, no loss-advertising cosmetics) hold.
- The trust-system exclusivity of trust signals holds.
- The phased rollout structure holds (with the prerequisite art notes above).

---

## 14. Recommended next steps

1. **Move the 5 batch_2 reference sheets out of `scripts/finalized/assets/`** to `scripts/reference/`. Same for the `_equipped` and `usage_example` previews in raw. This is the smallest pipeline-cleanliness win.
2. **Author the missing border atoms** before Phase A: `border_claimed`, transparent-overlay versions of `border_trusted`, `border_silver`, `border_mythic`, `border_arcane`. Use the B4 chip-style as the canonical design language.
3. **Author 2 more friendly manual emotes** (`bow` + `salute`) before Phase D.
4. **Author `crowd_cheer`** before Phase H.
5. **Re-canvas the launch-safe subset to 256×256 + record anchor offsets** in the cosmetics manifest. Even just for the ~22 launch items, this unblocks the layered renderer.
6. **Confirm `queen_verified_halo` is not an accidental duplicate of `queen_elite`** (matching dimensions + bytes is suspicious).
7. **Retire `slot_machine` and `casino_chips` as wearable cosmetics.** Either delete or reclassify as scenery for a dedicated stable's backdrop.
8. **Update `COSMETICS_NEXT_PASS.md` § 5.1, § 6, § 11, § 15 per § 13.1 above** in the same change that promotes any phase to `IMPLEMENTATION_PLAN.md`.
9. **Defer batches 3 (knight scenes) and 4 (queen scenes) from launch equip catalog**; use them as wardrobe preview / kit-complete trophy art only.

The product can ship a coherent first cosmetic system with ~22 atoms + the trust-tier overlays + 4 emotes. The other ~95 finalized assets become content waves that follow.
