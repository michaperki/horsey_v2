# Lobby (Play screen) design gap

Living plan for the Play screen's information architecture and the deltas between current implementation and the canonical designs in `hifi-lobby.jsx` and `lobby.jsx`.

Companion docs: `docs/IA_PROPOSAL.md` (nav-level IA), `docs/DESIGN_REVIEW.md` (canonical source treatment), `docs/SCOUTING_TRUST_NEXT_PASS.md` (next-pass Open Tables + scouting direction), `docs/PUNCH_LIST.md` (smaller polish items), `docs/IMPLEMENTATION_PLAN.md` (phased roadmap).

## Information architecture

The lobby is not two equal-weight matchmaking forms (Quick Match and Open Invite). They are two verbs — *find* and *host* — on the same selection: stake + time + viewer identity. The screen is organized around that insight.

### One picker, two verbs

The chip + time pickers (already built) appear **once** in the hero. Two CTAs share that selection:

- **Find me a game →** — primary, glowing, dominant. Quick Match's ephemeral queue.
- **Host a table at these terms →** — muted secondary text-link / ghost CTA below. Open Invite's persistent table.

This removes the duplicate stake/time selectors that currently live in two separate forms and folds the Open-an-invite form out of the right rail.

### Hero state machine

The hero is one physical felt card whose content morphs in place across three states. None of the transitions navigate away — the dashboard around the hero keeps streaming.

**State A — Idle (default).**
```
felt card:
  "You're playing as Sam · 1932"            ← identity badge (top-right)
  Pick a chip. Sit down.                    ← hero h1
  STAKE  [ chip stack picker ]
  TIME   [ pill picker ]
  [ Find me a game → ]  [ pot +$48 · 5% rake ]   ← primary CTA + pot panel
  Host a table at these terms →                  ← secondary CTA (shared picker)
  Pick up where you left off · Vish · Kobe ...   ← rematch strip
```

**State B — Queued (Quick Match in flight).**
```
felt card:
  You're in the queue.
  [ locked chip stack ]  $25 · 3+0
  ~5s typical wait  ·  12s elapsed              ← live timer
  [ Leave queue ]    change terms ↩
  Recent pairings ticker (live feed)            ← gives the queued player something to read
```

**State C — Hosting an open invite.**
```
felt card:
  You're hosting a table.
  [ chip stack ] $25 · 3+0 · waiting for player
  00:47 left before auto-expire                 ← live countdown
  [ Withdraw invite ]    change terms ↩
  You appear in Open Tables to other players.
```

### Right rail — drop CRUD, become liveness

| Today | Proposed |
|---|---|
| `Incoming` (always rendered) | `Incoming` — top of rail, hides when empty |
| `Open Tables` as single-line CRUD list | `Open Tables` as 4–6 opponent cards (avatar + stake stack + time pill + Sit CTA + RIVAL ribbon) |
| `Sent` (when non-empty) | **Removed** — sent invite is now the State C hero |
| `Open an invite` form card | **Removed** — Host is now the secondary CTA in the hero |
| — | **NEW:** heartbeat strip (`● 1,204 online · 412 in active games`) |
| — | **Later:** Hot Upsets card, Rivals list, Live Games feed (each blocked on a subsystem; add incrementally) |

## Sequenced workstream

The IA shift is the next wave; isolated visual polish is paused until the hero shape is coherent.

### Wave 1 — Picker primitives  *(shipped)*

- [x] **Chip + pill pickers replace `<select>` dropdowns.** Both forms now use poker-denomination chip stacks (`stakeChipStack` greedy-decomposes over `[500, 100, 25, 5, 1]`) and time-control pills with lowercase category labels. Chips are textless casino tokens (color + dashed edge + inner ring); the `$25 / $50 / $1K` total label below the stack does the precise reading and turns gold on active. (`apps/web/src/{app.js,styles.css}`, commit `54e7f50`)

### Wave 2.5 — Live-Table Module  *(shipped)*

The dashboard's active-game state has its own structural problem, separate from the hero state machine. Today there are two Resume affordances competing — a small top-nav pill and a large hero banner — and the banner is rendered as `<a class="primary" href="#game">` which produces an underlined gold-tinted link because `.primary` was authored for `<button>` and only paints color/font (no padding, no `text-decoration: none`). On top of the cosmetic bug, the IA is wrong: the broken banner sits *above* a glowing `Find me a game →` CTA, so the matchmaking hero outshouts the active-game one. The room is shouting "play a new game" while a clock ticks on the one in progress.

**Mental model.** "I'm still in the casino, seated at a live table." The lobby stays a lobby. The active game gets a deliberate first-class surface inside it — not a separate "in-game dashboard" mode. (Considered and rejected: a full State D in the hero state machine — it would have duplicated the game page's clocks/opponent/pot/move-count, doubled maintenance, and felt like a half-in/half-out alternate dashboard.)

- [x] **Deleted `liveGameBanner()` and `.live-game-banner` CSS** including the mobile media query rule. Replaced, not restyled.
- [x] **New Live-Table Module** (`renderLiveTableModule`) sits above the matchmaking hero on `#play` whenever a live game exists. Dark felt with gold accents. Contents shipped:
  - `● LIVE · your move` / `● LIVE · {opponent}'s move` eyebrow with red pulse dot (`@keyframes live-pulse`).
  - Opponent avatar + handle + rating.
  - Only the side-to-move's clock, with `.low` (under 30s) and `.critical` (under 10s) variants and a critical-state pulse animation.
  - Stake chip stack (smaller, 28px chips) + `$X · [time control] · move N` meta line. Time control only renders when present on the game object (today it lives on the challenge, not the game blob — non-blocking).
  - XL glowing primary CTA: `Return to board →` — real `<button>` calling `navigate("game")`. Glow animation matches the felt's gold accents.
  - Muted dashed secondary: `Resign · concede $X` — opens the existing shell-level resign-confirm dialog via `openResignConfirm()`.
- [x] **Matchmaking surfaces stay at full visual weight.** No opacity/desaturation/inline notes were added. The module's loudness sets hierarchy.
- [x] **Topnav Resume pill unchanged.** Complementary cross-route affordance.
- [x] **Clock-tick reuse.** Extended `manageClockTick` to also tick on `#play` when there's a live game. New `updateLiveTableClockDom()` updates only the `[data-live-table-clock] time` node and toggles `.low` / `.critical` classes, so the display ticks every animation frame without re-rendering the page.

**Parallel server-side cleanup** (shipped after the UI work; tracked in `PUNCH_LIST.md`):
- [x] Auto-leave queue tickets + auto-withdraw pending hosted invites for both players when a game starts.
- [x] Reject `POST /api/matchmaking/quick` / `POST /api/challenges` / challenge-accept while the viewer has a live game, with `has_live_game` and inline client error copy.

This means the matchmaking hero can stay fully enabled in the UI; the server is the source of truth for "you can't start a second game." Cleaner than client-side disabling.

### Wave 2 — Lobby IA shift  *(shipped)*

The chip/pill primitives we built in Wave 1 are re-used inside the new hero. No new visual primitives — this was a restructure.

- [x] **Hero state machine — Idle / Queued / Hosting.** `lobbyHeroState()` returns one of three render branches sharing a single felt card via `renderHero()`. Transitions never navigate; `hostOpenInvite()` and `joinQuickMatch()` both stay on Play and morph the hero through `loadBootstrap` + `render`.
- [x] **Shared picker, two CTAs.** Single `state.picker.hero = { stakeCents, timeControl }` replaces the old `quick` / `invite` split. `Find me a game` calls `joinQuickMatch`; `Host a table at these terms →` calls the new `hostOpenInvite` (no-nav variant of the old createChallenge). The old `createChallenge` was deleted — rematch already posts to `/api/challenges` directly.
- [x] **Right rail unification.** Dropped the `Sent` block and the `Open an invite` form card. `Incoming` hides when empty. `Open Tables` is now a 2-column opponent-card grid (avatar + chip stack + time pill + Sit CTA) and filters out the viewer's own invites (those live in the hero in State C).
- [x] **Heartbeat strip** at the top of the right rail — first slice of item #2. Uses `bootstrap.lobby.onlineCount` and `activeGames`. Hot Upsets / Rivals / Live Games defer to their subsystems.

### Wave 3 — Hero polish inside the new shape  *(shipped)*

Five polish items landed together inside the new State A hero now that Wave 2.5 set the live-game presence cleanly.



These items previously lived as isolated polish tickets; they now land inside the State A hero card.

- [x] **#4 "Pot if you win" panel** beside the primary CTA. Inline `previewNetPotCents(stakeCents)` mirrors `calculatePot` in `packages/shared/domain.mjs` (RAKE_RATE = 0.05); preview only, the server is the source of truth at game creation.
- [x] **#5 Rematch strip** — last 4 unique opponents from `/api/games/history`, deduped and capped. Fetched on play-route entry. Each row shows avatar + `↺ {handle}` + win-delta (positive only, gold) or time control fallback, with the stake on the right. **Honors `project_no_loss_advertising`**: negative deltas are suppressed in favor of the time-control line. New `rematchFromHistory()` action posts to `/api/challenges` and navigates to the wager screen for confirmation.
- [x] **#6 CTA glow + arrow** on the *primary* Idle CTA only. Scoped via `.hero-state-idle .hero-cta-primary` so Queued's `Leave queue` and Hosting's `Withdraw invite` stay calm (they're exits, not invitations). New `@keyframes hero-cta-glow` runs 3s ease-in-out infinite.
- [x] **#7 Hero voice** — `Pick a chip. Sit down.` replaces the missing-h1 picker-only Idle hero.
- [x] **#9 "You're playing as" identity badge** in the hero's top-right: viewer avatar + handle + rating. Now that the hero is the only matchmaking surface, the player can see at a glance what identity they're betting with.

### Wave 4 — Deferred to subsystems / later

- [x] **Live Games feed** — landed in the liveness pass. New `.live-games-card` between Incoming and Open Tables. Each row shows both players (scoutable identities), stake, time control, and client-computed elapsed time. Broadcast over `CHANNELS.lobby` alongside the heartbeat. See `docs/LIVENESS_NEXT_PASS.md` item 1.
- [ ] **Hot Upsets / Rivals shortlist** — still deferred. Will sit beside the Live Games card once we have rivalry signals and upset-detection logic.
- [ ] **#8 Filter chips above Open Tables** (`all / bullet / blitz / rapid / $100+ / rivals`). Cosmetic until the grid scales — defer until there's enough volume to need filtering.
- [ ] **#10 TopNav cleanup.** Fold connection pill + identity + logout into a tidier avatar menu. Independent of the lobby IA; do alongside a real auth-menu later.

## How to use

- Wave 2 lands as one workstream — don't cherry-pick parts; the hero, the shared picker, and the right rail unification are interlocking.
- Wave 3 items can each be a small commit once Wave 2 is in.
- When a checklist item ships, check it off and link the commit in the item body.
- When something turns into a multi-screen workstream (e.g., the full Live Floor), promote it to `IMPLEMENTATION_PLAN.md` and leave a one-line pointer here.
