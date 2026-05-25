# Cosmetics, emotes, & identity progression — research and design

Companion docs: [`PROJECT_SOUL.md`](PROJECT_SOUL.md) (intentional casino energy + anti-mobile-casino line), [`ARENA_NEXT_PASS.md`](ARENA_NEXT_PASS.md) (atmosphere thesis), [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md) (celebration licensing), [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md) (audio layer), [`SCOUTING_TRUST_NEXT_PASS.md`](SCOUTING_TRUST_NEXT_PASS.md) (trust ladder + scout reads), [`USER_PROFILE_IA.md`](USER_PROFILE_IA.md) (identity surfaces), [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) § Trust Tiers (policy hooks).

Status: **research / proposal**. No code changes yet. Companion to the existing `_NEXT_PASS` docs; structured so phases can be promoted into `IMPLEMENTATION_PLAN.md` once direction is confirmed.

---

## 1. Thesis

A roughly ~250-asset set of transparent-background cosmetics + emotes exists in `scripts/finalized/assets/batch_{1..4}/`, organized by `manifest.json` files. The aesthetic clusters are already coherent: **grindset** (coffee, headphones, ramen, sweatband, opening book), **high roller** (chip stack, gold chain, fur coat, diamond, sunglasses), **trust / fair-play** (verified halo, fairplay shield, clean account, honorable, laurel, handshake), **tilt / rage** (salt, cracked glasses, stormcloud, meltdown, rage flames, broken crown, table flip), **borders** (provisional → mythic), **stable / faction banners**, and **emotes** (gg, wave, sweat, ggez, table flip, chip explosion, salt, trust handshake).

These are not a battle-pass cosmetic catalog. They are an **identity vocabulary** that can express the four things Horsey actually is — a chess platform, a wagering room, a status ecosystem, and a spectator product — without any of the moves that make us look like a candy-crush casino skin.

The thesis of this doc: **Horsey cosmetics must follow the same rule as Horsey milestones — earned from real signal, never claimed, never sold inside a chest, never tied to a daily-grind treadmill.** The cosmetics extend the existing trust tier + milestone + atmosphere systems; they do not invent a parallel economy.

The line we don't cross is the same line `ARENA_NEXT_PASS.md` and `MILESTONES_NEXT_PASS.md` already drew: no loot boxes, no premium-currency gems, no daily-login shields, no loot-language ("claim/redeem"), no FOMO upsell, no streak-shield mechanics, no manufactured scarcity, no pay-to-skip trust-tier. Anything that "borrows the aesthetic of low-trust mobile gambling and bolts it onto our high-trust real-money platform" is the failure mode.

What we *do* lean into: poker-room heraldry, sportsbook tier badges, esports-broadcast nameplates, "elite enters the room" presence, *visible-history* artifacts that say "this player has been here." The cosmetic system is how Horsey learns to remember its players in public.

---

## 2. Taxonomy: slot model + earn class + function

Three orthogonal axes. Every cosmetic has exactly one value on each axis.

### 2.1 Slot (where it attaches)

The avatar primitive is layered. Current implementation uses a flat colored circle with the first letter of the handle (`renderProfile` etc. all reference `<div class="avatar">${initial}</div>`). The new avatar composes 0..N PNG layers in z-order:

```
Layer 0  base          chess-piece body (knight default; queen, etc. once unlocked)
Layer 1  border        rectangular/circular ring around the avatar (trust tier)
Layer 2  outerwear     hoodie up, royal cape, fur coat, scarf
Layer 3  jewelry       gold chain, diamond pendant, chip stack
Layer 4  facewear      sunglasses, cracked glasses, tired eyes, sweatband (low)
Layer 5  headwear      crown, top hat, flame crown, broken crown, laurel, headphones, VR visor
Layer 6  halo / aura   verified halo, eye glow, aura ring (gold/purple) — drawn over headwear
Layer 7  banner       stable banner / heraldry (placed in dossier card, not on avatar itself)
```

Headwear and outerwear are **mutually exclusive within their slot** — you wear one crown, not two. Layers 1, 6, and 7 are global; the rest are personal.

Slots also drive a `densityMode` setting: at "minimal" only Layer 1 (border) renders, at "compact" 1 + 5 (border + headwear), at "full" all equipped slots render. Spectator HUDs and Featured Tables override to "full" regardless.

### 2.2 Earn class (how it's acquired)

| Class | Source | Examples | Treatment |
|---|---|---|---|
| **Tier-bound** | Auto-granted by `computeTrustTier` ladder | `border_provisional`, `border_claimed`, `border_verified`, `border_trusted`, `verified_halo`, `veteran_badge` | Always equipped on the matching tier. Cannot be unequipped. Tier loss → cosmetic loss. |
| **Milestone** | Auto-granted by `detectMilestonesForGame` and adjacent detectors | First-win laurel notch, `flame_crown` (active during streak ≥3), `chip_explosion` (biggest pot ever), `comeback` emblem | Granted at unlock; persists unless its meaning is "currently doing X" (flame crown is *live state*, not historical). |
| **Persona-kit** | Earned by playing in a pattern that fits the kit | `grindset_coffee` (50 games in 0100–0500 local), `high_roller_*` (sustained $100+ tables once verified), `tilt_*` (some lighter tilt cosmetics earned by survived comebacks), `trust_*` (low timeout + low report + draw-from-losing-position) | Earned silently in the background; surfaced when the kit completes. **No reminder pings during partial progress.** |
| **Stable-bound** | Granted by current stable affiliation | `stable_banner_blue`, `crest_gold`, `team_three`, etc. | Active while in that stable. Switching stables swaps the banner; previous banner becomes "tenure of {old stable}" title only. |
| **Honor / bestowed** | Server detects fair-play signal, OR system grants for sportsmanship | `honorable`, `fairplay_shield`, `clean_account`, `trust_handshake` emote | Gated on trust signals from Phase 6. Until those pipelines exist, do not render these — a missing trust block is better than a fake one (`SCOUTING_TRUST_NEXT_PASS.md`). |
| **Legacy / retired** | Granted during a finite window, then locked forever | "March 2027 Bracket Champion" crest, Founder cosmetic | Scarcity by time, not by RNG. Once retired, the wardrobe shows a greyed silhouette with the retirement date. |
| **Shop (deferred to Phase 7+)** | Cosmetic-only purchase, fair-priced, no boxes | High Roller cosmetic pack (palette only — the trust-tier gating still applies for *being* a high roller), avatar-upload slots | See § 13 monetization. Hard separated from gameplay. |

The five classes are mutually exclusive. A cosmetic is *either* earned, persona-completed, stable-given, honor-bestowed, retired, or shop-purchased — never two at once. This rule keeps provenance auditable.

### 2.3 Function (what message it carries)

| Function | What it signals | Read at |
|---|---|---|
| **Trust signal** | Tier on the trust ladder | every opponent surface; spectator HUD; settlement |
| **Status flex** | High-stakes pedigree | wager dossier; live games feed; spectator HUD |
| **Identity persona** | What kind of player they are (grindset / high roller / tilt / honor / stable) | scout card narrative line; full profile |
| **Live state** | Right-now condition (on streak; in a hot match) | game page player strips; live games feed; spectator |
| **Memorial / trophy** | A specific past achievement | profile trophy rack only — not pinned to live identity |
| **Emote / reaction** | In-game emotional release | game page only, with mute toggle |

A given asset can only carry **one** function. Function determines where it renders and whether it's mutable.

---

## 3. Where they appear — surface map onto current code

This is the integration matrix. All surfaces below already exist; this maps which cosmetic layers each should render.

| Surface | File / function | Current state | Cosmetic role |
|---|---|---|---|
| Top-nav identity badge | `apps/web/src/app.js` `renderHeroIdle` "You're playing as Sam · 1932" | initials avatar | Layer 0–1 (base + border). Tier-bound only. |
| Live-Table Module | `renderLiveTableModule` | initials avatar | Layer 0–1 + Layer 5 if equipped (the "I'm seated at a live game" surface should show enough flex to anchor identity). |
| Open Tables row | `renderOpenTableRow` | initials avatar; tier-pip already shipped | Layer 0–1 only at row scale (typography is already tight per Wave O1). Headwear shows in Scout Card. |
| Live games feed | `renderLiveGameRow` | initials avatars for both players | Layer 0–1 + Layer 5 (border + headwear) — this surface IS the broadcast read. |
| Wager screen dossier | `renderWagerDossier` | initials avatar + handle + rating | Full equip (Layers 0–6) + Layer 7 banner alongside. **Highest leverage surface — the decision-time identity moment.** |
| Game page player strips | `renderGame` player rails | initials avatar | Full equip + currently-live cosmetics (flame crown only renders during streak). |
| Scout Card popover | `renderScoutPopover` | initials avatar + scout narrative | Layer 0–1 + Layer 5 + narrative label derived in part from persona kits. |
| Full player profile | `renderUserProfile` | initials avatar + 3-column dossier | Full equip on rail; wardrobe section in main column; trophy rack section (read-only at first). |
| Settlement | `renderSettlement` | result + credited + rating delta | **Climax surface.** Winner's full equip is the visual subject; loser's avatar dimmed but intact (no humiliation). Milestone-tier compositions layer on top per `MILESTONES_NEXT_PASS.md`. |
| History list / detail | `renderHistoryList` + settlement reuse | initials avatars | Layer 0–1 only — keep History dense; the detail page reuses settlement so cosmetics show there. |
| Profile (own) | `renderProfile` | handle + rating + tier chip + wallet + ledger | Add a wardrobe block: equipped slots, owned-but-unequipped, locked silhouettes with earn condition, trophy rack. **No loss aggregates** per `project_no_loss_advertising`. |
| Spectator HUD | game page when not a player | currently same as player view minus controls | Nameplates carry full equip + stable banners. This is the broadcast surface. Watcher count already lives here. |

One integration point makes most of this cheap: introduce a `renderAvatar(user, { size, density })` primitive that all the surfaces above call. The current 11+ inline `<div class="avatar">${initial}</div>` sites all collapse into it.

---

## 4. Onboarding — how cosmetics enter the user's vocabulary

The current onboarding (post-signup) is the optional external-account modal that shipped under `SCOUTING_TRUST_NEXT_PASS.md` § 6. Cosmetics get inserted into the same flow without lengthening it.

### What a new account starts with

- **Base knight** as the Layer 0 avatar. Clean, dignified — not childish.
- **`border_provisional`** automatically applied. Identity is visually honest from minute one — a fresh account *looks* provisional, no chrome lying about who you are.
- **GG emote + one neutral wave emote** equipped by default. So emotes exist in the player's vocabulary before they're asked to think about them.

### Optional, skippable: a stable pick

After the external-account modal (or after Skip), one more step:

```
"Pick a starting house. You can change later, but switching has a 7-day cooldown."

[ Grindset Hall ]   [ Veterans ]   [ Tilt Tavern ]   [ Honor Guard ]
                          [ Skip — no house ]
```

Stables are personal affiliation, not membership-managed. See § 11.

### What the new user does NOT see at onboarding

- **No claim-your-reward modal.** No "your first chip pack is ready!" No "level up to unlock!" That's the mobile-casino move we're rejecting.
- **No locked-cosmetic preview carousel.** The wardrobe page exists; it's reachable from Profile. Discovery is on the user's terms.
- **No "complete this checklist to unlock"**. Tutorial quests are the manufactured-grind pattern. Horsey already has natural first-time events that earn cosmetic recognition (first finalized game, first wager, first verified game, etc.). Those are *recognized when they happen*, never quested.

### First-game silent unlock

When a player finalizes their first game (win OR loss), they get the **"First Game" laurel-notch** cosmetic — tier-1 toast (per `MILESTONES_NEXT_PASS.md` ladder), no badge claim flow, no separate UI. It just shows up in their wardrobe with a soft chime. The win-specific "First Win" remains a separate tier-3 burst.

This teaches the user, with one event, that "the system gives me things when I do things." From then on, the wardrobe accumulates passively.

---

## 5. Unlock paths & progression design

The catalog needs an explicit ordering of *how each cosmetic gets to a user*. This is the policy layer.

### 5.1 Trust-tier cosmetics — auto-granted

| Tier | Granted on `computeTrustTier` transition | Asset |
|---|---|---|
| provisional | account creation | `border_provisional` |
| claimed | external account linked + stats imported | `border_claimed` (re-uses provisional treatment + muted "?" mark; the existing `?` chip already does this in the trust UI) |
| verified | claim-challenge succeeds | `border_verified` + `verified_halo` |
| trusted (proposed, low timeout + low report + ≥30 games) | metric pipeline (Phase 6) | `border_trusted` |
| established (≥50 games + verified) | game count threshold | `border_elite` / `border_gold` (single asset; gradient choice based on tier rank) + `veteran_badge` |

No cosmetic that signals trust may be acquired via any other path. Honor signals are the trust system's exclusive vocabulary. This is what protects the trust system from devaluation.

### 5.2 Milestone cosmetics — auto-granted on detection

Extend `apps/api/milestones.mjs` from "detect milestone → publish unlock event" to also "detect milestone → grant cosmetic". The `user_milestones` table already records what fired; the cosmetic grant is one INSERT into a new `user_cosmetics` table referencing the milestone id.

| Milestone | Cosmetic |
|---|---|
| First win | small `laurel` notch (permanent wardrobe) |
| 3-win streak | `flame_crown` — **live state**, only renders while streak ≥3 |
| 5/7/10/15-win streak | flame intensifies (asset variants exist) |
| Biggest pot ever (PB) | `diamond` accent — permanent |
| Upset victory | `broken_crown` of the defeated rating-tier — one-off trophy |
| Comeback win | `stormcloud_cleared` emblem (proposed companion to `stormcloud` tilt asset) |
| Hot table participant | live `chip_explosion` accent during that game only |
| Watcher milestones (5/10/25/50) | tally-based cosmetic at the top thresholds; **none below 5** |

The detection schema and tier ladder already in `MILESTONES_NEXT_PASS.md` covers timing and intensity. Cosmetics are an additional persistence layer on the same detection — no new pipeline needed.

### 5.3 Persona-kit cosmetics — earned silently, surfaced on completion

The grindset / high-roller / tilt / trust assets are clustered into **kits**. Kit completion is when a user has earned enough of the underlying pattern that the kit fits.

| Kit | Member assets | Completion trigger | Title earned |
|---|---|---|---|
| **Grindset** | `coffee`, `headphones`, `ramen`, `sweatband`, `tired_eyes`, `opening_book`, `elo_goals`, `protein_shaker` | ≥50 finalized games where ≥30 fell in 0100–0500 local; or 100+ games at any time + sustained 5+ games/day for 30 days | "Grinder" |
| **High Roller** | `gold_chain`, `fur_coat`, `chip_stack`, `diamond`, `sunglasses`, `flame_crown` | verified-tier + average stake over last 50 games ≥ $100 + finalized at least 10 games at ≥$250 | "High Roller" |
| **Tilt** | `salt`, `cracked_glasses`, `stormcloud`, `meltdown`, `rage_chat`, `rage_flames`, `broken_crown`, `table_flip` | individual pieces earned by specific losing-but-honest patterns (resigned-down-material, lost-from-winning-position with no timeout, etc.). **Never gamified — these are emotional vocabulary, not achievement bait.** | no title — wearing tilt cosmetics IS the title |
| **Trust / Honor** | `honorable`, `fairplay_shield`, `clean_account`, `laurel`, `crest_gold`, `trust_handshake` | gated on Phase 6 trust pipeline (low timeout, low report, drew from losing position multiple times, etc.) | "Honorable" |

Earned silently means: no progress bar, no "you're 3 games from completing Grindset!", no notification spam. The kit just appears in the wardrobe when it fits — and only the user sees the wardrobe entry. On completion, a tier-2 callout (`MILESTONES_NEXT_PASS.md` ladder) fires *once*, and the title becomes available for equip.

This is the line between "real-signal cosmetic" and "manufactured-grind cosmetic." Duolingo and Clash Royale tell you you're 17 XP from a reward; we don't.

### 5.4 Stable cosmetics — granted by affiliation

While you're in a stable, your stable's banner is your Layer 7. Switching stables (7-day cooldown) swaps it. Stables only grant cosmetics; they never grant matchmaking/rake/stake-cap advantages.

### 5.5 Honor / bestowed — Phase 6 dependent

The `trust_handshake`, `fairplay_shield`, `clean_account`, `honorable` assets are reserved. Until the trust pipeline (timeout rate + disconnect adjudication + report queue) is wired, they don't render. This is the same rule that already governs the Trust & Safety panel.

### 5.6 Legacy / retired — finite-window grants

For a future season / arena, a limited cosmetic can be created with a hard end date. After end date, no further grants. Existing holders keep theirs forever (wearing one becomes scarcity-by-tenure, the poker-room equivalent of an old World Series of Poker bracelet). The wardrobe displays the retirement date on greyed silhouettes.

---

## 6. Emote strategy during games

Emotes are the most emotionally potent and the most toxicity-prone surface. Posture: **be honest about emotional state, never weaponizable as targeted harassment**.

### 6.1 Two emote populations: manual and event-fired

**Manual emotes** are selected by the player from a small palette (4–6 slots, equip-from-wardrobe). Allowed: greeting (`wave`, `gg`, `ggez`), reactions (`sweat`, `chip_explosion`). Banned from manual fire: anything explicitly targeted-toxic (`table_flip` aimed at opponent, `rage_chat` aimed at opponent). Manual emotes always render in opponent's view.

**Event-fired emotes** are auto-triggered by the server when a real game-state condition matches. These bypass the manual palette and have no aim — they're an emotional fact about the game, not a directed action.

| Trigger | Fired emote | Who sees it |
|---|---|---|
| Player loses by checkmate while down 5+ points | `salt` toast on the loser's own avatar | spectators + winner |
| Player resigns from a winning position (blunder + resign) | `meltdown` cosmetic during settlement | spectators + winner |
| Player wins after being down 7+ points | `stormcloud_cleared` / comeback emblem | spectators + loser |
| Player wins a >$1000-pot game | `chip_explosion` flash on winner's nameplate | spectators + loser |
| Player wins three in a row | `flame_crown` activates (live) | everyone, until streak breaks |
| Spectators ≥10 watching | crowd reaction `cheer` (asset TBD) | everyone in the room |
| Player offers a draw from a winning position | `trust_handshake` near their avatar after game | spectators + opponent |

Event-fired emotes are the *honest casino floor*. They communicate emotional state without giving the user a weapon. If you tilt, the room sees you tilt — that's poker. If you're hot, the room sees you hot. The player doesn't pick "I'm raging"; the game state earns it.

### 6.2 Toxicity controls

- **Mute opponent emotes**: a per-user setting, defaulting on **for new accounts** (until they've played 5+ games and know the culture). Mutes both manual and event-fired emotes from the opponent. Does not mute spectator emotes.
- **No targeted emote spam**: manual emotes have a per-game cap (3 fires/game, reset per side). Even if not toxic, spam dilutes meaning.
- **Audit log**: each emote fire writes a `game_event` (the schema already exists — see `db.mjs` `game_events` table). Admin queue can review reported emote patterns.
- **No text chat**: avoids the bulk of moderation surface. Emotes carry expression; words don't.

### 6.3 Spectator emotes (railbirds)

Spectators have their own quick-react bar — heart / fire / chip emoji equivalents, fired into a transient bubble layer at the bottom of the game viewport. Rate-limited per spectator. This is the *crowd noise* — and the data feeds the "hot table" detection. Spectators reacting heavily is a real signal for `MILESTONES_NEXT_PASS.md` watcher milestones.

---

## 7. Spectator-facing presentation

Watcher count already ships (`enrichGame.watcherCount`, lobby `Live now` projection, game page Table status). The cosmetic layer turns the spectator stream from "two name-letters playing chess" into a broadcast surface.

### Player nameplate (spectator-only treatment)

```
┌────────────────────────────────────────────────────────────┐
│ [piece + halo + crown] Vish · 2148   E    🏛 Veterans       │
│ ────── ── time ── 4:32  ── flame_crown live (W3) ──         │
└────────────────────────────────────────────────────────────┘
```

Full equip renders larger on spectator HUDs — the broadcast is the surface where status is supposed to be loud. Tier-pip becomes a tier-band. Stable banner is visible. Live-state cosmetics (flame_crown during streak) are explicitly called out in the eyebrow line. This is the "esports broadcast" reference from `ARENA_NEXT_PASS.md`, made concrete.

### Featured Table

The "Featured Table" slot named in `ARENA_NEXT_PASS.md` Phase 1 has been pending. Cosmetics give it product meaning: a Featured Table is the live game in the lobby with the highest combined `(stake_cents × cosmetic_rarity_score × watcher_count)`. The featured-table card shows both nameplates at full broadcast treatment, with a subtle ESPN-style "FEATURED" eyebrow. Contained, time-bound (recomputed every 60s).

### Settlement broadcast

When a spectator-attended game finalizes, the settlement chip-rake from `ARENA_NEXT_PASS.md` § Phase 4 composes with the winner's full equip filling the settlement card for ~1.5s, then settles. Spectators stay on the settlement view for one cycle before being released to `#play` or the next game.

### Crowd noise (audio)

`SOUNDSCAPE_NEXT_PASS.md` § 3 has slots for `watcher_join` and `railbird_activity_spike`. With cosmetics in play, a high-rarity cosmetic wearer entering a game's watcher list fires a slightly weighted version of `watcher_join` — the "high roller walking in" sound. Same primitive, parameterized by entrant's rarity score.

---

## 8. Audio / animation / event integration

Every cosmetic moment maps to an existing system. No new pipelines.

### Equip moment

User equips a cosmetic from wardrobe. Animation: tactile slide-in (Layer drops from above + 200ms cubic-bezier with subtle overshoot). Audio: `chip_click` from `sound.mjs` at `action` tier. **Never a slot-machine jingle or sparkle burst.**

### Unlock moment

Cosmetic granted by milestone or kit completion. Composes with the existing milestone tier ladder per `MILESTONES_NEXT_PASS.md` § Composition:
- Tier-1 (toast): tiny chip in top-right "Unlocked: {asset}", 2s, soft chime — audio = `milestone_unlock_t1` (already implemented in `sound.mjs`).
- Tier-2 (callout): banner across settlement card or top of profile "You earned {asset}"; the asset's preview chip slides in.
- Tier-3 (burst): the asset emerges *from* the chip-rake animation of settlement — a poker chip flips over to reveal the cosmetic design. **Contained to the settlement card, never the viewport.**

Unlock audio replaces base settlement SFX at equivalent priority, as already specified for milestone composition. No double-stacking.

### Live-state cosmetics

Flame crown active during streak: a subtle ember-flicker animation (CSS keyframes, 4s loop, low opacity delta). Audio: none — looping audio for cosmetics is the path to the uncanny.

### Reveal animation for high-rarity entries to a room

Cosmetic-tier-3+ wearer joins as a spectator: brief 200ms `watcher_join` chime, slightly weighted, no visual interruption. "Elite enters the room" — borrowed from poker.

### Reduced-motion / reduced-sensory

Per existing `prefers-reduced-motion` and the soundscape mute modes:
- Reduced-motion: cosmetic equip animations collapse to instant swap. Unlock tier-3 bursts collapse to tier-2 callouts.
- Reduced-sensory ("essentials" or "mute"): cosmetic unlock audio respects the existing essentials/mute filter.

---

## 9. Retention loops — earned, not manipulated

The cosmetic system as a retention surface, without inheriting any of the patterns we already rejected.

### The legitimate hooks

- **"I'm on a 2-win streak — if I win this one my flame crown lights up."** This is a real, honest hook. The cosmetic is visible *state*, not a quest reward. Reflexively comparable to a poker player's stack growing — not a Duolingo streak.
- **"My stable's featured-table list shows a Veterans game tonight at $250."** Stable affiliation creates a returning identity. Real social pull, not a daily quest.
- **"I'm one milestone away from earning the Comeback emblem."** *We do not surface this* — the user discovers it after they earn it. The hook is the unrevealed reward, not a progress bar.
- **"Vish has the Established laurel and just sat at my stake band."** Status visibility creates aspiration. The cosmetic *is* the aspiration mechanism.
- **"My wardrobe page shows a row of locked silhouettes labelled 'Win at $500+ stakes.'"** This is the wardrobe as a goal map. It exists, but the user navigates to it; it doesn't push notifications at them.

### What we explicitly do NOT do

- **No daily login reward.** No "come back tomorrow!" mechanic. No streak shield.
- **No quest-style "play 3 games to unlock".** Quests are manufactured grind; we have wagers, which are real.
- **No FOMO timers on cosmetic shop.** A cosmetic is a fair-priced purchase, never "1h 23m left!"
- **No push notifications for *almost-earned* milestones.** "You're 1 win away from..." is the predatory variant. We celebrate what happened, never what's almost-happening (this is already a `MILESTONES_NEXT_PASS.md` rule; cosmetics inherit it).
- **No premium-currency that maps to cosmetics.** We have real money. Cosmetic shop accepts USD or play tokens, not "Horsey Gems."
- **No loss-paired "consolation cosmetic."** Losing earns nothing. Losing honest is enough. Per `project_no_loss_advertising`, we don't dress up losses.

### Long-arc collection (passive)

Wardrobe becomes the resume the player can look at. Every cosmetic in it points to a real event. After 6 months a player can open Profile and see a visible *history of their play*. This is the retention loop — not gamified, persistent, owned.

---

## 10. Trust / reputation / status signaling

The trust system has the ladder (`provisional` / `claimed` / `verified` / `established`). Cosmetics amplify it without duplicating.

### Hard-bound to trust system (exclusive)

These cosmetic categories are owned by the trust system. No other path grants them.

- **Borders.** `border_provisional` / `border_claimed` / `border_verified` / `border_trusted` / `border_gold` (established) — automatic on tier transition. Cannot be unequipped. This is the floor of identity honesty.
- **`verified_halo`.** Granted on verified tier. Bright gold halo overlay — visible in dense rows.
- **`veteran_badge` / `laurel`.** Granted at `established` tier (≥50 finalized games + verified).
- **`fairplay_shield`, `honorable`, `clean_account`, `trust_handshake` (emote).** Reserved for Phase 6 trust signals — never rendered until those pipelines exist.

This protects the trust signal from inflation. The `verified` glyph on a scout card *means* verified, and only verified. No purchase path. No earn-by-stable. No comeback-cosmetic that looks like a halo.

### Loose-bound (free vocabulary)

Everything else — grindset kit, high-roller flex, tilt emotes, stable banners — is free identity vocabulary. Players can mix freely. A grinder can wear a flame crown if they're on streak. A high roller can wear `tired_eyes` if they want to flex grind aesthetic. This is poker culture: cross-style is expressive.

### Status legibility

Status reads should be **fast** at every surface:

- Dense surfaces (Open Tables rows, live games feed): tier-pip + Layer 5 headwear if present. Two glances of information.
- Medium surfaces (Scout Card, wager dossier): tier-pip + border + headwear + stable banner + persona title under handle.
- Broadcast surfaces (Featured Table, settlement, spectator HUD): full equip + title + live-state cosmetics + stable banner.

A spectator scrolling the lobby should be able to identify "high-stakes verified match" in under one second by silhouette alone.

---

## 11. Stable / faction / team identity

Stables are personal affiliations that carry identity flavor, not guild mechanics.

### Design constraints

- **No mechanical bonuses.** Stables don't increase stake caps, lower rake, or alter matchmaking. The trust ladder owns those. A stable is identity, not advantage.
- **No membership management.** No clan leader, no kick mechanic, no application flow, no member count pressure. Joining is one click. Switching is one click + 7-day cooldown.
- **No clan wars.** Stable-vs-stable rivalry exists implicitly when two players from different stables face off, but no "weekly war winner" mechanic. That's mobile-clan territory.
- **No exclusive cosmetics behind tier.** A stable's cosmetics are *cosmetic only*. There's no "Stable level 5 unlocks the elite border" — that path goes back through the trust system or the milestone system.

### Launch stables (proposed 4)

| Stable | Identity flavor | Default emote palette | Default cosmetic palette |
|---|---|---|---|
| **Grindset Hall** | late-night sweat, low-stakes volume, the grinder | `sweat`, `coffee`, `gg` | `coffee`, `headphones`, `ramen`, `sweatband`, `opening_book` |
| **High Rollers** | only available once verified-tier — high-stakes posture | `chip_explosion`, `ggez`, `gg` | `chip_stack`, `gold_chain`, `fur_coat`, `sunglasses`, `diamond` (palette unlocked; *being* a high roller still gates kit) |
| **Veterans** | tenure-respecting, established players | `gg`, `wave`, `trust_handshake` (Phase 6) | `laurel`, `veteran_badge`, `crest_gold` |
| **Tilt Tavern** | embraces the chaos energy, the saltiest table at the bar | `salt`, `table_flip`, `rage_chat` | `cracked_glasses`, `stormcloud`, `broken_crown`, `meltdown` |

A player skipping stable selection (per § 4 onboarding) just has no Layer 7 banner and no stable title. Fully valid.

### Stable surfaces

- **Wager dossier**: opponent's stable banner sits alongside the dossier card. "Vish · Veterans · 1842" reads instantly.
- **Settlement**: winner's stable banner momentarily lights at the climax.
- **Profile**: stable affiliation + tenure displayed in the header. Past stable tenures listed as titles only (no past banner persists — that would dilute current affiliation).
- **Lobby filtering** (later): "Open tables hosted by my stable" filter chip on the Open Tables rail. Real product meaning, not a grind hook.

---

## 12. Rarity tiers & scarcity philosophy

Rarity is **what you had to do**, not **what RNG rolled**. Borrowed from poker's tournament-shirt model.

### Rarity ladder

| Tier | Definition | Examples |
|---|---|---|
| Common | Always available, no gate | base knight, base border, `gg` emote, `wave` emote |
| Earned | Tied to specific real signal | first-win laurel notch, `flame_crown` (active), `chip_explosion` (PB pot) |
| Tier-locked | Bound to trust ladder | `border_verified`, `verified_halo`, `veteran_badge` |
| Featured | Live during a specific arena/season window | future "March 2027 Bracket Champion" crest |
| Bestowed | Granted by system for fair-play / sportsmanship | Phase 6: `fairplay_shield`, `honorable` |
| Legacy | Once-earnable then permanently retired | Founder cosmetic, retired seasonal crests |
| Mythic | Single-shot historic events | "First $10K pot in Horsey history" — assigned to exactly one user, forever |

### Anti-patterns

- **No RNG drops.** "0.5% chance" is the casino-skin path. Replace with "do this specific thing."
- **No artificial caps.** "Only 100 will exist" is FOMO. Scarcity should come from the rarity of the *event* required.
- **No cosmetic trading or marketplace.** Cosmetics are bound to the account that earned them. CS:GO-style skin economies are downstream casinos in their own right — that's the wagering-on-top-of-wagering trap.
- **No upgrade-by-shards.** Combining four common cosmetics into one rare is the F2P grind pattern. Cosmetics are atomic — you earn one, you have one.

---

## 13. Monetization — fair, cosmetic-only, hard-separated

Horsey is wagered chess. P2W is uniquely toxic here — the game already has real money on the line, so any pay-to-win path is *also* pay-to-win-money. The wall between gameplay and cosmetic shop has to be load-bearing.

### What can be sold (Phase 7+)

All listed below are **cosmetic-only**, **fair-priced**, **no boxes**, **no premium currency**, **what-you-see-is-what-you-pay**.

| Product | Notes |
|---|---|
| **Cosmetic packs** — themed sets of avatar slots | e.g., "Old World" pack: alternate piece bases for the four classes. Identity flavor only. |
| **Stable upgrade kits** | cosmetic-only — the High Rollers stable cosmetic palette can be purchased without grinding to high-roller-kit completion. But the kit *gating* (verified-tier + $100 stake band) still applies for the persona-kit title. You can wear the visual without earning the social label. |
| **Avatar upload slots** | one-time purchase for a custom avatar slot (subject to moderation). Optional. Useful once user-uploaded content is moderated. |
| **Patron / Founder cosmetic** | one-time, early-supporter cosmetic. Never available again. |
| **Anniversary skins** | annual cosmetic, available during a specific window. Subsequently retired (joins legacy tier). |

### Hard nos

- **No loot boxes** of any kind. No "mystery roll" cash purchases.
- **No premium currency.** USD or play tokens, not "Gems."
- **No pay-to-skip trust-tier.** Verified means verified.
- **No advertising "save 30%!" or "X left!"** — manufactured urgency on real-money transactions is predatory (already a project principle).
- **No cosmetic-locked emotes that change game state.** All emotes are visual; none affect timer, escrow, or rating.
- **No cosmetic-bundle subscriptions.** A monthly "Pro" pass that drops cosmetics is the battle-pass clone we explicitly avoid. One-time purchases only.
- **No advertising loss recovery.** Never "buy this cosmetic to feel better after a loss."

### What this is NOT designed to fund

The wagering rake is the revenue model. Cosmetic sales are a small secondary stream that exists *because the assets exist*, not because the platform needs them to survive. This posture protects the product from the cosmetic team having retention quotas.

---

## 14. Long-term collectible / meta progression

The persistent layer beneath any single session.

### Wardrobe

The wardrobe is a Profile section. It shows:

- **Equipped slots** (per layer). User can toggle equip/unequip for non-tier-bound items.
- **Owned-but-unequipped**: chips of every cosmetic the user has earned.
- **Locked silhouettes** with the *earn condition* visible — but *only condition*, not progress. "Win a game at $500+ stakes" — not "0/1." We name the door, not the threshold.
- **Trophy rack** (5–7 pinnable slots): the user curates which cosmetics they want pinned. The trophy rack appears on their public Profile and Scout Card narrative.
- **Title bar**: the user picks one title from the titles they've earned. Persona kits earn titles; stable tenures earn titles; rare milestones earn titles.

### Career-arc cosmetics (long-arc)

- **Trust journey medal**: held by users who climbed all four trust tiers. Permanent profile artifact.
- **Decade pin** (long-term, post-launch): held by users with 1k / 5k / 10k finalized games.
- **Stable tenure crests**: shown as titles on profile ("Veterans · 2 years tenure").

### Retired cosmetic season system

Once a year, an arena event (e.g., "Spring Bracket") creates 1–3 cosmetics earnable only during the arena. After the arena, those cosmetics retire. Holders keep them. The wardrobe greys silhouettes with the retirement date. This makes the wardrobe a calendar of Horsey's history — players who weren't around in Spring 2027 can see that something happened and that they missed it. That's scarcity-by-tenure, the poker-bracelet pattern.

---

## 15. Phased rollout — what immediate, what later

Map to the existing `IMPLEMENTATION_PLAN.md` phases when promoting items. Today these are scoped as a fresh workstream.

### Phase A — Avatar primitive + tier cosmetics  *(foundation)*

Lands before any earn paths. Pure rendering work.

- DB schema: `cosmetics` (catalog of every asset + slot + earn class), `user_cosmetics` (which user owns which), `user_cosmetic_equip` (slot → cosmetic id per user).
- `renderAvatar(user, { size, density })` primitive in the client; replaces all `<div class="avatar">${initial}</div>` callsites.
- Auto-grant trust tier cosmetics on `computeTrustTier` transitions. Wire in via the existing tier computation in `packages/shared/trust.mjs`.
- Asset pipeline: serve PNGs from `apps/api/server.mjs` static handler under `/assets/cosmetics/...`.
- Profile wardrobe stub: equipped section, owned section, locked section (read-only). No equip mechanic yet.

Exit: every avatar in the app shows piece + border. Verified users have a verified halo on every surface.

### Phase B — Milestone cosmetics  *(extends existing system)*

- Extend `apps/api/milestones.mjs` to also grant cosmetics on first-time and recurring milestones — INSERT into `user_cosmetics` referencing the milestone id.
- Wire `flame_crown` live-state cosmetic: detection at game finalize + active flag, cleared on next non-win.
- Wire `chip_explosion` to PB pot.
- Settlement renderer composes milestone-tier unlocks per `MILESTONES_NEXT_PASS.md` (already specified) — adds the new cosmetic reveal animation as the tier-3 burst variant.

Exit: milestone unlocks land cosmetics that are visible immediately at the next render.

### Phase C — Equip mechanic  *(interactive wardrobe)*

- Wardrobe becomes interactive — equip / unequip / swap on non-tier-bound slots.
- Density mode setting (minimal / compact / full) on Profile.
- Default-equip heuristic for users who never visit wardrobe (pick best display: border + rarest milestone item + most recent kit item).

Exit: a power user can fully curate their avatar.

### Phase D — Emote system  *(in-game expression)*

- Manual emote palette (4–6 slots) in game UI.
- Mute-opponent-emotes setting (default on for first 5 games per § 6.2).
- Event-fired emote detection at game finalize + spectator audit hook.
- Emote events written to existing `game_events` table.

Exit: emotes ship with toxicity controls in place.

### Phase E — Stables  *(faction identity)*

- 4 launch stables defined.
- Stable selection at end of onboarding (skippable).
- Stable cooldown (7d) on switching.
- Stable banner on wager dossier, settlement, profile.
- (Later in phase) Stable filter on Open Tables.

Exit: identity has a layer above trust tier — affiliation.

### Phase F — Persona-kit detection  *(silent-earn system)*

- Detection passes for grindset / high-roller / tilt clusters. Run at game finalize.
- Kit-complete recognition (tier-2 callout, one-shot).
- Title bar on profile.

Exit: silent-earn system surfaces real player archetypes.

### Phase G — Cosmetic shop  *(Phase 7+ gated)*

- Requires real-money infrastructure (Phase 7 of `IMPLEMENTATION_PLAN.md`).
- Cosmetic-only catalog. No boxes, no premium currency. Fair flat pricing.
- Stable cosmetic packs.
- Avatar upload slots (requires moderation pipeline).

Exit: optional monetization stream alongside the rake, no gameplay implications.

### Phase H — Spectator broadcast layer  *(amplify the room)*

- Featured Table card on lobby using the rarity-weighted scoring.
- Broadcast nameplates for spectator HUD.
- Crowd noise audio cues for high-rarity entrants (extends `SOUNDSCAPE_NEXT_PASS.md` § 3).
- Spectator emote bar.

Exit: spectator stream becomes a product surface, not just a window.

### Phase I — Honor / trust cosmetics  *(blocked on Phase 6 trust pipeline)*

- Reserved. Render only after timeout-rate + disconnect-adjudication + report-queue pipelines exist.

### Phase J — Seasonal / retired arena cosmetics

- First seasonal arena event with bound cosmetics + retirement date.
- Wardrobe shows retired-with-date silhouettes.

---

## 16. Risk analysis

| Risk | Mitigation |
|---|---|
| **Overstimulation** (every avatar wearing 5 cosmetics → noise) | Density mode setting; dense surfaces only render Layer 0–1 + headwear by default; broadcast surfaces are the only place full equip renders. |
| **Toxicity weaponization** (manual rage emote spam) | Event-fired tilt emotes only — no manual aim. Manual palette curated. Mute-opponent default on for first 5 games. Per-game cap on manual emote fires. |
| **Trust devaluation** (cosmetics impersonating verified halo) | Tier-bound cosmetics are *exclusive* to the trust system. No other earn path. Auditable in `user_cosmetics` join. |
| **Mobile-casino regression** (cosmetic system slides toward gambification) | Every cosmetic must map to one of the six explicit earn classes. Quarterly audit. The line is: real signal, real purchase, or honor pipeline — never RNG. |
| **Manipulation creep** (progress bars sneak in, "1 more to unlock" creeps in) | Anti-pattern list in § 5.3 codified. PR review checklist: any new cosmetic surface that shows progress-to-unlock to the user requires explicit reviewer sign-off. |
| **Pay-to-win drift** (a "cosmetic" turns into a stake-cap bonus) | Phase G shop is cosmetic-only by definition. Stake caps stay in `packages/shared/trust.mjs`. Cosmetic schema has no game-mechanic fields. |
| **Cosmetic shop pressure** (revenue quota erodes the brand) | Wagering rake is the revenue model. Cosmetic shop is secondary, fair-priced, no targets. |
| **Inflation** (everyone has all cosmetics, none means anything) | Scarcity from real difficulty + retirement schedule + tier-locked exclusives. Wardrobe silhouettes show "earn condition" so locked items remain visible aspiration. |
| **Loss-advertising drift** (a "loss cosmetic" emerges) | Anchored to `project_no_loss_advertising` memory — no cosmetic granted *for losing*. Tilt cosmetics are granted for *survived emotional moments*, not losses. |
| **Stable politics** (toxic in-groups, harassment between stables) | No clan management mechanics. No member counts pinned to leaderboards. No "weekly stable war." Stable-vs-stable surfaces stay implicit + non-aggressive. |
| **Performance** (layered PNG avatars in 50+ rows on dense surfaces) | Asset pipeline outputs precomposed sprite-sheets per common equip combo at small sizes; full equip only renders at medium+ sizes. CSS sprites for borders. |
| **Asset moderation** (later: user uploads) | Phase G gates avatar-upload behind moderation pipeline before it ships. Until then, only curated catalog. |

---

## 17. Open questions

These are intentionally not decided in this pass — list of things to confirm before promoting any phase to `IMPLEMENTATION_PLAN.md`.

- **Avatar primitive shape**. Square or circle frame? Hi-fi designs use both. Recommendation: square with rounded corners on dense rows; circle on hero/broadcast surfaces. Confirm before Phase A.
- **Density default.** Should the default density for new users be "minimal" (border only) or "compact" (border + headwear)? Recommendation: compact, so equipped cosmetics matter immediately to new users.
- **Persona kit detection windows.** The grindset 0100–0500 window is illustrative. Real numbers need engagement data before locking — recommend launching with the kit definitions but a private feature-flag to gate surfacing, until detection accuracy is sane.
- **Stable cooldown.** 7 days proposed; could be 30. Long cooldown protects stable identity; short cooldown forgives onboarding mistakes. Recommend starting at 7 and watching switch rate.
- **High Rollers stable verified-tier gate.** Should the cosmetic palette be purchasable by non-verified users (cosmetic-only) but the *stable* be verified-tier locked? Recommendation: yes — separating shop palette from identity gate is the design we want generally.
- **Cosmetic shop pricing model.** Flat USD pricing or play-token pricing or both? Recommendation: both, with USD as primary and play-token equivalence at the rake-implied conversion. Confirm at Phase G.
- **Mythic / once-in-history cosmetics.** Who decides what qualifies? Recommendation: trust the milestone detection — "first user to hit $10K pot, first to win 100 games in a single day, first to verify, etc." Mythic events are pre-declared, not human-curated.
- **Inactive-cosmetic display.** If a user earned `flame_crown` (live state) but is not currently on streak, does the wardrobe show it greyed-out or hide it? Recommendation: greyed-out with the "lights up while you're on a 3-win streak" hover. The user owns the *capacity*; the cosmetic is *active* during real state.

---

## 18. Summary — what fits Horsey's posture and what doesn't

**Fits Horsey:**
- Cosmetics as visible history of real play
- Trust tier exclusively owning trust signals
- Milestone unlocks compose with existing celebration tiers
- Stable as personal affiliation, never a clan-management mechanic
- Wardrobe as a Profile section, not a separate destination in nav
- Persona kits earned silently from real patterns
- Event-fired tilt emotes that reflect honest emotional state
- Spectator broadcast surfaces that read full equip + stable + live state
- Scarcity from doing the thing, not from RNG
- Cosmetic shop later as a flat-priced cosmetic-only secondary stream

**Does not fit Horsey:**
- Loot boxes, mystery rolls, premium currency
- Daily login streaks, login shields, "come back tomorrow" mechanics
- Battle pass treadmills with seasonal grind windows
- "You're 1 win away from..." manufactured-anticipation pings
- Pay-to-skip trust tier
- Cosmetic trading marketplaces (downstream casinos in their own right)
- Cosmetics granted *for losing* (loss-advertising)
- Targeted manual rage emotes weaponized against opponents
- Stable clan-war leaderboards with public "winning/losing" tallies
- Tutorial quest-chains that gate cosmetics

The whole system is one rule: **Horsey remembers what you did. The cosmetic is the remembering.**
