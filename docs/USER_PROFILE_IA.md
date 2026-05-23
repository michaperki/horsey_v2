# User profile + opponent trust IA

Living plan for opponent identity, scouting, and trust signals across the app. Investigation findings, the layered surface model, the buildable-now vs deferred split, and the privacy rules that govern what we surface.

Companion docs: `docs/IA_PROPOSAL.md` (nav-level IA), `docs/LOBBY_DESIGN_GAP.md` (lobby internal IA), `docs/SCOUTING_TRUST_NEXT_PASS.md` (next-pass scouting/trust direction), `docs/IMPLEMENTATION_PLAN.md` (phased roadmap — Phase 6 is the trust subsystem).

## Why this exists

Players need to trust that the games are fair. Part of that trust is being able to inspect opponents and see evidence they're real, fallible players: they win and lose, they have a history, they have a record. Today the app surfaces opponent avatars + handles + ratings in nine places, but **none of them are clickable, and we expose no public projection of any user beyond `{id, handle, rating}`**. There is no `/api/users/:id` endpoint and no `#user/:id` route.

The canonical designs treat identity as a first-class system. `profile.jsx` is titled "Player profile / opponent HUD variations + flow + system" and defines three identity surfaces (compact scout card, full dossier, trust panel) plus the wager screen which is structurally an opponent dossier at the moment of decision. `DESIGN_REVIEW.md:47` is explicit: *"Opponent context matters before accepting a wager."* `ARCHITECTURE_FIRST_PASS.md:28` names `/players/:id` as a route candidate. The flow map in `profile.jsx:281` includes "Scout / Accept" as a core-loop node.

## Mental model: identity is layered

Not one page — a stack of surfaces sized to the moment.

| Layer | Surface | Trigger | Lives at |
|---|---|---|---|
| 1 | Inline identity (avatar + handle + rating) | always rendered | every opponent surface (already shipped) |
| 2 | **Compact Scout Card** | click any avatar/handle | popover anchored to the clicked element |
| 3 | **Full Player Profile** | "view profile" link in Scout / direct URL | new route `#user/:id` |
| 4 | Wager-screen dossier | clicking a challenge / Sit / rematch | existing `#wager`, enriched as signals land |
| 5 | In-game tells rail | always on `#game` while live | game-page side rail (deferred) |
| 6 | Trust & Safety panel ("how Horsey keeps it fair") | from Profile or a quiet `#trust` page | post-Phase-6 |

Layers 2 and 3 are buildable **now** against existing data + two new endpoints. Layers 5 and 6 defer to the trust subsystem.

## Structural decisions

- **Scout Card** = anchored popover next to the clicked avatar. Closes on outside-click or Esc. Smaller surface, ~340px, "2-second read" matching the design intent. Disciplined about what fits.
- **Profile route** = `#user/:id`. Matches the existing `#play / #history / #profile` pattern.

## What "click to inspect" means everywhere

When Layer 2 lands, every avatar+handle becomes a Scout Card trigger. Surfaces that get this treatment in order of importance:

1. **Wager screen** — most important. Before you escrow money, you can inspect.
2. **Live-Table Module** (Play, while a game is live) — know who you're playing against without leaving the lobby.
3. **Game page player strips** — mid-game inspection of your opponent.
4. **Open Tables grid** (Play right rail) — scout before you sit.
5. **Rematch strip** (Play hero State A) — quick check before re-challenging.
6. **History list** — look up the person from a past game.
7. **Settlement** — close the loop on who you just played.
8. **Incoming challenges row** — vet the sender.

Open Table cards have a special case: the *card body* still does what it does now (`selectChallenge` → Wager). The *avatar+handle within it* becomes the Scout trigger via event-stopPropagation. Same on rematch picks and history rows.

## API additions

Two new endpoints, both lean.

### `GET /api/users/:id`

Public projection + aggregated stats. Computed server-side; no client logic.

```ts
{
  id, handle, rating, createdAt,
  stats: {
    finishedGames: number,           // count from listFinalizedGamesForUser
    wins, losses, draws: number,     // result aggregation
    currentStreak: { kind: "W"|"L"|"D", length: number },
    last10: ("W"|"L"|"D")[],         // for bead row
    ratingTimeline: { at, delta, after }[]  // from ratingChange snapshots
  },
  presence: { online: bool, lastSeenAt: iso|null },
  liveGame: { id, opponent: {handle, rating}, stakeCents, ... } | null,
  h2hVsViewer: {
    games: number,
    viewerWins, viewerLosses, draws: number,
    // viewer's net dollar delta — NEVER surfaced when negative (see Privacy below)
    viewerNetCents: number,
    last5: { result, timeControl, endedAt, opening? }[]
  } | null  // null if no shared history
}
```

Profile-wide earnings charts should come from `ledger_entries` when Layer 3 adds them. Viewer-relative h2h uses a query joining `game_players` against itself, with the viewer net amount suppressed whenever it is not positive.

### `GET /api/users/:id/recent-games?limit=10`

Returns the opponent's last N finalized games with viewer-safe fields only:
`{ id, opponent: {handle, rating}, result (from this user's POV), endedAt, timeControl, endReason }`.

Crucially: **does not surface stake amounts**. Other people's bet sizes aren't ours to publish.

## Scout Card content (Layer 2, 340px popover)

Tight by design. Six blocks max:

```
┌─────────────────────────────────────┐
│ [avatar]  Vish · 1842       [RIVAL] │  ← identity + h2h-derived RIVAL pill (if any)
│           IN · joined 2y · ★4.8     │  ← tenure (when verified; just tenure today)
├─────────────────────────────────────┤
│ [style] [WR ##%] [avg ##m##s]       │  ← 3 stat tiles
├─────────────────────────────────────┤
│ last 10:  W W L W L W W W W W       │  ← bead row
├─────────────────────────────────────┤
│ h2h vs you:  3 – 2  (5 games)       │  ← score only; no dollar tally
├─────────────────────────────────────┤
│ [          View profile →         ] │  ← single inspection CTA
└─────────────────────────────────────┘
```

Today (no trust pipeline yet): drop the `★4.8` trust pill and the `verified ID` badge — surface them only when they have real backing.

## Full Profile page (Layer 3, `#user/:id`)

Match the design's 3-column dossier shape but render only what we can populate truthfully. Decorative-only fields stay out.

| Column | Block | Real today? |
|---|---|---|
| Left | Avatar + handle + tenure + status pills | yes (initials only) |
| Left | H2h vs viewer (score + beads, dollar tally suppressed if negative) | yes (after new query) |
| Left | Challenge + Rematch CTAs | yes |
| Left | Message / Follow / Report | **skip** — no underlying systems |
| Center | Recent earnings chart (their own) | yes, with a later endpoint extension (ledger aggregation) |
| Center | 4 stat tiles (Games / WR / avg game / favorite time control) | yes |
| Center | Tells & Tendencies | **skip** — Layer 5 territory |
| Right | Trust & Safety checklist | **skip** — no pipeline |
| Right | Favourite openings | **skip** — needs ECO classification |
| Right | Recent vs you (last 5, result + opening + date, no dollar) | yes |

## Privacy / loss-advertising rules

Per `project_no_loss_advertising` memory: the opponent's *own* W/L/earnings are fair game (their record, not the viewer's losses). Specific guardrails:

- **H2h dollar tally:** suppress when viewer is net-down. Show the score (e.g. `2 – 5`), and dollar delta only when positive (`+$340`).
- **Recent vs you mini-feed:** result + time control + opening + date only. No `−$250` per row. (Same fix as Wave 3 rematch strip.)
- **Opponent's recent-games stake amounts:** never published. Their game outcomes are public; their wager sizes aren't.

These rules apply both to API responses (server should not return suppressed numbers in the first place) and to client rendering.

## Sequenced workstream

Names follow the project's wave convention; this is a new track running parallel to the lobby waves.

### Wave U1 — API foundations  *(blocks U2/U3)*

- [x] `GET /api/users/:id` returning the projection above. Server-side aggregations: game counts, W/L/D, streak, last10, h2h vs viewer (with loss-advertising rules applied), recent rating timeline from `ratingChange` snapshots, presence snapshot, live game.
- [x] `GET /api/users/:id/recent-games?limit=10` (viewer-safe; no stakes).
- [x] DB query addition: `listFinalizedGamesBetween(viewerId, otherId)` for h2h.

### Wave U2 — Compact Scout Card

- [x] Popover primitive: anchored to a triggering element, click-outside + Esc to close, single open at a time. Remaining polish: focus return/trap.
- [x] `Scout Card` renderer fed by `GET /api/users/:id`. Skeleton state for the brief fetch.
- [x] `[data-open-scout]` triggers added to opponent identity surfaces (Wager, Live-Table Module, Game player strips, Open Tables, Rematch strip, History, Settlement, Incoming). Trigger clicks stop propagation so parent card clicks (e.g. `selectChallenge`) don't also fire.
- [x] **Scout Card is inspection-only.** The original cut had a `Challenge $X` button alongside `Profile ->`, but the directed-challenge action turned out to compete with `Sit ->` on every open-table identity click and pushed the lobby fantasy toward "calling people out" rather than "sitting at public tables." Directed challenge now lives on the Profile route (and on Rematch / Settlement, where a relationship already exists). Clicking through Scout -> Profile -> Challenge is the deliberate path for a stranger callout.
- [x] Scout CTAs are reduced to a single full-width `View profile ->` link; the trigger's stake/time context is no longer needed by the card and was removed from `scoutTrigger()`, `openScout()`, and the trigger dataset attrs across all callsites.

### Wave U3 — Full Player Profile

- [x] New `#user/:id` route + `renderUserProfile()`. Fetches `GET /api/users/:id` and `GET /api/users/:id/recent-games`.
- [x] Initial 3-column dossier with real today blocks only: identity, presence, h2h, record, rating timeline, last10, recent games. Decorative trust/tells/openings blocks omitted entirely.
- [x] Wired Challenge CTA using the current hero stake/time defaults. CTA now branches on shared history: reads `Rematch {handle} · $X` when `h2h.games > 0`, `Challenge {handle} · $X` otherwise. The opponent's handle is in the label in both cases — the prior `Challenge $25` copy was impersonal for what is structurally a directed callout.

### Wave U4 — Wager-screen enrichment  *(shipped)*

- [x] `enterRoute("wager")` triggers `loadWagerOpponent()` which fetches `GET /api/users/:id` for the challenge's opposite party. New state fields `wagerOpponent` + `wagerOpponentLoading`; the opponent profile clears on every route transition away from wager so stale dossiers can't bleed across challenges.
- [x] `renderWagerDossier(opponent, dossier)` builds the dossier card under the decision-time headline ("Vish wants $250 from you"). Anatomy: identity (avatar + handle + rating, still a scout trigger) → narrative reveal (same `scoutNarrative()` voice as Scout Card and Profile) → 3-tile stat grid (Win rate / Streak / Joined) → Last 10 beads → H2H block with shared-games count. Skeleton state while loading.
- [x] Right-side `.match-card` trimmed. Removed the "Stakes lock in fake-money escrow for this milestone" line, added `timeControlKind` suffix to the time-control line. Accept stays loud-primary, Decline drops to a ghost `.quiet` button on the felt.
- [x] **Counter terms is a real mechanism now.** The previous no-op `Counter same stake` button posted to `/counter` with identical values — a state transition for the sake of state transition. Replaced with an inline picker (stake chips + time pills + Send / Cancel) that opens in the match-card when the recipient clicks `Counter terms`. Submit is gated on at least one term changing. After counter, the server transitions to `countered` with the new stake/time/pot, and the *original challenger* becomes the responding party (server-side `requireRespondingParty(viewer, challenge)` gates accept/decline by state: `incoming` → recipient, `countered` → challenger). Headlines branch on state: original challenger sees `Vish countered with $50`, original recipient sees `You countered with $50 — waiting on Vish`. Counter is intentionally NOT exposed on open tables (no recipientId) — the public-table contract is "sit or don't sit," not "negotiate from the lobby."

### Deferred to the trust subsystem (Phase 6)

- Tells & tendencies aggregation (Layer 5 in-game rail; also center column of Profile).
- Anti-cheat / fair-play score, verified ID badges, report counts.
- Centipawn-loss / accuracy.
- Country flag (was deleted as decoration; bring back when there's a real signal).
- Favourite openings (needs ECO classification).
- Trust & Safety panel (Layer 6).
- Avatar art uploads.

Each is named here so future agents have a placeholder and don't try to mock them.

## How to use

- Wave U1 lands first; U2 and U3 both depend on it.
- Wave U2 and U3 can ship together or sequentially. U2 alone is a meaningful improvement.
- U4 lands after U1 once the data is flowing.
- Each Layer 2 trigger is small; the surfaces don't all need to land in one commit. Wager and Live-Table Module are the highest-leverage entry points.
- When the trust subsystem (Phase 6) starts, revisit the deferred list and slot blocks back into the existing Profile / Scout shapes rather than rebuilding them.
