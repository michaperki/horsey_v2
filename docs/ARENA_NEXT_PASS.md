# Competitive wagering arena — atmosphere & feature backlog

Companion docs: `PROJECT_SOUL.md` (product voice), `MILESTONES_NEXT_PASS.md` (celebration system), `SOUNDSCAPE_NEXT_PASS.md` (audio layer), `SCOUTING_TRUST_NEXT_PASS.md` (dossier + trust UX), `LIVENESS_NEXT_PASS.md` (lobby liveness), `LOBBY_DESIGN_GAP.md` (Play/Open Tables IA), `IMPLEMENTATION_PLAN.md` § Trust Tiers / cross-cutting workstreams.

## Thesis

Horsey is a wagering product; the visual and audio language should embrace that. The reference points are **high-stakes poker room, sportsbook terminal, and esports broadcast** — never mobile-game candy-crush casino spam.

Chess.com and similar pure-skill products *simulate* stakes through casino grammar (leagues, daily missions, glowing-gem currencies, "Redeem Now" modals, loot-language for purchases). They're borrowing emotional grammar from gambling because their underlying product doesn't have it. Horsey doesn't need to simulate — but the prior "anti-casino" framing was over-corrected: real-stakes products shouldn't *artificially flatten* the celebration of real money events either. A settlement that snaps a number or slides three dots is just as wrong as a settlement that shoots fireworks.

The right intensity ceiling is **a high-stakes live poker room**: physical chip motion at settlement, asymmetric weight by outcome, audible chip clacks and rake slides, dealer-banner moments for genuine milestones — and total silence/restraint everywhere it would be noise. Ordinary play stays grounded; milestones earn celebration; losses feel honest and weighty.

The emotional high in this category often lives *before* the gameplay — entering the arena, posting the challenge, waiting for acceptance, watching stakes rise, scouting the opponent. The board is the climax; the lobby is the foreplay. Poker rooms understood this for decades. The lobby should feel alive before cards are even dealt; the table should feel material; the settlement should feel like a financial event the house resolved.

## What we borrow vs. what we reject

Two reference axes — adopt aesthetics from one, reject aesthetics from the other.

### From poker room / sportsbook / esports broadcast — **adopt**

| Aesthetic | How it lands |
|---|---|
| Chip-rack physicality on the table | Real disc-shaped stacked chips with edge shading; not flat dots |
| Dealer rake animation at settlement | Cascade timing, arced trajectory, settle-with-weight; rake chip splits to house |
| Asymmetric outcome weight | Wins brisk, losses slow & heavy, draws split the pot down the middle |
| Sportsbook ticker / bankroll counter | Balance ticks up on wins, down on losses (sound-paired) |
| Tier badges & identity heraldry | Trust pip on opponent rows; verified-gold accents |
| Subtle ambient room sound (deferred) | Background "live room" tone at low mix; off by default |
| Camera-on-board moments for high-stake matches (deferred) | Spotlight treatment when stake or rating gap is unusual |
| Achievement banners for genuine milestones | Contained, time-limited; see [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md) |
| Streak / momentum indicators (esports broadcast) | Real-signal-backed only; W3 / W5 / upset / comeback |
| Honest expiry on challenges | The 60s acceptance window is real urgency, not manufactured scarcity |

### From mobile-game casino aesthetic — **reject**

| Pattern | Why we don't |
|---|---|
| Variable-ratio loot boxes / chests | Stacking dopamine reinforcement on top of real wagering is the predatory direction we explicitly reject |
| Premium-currency gems / glowing tokens | We have real money — dressing it as fake currency dilutes the product |
| Daily reward / login-streak shields | Manufactured retention bait; Duolingo-grade emotional manipulation |
| "Claim/Redeem" loot-language on commerce | Euphemizes a financial transaction; we say "settle", "deposit", "buy in" |
| React-Confetti on every win | Childish; trivializes the wins that should matter |
| Slide-whistle / coin-shower / 8-bit audio | Cartoon sounds destroy the high-stakes register |
| Manufactured urgency on real-money flows | Predatory; the only honest urgency is the clock and the challenge timer |
| Full-screen dim-and-spotlight upsell modals | Interruptive; reserved only for genuine settlement / milestone reveal |
| Achievement spam for trivial actions | "First move" / "first opening" dilutes real milestones |

Principle: *we are a casino — we don't have to wear casino skin to advertise it.* The product should feel like a high-stakes live room where money is the table, with the visual + audio + interaction polish that real money rooms have spent decades perfecting. Reject everything that imports the *aesthetic* of low-trust mobile gambling onto our high-trust real-money platform.

## Feature backlog by play-loop phase

Each item is a named slot. Status: **done**, **partial**, **pending**.

### Phase 1 — Arrival & lobby (pre-challenge)

The "before the cards are dealt" period. Most addictive layer per the thesis above; under-developed today.

- **Live action feed.** In-progress games visible on Play. Status: **partial** — `Live now` row shipped, shows opponent identities, stake, move number-ish; missing real per-move tick.
- **Watcher count per live table.** "X watching" on the live game and the Live now row. Status: **shipped** — server tracks per-game spectator subscriptions (non-player WS connections, ref-counted across tabs), broadcasts `spectators.changed` on the game channel, and surfaces `watcherCount` on the lobby live-game projection and on `enrichGame`. UI: eye-chip on the Live now row, "Watching" stat on the game-page Table status card, live-updates over the existing realtime channel.
- **Featured table.** Highlighted high-stakes / high-skill table at top of the live feed; should be a real signal (largest pot, highest combined rating, established players) rather than editorial pick. Status: **pending**.
- **Open tables hierarchy.** Single-column rows over card-grid. Status: **done** (Wave O1).
- **Scout-on-hover / scout-on-tap.** Opening the dossier from any handle on Play. Status: **done** — scout popover.
- **Crowd / online count.** "N online" on lobby. Status: **done** — heartbeat strip.
- **Tier-aware lobby.** Tickets and challenges visibly carry trust tier (chips on rows). Status: **partial** — viewer badge, Quick Match tier-floor picker (`any` / `claimed` / `verified`), and compact `tier-pip` on opponent identities (live feed, open tables, player strips) shipped. Pending: tier filter on the Open Tables rail itself.

### Phase 2 — Posting & accepting (wager negotiation)

- **Challenge expiry timer.** Visible 60s clock on incoming/sent challenges. Status: **done**.
- **Counter-offer flow.** Recipient raises stake or shortens clock. Status: **done** for the mechanism; no escalation animations.
- **Challenge escalation animations.** Stake-bump or time-control change should feel like *raising* — chip stack growth, audible chip-click. Status: **pending**.
- **Subtle anticipation before acceptance.** Pre-board moment: opponent identity rendered, stakes lock visibly, "shuffling pieces" or chip-slide before the board appears. Status: **pending**.
- **Match intro.** Brief animated card flip / chip rack as the game opens, especially for high-stake matches. Status: **pending**.
- **Anti-decision-fatigue defaults.** Sensible stake/time picker defaults; sticky last-used. Status: **partial** — sticky picker, no last-used yet.

### Phase 3 — Live game (table energy)

- **Animated buy-in entering the pot.** When both sides escrow, chips visibly slide to the center. Paired with stake-locked SFX (see [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md)). Status: **pending**.
- **Core chess interaction sound.** Piece pickup, piece drop on felt, capture impact, check chime, mate two-stage cue, illegal-move muted thunk, clock low-time tension pulse. First-class layer, not afterthought. Status: **pending** — entire layer scoped in [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md).
- **Visible momentum.** A "heat" indicator (board edge glow, light gold halo) when one side has a clear material or positional advantage. Must be backed by a real signal (eval pipeline) — defer until eval lands or use a coarser heuristic. Status: **pending — gated on eval policy**.
- **Streak heaters.** W3 / W5 visual treatment on the identity badge or scout chip. Triggered by milestone unlock; see [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md). Status: **pending**.
- **Audience / spectator presence.** Watch button + spectator count for live games. Status: **shipped** — Watch button (read-only board) plus live-updating spectator count on both Live now feed and game-page Table status. Next: watcher-join SFX (low ambient "presence" tone).
- **Rank volatility cue.** Mid-game indicator that this match's rating swing will be unusually large (large rating gap, high-stake match). Status: **pending**.
- **Clock tension.** Sub-30s and sub-10s clock styling. Status: **done** visual; **pending** audio pulse pairing.

### Phase 4 — Settlement (the climax money moment)

The current settlement animation (single 700ms three-dot slide) is too restrained for what it represents. Settlements should feel like a financial event resolved at a poker table — physical, weighted, honest about the outcome. The "house resolved a financial event" register, not a "candy-crush level cleared" celebration.

- **Settlement physicality (the next iteration of the chip slide).** Status: **partial — shipped baseline only**, full physicality pass pending.
  - **Real chip-stack visualization.** Replace flat dots with 5–7 disc-shaped chips, vertically offset 2–3px each, edge-shaded to read as a poker stack. Pot label sits beside or atop the stack.
  - **Cascade timing.** Chips leave with stagger (~60ms between), travel along a slight parabolic arc, land with subtle scale-up settle (cubic-bezier with overshoot).
  - **Rake split.** A single rake chip splits off and slides toward "house" in the opposite direction — visualizes a fact the current chip-slide hides. Paired with rake SFX.
  - **Asymmetric outcome weight.**
    - **Win:** brisk and satisfying (~700ms), gold-accent landing, chip-rake SFX, bankroll counter ticks up. Milestone composition may layer on top (see below).
    - **Loss:** slow and heavy (~1100ms), muted palette, chips slide *away* from viewer toward opponent, heavier chip-slide SFX, bankroll counter ticks down. **No celebration of any kind.**
    - **Draw:** visible split down the middle, two half-stacks travel half the distance each, neutral palette, no fanfare, balanced SFX.
  - **Bankroll counter.** Sportsbook-style ticker tween of the viewer's balance over ~800ms, paired with bankroll-tick SFX (`SOUNDSCAPE_NEXT_PASS.md`). Counts up on wins, down on losses, no animation on draws.
  - **Milestone composition.** If the settlement triggers a milestone (first win, biggest pot, upset, streak), the milestone's intensity tier renders *on top of* the base settlement (contained confetti burst, stronger audio cue, banner). See [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md) for the tier ladder. Ordinary wins do not get confetti — that line is load-bearing.
  - **Reduced-motion:** chips snap to final position; bankroll counter snaps; settlement text reads the result with the same persistence (acknowledge the outcome, just don't animate it). Reduced-sensory: mutes SFX while keeping visuals.
- **Rating volatility display.** Visible +Δ / −Δ after settlement, with tier-appropriate dramatization (verified high-stake matches feel weightier — heavier font, stronger color, longer settle). Status: **partial** — number shipped; no animation/dramatization.
- **Rematch invitation timing.** Rematch CTA appears after settlement animation finishes (~1.2s gate), not before. Status: **partial** — CTA shipped, no animation gate.
- **Hand summary.** Short cinematic recap of the winning blow, last move, key tactical moment. Status: **pending**.

**The non-negotiable line:** even at maximum intensity, a settlement should still feel like a high-stakes live room resolving a hand, not a mobile game congratulating you. No coin-shower, no rainbow burst, no slide-whistle, no "TA-DA". The reference is the dealer at a poker table, the sportsbook payout terminal, the esports commentator's two-second "and that's the match" beat — not the casino floor's slot machine.

### Phase 5 — Identity & history (the persistent layer)

- **Personal stats / HUD.** Profile + dossier rail. Status: **partial** — dossier shipped (per Wave P1), still missing reliability metrics.
- **Scout cards (compact + full dossier).** Two reveals. Status: **done** for the current data layer.
- **Playstyle archetypes.** Narrative labels like `aggressive opener`, `time-pressure survivor`. Must be data-backed — defer until we have move-time + opening data. Status: **pending — gated on real signal**.
- **Opening badges.** ECO-classified opening preference. Status: **pending — gated on ECO pipeline**.
- **Established / verified / placed chips.** Trust ladder visible on every identity surface. Status: **partial** — tier chip on hero badge + Settings; compact `tier-pip` on opponent identities in live feed, open tables, and player strips. Still missing: scout card embed of the tier.
- **Rivalry threads.** H2H, recent matches with same opponent. Status: **partial** — H2H shown on scout / profile; no rivalry pinning.

## Sequencing notes

- The thesis above is load-bearing for every item. When in doubt, prefer the **poker-room / sportsbook / esports-broadcast** version of an effect over the **mobile-game casino** version (real chip-stack physicality over flat dots; rake animation over snapping numbers; chip-clack SFX over coin-shower jingles; contained banner over screen-wide confetti).
- Anything labelled "gated on" needs a separate workstream to land first (eval pipeline, ECO classification, milestone foundation, sound foundation). Don't fake the signal to ship the chrome.
- Animations should communicate, not decorate. Chip slide *means* "money moved." Board glow *means* "you're winning." If the animation doesn't carry a real fact, drop it.
- Sound is a peer to animation, not an afterthought. A chip-rake animation without the chip SFX is missing half the communication — and a chip SFX with no animation is the reduced-sensory fallback. See [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md).
- Milestones are the only thing that licenses confetti/banner/strong-audio intensity. Ordinary wins do not earn celebration — that distinction is what keeps milestone celebrations meaningful when they fire. See [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md).
- Atmosphere is built across many small slices over time, not one redesign. Treat this doc as a backlog, not a milestone.

## Anti-patterns

- **Confetti on every win.** Ordinary settlements do not get celebration overlays — only milestones do. Dilutes the meaning of milestone confetti.
- **React-Confetti sprayed across the full screen.** Even at milestone tier, confetti must be contained (chip-burst from the settlement card, not the whole viewport). Full-screen confetti reads as mobile game.
- **Variable-ratio "open a chest" loops on top of real wagering.** Double-dipping reinforcement is the predatory casino-skin path.
- **Premium-currency aesthetics.** We have real currency. Don't dress fake money up like gems.
- **Daily reward / streak shield / login bonus mechanics.** Manufactured retention bait. The real economy already has signal; manufactured signal dilutes it. Streaks are *recognized* (W3 chevron, banner) when they happen — they are not gamified with shield mechanics.
- **Manufactured urgency on real-money transactions.** Honest urgency (challenge timer, clock) is fine; "buy now / 30 seconds left" on deposits or sweeps is predatory.
- **Loot-language on commerce.** We say "deposit," "buy in," "settle," not "claim" or "redeem."
- **Cartoon sound design.** No slide-whistles, no "ta-da", no coin-shower jingles, no 8-bit chiptune. Tactile/material (wood, chip, felt, glass) — see [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md).
- **Achievement spam for trivial actions.** First move, first opening, first capture — boy-who-cried-wolf. Real milestones only (see [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md)).
- **Loss euphemisms.** Losses are honest and weighty. No "Better luck next time!", no encouragement palette, no consolation chip.
