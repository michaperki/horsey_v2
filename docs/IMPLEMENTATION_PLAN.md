# Horsey Roadmap

This is the single master document for Horsey's product execution. It covers the product shape, the working principles, what is built today, what is mocked, the staged plan to replace each mock with the real version, and the cross-cutting work that runs alongside. Update this doc — not a side note — when product direction changes.

Companion docs (not roadmaps): `PROJECT_SOUL.md` (product voice and feel), `ARCHITECTURE_FIRST_PASS.md` (early system shape), `DESIGN_REVIEW.md` (design intent), `adr/` (durable architecture decisions).

## Product Shape

Horsey is a wagered chess product. Two players pick a stake and time control, escrow the wager, play a chess game with server-authoritative state, and the winner takes the pot minus rake. The first milestone is a local fake-money playable loop. Real-money decisions are gated to Phase 7.

## Working Principles

- Build the real project, not a mockup reproduction.
- Keep the first playable system fake-money or sandbox-money until compliance, payments, and trust decisions are explicit.
- Make the server authoritative for chess state, clocks, wagers, escrow, and settlement.
- Use the designs as product truth for surfaces and interaction intent, but replace demo data and placeholder boards with production data and logic.
- Record major decisions in docs before importing libraries or creating hard-to-reverse structure.
- Every dev mock has a named seam. Replacing a mock is a contained swap, not a rewrite.

## Current Working Preferences

These reflect *how* we're working right now, not permanent rules. Update as conditions change.

- **Rapid iteration mode.** Surfaces are still moving. Don't propose broad automated test scaffolding (E2E, integration sweeps) as a headline next step — targeted tests for specific new domain logic are fine, but locking-in-the-milestone-via-tests is deferred until the loop stabilizes. The existing 42 unit tests should keep passing; we're just not investing in a test pyramid yet.
- **Nav is product, not scaffolding.** The current top nav (`LOBBY · WAGER · GAME · SETTLEMENT · WALLET`) treats flow stops as destinations. Wager / Game / Settlement are places a user passes through, not places they navigate to. Information architecture rethink is a tracked workstream (see below); the current nav is a debug-era artifact.
- **UI placeholder fields count as mocks.** A field that *looks* real but is hardcoded (opponent rating, country, h2h, momentum, rating delta, rematch button) is as much a mock as any subsystem in the seam list — and arguably more misleading, because it pretends to be product. Track them.
- **Docs over chat.** When a working session produces a durable direction or preference, the relevant doc (this one, `PROJECT_SOUL`, or an ADR) gets updated in the same change.

## Where We Are Right Now

What a developer can do locally today, end to end:

- Start the server (`node apps/api/server.mjs`), open `http://localhost:8787/` in two separate browser profiles (or one regular + one incognito) so each holds its own session cookie. Sign up two accounts.
- Either account can post an open invite from the lobby; the other accepts it before the 60-second auto-decline window. Both stakes lock in fake-money escrow as append-only ledger entries; only the recipient is allowed to accept/decline/counter.
- Each tab is restricted to its own player. Clicking on the wrong color returns `403 not_your_turn`; non-players cannot read private game or settlement data.
- Play legal chess moves until checkmate, stalemate, or draw conditions. The server auto-finalizes when chess.js reports a terminal result, releases both escrow holds, credits the winner the net pot, and records the rake.
- Either player can resign at any time during a live game; the opponent is credited.
- Draw settlements split the net pot, with any 1-cent rounding remainder routed to the house alongside the rake.
- The wallet page shows the ledger from the viewer's perspective; the settlement page shows the result from the viewer's perspective.
- Opponent moves and game finalization push to the other tab over WebSocket — no refresh needed. Challenge create/accept/decline/counter and matchmaking pair also push to the involved users' tabs. (Transport: ADR 0004.)
- Clocks tick server-side. Each `/moves` advances the moving side's clock; if a side runs out, the server auto-finalizes as a timeout and credits the opponent through the same `settleGame` path used by resign/checkmate. Live actions such as resign and draw offer/accept/decline also check for a flag before applying the requested action. Per-game timeout scheduler rehydrates after a server restart from `state=live` games.
- Either player can offer a draw mid-game (`POST /api/games/:id/draw-offer`); the opponent accepts (`/draw-accept` → game finalizes as a draw via `settleGame(winnerId=null)`, pot split with 1-cent remainder to house) or declines (`/draw-decline` → offer cleared). Same-side double offers, self-accept, and self-decline all return `409`. The offerer's own pending offer auto-clears on their next move.

The domain code in `packages/shared/domain.mjs` (money math, escrow, ledger summary, `settleGame`, challenge transitions) and `packages/chess/src/board.mjs` (chess.js wrapper, FEN, legal moves, terminal detection) is already production-shaped. The mocked surface is everything around it: identity, transport, persistence, asset quality, and seed-vs-real data.

## Dev Mocks That Replace To Reach The MVP

Each item below is a named seam. The "Phase" line points to where the real version lands.

### 1. In-memory state → persistent storage

Today: SQLite via `better-sqlite3` (see ADR 0003). DB lives at `data/horsey.db` by default, overridable via `HORSEY_DB_PATH`. Schema covers users, ledger entries, challenges, games, lobby, settlements. The `apps/api/seed.mjs` module is now an `initialSeed()` factory that is inserted only when the DB is empty. Multi-step writes (accept, finalize, resign) run inside `db.transaction(...)`. Restart-survival smoke-tested: mid-game and post-finalize state both resume cleanly. Status: **done** for the dev SQLite scaffold.
Real version remaining: Postgres for prod. Because the DB module is the only place SQL lives and the domain code in `packages/shared/domain.mjs` is unchanged, the swap is contained.
Phase: **3** scaffold done; **4** prod store + migrations + multi-game indexing pending.

### 2. Header-based identity → real auth

Today: email + password signup/login via `POST /api/auth/signup|login|logout`, with `crypto.scrypt`-hashed passwords and DB-backed sessions cookie'd as `horsey_session` (HttpOnly, SameSite=Lax, 30-day TTL). `resolveViewer` reads the cookie. The WebSocket `/ws` upgrade reads the same cookie instead of the prior `?as=<userId>` query string. Downstream guards (`requireRecipient`, `requireTurnOwner`, `requirePlayer`) are unchanged. Viewer-switch UI and `?as=` query string are gone. New accounts are granted $1,000 fake-money on signup. See ADR 0005. Status: **done** for the dev scaffold.
Real version remaining: rate limiting on signup/login, password reset, email verification, `Secure` cookie flag once the server runs over TLS, CSRF token if the API ever serves a cross-origin caller. Targeted challenges still work server-side but the lobby picker is gone (re-introduce via handle lookup when rivals/friends land).
Phase: **3** scaffold done; hardening pending under Phase 6.

### 3. Manual refresh → realtime push

Today: WebSocket transport landed via the `ws` package (ADR 0004). Server attaches a `WebSocketServer({noServer:true})` to the existing `node:http` server and handles `/ws` upgrades, authenticating via the `horsey_session` cookie (same session seam as the REST surface — see Mock #2 / ADR 0005). Each socket auto-subscribes to `user:<viewerId>`; clients opt into `game:<gameId>` and the server rejects subscriptions from non-players. A transport-agnostic broker in `apps/api/realtime.mjs` owns `Map<channel, Set<client>>` and prunes on close/error. Publishes are co-located with REST mutations: move → `game.updated`; finalize/resign/auto-finalize → `game.finalized` to game and to each player's user channel; challenge create/accept/decline/counter → `challenge.created|updated` to involved users; matchmaking pair → `matchmaking.matched` to both. Client opens one WS on load, reconnects with exponential backoff, subscribes/unsubscribes from `game:<id>` as the route changes, and refetches settlement on `game.finalized`. The 2s matchmaking poll remains as a belt-and-suspenders fallback. Status: **done** for the transport, channel architecture, and the events listed.
Real version remaining: replay-last-known-state on reconnect (currently the client re-fetches via `loadBootstrap`); spectator subscriptions (player-only guard on `game:*` is intentional for this slice); drop the matchmaking poll once reconnect behavior is observed in browser. Future consumers — clocks (Mock #5), draw offers / timeouts (Mock #7), presence, spectator stream, quick chat — are **deferred future consumers of this realtime layer, not rejected features** (see ADR 0004).
Phase: **4** transport done; consumer features land in their own slices.

### 4. One seeded challenge → real challenge + matchmaking

Today: `POST /api/challenges` issues a challenge to a specific user (or open / no recipient); `GET /api/bootstrap` returns the viewer's incoming, sent, and open challenges; pending challenges expire after the visible 60-second auto-decline window; accept creates a fresh game on the fly with randomized colors and escrows both sides in a single transaction. `POST /api/matchmaking/quick` queues by `(stakeCents, timeControl)` and instant-pairs against the oldest matching ticket from another user. Lobby UI shows real challenges, has a create-challenge form, and a quick-match form that polls every 2s while a ticket is open. Status: **done** for the dev scaffold.
Real version remaining: rating-bracketed matchmaking, presence/online filtering, anti-abuse rate limits on challenge creation.
Phase: **3** scaffold done; rating brackets + presence pending under Phase 4/6.

### 5. Static clocks → server-authoritative clocks

Today: server tracks `{whiteMs, blackMs, sideToMove, lastMoveAt, incrementMs}` per game via `packages/shared/clocks.mjs` (`parseTimeControl`, `initClockState`, `applyMoveToClock`, `flaggedSide`, `remainingForSide`, `msUntilFlag`). On accept the clock is initialized from `timeControl`; on each `/moves` call, the pre-check `settleIfFlagged` auto-finalizes as a timeout if the moving side has run out, otherwise `applyMoveToClock` deducts elapsed, adds the increment, and flips the side. A module-level `Map<gameId, NodeJS.Timeout>` schedules a `setTimeout` to fire when the side-to-move would flag; on fire the timer re-reads the game and finalizes if still flagged. Rehydrate runs on server start to re-arm timers for all `state=live` games. The new state is broadcast via the realtime `game.updated` payload (ADR 0004). Client derives `remainingForSide` from the clock blob + `Date.now()`, ticks locally every 250ms in place (no full re-render), and highlights under 30s. Status: **done**.
Real version remaining: drift-tolerant display polish (currently snaps on each push, no smoothing); per-tab visibility throttling; the existing `parseTimeControl` regex enforces `min+inc` in whole minutes — sub-minute formats (e.g. "30s+0" bullet) need a format extension.
Phase: **4** core done; UX polish + bullet-format support pending.

### 6. Crude unicode board → production-intended board UI

Today: custom CSS-grid board with public-domain SVG pieces, viewer-relative orientation, click-to-move, drag/drop, keyboard square navigation/selection, turn-aware source selection, legal target hints with capture styling, last-move/check highlighting, edge-only coordinates, captured-piece trays, accessible square labels, focus states, mobile-safe tap sizing, and a promotion picker. This is now the accepted production-intended baseline for the current milestone, not a mock loop to keep reopening.
Real version remaining: future chess UX features should be specific asks (for example premoves, animation, richer touch dragging, replay controls, or adopting a permissively licensed board package after license review), not a generic "fix the crude board" item.
Implementation note: in the runtime app, the board square button is the draggable surface and the inner piece image stays visual-only; the placeholder `primitives.jsx` board remains design-source only.
Phase: **2** baseline done; future enhancements are feature-specific.

### 7. Resign + auto-finalize → full lifecycle endpoints

Today: resign, auto-finalize from chess result, timeout settlement, and draw offer/accept/decline all exist. Draw offers live on `game.drawOffer = { offeredBy, offeredAt } | null` (persisted in the game JSON blob). State machine in `packages/shared/draw-offers.mjs` (`offerDraw`, `acceptDraw`, `declineDraw`, `clearOwnOffer`). Endpoints `POST /api/games/:id/draw-offer | draw-accept | draw-decline` reject same-side double offers (`draw_already_offered`), opponent attempting to offer while the other side's is pending (`draw_should_accept`), and self-accept/decline (`not_your_offer_*`). Accept routes through `settleGame(winnerId=null)`, reusing the draw-split + 1-cent-rounding-to-house path already used for chess draws. The moving side's own pending offer is cleared on their next move via `clearOwnOffer`. All three endpoints publish over the realtime broker: offer/decline as `game.updated`, accept as `game.finalized` (ADR 0004). Status: **done** for draw offers; resign **done**; timeout settlement **done** under mock #5.
Real version remaining: explicit abandonment / disconnect adjudication beyond the clock-timeout path. In this slice, "abandonment" is resolved by the existing clock-timeout: if a player walks away, their clock runs out and they lose by timeout. Presence-driven early-loss (auto-finalize before the flag falls, when the player has been disconnected from the WS for a defined window) is a future slice that depends on a presence subsystem — **deferred future consumer of the realtime layer, not a rejected feature**.
Phase: **4** core done; presence-driven abandonment policy pending.

### 8. Seed wallets → operator + admin tooling

Today: starting balances are hardcoded in the seed; there is no admin view of the ledger, no dispute resolution, no manual correction path.
Real version: admin views over users, ledger entries, escrow holds, settlements, reports, fair-play review. Manual correction is appending compensating ledger entries — the append-only schema already supports it.
Phase: **6**.

### 9. Fake money → real money

Today: every entry is fake-money; "house" is a pseudo-account; no payment integration.
Real version: jurisdiction + legal review, payment + payout provider, KYC, AML, sanctions, responsible-play controls, security review of wallet and escrow flows. The ledger schema is intentionally shaped to support real money via a `currency` column without domain rewrites.
Phase: **7** (gated decision).

## Phased Plan

Status legend per deliverable: **done**, **partial**, **pending**.

### Phase 0 — Project Foundation

Goal: establish the production workspace without burying the design source.

Deliverables:
- Repo layout: app workspace with frontend, backend, shared packages, docs, preserved design references. Status: **done**.
- Project README with local setup, commands, environment expectations, WSL/PowerShell notes. Status: **partial**.
- Initial stack for frontend, backend, database, realtime transport, test runner, package manager. Status: **partial** — Node/ESM with `node --test`, SQLite via `better-sqlite3` (ADR 0003), WebSockets via `ws` (ADR 0004).
- Design files preserved under a clear location. Status: **done** (`design/claude-canonical/`).
- Basic lint, format, typecheck, test commands. Status: **partial** — `npm test`, `npm run check`, `npm run lint`, `npm run format`, and `npm run verify` exist; no typecheck/pre-commit yet.
- ADR folder for durable architecture decisions. Status: **done** (`docs/adr/`).

Exit criteria:
- A new agent can install, run, test, and understand the project from docs. **Met (modulo expanded README).**
- Design source remains accessible and clearly marked. **Met.**

### Phase 1 — Product Skeleton

Goal: real frontend/backend shell and route/domain boundaries.

Deliverables:
- Frontend routes for lobby, challenge/wager, live game, settlement, profile, wallet, and future admin. Status: **done** (except admin).
- Backend API skeleton: health, users, challenges, games, wallet, settlement. Status: **done** for the seeded surface.
- Auth. Status: **done** — email + password signup/login + DB-backed sessions via `horsey_session` HttpOnly cookie; `resolveViewer` reads the cookie, WebSocket `/ws` upgrade reads the same cookie. See ADR 0005 and mock #2.
- Shared domain types for money amounts, users, challenges, games, moves, clocks, settlements. Status: **done** for amounts/challenges/games/settlements; clocks are still static.
- Design-system primitives inspired by `hifi-system.jsx`, rebuilt cleanly. Status: **partial** — minimal CSS only; no design-system layer yet.
- Seed/demo data path that can populate flows without hardcoding into components. Status: **done** via `apps/api/seed.mjs`.

Exit criteria:
- The app navigates through canonical surfaces using real routes and backend-provided demo data. **Met.**

### Phase 2 — Chess Core And Board

Goal: production-intended chess experience with legal move validation.

Deliverables:
- License review for chess libraries. Status: **done** for `chess.js`; board UI remains custom (see ADR 0002).
- Server-side game state model with FEN. Status: **done** (in-memory).
- Legal move validation, turn enforcement, check/checkmate/stalemate/draw detection. Status: **done** via `chess.js` wrapper.
- Client board: orientation, click-to-move, drag/drop, keyboard navigation, accessible square labels, legal-move hints, last-move/check highlight, captures, edge coordinates, responsive sizing, and mobile-safe tap behavior. Status: **done** for the current milestone baseline.
- Move history / notation display. Status: **partial** — basic SAN rows.
- Tests for legal moves, illegal moves, result detection, special moves, notation. Status: **done** — wrapper-level unit tests cover legal, illegal, castling, en passant, promotion, stalemate, and checkmate; API integration tests cover Scholar's Mate, threefold repetition, stalemate auto-finalize, and promotion through `/api/games/:id/moves`.

Remaining Phase 2 work:
- Phase 2 test gaps closed: castling, en passant, promotion, stalemate, and checkmate are covered at the chess wrapper level; threefold repetition, stalemate auto-finalize, and promotion are also covered as API integration tests. The chess wrapper bug that hid threefold from auto-finalize is fixed by replaying history through chess.js.
- Treat further board work as named product features, not open-ended polish. Examples: premoves, move animation, richer mobile drag gestures, replay scrubber, or replacing the custom board after a documented permissive-license review.

Exit criteria:
- Two local/demo users can complete a valid chess game through the app. **Met.**
- The server rejects illegal moves even if the client is modified. **Met.**

### Phase 3 — Challenge, Matchmaking, And Fake-Money Wagers

Goal: lobby and wager flows functional with auditable fake-money state.

Deliverables:
- Challenge lifecycle: create, receive, accept, counter, decline, expire. Status: **done** for the dev scaffold — create / accept / counter / decline / list-by-state and 60-second auto-decline are implemented.
- Matchmaking ticket lifecycle for quick match by stake and time. Status: **done** — `POST /api/matchmaking/quick` queues or instant-pairs; `DELETE` removes own ticket; ticket auto-consumed on pair. Rating-bracketed matching pending.
- Fake-money wallet ledger with balance, holds, releases, settlement entries, audit trail. Status: **done** for entries, balances, escrow holds/releases, win/loss/draw/rake settlement entries; audit-trail UX rolls into Phase 6.
- Escrow hold when a wager is accepted. Status: **done** (idempotent).
- Pot/rake calculation as a centralized domain rule. Status: **done** — `calculatePot` and `settleGame` in `packages/shared/domain.mjs`; rake recorded under the `house` pseudo-account.
- Idempotent game finalization that releases both escrow holds, credits the winner net pot, records the rake. Status: **done** via `POST /api/games/:id/finalize`, including draw settlements that split the net pot and route any 1-cent rounding remainder to the house. The move endpoint also auto-finalizes when chess.js reports a terminal result. Resign reuses the same path via `POST /api/games/:id/resign`.
- Lobby open tables, live floor, rivals, recent rematch data backed by API models. Status: **done** — lobby surfaces real incoming, sent, and open challenges; rivals list still seed-driven.
- Wager/scouting page backed by player stats, trust summary, head-to-head data. Status: **partial** — basic player info from `users` table; tells / trust summary / h2h still seed/decorative.

Exit criteria:
- A player can select a stake/time, accept or create a wager, and enter a game with fake funds escrowed. **Met.**
- All wallet changes are represented as ledger entries. **Met.**

### Phase 4 — Realtime Game Loop

Goal: live play reliable enough for real product iteration.

Deliverables:
- Realtime connection layer for game state, challenge notifications, presence, clocks, quick chat. Status: **partial** — WebSocket transport + broker + `user:*` / `game:*` channels + opponent move propagation + finalize push + per-user presence (online/lastSeenAt, surfaced on the opponent's user channel as `presence.changed` and embedded in game payloads as `players[].presence`) are **done** (mock #3, ADR 0004). Clocks and quick chat are deferred future consumers of this layer.
- Server-authoritative clocks with drift-tolerant client display. Status: **done** for the server side and the basic ticking client display (mock #5). Published through the realtime broker on `game.updated`. Drift smoothing and bullet (sub-minute) formats remain.
- Reconnect flow with grace windows. Status: **partial** — client reconnects to the WS with exponential backoff and refetches via `loadBootstrap`; server-side grace-window policy (for clock/abandonment) is pending and lands with mock #5/#7.
- Resign, draw offer/accept/decline, timeout, abandonment, disconnect adjudication. Status: **partial** — resign, timeout, and draw offer/accept/decline all done (mock #7). Presence is now tracked (opponent online/offline + lastSeenAt visible on the game page) but abandonment is still resolved by clock timeout; presence-driven early-abandonment policy (auto-loss after N disconnected seconds) is intentionally deferred — that's a product decision, not a missing primitive.
- Idempotent finalization that triggers settlement exactly once. Status: **done** — covered by Phase 3 work (auto-finalize, explicit finalize, resign all reuse `settleGame`); now also publishes `game.finalized` over realtime.
- Per-side identity enforcement so each player can only move on their own turn. Status: **done** — `403 not_your_turn` when the requester doesn't own the side to move. Real session/auth landed under mock #2; both REST and WS now authenticate via the `horsey_session` cookie. Game and settlement reads are also player-scoped; finalized games reject further move mutations.
- Spectator/read-only game stream. Status: **pending** — deferred future consumer of the realtime layer; the player-only guard on `game:*` subscriptions is intentional until spectator policy is decided.

Key decisions still open:
- ~~WebSocket vs SSE vs WebRTC vs managed realtime provider.~~ Resolved in ADR 0004 (`ws`).
- Clock update frequency and source of truth.
- Reconnect and abandonment policy.

Exit criteria:
- Two browser sessions can play a timed wagered game with reconnect and timeout behavior.
- Settlement is correct and idempotent across refreshes/retries.

### Phase 5 — Settlement, Profile, And Retention Loops

Goal: make the full design loop real after a game ends.

Deliverables:
- Settlement page with credited amount, rake, balance change, rating/stat changes, final position, rematch actions. Status: **partial** — credited / rake / balance / final move and a real Elo-based rating delta are now live; rematch issues a real challenge. Per-game stat aggregation and richer post-game stats still pending.
- Game history and profile stats. Status: **partial** — viewer-scoped finalized games list shipped at `GET /api/games/history` with a History route + detail view (reusing the settlement renderer); per-game stats aggregation and profile stats still pending.
- Rivalry/head-to-head tracking. Status: **pending**.
- Rematch, double-or-nothing, auto-requeue flows. Status: **partial** — rematch now issues a real challenge against the prior opponent at the same stake + time control; double-or-nothing and auto-requeue still pending.
- Review/replay view for finished games. Status: **done** for the dev scaffold — `GET /api/games/:id/replay` returns ordered moves with FEN-after-each-ply; settlement (immediate post-game) and history detail (revisited) both render the same read-only replay board with first/prev/next/last controls and a clickable move list. Future polish: keyboard arrow navigation, evaluation overlays.

Key decisions:
- Rating system.
- Stat aggregation approach.
- How much post-game analysis/eval is real in early milestones.

Exit criteria:
- A player can go lobby → wager → game → settlement → rematch without leaving the loop.

### Phase 6 — Trust, Safety, And Admin Foundations

Goal: operational infrastructure before any real-money launch path.

Deliverables:
- Trust profile model and UI hooks. Status: **partial** (UI only, seed data).
- Report player/game flow. Status: **pending**.
- Admin/support views for users, games, ledger, escrow, settlements, reports, fair-play review. Status: **pending** — mock #8.
- Event log for game, wallet, trust, admin actions. Status: **partial** — wallet ledger is append-only; a `game_events` table now records `move`, `resigned`, `draw_offered`/`accepted`/`declined`, and `finalized` (with `ratingChange` payload). Nothing reads from it yet, but it's the seed of a cross-domain audit log. Wallet/trust/admin events still pending.
- Basic anti-cheat signal ingestion points. Status: **pending**.
- Manual settlement correction workflow with audit trail. Status: **pending** — the ledger schema supports compensating entries; tooling does not exist.

Key decisions:
- What anti-cheat means for closed testing.
- Which admin actions require dual control or elevated permissions.
- Data retention and privacy posture.

Exit criteria:
- Operators can inspect and resolve stuck games, reports, and fake-money settlement issues.
- Trust/safety is represented in the system, not just the UI.

### Phase 7 — Real-Money Readiness Gate

Goal: decide if and how Horsey can become real-money in specific jurisdictions.

Deliverables:
- Jurisdiction and legal/compliance review.
- Payment and payout provider evaluation.
- KYC/age verification approach.
- AML/fraud/chargeback/sanctions plan.
- Responsible-play controls.
- Terms, disclosures, rake/fee visibility, tax/reporting plan.
- Security review of wallet, escrow, settlement flows.

Status: **pending** — mock #9. No work has started.

Key decisions:
- Launch geography.
- Whether Horsey is skill gaming, gambling, sweepstakes, or another regulated model in each target region.
- Custody model and provider responsibilities.

Exit criteria:
- A written go/no-go decision exists before any production real-money integration.

## Cross-Cutting Workstreams

Run alongside the phases, not after them:

- **Information architecture.** First pass landed: top nav is now Play · History · Profile, with a Resume-game pill that appears only when a live game exists. Wager/Game/Settlement keep their routes but are reached through the flow, not the chrome. Wallet folded into Profile. History list + detail (reusing the settlement renderer) shipped. Deferred destinations (Live spectator, Friends/Rivals, Admin) remain named slots. **See `IA_PROPOSAL.md` for the per-screen real-vs-mocked matrix; it stays live as mocks turn real.**
- **UI surfaces still showing seed/decorative data.** Distinct from the numbered subsystem mocks (#1–#9). Status after the IA pass:
  - Wager page opponent `country` / `reputation` / `verified` / `h2h` / `note` — **deleted from API and UI.** Will re-emerge with real backing under Phase 5 (rivalry/h2h) + trust subsystem (Phase 6).
  - Settlement `ratingDelta` — **now real.** Backed by an Elo module (`packages/shared/rating.mjs`, K=32, formula version 1) and a per-game `ratingChange` snapshot in `games.data_json`. Users' `rating` is updated inside the same transaction as `settleGame`. Per-time-control ratings and provisional/Glicko-style uncertainty are not in scope for this slice.
  - Settlement rematch button — **now a real action** (`POST /api/challenges` against prior opponent + stake + time control).
  - Game page eval / anti-cheat insights — the prior "Momentum" placeholder has been removed from the live rail; real eval/scouting remains deferred to trust/safety work.
  - Play page rivals list — not yet rendered (was always pending). Will arrive with Phase 5.
- **Dev ergonomics.** Phase 0 lint/format/typecheck are still partial. Biome lint/format scripts and a single `npm run verify` aggregate now exist. Remaining low-cost work: optional `tsc --noEmit` for JSDoc/types and pre-commit wiring.
- **Testing.** Unit tests for domains plus a focused API/session integration slice are in `tests/` (currently 45 passing). Broader E2E investment is **deferred** while we're in rapid-iteration mode — see Working Preferences. Targeted tests for specific new domain logic are still welcome; what's deferred is a test-pyramid push.
- **Observability.** Logs, metrics, traces, audit events, error reporting.
- **Security.** Auth, authorization, input validation, rate limiting, secrets, abuse prevention.
- **Accessibility.** Keyboard board controls, focus states, color contrast, mobile ergonomics.
- **Performance.** Board responsiveness, realtime latency, clock accuracy, query health.
- **Documentation.** Update `PROJECT_SOUL`, architecture docs, ADRs, and this roadmap as product decisions change.

## First Build Milestone — Local Fake-Money Playable Loop

Scope:
- Real app scaffold. **Done.**
- Lobby with stake/time selection. **Done** — real open/incoming/sent challenges + quick-match form.
- Challenge or quick-match path. **Done** — `POST /api/challenges` for targeted/open challenges; `POST /api/matchmaking/quick` for stake+time pairing.
- Server-authoritative chess game. **Done.**
- Fake-money escrow and settlement. **Done** (decisive + draw + resign).
- Basic post-game settlement/rematch page. **Done** — settlement is real; rematch now issues a real `POST /api/challenges` against the prior opponent at the same stake + time control.

Out of scope for this milestone:
- Real payments.
- Full anti-cheat.
- Production KYC/compliance.
- Native mobile app.
- Advanced engine evaluation unless a low-risk permissive dependency is chosen.

What stands between now and the milestone being complete:
1. Phase 2 is complete for the dev scaffold. Remaining named follow-ups are scoped product features (premoves, animation, replay polish, etc.), not generic gaps.

Safety note: the manual `POST /api/games/:id/finalize` endpoint is now explicitly dev-gated by `HORSEY_ENABLE_DEV_FINALIZE=1` and still requires the caller to be a player. Normal game completion should flow through moves, resignation, draw agreement, or timeout settlement.

Mocks #1 (persistence), #3 (realtime transport), #4 (challenge create + matchmaking), #5 (server clocks + timeout settlement), and #7 (full game-lifecycle endpoints minus presence-driven abandonment) have all landed. Mock #3 unlocked the rest of Phase 4 by giving every server-push consumer (clocks, draw offers, plus future presence / spectator stream / quick chat) a transport to plug into — see ADR 0004.
