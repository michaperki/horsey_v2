# Competitive wagering arena — atmosphere & feature backlog

Companion docs: `PROJECT_SOUL.md` (product voice), `SCOUTING_TRUST_NEXT_PASS.md` (dossier + trust UX), `LIVENESS_NEXT_PASS.md` (lobby liveness), `LOBBY_DESIGN_GAP.md` (Play/Open Tables IA), `IMPLEMENTATION_PLAN.md` § Trust Tiers / cross-cutting workstreams.

## Thesis

Chess.com and similar pure-skill products work hard to *simulate* stakes — leagues, streaks, daily missions, glowing-gem currencies, "Redeem Now" modals, full-screen dim-and-spotlight upsells, loot-language for purchases. They're borrowing emotional grammar from gambling and mobile games to make a dry product feel charged.

Horsey doesn't need to simulate stakes — they're already real. Money moves. Reputation moves. Status moves. The opportunity is therefore *inverted*: we don't import casino aesthetics, we build a **competitive wagering arena** that respects how charged the underlying activity already is.

The emotional high in this category often lives *before* the gameplay — entering the arena, posting the challenge, waiting for acceptance, watching stakes rise, scouting the opponent. The board is the climax; the lobby is the foreplay. Poker rooms understood this for decades. The lobby itself feels alive before cards are even dealt.

## What we borrow vs. what we reject

| From chess.com / mobile-gaming grammar | Reject | Borrow (reframed) |
|---|---|---|
| Full-screen dim + spotlight upsell modals | ✕ — interruptive, casino-energy literal | Reserved for genuine consequence moments (settlement reveal) |
| Glowing-gem premium currency aesthetics | ✕ — we have real money, no need to simulate | Chip stacks are the visual currency primitive; they already do this work without faking |
| "Limited time" urgency on purchases | ✕ — predatory pattern | Challenge expiry timer (60s acceptance window) is the honest version: real time pressure on a real decision |
| "Claim/Redeem" loot language for SaaS upgrades | ✕ — euphemizes commerce | "Settle", "buy-in", "rake", "pot" — the honest poker vocabulary |
| Constant progression surfaces (leagues, streaks, badges) | Partial — only when backed by real signal | Trust tiers (provisional/claimed/verified), placement progress, established badge |
| Streaks/ratings everywhere | Partial — restraint matters | Rating visible in identity badge, streak shown in scout card. Don't paste it onto every surface. |
| Intermittent rewards | ✕ — variable-ratio reinforcement is the dark version | Real outcomes already provide variable reinforcement; don't add a second layer |
| Bright reward colors against dark UI | Partial | Gold accents on real wins (chip slide, win settlement). Used sparingly so the contrast keeps meaning. |

Principle: *we don't need to act like a casino because we are one.* The product should feel like a competitive arena where money is the table — not a chess product wearing a casino skin.

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

- **Animated buy-in entering the pot.** When both sides escrow, chips visibly slide to the center. Status: **pending**.
- **Visible momentum.** A "heat" indicator (board edge glow, light gold halo) when one side has a clear material or positional advantage. Must be backed by a real signal (eval pipeline) — defer until eval lands or use a coarser heuristic. Status: **pending — gated on eval policy**.
- **Streak heaters.** W3 / W5 visual treatment on the identity badge or scout chip. Subtle, not Vegas. Status: **pending**.
- **Audience / spectator presence.** Watch button + spectator count for live games. Status: **shipped** — Watch button (read-only board) plus live-updating spectator count on both Live now feed and game-page Table status.
- **Rank volatility cue.** Mid-game indicator that this match's rating swing will be unusually large (large rating gap, high-stake match). Status: **pending**.
- **Clock tension.** Sub-30s and sub-10s clock styling. Status: **done**.

### Phase 4 — Settlement (the climax money moment)

- **Settlement animation.** Pot chip slide to winner, rake chip slide to house. Status: **partial — pot chip-slide shipped** (single 700ms decisive slide from center toward winner; draw splits the stack; reduced-motion fallback honored). Rake-to-house chip and tier-weighted dramatization still pending.
- **Rating volatility display.** Visible +Δ / −Δ after settlement, with tier-appropriate dramatization (verified high-stake matches feel weightier). Status: **partial** — number shipped; no animation/dramatization.
- **Rematch invitation timing.** Rematch CTA appears after settlement animation finishes, not before. Status: **partial** — CTA shipped, no animation gate.
- **Hand summary.** Short cinematic recap of the winning blow, last move, key tactical moment. Status: **pending**.

### Phase 5 — Identity & history (the persistent layer)

- **Personal stats / HUD.** Profile + dossier rail. Status: **partial** — dossier shipped (per Wave P1), still missing reliability metrics.
- **Scout cards (compact + full dossier).** Two reveals. Status: **done** for the current data layer.
- **Playstyle archetypes.** Narrative labels like `aggressive opener`, `time-pressure survivor`. Must be data-backed — defer until we have move-time + opening data. Status: **pending — gated on real signal**.
- **Opening badges.** ECO-classified opening preference. Status: **pending — gated on ECO pipeline**.
- **Established / verified / placed chips.** Trust ladder visible on every identity surface. Status: **partial** — tier chip on hero badge + Settings; compact `tier-pip` on opponent identities in live feed, open tables, and player strips. Still missing: scout card embed of the tier.
- **Rivalry threads.** H2H, recent matches with same opponent. Status: **partial** — H2H shown on scout / profile; no rivalry pinning.

## Sequencing notes

- The thesis above is load-bearing for every item. When in doubt, prefer the *honest* version of a casino mechanic (real expiry over fake urgency, real chip stack over glowing gem, real stakes over simulated leagues).
- Anything labelled "gated on" needs a separate workstream to land first (eval pipeline, ECO classification, etc.). Don't fake the signal to ship the chrome.
- Animations should communicate, not decorate. Chip slide *means* "money moved." Board glow *means* "you're winning." If the animation doesn't carry a real fact, drop it.
- Atmosphere is built across many small slices over time, not one redesign. Treat this doc as a backlog, not a milestone.

## Anti-patterns

- Variable-ratio "open a chest" loops on top of real wagering — double-dipping on reinforcement is the casino-skin path we're explicitly rejecting.
- Premium-currency aesthetics. We have real currency. Don't dress fake money up like gems.
- "Daily reward" or "streak bonus" mechanics that pay out play tokens for showing up. The economy already has signal — adding manufactured signal dilutes it.
- "Limited-time" urgency on real-money transactions. The real expiry surfaces (challenge timers, clock) are honest; manufactured urgency on deposits / sweeps purchases would be predatory.
- Loot-language on commerce surfaces. We say "deposit," "buy in," "settle," not "claim" or "redeem."
