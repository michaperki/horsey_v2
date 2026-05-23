# Lobby (Play screen) design gap

Living plan for the Play screen's information architecture and the deltas between current implementation and the canonical designs in `hifi-lobby.jsx` and `lobby.jsx`.

Companion docs: `docs/IA_PROPOSAL.md` (nav-level IA), `docs/DESIGN_REVIEW.md` (canonical source treatment), `docs/PUNCH_LIST.md` (smaller polish items), `docs/IMPLEMENTATION_PLAN.md` (phased roadmap).

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

### Wave 2 — Lobby IA shift  *(shipped)*

The chip/pill primitives we built in Wave 1 are re-used inside the new hero. No new visual primitives — this was a restructure.

- [x] **Hero state machine — Idle / Queued / Hosting.** `lobbyHeroState()` returns one of three render branches sharing a single felt card via `renderHero()`. Transitions never navigate; `hostOpenInvite()` and `joinQuickMatch()` both stay on Play and morph the hero through `loadBootstrap` + `render`.
- [x] **Shared picker, two CTAs.** Single `state.picker.hero = { stakeCents, timeControl }` replaces the old `quick` / `invite` split. `Find me a game` calls `joinQuickMatch`; `Host a table at these terms →` calls the new `hostOpenInvite` (no-nav variant of the old createChallenge). The old `createChallenge` was deleted — rematch already posts to `/api/challenges` directly.
- [x] **Right rail unification.** Dropped the `Sent` block and the `Open an invite` form card. `Incoming` hides when empty. `Open Tables` is now a 2-column opponent-card grid (avatar + chip stack + time pill + Sit CTA) and filters out the viewer's own invites (those live in the hero in State C).
- [x] **Heartbeat strip** at the top of the right rail — first slice of item #2. Uses `bootstrap.lobby.onlineCount` and `activeGames`. Hot Upsets / Rivals / Live Games defer to their subsystems.

### Wave 3 — Hero polish inside the new shape

These items previously lived as isolated polish tickets; they now land inside the State A hero card.

- [ ] **#4 "Pot if you win" panel** beside the primary CTA (`+$pot · 5% rake · escrowed`).
- [ ] **#5 Rematch strip** — last 4 opponents with avatar + P/L delta + stake (`↺ Vish +$225 · $250`). Data likely derivable from `history`.
- [ ] **#6 CTA glow + arrow** on the *primary* CTA only (`animation: ho-glow 3s ease-in-out infinite`). Host CTA stays muted on purpose.
- [ ] **#7 Hero voice** — `Pick a chip. Sit down.` Replaces `Pick a stake. Find a game.`
- [ ] **#9 "You're playing as" identity badge** in the hero's top-right (avatar + handle + rating). More important now that the hero is the only matchmaking surface.

### Wave 4 — Deferred to subsystems / later

- [ ] **Live Floor right column — full version** (Hot Upsets, Rivals list, Live Games feed). Blocked on presence + spectator subsystems; promote to `IMPLEMENTATION_PLAN.md` when those are queued.
- [ ] **#8 Filter chips above Open Tables** (`all / bullet / blitz / rapid / $100+ / rivals`). Cosmetic until the grid scales — defer until there's enough volume to need filtering.
- [ ] **#10 TopNav cleanup.** Fold connection pill + identity + logout into a tidier avatar menu. Independent of the lobby IA; do alongside a real auth-menu later.

## How to use

- Wave 2 lands as one workstream — don't cherry-pick parts; the hero, the shared picker, and the right rail unification are interlocking.
- Wave 3 items can each be a small commit once Wave 2 is in.
- When a checklist item ships, check it off and link the commit in the item body.
- When something turns into a multi-screen workstream (e.g., the full Live Floor), promote it to `IMPLEMENTATION_PLAN.md` and leave a one-line pointer here.
