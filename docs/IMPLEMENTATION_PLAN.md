# Horsey Roadmap

This is the single master document for Horsey's product execution. It covers the product shape, the working principles, what is built today, what is mocked, the staged plan to replace each mock with the real version, and the cross-cutting work that runs alongside. Update this doc — not a side note — when product direction changes.

Companion docs (not roadmaps): `OPERATIONAL_POLICY.md` (integrity/abuse/payments/support doctrine — source material for ToS and FAQ; *what's allowed* and *how we explain it*, paired with the topic `_NEXT_PASS` docs that own *how we build it*), `PROJECT_SOUL.md` (product voice and feel), `ARCHITECTURE_FIRST_PASS.md` (early system shape), `DESIGN_REVIEW.md` (design intent), `DEV_QA_WORKFLOW.md` (manual multiplayer smoke workflow + lightweight dev-tool direction), `adr/` (durable architecture decisions).

## Product Shape

Horsey is a wagered chess product. Two players pick a stake and time control, escrow the wager, play a chess game with server-authoritative state, and the winner takes the pot minus rake. The first milestone is a local fake-money playable loop. The next money step is a real payments panel for buying non-cashout entertainment chips; cashout/payout decisions are gated to Phase 7.

The path from "playable on my laptop" to production now has four parallel lanes: (A) **Deploy Readiness** — host the loop somewhere a closed-beta tester can reach it; (B) **Closed Beta Operations** — minimum admin / smoke / observability so humans can use it unattended; (C) **Payments v1** — NOWPayments stablecoin chip purchases, ToS acceptance, refunds, spend caps, kill switch, and no cashout; (D) **Cashout Discovery** — jurisdiction, dual-currency/sweepstakes framing, KYC, AML, custody, payouts, and written decisions before redeemable balances ship. These lanes sit alongside the numbered phases rather than replacing them.

## Working Principles

- Build the real project, not a mockup reproduction.
- Keep cashout and redeemable balances out of v1. Inbound chip purchases are now in scope as non-cashout entertainment credit, with explicit ToS acceptance and a kill switch.
- Make the server authoritative for chess state, clocks, wagers, escrow, and settlement.
- Use the designs as product truth for surfaces and interaction intent, but replace demo data and placeholder boards with production data and logic.
- Record major decisions in docs before importing libraries or creating hard-to-reverse structure.
- Every dev mock has a named seam. Replacing a mock is a contained swap, not a rewrite.

## Current Working Preferences

These reflect *how* we're working right now, not permanent rules. Update as conditions change.

- **Rapid iteration mode.** Surfaces are still moving. Don't propose broad automated test scaffolding (E2E, integration sweeps) as a headline next step — targeted tests for specific new domain logic are fine, but locking-in-the-milestone-via-tests is deferred until the loop stabilizes. The existing Node test suite should keep passing; we're just not investing in a full test pyramid yet.
- **Manual multiplayer QA is now documented.** The user's current smoke test is two isolated browser sessions, two accounts, pair a game, play a quick checkmate, and inspect settlement/history/realtime behavior. See `DEV_QA_WORKFLOW.md`. Because this loop is repetitive, a small scenario runner and one narrow two-browser smoke automation are now considered worthwhile dev ergonomics, without changing the broader "no big E2E push yet" preference.
- **Nav is product, not scaffolding.** The current top nav (`LOBBY · WAGER · GAME · SETTLEMENT · WALLET`) treats flow stops as destinations. Wager / Game / Settlement are places a user passes through, not places they navigate to. Information architecture rethink is a tracked workstream (see below); the current nav is a debug-era artifact.
- **UI placeholder fields count as mocks.** A field that *looks* real but is hardcoded (opponent rating, country, h2h, momentum, rating delta, rematch button) is as much a mock as any subsystem in the seam list — and arguably more misleading, because it pretends to be product. Track them.
- **Docs over chat.** When a working session produces a durable direction or preference, the relevant doc (this one, `PROJECT_SOUL`, or an ADR) gets updated in the same change.
- **Policy doctrine lives in `OPERATIONAL_POLICY.md`.** Anything about *what is allowed, prohibited, reviewed, refunded, void-able, or surfaced in user-facing language* belongs there — it's the source material for the eventual ToS and public FAQ. Topic docs (`FAIR_PLAY`, `PAYMENTS`, `SCOUTING_TRUST`, `RATING_BLOCKS`) own the implementation side and cross-link to the matching policy section. When the two seem to disagree, the policy doc wins for *language and posture*, the topic doc wins for *how to build it*. Open product questions land in `OPERATIONAL_POLICY.md` § 9 until they're answered.
- **Deploy with the dev store; swap stores only when real money forces it.** SQLite-on-a-volume is the prod store through the fake-money closed beta. The Postgres swap is a *named* pre-real-money slice, not a generic next step — it costs an async refactor of every `db.X(...)` call site in the server and earns its place only when concurrent-write safety, point-in-time recovery, and audit-grade backups actually matter (i.e., when funds are real). See mock #1 and the Deploy Readiness Bucket.
- **Mobile pass comes before the next product expansion.** The app is mobile-native in intent, and the next broad UI work should be a full mobile pass before deeper admin/fair-play surfaces. Scope + decisions live in `MOBILE_NEXT_PASS.md` — bottom tab bar, compact topbar, unified pointer-events board, `dvh` + safe-areas, `(pointer: coarse)` target sweep.
- **Fair-play is the next trust conversation after mobile.** Engine use and stronger-player assistance are the two obvious cheating paths. Blunder rate, average centipawn loss, top-engine agreement, and time/quality anomalies should enter the admin review model first, then selectively graduate into History/Profile/HUD once the analysis pipeline and caveats are real. See `FAIR_PLAY_NEXT_PASS.md`.
- **Payments v1 is buy chips, not cashout.** Build toward NOWPayments stablecoin chip purchases with ToS acceptance, refunds, spend caps, and a no-cashout wall. Cashout/payouts remain discovery first, code second. The dual-currency / sweepstakes-compatible route is now the favored cashout discovery thesis, but it still needs legal review and explicit product rules before product copy implies redeemability. See `PAYMENTS_NEXT_PASS.md`.

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

The repeatable human QA version of this flow lives in `docs/DEV_QA_WORKFLOW.md`, including the current Chrome + Edge two-session habit and the quick checkmate script.

The domain code in `packages/shared/domain.mjs` (money math, escrow, ledger summary, `settleGame`, challenge transitions) and `packages/chess/src/board.mjs` (chess.js wrapper, FEN, legal moves, terminal detection) is already production-shaped. The mocked surface is everything around it: identity, transport, persistence, asset quality, and seed-vs-real data.

## Dev Mocks That Replace To Reach The MVP

Each item below is a named seam. The "Phase" line points to where the real version lands.

### 1. In-memory state → persistent storage

Today: SQLite via `better-sqlite3` (see ADR 0003). DB lives at `data/horsey.db` by default, overridable via `HORSEY_DB_PATH`. Schema covers users, ledger entries, challenges, games, lobby, settlements. The `apps/api/seed.mjs` module is now an `initialSeed()` factory that is inserted only when the DB is empty. Multi-step writes (accept, finalize, resign) run inside `db.transaction(...)`. Restart-survival smoke-tested: mid-game and post-finalize state both resume cleanly. Status: **done** for the dev SQLite scaffold *and* as the closed-beta prod store on a mounted volume (see ADR 0006).
Real version remaining: Postgres only becomes load-bearing at the real-money gate, when concurrent-write safety, point-in-time recovery, and audit-grade backups stop being optional. The swap is **not contained** the way an earlier reading suggested: SQL itself lives in `apps/api/db.mjs`, but `better-sqlite3` is synchronous and `node-postgres` is async — the swap propagates `await` through every `db.X(...)` call site in `server.mjs` (~190 sites today) plus `scripts/dev-scenario.mjs` and `apps/api/milestones.mjs`. Treat it as a dedicated slice, not an incidental refactor.
Phase: **3** scaffold done; **closed-beta deploy** uses SQLite-on-volume (Deploy Readiness Bucket); **pre-Phase-7** Postgres swap pending.

### 2. Header-based identity → real auth

Today: email + password signup/login via `POST /api/auth/signup|login|logout`, with `crypto.scrypt`-hashed passwords and DB-backed sessions cookie'd as `horsey_session` (HttpOnly, SameSite=Lax, 30-day TTL). `resolveViewer` reads the cookie. The WebSocket `/ws` upgrade reads the same cookie instead of the prior `?as=<userId>` query string. Downstream guards (`requireRecipient`, `requireTurnOwner`, `requirePlayer`) are unchanged. Viewer-switch UI and `?as=` query string are gone. New accounts are granted $1,000 fake-money on signup. See ADR 0005. Status: **done** for the dev scaffold.
Real version remaining: CSRF token if the API ever serves a cross-origin caller; shared rate-limit store + abuse analytics. The `Secure` cookie flag is now wired and emits behind TLS (ADR 0006). Email verification + password reset are **shipped** — schema v10 adds `users.email_verified_at` + `email_tokens` (hashed, single-use, TTL: verify 7d / reset 1h); existing rows are grandfathered to verified on migration. Thin Resend HTTP client at `apps/api/email.mjs` (no SDK) with a silent default sink so test runs don't pollute output; `npm run dev[:qa]` sets `HORSEY_EMAIL_DRY_RUN_LOG=1` so local devs see the link in the terminal when no API key is configured. Endpoints: `POST /api/auth/verify-email/send|confirm`, `POST /api/auth/password/reset/request|confirm`. Reset confirm runs inside a transaction that updates the password, consumes the token, and deletes every session for that user. Reset request always returns 200 regardless of email existence. Soft-verify policy: account works pre-verification, persistent shell banner with "Resend" action, every privileged surface can later gate on `emailVerifiedAt`. Profile already exposes email change, password change, and log-out-other-sessions actions; changing email now also clears `email_verified_at`. Production startup warns if `RESEND_API_KEY` is unset. Targeted challenges still work server-side but the lobby picker is gone (re-introduce via handle lookup when rivals/friends land).
Phase: **3** scaffold done; verification + reset done under Deploy Readiness Bucket A; CSRF / shared rate-limit store pending under Phase 6.

### 3. Manual refresh → realtime push

Today: WebSocket transport landed via the `ws` package (ADR 0004). Server attaches a `WebSocketServer({noServer:true})` to the existing `node:http` server and handles `/ws` upgrades, authenticating via the `horsey_session` cookie (same session seam as the REST surface — see Mock #2 / ADR 0005). Each socket auto-subscribes to `user:<viewerId>`; clients opt into `game:<gameId>`. Live games allow read-only spectator subscriptions; finalized games and settlement remain player-scoped. A transport-agnostic broker in `apps/api/realtime.mjs` owns `Map<channel, Set<client>>` and prunes on close/error. Publishes are co-located with REST mutations: move → `game.updated`; finalize/resign/auto-finalize → `game.finalized` to game and to each player's user channel; challenge create/accept/decline/counter → `challenge.created|updated` to involved users; matchmaking pair → `matchmaking.matched` to both. Client opens one WS on load, reconnects with exponential backoff, subscribes/unsubscribes from `game:<id>` as the route changes, and on `game.finalized` refreshes the finalized game, settlement, wallet, and replay in place for players instead of route-jumping away from the board. The 2s matchmaking poll remains as a belt-and-suspenders fallback. Status: **done** for the transport, channel architecture, and the events listed.
Real version remaining: durable notification rows and an inbox/toast surface for direct challenges, bot greetings, counters, draw offers, game finalization, payment receipts, and account notices; replay-last-known-state on reconnect (currently the client re-fetches via `loadBootstrap`); drop the matchmaking poll once reconnect behavior is observed in browser. Future consumers — richer spectator floor, quick chat, and abandonment policy — are **deferred future consumers of this realtime layer, not rejected features** (see ADR 0004 and `NOTIFICATIONS_NEXT_PASS.md`).
Phase: **4** transport done; consumer features land in their own slices.

### 4. One seeded challenge → real challenge + matchmaking

Today: `POST /api/challenges` issues a challenge to a specific user (or open / no recipient); `GET /api/bootstrap` returns the viewer's incoming, sent, and open challenges; pending challenges expire after the visible 60-second auto-decline window; accept creates a fresh game on the fly with randomized colors and escrows both sides in a single transaction. `POST /api/matchmaking/quick` queues by `(stakeCents, timeControl)` and instant-pairs against the oldest matching ticket from another user. Lobby UI shows real challenges, has a create-challenge form, and a quick-match form that polls every 2s while a ticket is open. Status: **done** for the dev scaffold.
Real version remaining: rating-bracketed matchmaking, presence/online filtering, anti-abuse rate limits on challenge creation.
Phase: **3** scaffold done; rating brackets + presence pending under Phase 4/6.

### 5. Static clocks → server-authoritative clocks

Today: server tracks `{whiteMs, blackMs, sideToMove, lastMoveAt, incrementMs, firstMovesMade}` per game via `packages/shared/clocks.mjs` (`parseTimeControl`, `initClockState`, `applyMoveToClock`, `flaggedSide`, `remainingForSide`, `msUntilFlag`). On accept the clock is initialized from `timeControl`; on each `/moves` call, the pre-check `settleIfFlagged` auto-finalizes as a timeout if the moving side has run out, otherwise `applyMoveToClock` deducts elapsed, adds the increment, and flips the side. The `firstMovesMade` field gates a per-side main-clock pause: while it's < 2, the side-to-move's clock doesn't tick (only the 15s first-move window does — see Bucket B § Pre-move abort). A module-level `Map<gameId, NodeJS.Timeout>` schedules a `setTimeout` to fire when the side-to-move would flag; on fire the timer re-reads the game and finalizes if still flagged. Rehydrate runs on server start to re-arm timers for all `state=live` games. The new state is broadcast via the realtime `game.updated` payload (ADR 0004). Client derives `remainingForSide` from the clock blob + `Date.now()`, ticks locally every 250ms in place (no full re-render), and highlights under 30s. Status: **done**.
Real version remaining: per-tab visibility throttling. (Drift smoothing landed: the client anchors on `performance.now()` at message receipt and ticks via `requestAnimationFrame` so the display is monotonic between server updates. Sub-minute bullet formats landed: `parseTimeControl` accepts `Ns+inc` like `30s+0` / `45s+1`, with a 10-second floor; both `POST /api/challenges` and the matchmaking ticket endpoint validate up front; seed lobby exposes 30s+0 and 45s+0.)
Phase: **4** core done; per-tab throttling pending.

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

Today: read-only admin slice shipped (Bucket B #1). Schema v11's `users.is_admin` gates `/api/admin/*` and the `#admin` web page; six tabs cover Users / Games / Stuck / Ledger / Challenges / External. Starting balances are still seed-grant-only; manual correction is appending compensating ledger entries directly against the DB (the append-only schema supports it) — there is no in-app correction UI.
Real version remaining: in-app correction tooling, dispute resolution workflow, reports inbox, fair-play review, dual-control for mutations.
Phase: **6** for the remaining work; **Bucket B #1** for the read-only slice (done).

### 9. Fake money → payments v1 → cashout

Today: every entry is seeded/fake-money; "house" is a pseudo-account; no payment integration.
Payments v1: users can buy non-cashout entertainment chips through NOWPayments hosted stablecoin invoices. Webhooks append `purchase` ledger entries to the existing play-token balance; Profile/Cashier shows receipts; ToS acceptance, refunds, spend caps, geo-blocks, and `HORSEY_PAYMENTS_ENABLED=0` are part of the slice. See `PAYMENTS_NEXT_PASS.md`.
Cashout version: jurisdiction + legal review, dual-currency/sweepstakes-compatible rules, payout provider, KYC, AML, sanctions, responsible-play controls, tax/reporting plan, and security review of wallet/escrow/settlement flows. The ledger schema is intentionally shaped to support future cashout/redeemable balances via a `currency` column without domain rewrites.
Phase: **Payments v1 before Phase 7; cashout gated to Phase 7**.

## Trust Tiers

The trust system is one ladder that connects identity, matchmaking, stake limits, and (eventually) the real-money gate. Every other surface — dossier chips, matchmaking pool selection, stake cap enforcement, dual-currency policy — reads from this one model.

### The ladder

| Tier | How a user reaches it | What it unlocks |
|---|---|---|
| `provisional` | Default state for any new account. No external link, no finalized Horsey games. | Play tokens only. Low per-game stake cap. Matchmaking biased toward other provisionals. |
| `claimed` | Linked an external Lichess or Chess.com handle; we fetched public stats. Binding to this Horsey user is *not* proven. | Rating seed up to 1800. External game count visible on dossier as a separate signal. Still play tokens only. Higher stake cap than provisional. |
| `verified` | Chess.com bio-token claim challenge passed *or* Lichess OAuth/PKCE completed. We have proof this Horsey user controls the external account. | Rating seed cap raised (target: 2400, possibly uncapped). Higher stake cap. Sweeps-token earning unlocked once placement completes. |
| `placed` | Completed N placement games per time control they want to wager at (target: 10/time-control). | Combined with `verified` → sweeps-token writes allowed for that time control only. |
| `established` | 50+ finalized Horsey games at acceptable timeout rate. | Display badge on dossier. No new mechanical privileges — purely a trust read. |

`verified` and `placed` are intentionally separate. Verified proves the *seed* is honest. Placed proves the Horsey K-factor has converged enough that we believe our own number. A 2400-rated Lichess player can verify and still need placement before betting at high stakes.

`provisional`/`claimed`/`verified`/`established` are user states. `placed` is per-time-control state because skill across bullet/blitz/rapid is uncorrelated enough that placement should be earned per surface they want to bet at.

### Calibration scales with tier

The `calibrating` chip on a user's identity reflects how settled their Horsey rating is. The threshold isn't fixed — it scales with how much prior information we had when seeding:

| Tier at link time | Calibration games on Horsey | Why |
|---|---|---|
| `provisional` (no external link) | 10 | Zero prior — full cold-start, the K-factor has to do all the work. |
| `claimed` (linked, unverified) | 5 | Real external seed, no proof of ownership — moderate confidence in the seed. |
| `verified` (proven ownership) | 3 | Real seed + proven binding — we just need a handful of Horsey games to confirm the user *is* the player. |

Calibration is a *display* state today (the chip + the "still calibrating" narrative label). It is not yet a policy gate. When `placed` ships (per-time-control), calibration becomes one of the inputs to the placed gate alongside per-time-control game counts.

### Claimed vs verified deltas

| Axis | claimed | verified |
|---|---|---|
| Rating seed cap | 1800 | 2400 (or uncapped) |
| Sweeps eligibility | No | Yes, after placement |
| Dossier chip styling | muted "?" treatment | gold check glyph |
| Matchmaking pool | weighted toward other claimed/provisional users | full pool |

### Game-count policy: surface, never merge

External game counts are real signal, but they live in their own column. The dossier renders them next to — not summed with — Horsey's `finishedGames`:

`Lichess · 1791 blitz · 3,400 games  |  Horsey · 1791 · 12 games`

Reasons:
- Provenance stays clean. We can always answer "did this game happen here or there?"
- External game count becomes its own trust signal independent of seed correctness — 3,400 Lichess blitz games behind a 1791 means the seed is probably calibrated; 12 games means it isn't.
- We never need to migrate the meanings later when sweeps rules change.

Historical rating timelines from external platforms are *not* imported into Horsey's rating ledger. The Horsey rating starts at the seed and evolves only through finalized Horsey games — same source of truth as today.

### Dual-currency model (sweepstakes-compatible)

Real-money readiness (mock #9 / Phase 7) lands as a *second* currency alongside the existing play tokens. The existing wallet, ledger entries, and escrow flows continue to represent the play-token tier — they don't need a rewrite.

Plan shape:
- `play_tokens_cents` (today's `available_delta_cents`): always earnable, always spendable on play-token games. No legal constraints.
- `sweeps_cents` (new column or a `currency` enum on ledger rows): earned only via verified+placed activity, spent only against other verified+placed players, redeemable per Phase 7 rules.
- The ledger schema is already shaped to support this — `domain.mjs` math is currency-agnostic.

Gates for *earning* sweeps tokens:
- `verified` tier (Lichess OAuth or Chess.com bio-token claim).
- `placed` for the time control they're playing.
- Account age + region + Phase 7 controls.

Welcome bonuses, daily rewards, referral grants, and similar engagement loops all continue to land in the play-token ledger. Sweeps stay narrow until the Phase 7 go/no-go.

### Matchmaking implications

Matchmaking tickets carry the user's trust tier. Pool preference:
1. Same-tier first.
2. ±1 tier after a short delay.
3. Wider pool only when ticket has aged out, with a visible "no matches at your tier — opening pool" cue.

Stake caps are a function of tier (initial pass — caps tune as the loop calibrates):

| Tier | Per-game stake cap (play tokens) |
|---|---|
| provisional | $25 |
| claimed | $100 |
| verified | $500 |
| established | $1,000 |

When a challenge has a specific recipient, the *lower* of the two caps applies — preventing a verified user from coaxing a provisional user into a stake the provisional tier shouldn't see. Open tables enforce the host's cap; takers must also be at-or-above the cap themselves.

### Admin oversight surfaces (Phase 6 follow-ons)

The tier ladder makes admin queries trivial:
- Recent external-account links (audit). Already in `external_accounts.created_at`.
- Accounts where claimed-tier rating diverges sharply from Horsey rating (potential sandbag). One JOIN on `external_accounts.imported_stats_json` vs `users.rating`.
- High-stake activity by provisional users (review queue). One filter on `trust_tier`.
- Verification disputes (two Horsey accounts claiming the same external handle). Already implied by the `external_accounts.status='verification_pending'` lifecycle.

None of these need a separate trust subsystem — they're queries against existing tables plus the tier-computation function.

### What's shipped vs pending

- **Shipped:** `claimed` tier via Settings/Onboarding link (mock #2 follow-on, Phase 6 deliverable). `external_accounts` table (schema v3). Rating seed at 1800 cap (claimed) / 2400 cap (verified). Calibrating flag for first 10 Horsey games. Onboarding modal with skip-to-completion (schema v4). Tier computation as a shared function (`packages/shared/trust.mjs`). Tier + stake-cap on viewer/profile payloads. Stake cap enforced in `createChallenge` + `acceptChallenge` + `quickMatch` (lower of both sides applies when a recipient is set). `verified` tier via profile-token claim-challenge on **Lichess only** — token in bio / first / last / location, server fetches raw profile + case-insensitive scan, idempotent token (regenerate on demand), conflicting claims auto-dropped on verify, verified-tier reseed runs in the same transaction. Matchmaking tier preference (`any` / `claimed` / `verified` floor) on Quick Match tickets — schema v5 adds `tier_pref`; matches require mutual floor satisfaction. Trust tier surfaced on opponent identities (live feed, open tables, player strips) via a compact `tier-pip` chip (hidden for provisional to keep dense rows quiet). Avatar frames/borders also carry trust tier through CSS classes around the curated avatar image.
- **In flight:** none currently named.
- **Pending:** Chess.com verification (needs OAuth, club-name claim, or a different mechanism — Chess.com's public API has no reliably user-editable text field, so bio-claim can't ship there). Lichess OAuth/PKCE (higher-confidence verified channel than bio-claim). Per-time-control placement tracking + `placed` tier. Tier preference on Open Tables (filter the rail by minimum opponent tier). Dev fixtures for realistic trust-tier coverage, so local QA does not require manually grinding 50 finalized games to inspect established-tier banners. Dual-currency split (sweeps tokens). Phase 7 sweeps gate. Admin queue for handle disputes / sandbag flags.

This whole section is a load-bearing input to Phase 6 and Phase 7 below — those phases own *building* the surfaces, this section owns the *model*. When the model changes, update here first.

## Deploy Readiness Bucket

A workstream parallel to the phases, not a numbered phase of its own. It exists because "playable on my laptop" and "the fake-money loop is done" do not equal "a closed-beta tester can use this." That gap is operational, not chess-product. Reaching it is what unblocks any Phase 7 conversation.

Three buckets, in order. The bucket items below map onto `OPERATIONAL_POLICY.md` § 8 (Implementation Priorities) — Bucket A + B + Bucket C slice 1 cover the policy's "Before first real-money users" list; Bucket B follow-ons + first FAIR_PLAY slice cover "Soon after launch"; Bucket D inputs the "Deferred until scale" tail.

### Bucket A — Pre-deploy hardening (real-money-agnostic)

The minimum to host the fake-money loop somewhere external. **Status: code-side done.** Trailing items that depend on an external account (error tracker, object-storage backup, uptime monitor) are parked in the Backlog below; flip them on when you're ready to pay for the service.

- **Deploy target picked + plumbing in repo.** Status: **done** — Fly.io with a persistent volume for SQLite. See `docs/adr/0006-deploy-target.md`, `fly.toml`, `Dockerfile`.
- **Production-safe cookies.** Status: **done** for the seam — `Set-Cookie` emits the `Secure` attribute when running behind TLS (`HORSEY_TRUST_PROXY=1` or `NODE_ENV=production`).
- **Email verification + password reset.** Status: **done** — mock #2 follow-on. Resend HTTP client (no SDK), hashed-token table, four endpoints, soft-verify (account works pre-verification but every privileged surface can later gate on `emailVerifiedAt`), persistent shell banner, `#verify-email/:token` and `#password-reset/:token` routes work even when unauthenticated, password reset deletes every session for the user in the same transaction. Deploy needs `fly secrets set RESEND_API_KEY=re_... EMAIL_FROM='Horsey <onboarding@resend.dev>' HORSEY_APP_URL=https://horsey.fly.dev`.
- **Structured server logger.** Status: **done** — `apps/api/logger.mjs`. JSON-per-line under `NODE_ENV=production` or `HORSEY_LOG_FORMAT=json`, pretty otherwise. Per-request `requestId`, method, path, status, durationMs. `/api/health` silenced on 2xx so uptime checks don't drown the feed. Levels via `HORSEY_LOG_LEVEL`. The error tracker (Bucket A backlog) plugs into this logger's error path when it lands.
- **Health endpoint exists.** Status: **done** — `/api/health` returns 200; external uptime monitoring is in the Backlog.

### Bucket B — Closed-beta operations

The minimum to let real humans use it unattended.

- **Read-only admin slice (Phase 6 first cut).** Status: **done** — schema v11 adds `users.is_admin` (hand-set in the DB via `UPDATE users SET is_admin=1 WHERE handle='...'`; no admin-creates-admin UI yet). `/api/admin/{users,games,stuck-games,ledger,challenges,external-accounts}` are read-only and gated on `is_admin`. Web `#admin` page renders a tabbed view (Users / Games / Stuck / Ledger / Challenges / External). Nav link only shows when the viewer is admin. No mutations through this surface — corrections are append-only compensating ledger entries written directly to the DB.
- **Report-player path.** Even as a row in a `reports` table an admin can read. Seeds Phase 6 anti-cheat ingestion. Policy reference: `OPERATIONAL_POLICY.md` § 5.2 (user dispute flow).
- **Admin mutation slice — void / adjust / restrict.** Policy `§ 8` requires "ability to manually void/refund/adjust a match" + freeze accounts before first real-money users. **Locked 2026-05-28: all match outcomes are reversible by admin discretion** — no rules on *what* can be reversed, only audit-trail rules on *how*. **Void-not-refund framing (2026-05-28):** void is a *state*, refund is its ledger *consequence* — voiding a game writes the compensating entries that return both stakes. There is no separate `/refund` endpoint; if you want stakes returned, you void. The slice adds an `admin_actions` audit table (actor, target, action, reason, before/after JSON), a `user_restrictions` table (separate rows per restriction, audit-friendly, indexed for matchmaking/withdrawal-review queries), a reason field on every mutation, and the following endpoints: `POST /api/admin/games/:id/void` (writes compensating ledger entries, sets `state='voided'`, reverses any rating delta if the game had finalized), `POST /api/admin/games/:id/adjust` (manual settlement override — winner-id and credited-cents both writable, compensating entries net to the new outcome inside one transaction), `POST /api/admin/users/:id/restrict` (apply or clear one or more ladder states). The restrict endpoint takes the *full* shadow-restriction ladder from `FAIR_PLAY_NEXT_PASS.md` § Enforcement Ladder (lower trust score → restricted matchmaking → … → hard ban). Hard ban locks the user out *and* auto-voids any live game they're in (opponents refunded via the same void path). Future void triggers (server-outage detection, unrecoverable-state detection) are out of slice 2 but the `state='voided'` shape supports them. Status: **pending**.
- **Disconnect policy — pre-move abort + user-facing wording.** Policy `§ 1.10` (locked 2026-05-28). Trigger is a dedicated **15-second first-move clock per side**, not the main game clock or presence — at accept, white has 15s to play move 1; after white moves, black has 15s to play move 1; thereafter the main clock takes over. The **main game clock is paused** for each side until they play their first move, so a player isn't drained of their 3 minutes while the table is being seated; clock state gained a `firstMovesMade: 0|1|2` field that gates this in both `remainingForSide` and `applyMoveToClock` (`packages/shared/clocks.mjs`). If either first-move timer expires, `abortGame()` settles the game via `abortGameSettlement` (`packages/shared/domain.mjs`) — escrow released on both sides, no rake, no wager entries, `state='aborted'`, `endReason='aborted_pre_move'`. Pre-move *resign* collapses to the same abort path so closing the tab and clicking "resign" feel the same. Aborted games are excluded from `listFinalizedGamesForUser` (no rating change, no history pollution). Short user-facing copy: "first move · 15s" pill on the to-move side's player strip, plus the abort settlement panel ("No first move. Stakes returned."). The post-first-move behavior already matches the policy (clock just runs); no behavior change there. Repeat-offender escalation hooks into the slice 2 audit table / shadow-restriction ladder, not this one. Status: **done**.
- **Per-tab clock visibility throttling** (mock #5 trailing gap). Real users with backgrounded tabs will find this within a day.
- **Narrow multiplayer smoke automation.** Moved to **Backlog** (operational): the bustling dev daemon already exercises the pair → finalize loop continuously, which covers the regression case for now. Revisit when CI is gating deploys or when the loop changes shape enough that bustling no longer represents real human flow.

### Bucket C — Payments v1 (NOWPayments, stablecoins)

The buy-chips work that lets Horsey charge for entertainment credit in crypto while cashout stays closed. Provider + currency posture is locked in ADR 0007 — NOWPayments hosted invoice flow, USDT-TRC20 + USDC (Polygon / Solana). Card / fiat acquirer is out: card AUPs broadly disallow wagering on real money even when framed as entertainment credit.

- **ToS acceptance.** Status: **done (slice 1)** — versioned acceptance at signup, re-acceptance modal on version bump (current version: 1). `packages/shared/tos.mjs` is the single source of truth for the body; `tos_acceptances(user_id, tos_version, accepted_at)` records each consent. `GET /api/tos` is public; `POST /api/tos/accept` is authenticated.
- **Kill switch + catalog.** Status: **done (slice 1)** — `HORSEY_PAYMENTS_ENABLED=0` default; chip-package + currency catalog lives in `packages/shared/payments.mjs`; geo-block constant + `isGeoBlocked()` helper exist (no edge geo lookup yet — that lands when needed).
- **Buy Chips panel.** Status: **done (slice 1)** — Profile -> Buy Chips renders the package tiles. Tiles are locked when the kill switch is off or the viewer is geo-blocked. Buy button hits `POST /api/payments/checkout`, which currently 503s (kill switch) or 501s (slice 2 not wired yet).
- **Cashout waitlist.** Status: **done (slice 1)** — Profile -> "Cashout coming soon" card collects email; `cashout_waitlist` table; `POST /api/cashout-waitlist`.
- **Purchase ledger.** Status: **partial (slice 1 ships the table; slice 2 populates it)** — `purchases` table tracks `provider_session_id`, `provider_payment_id`, package, USD amount, chips credited (with bonus), status, pay currency, ledger entry id, raw IPN payload for audit.
- **NOWPayments wire-up.** Status: **pending (slice 2)** — `POST /api/payments/checkout` will create a NOWPayments invoice via `POST https://api.nowpayments.io/v1/invoice` and return the hosted `invoice_url`. `POST /api/payments/webhook` will verify HMAC-SHA512 IPN signatures against the merchant IPN secret and idempotently credit chips when status reaches `finished`. Needs `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` via `fly secrets set`.
- **Risk controls (deferred follow-on).** Real geo-block at the edge (Cloudflare or request layer), per-session / per-day spend caps, refund flow (admin-only via compensating ledger entries through the admin slice), chargeback / IPN-replay logging.

Status: **partial** — slice 1 scaffold shipped. Canonical detail lives in `PAYMENTS_NEXT_PASS.md` and ADR 0007.

### Bucket D — Cashout discovery (non-code)

The work that decides whether redeemable/cashout Phase 7 ships, and where. **Not actively blocking current product work.** Per decision 2026-05-28, the gaming-attorney conversation is deferred indefinitely — it's expensive, it isn't on the near-term critical path, and Bucket C (NOWPayments buy-chips with a no-cashout wall) doesn't depend on it. Bucket D items live here as parking, not as a milestone we're sequencing toward.

- **Sweepstakes model is the favored framing** (locked 2026-05-28). Dual currency: cosmetic / play chips (not withdrawable) + promotional / redeemable sweeps credits (potentially redeemable under rules). This matches the Trust Tiers § dual-currency direction. Other regulatory framings (skill-gaming, licensed sportsbook) are not ruled out but are not the working assumption.
- **Gaming attorney conversation.** Costs money. Required *before* any sweepstakes-compatible cashout copy goes live publicly. Deferred until we have closed-beta traction worth paying to formalize.
- **Jurisdiction shortlist + regulatory framing per region.** Where the sweepstakes model is viable, where it isn't.
- **Custody model.** Do we hold funds, or does the payment provider? This decision constrains the provider list.
- **KYC vendor evaluation.**
- **Payout provider evaluation** — narrow shortlist of providers willing to touch a chess-wagering product in the chosen jurisdictions.

Status: **deferred** across the board. Bucket D inputs the *cashout* code spec for Phase 7. Without Bucket D, cashout code is premature — but the absence of Bucket D progress does *not* block Buckets A/B/C.

## Backlog

Items that are scoped, named, and acknowledged — but intentionally not the next thing we touch. Most live here because they need an external account, a paid service, or a real human user to justify the work. Don't confuse "in the backlog" with "small": these are deferred, not trivial. Promote into the active buckets / phases when the gating condition is met.

### Operational backlog (Bucket A trailing items)

- **External error tracker.** Sentry (or equivalent). Plugs into `apps/api/logger.mjs`'s error path — when a `level=error` record fires, mirror it to the tracker with the same `requestId` and field shape. Needs: account, DSN, `fly secrets set SENTRY_DSN=...`. Unblocks remote debugging once a closed-beta tester finds something we can't reproduce locally. Until then, the structured logger + `fly logs` is sufficient.
- **SQLite backup + restore.** Periodic `sqlite3 /data/horsey.db ".backup"` snapshot uploaded to object storage on a cron, with a documented restore command. Needs: an object-storage bucket (e.g. R2, B2, or a free tier S3). Required *before* opening the closed beta to people whose data we don't want to lose; not required to host the loop for ourselves.
- **External uptime monitoring.** A check hitting `/api/health` from outside the box (UptimeRobot / Better Stack / Pingdom). Pages on outage. Needs: an account.
- **Narrow multiplayer smoke harness.** Two isolated cookie jars, signup → pair → Fool's Mate → assert finalized state + settlement payload + history row + ledger deltas. Bustling daemon covers the same shape continuously in dev, so this earns its place only when CI is gating deploys or when the loop changes shape enough that bustling no longer represents real human flow.

### Product backlog (named-but-deferred features)

These are tracked in their own docs and the per-screen IA matrix; this list is just a single place to scan what's named but not the active focus.

- **Open Tables tier filtering.** Quick Match already supports tier floors. Open Tables rail gets a lightweight filter once table volume justifies it.
- **Trust visibility explanation on Scout Card / Profile.** Tier borders and pips are present everywhere — Scout Card and full Profile should narrate the tier/evidence relationship without inventing fake badges. See `docs/SCOUTING_TRUST_NEXT_PASS.md`.
- **Chess.com verification path.** Lichess bio-claim shipped; Chess.com needs a different mechanism (OAuth, club-name claim, or alternative) since their API has no reliably user-editable text field.
- **Lichess OAuth/PKCE.** Higher-confidence verified channel than bio-claim.
- **Per-time-control placement tracking + `placed` tier.** Enables per-surface sweeps eligibility under the dual-currency model.
- **Per-tab clock visibility throttling.** Mock #5 trailing gap. Real users with backgrounded tabs will find it within a day of being onboarded.
- **Replay-last-known-state on WS reconnect.** Currently the client re-fetches via `loadBootstrap`. Functional, just chatty.
- **Drop the matchmaking 2s poll.** Belt-and-suspenders behind the realtime broker. Remove once we trust reconnect behavior in the wild.
- **Phase 5 retention loops.** Rivalry threads, richer History/Profile stats, double-or-nothing, auto-requeue. Higher-impact *after* there are humans using the app — don't pre-build engagement loops for nobody.
- **Postgres swap (mock #1).** Async-ifies every `db.X(...)` call site (~190 in `server.mjs`). Lands at the real-money gate, not before.
- **Rating blocks UX (`OPERATIONAL_POLICY.md` § 1.4 + `RATING_BLOCKS_NEXT_PASS.md`).** Hide exact rating behind class bands (D / C / B / A / Expert / Master) across lobby, live-table, scout, profile, history, settlement. Admin stays exact. Gated on the open-questions decision in policy § 1.4. Significant surface sweep when it lands.
- **Shadow-restriction ladder (`OPERATIONAL_POLICY.md` § 1.14 + `FAIR_PLAY_NEXT_PASS.md`).** Account-status states beyond banned/not-banned — reduced stake limits, delayed withdrawals, promotion ineligibility, restricted matchmaking, reduced visibility, no-rewards-from-suspicious-matches. Builds on the admin mutation slice in Bucket B.
- **Responsible-play minimums (`OPERATIONAL_POLICY.md` § 5.3).** Self-exclusion, deposit/stake caps, cooling-off period. Not required before fake-money beta; required before scaling real-money. Earns its place once Bucket C is live.
- **Multi-account / signup-abuse signals (`OPERATIONAL_POLICY.md` § 1.5, § 1.6).** Account-creation velocity by IP/device/email/wallet, rate limits on signup + reward claiming. Cheap to log now; intervene later. Gates real promotional rewards.
- **Claim-victory CTA (Lichess-style, `OPERATIONAL_POLICY.md` § 1.10 Future plan).** After an opponent has been disconnected past a TC-aware threshold (shorter grace for faster time controls), the on-game player can click "claim victory" to force a settlement instead of waiting for the opponent's clock to run out. Quality-of-life polish on the disconnect policy, not v1. Lands after the pre-move abort slice ships.

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
- Wager/scouting page backed by player stats, trust summary, head-to-head data. Status: **partial** — basic player info from `users` table is real; tells / trust summary still pending; h2h is real (`userH2hVsViewer`); per-user evidence (stake band, biggest pot won, timeout rate) is real via `evidenceForUser` and surfaced on Scout Card, wager dossier, and profile.

Exit criteria:
- A player can select a stake/time, accept or create a wager, and enter a game with fake funds escrowed. **Met.**
- All wallet changes are represented as ledger entries. **Met.**

### Phase 4 — Realtime Game Loop

Goal: live play reliable enough for real product iteration.

Deliverables:
- Realtime connection layer for game state, challenge notifications, presence, clocks, quick chat. Status: **partial** — WebSocket transport + broker + `user:*` / `game:*` channels + opponent move propagation + finalize push + per-user presence (online/lastSeenAt, surfaced on the opponent's user channel as `presence.changed` and embedded in game payloads as `players[].presence`) are **done** (mock #3, ADR 0004). Clocks and quick chat are deferred future consumers of this layer.
- Server-authoritative clocks with drift-tolerant client display. Status: **done** for the server side and the client display (mock #5). Published through the realtime broker on `game.updated`. Client anchors on `performance.now()` at message receipt and ticks via `requestAnimationFrame` so the display is monotonic between server updates. Sub-minute bullet formats (e.g. `30s+0`, `45s+1`) are accepted with a 10-second floor.
- Reconnect flow with grace windows. Status: **partial** — client reconnects to the WS with exponential backoff and refetches via `loadBootstrap`; server-side grace-window policy (for clock/abandonment) is pending and lands with mock #5/#7.
- Resign, draw offer/accept/decline, timeout, abandonment, disconnect adjudication. Status: **partial** — resign, timeout, and draw offer/accept/decline all done (mock #7). Presence is now tracked (opponent online/offline + lastSeenAt visible on the game page) but abandonment is still resolved by clock timeout; presence-driven early-abandonment policy (auto-loss after N disconnected seconds) is intentionally deferred — that's a product decision, not a missing primitive.
- Idempotent finalization that triggers settlement exactly once. Status: **done** — covered by Phase 3 work (auto-finalize, explicit finalize, resign all reuse `settleGame`); now also publishes `game.finalized` over realtime.
- Per-side identity enforcement so each player can only move on their own turn. Status: **done** — `403 not_your_turn` when the requester doesn't own the side to move. Real session/auth landed under mock #2; both REST and WS now authenticate via the `horsey_session` cookie. Game and settlement reads are also player-scoped; finalized games reject further move mutations.
- Spectator/read-only game stream. Status: **minimal slice done** — live games can be opened from the lobby's `Live now` feed and watched through the same board in read-only mode. Settlement and finalized game reads stay player-scoped.

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
- Admin/support views for users, games, ledger, escrow, settlements, reports, fair-play review. Status: **partial** — read-only first cut shipped under Bucket B #1 (`users.is_admin` + `/api/admin/*` + `#admin` page covering users / games / stuck-games / ledger / challenges / external-accounts). Reports inbox, in-app mutation/correction tooling, and richer fair-play review remain pending (mock #8).
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

### Phase 7 — Cashout Readiness Gate

Goal: decide if and how Horsey can let users cash out/redeem balances in specific jurisdictions.

**Phase 7 is cashout discovery first, code second.** Payments v1 already covers inbound chip purchases with no cashout. The Deploy Readiness Bucket § D names the discovery items that block redeemable-balance and payout work. Do not begin cashout code (KYC integration, payout integration, AML pipeline, redeemable balance rules) until Bucket D has named the jurisdiction(s), the custody model, the provider shortlist, and a written decision.

Deliverables (gated on Bucket D answers):
- Jurisdiction and legal/compliance review *complete*.
- Payout provider integrated.
- KYC/age verification approach implemented.
- AML/fraud/chargeback/sanctions plan implemented.
- Responsible-play controls.
- Terms, disclosures, rake/fee visibility, tax/reporting plan.
- Security review of wallet, escrow, settlement flows.
- Postgres swap (mock #1) lands here — concurrent-write safety, point-in-time recovery, and audit-grade backups become required, not optional.

Status: **pending** — cashout side of mock #9. Bucket D discovery has not started.

Key decisions (Bucket D):
- Launch geography.
- Whether Horsey is skill gaming, gambling, sweepstakes, or another regulated model in each target region.
- Custody model and provider responsibilities.

Exit criteria:
- A written go/no-go decision exists before any production cashout integration.

## Cross-Cutting Workstreams

Run alongside the phases, not after them:

- **Arena atmosphere.** Horsey's defining feel is **intentional casino energy** — high-stakes poker room / sportsbook / esports broadcast, *not* mobile-game candy-crush casino spam (see `PROJECT_SOUL.md` § Intentional casino energy and `docs/ARENA_NEXT_PASS.md`). The arena doc tracks named slots — animated buy-ins, settlement physicality, watcher counts, featured tables, streak heaters, match intros, momentum cues — grouped by play-loop phase with shipped/partial/pending status. Atmosphere is built across many small slices over time, not one redesign; treat the arena doc as a backlog feeding the phased plan, not a milestone of its own. Two systems feed atmosphere as peers, each with its own doc:
  - **Milestones (`docs/MILESTONES_NEXT_PASS.md`)** — the celebration-licensing system. First-time + recurring milestones (first win, upset, biggest pot, streaks, hot table), four intensity tiers (toast → broadcast), detection schema, dedup rules. Milestones are the only thing that licenses contained confetti / strong audio / banners; ordinary settlements stay grounded.
  - **Soundscape (`docs/SOUNDSCAPE_NEXT_PASS.md`)** — the audio layer. Three layers (core chess interaction, economic, lobby/social), tactile/material design principles (no cartoon sounds, no coin-shower), reduced-sensory setting, mixing hierarchy, WebAudio implementation notes. Foundation sound is now shipped with synthesized placeholders for chess moves, check, settlement, bankroll ticks, and strong game-start/game-end hooks; recorded sample sourcing and lobby/social cues remain next-pass polish.
- **Avatar identity and cosmetics.** *(v1 ripped 2026-05-25; MVP direction set 2026-05-26.)* Out: the v1 PNG-layered atomic renderer (composition canvas, anchors, slots, live-state derivation, ownership/equip schema). In: a curated catalog of full-image avatars that players select. Acquisition is two-rail — milestone unlocks (signals of experience) plus in-game-currency purchases (signals of taste); avatar choice is purely cosmetic, with no rating gate on equipping. Trust status lives in the **border**, rendered as one of four CSS treatments (`provisional` / `claimed` / `verified` / `established`) rather than authored art. Adornments (badges, auras, crowns) are deferred. Assets are at `apps/web/assets/avatars/` (1 base + 19 piece avatars: 3 knight, 4 each of bishop/king/queen/rook). Current render surface uses `renderAvatar()` with the equipped avatar image plus an initial-letter fallback and tier-class wrapper; `users.equipped_avatar` and `user_avatars` exist for the MVP selector. The v1 thinking is archived at `docs/archive/COSMETICS_FORMALIZATION.md`, `docs/archive/COSMETICS_NEXT_PASS.md`, `docs/archive/COSMETICS_INVENTORY_AUDIT.md`, and the v1 PNG assets at `scripts/reference/cosmetics-v1/assets/`. The principle that cosmetics must never impersonate trust survives.
- **Information architecture.** First pass landed: top nav is now Play · History · Profile, with a Resume-game pill that appears only when a live game exists, plus an Admin link that appears only for `is_admin` viewers. Wager/Game/Settlement keep their routes but are reached through the flow, not the chrome. Wallet folded into Profile. History list + detail (reusing the settlement renderer) shipped. Deferred destinations (Live spectator, Friends/Rivals) remain named slots. **See `IA_PROPOSAL.md` for the per-screen real-vs-mocked matrix; it stays live as mocks turn real.**
- **UI surfaces still showing seed/decorative data.** Distinct from the numbered subsystem mocks (#1–#9). Status after the IA pass:
  - Wager page opponent `country` / `reputation` / `verified` / `h2h` / `note` — **deleted from API and UI.** Will re-emerge with real backing under Phase 5 (rivalry/h2h) + trust subsystem (Phase 6).
  - Settlement `ratingDelta` — **now real.** Backed by an Elo module (`packages/shared/rating.mjs`, K=32, formula version 1) and a per-game `ratingChange` snapshot in `games.data_json`. Users' `rating` is updated inside the same transaction as `settleGame`. Per-time-control ratings and provisional/Glicko-style uncertainty are not in scope for this slice.
  - Settlement rematch button — **now a real action** (`POST /api/challenges` against prior opponent + stake + time control).
  - Game page eval / anti-cheat insights — the prior "Momentum" placeholder has been removed from the live rail; real eval/scouting remains deferred to trust/safety work.
  - Play page rivals list — not yet rendered (was always pending). Will arrive with Phase 5.
- **Dev ergonomics.** Phase 0 lint/format/typecheck are still partial. Biome lint/format scripts and a single `npm run verify` aggregate now exist. `docs/DEV_QA_WORKFLOW.md` now captures the manual multiplayer smoke loop and the desired lightweight tools: disposable scenario DBs, known dev accounts, a small scenario runner, and a tiny helper surface for session/game IDs. **Bustling mode (`npm run dev:bustling`)** spawns a bot daemon (`apps/api/dev-bots.mjs`) that populates Live now / Open Tables with bot-vs-bot games running canned Fool's Mate; gated on `HORSEY_ENABLE_DEV_BOTS=1` + non-prod, scoped to `/tmp/horsey-bustling.db`. Remaining low-cost work: optional `tsc --noEmit` for JSDoc/types and pre-commit wiring.
- **Testing.** Unit tests for domains plus focused API/session/realtime integration slices are in `tests/` (currently 74 passing). Broad E2E investment is **deferred** while we're in rapid-iteration mode — see Working Preferences. The exception now worth building is a narrow two-browser smoke harness for pair → checkmate → settlement, because that is the user's repeated manual QA path. Targeted tests for specific new domain logic are still welcome; what's deferred is a test-pyramid push.
- **Observability.** Logs, metrics, traces, audit events, error reporting.
- **Security.** Auth, authorization, input validation, rate limiting, secrets, abuse prevention.
- **Accessibility.** Keyboard board controls, focus states, color contrast, mobile ergonomics.
- **Performance.** Board responsiveness, realtime latency, clock accuracy, query health.
- **Documentation.** Update `PROJECT_SOUL`, architecture docs, ADRs, and this roadmap as product decisions change.

## Likely Next Steps

**Locked 2026-05-28 — doctrine-ordered path.** The MVP playable loop is functionally complete; Bucket A is code-side done. The five slices below are the operational floor `OPERATIONAL_POLICY.md` § 8 names as "Before first real-money users." Ordered as a single sequence — each slice unblocks the next:

1. **Pre-move abort + disconnect copy (Bucket B).** 15s first-move clock per side; if either player fails to move in their window the game aborts and both stakes return with no rake (policy § 1.10). Short user-facing copy explaining the rule. Repeat-offender warning hooks into slice 2's audit table, not this one. Status: **done** — `abortGameSettlement` in `packages/shared/domain.mjs`, `abortGame` + first-move scheduler in `apps/api/server.mjs`, `state='aborted'` terminal, "first move · 15s" pill on the player strip.
2. **Admin mutation + audit slice (Bucket B).** `admin_actions` audit table (actor / target / action / reason / before-after JSON), `user_restrictions` table, mutation endpoints for `void` / `adjust` / `restrict` / `clear_restriction` — void is the state, refund is its ledger consequence — and the full shadow-restriction ladder from `FAIR_PLAY_NEXT_PASS.md` § Enforcement Ladder shipped in one slice. Hard ban auto-voids any live game the banned user is in. Status: **done** — schema v14, shared settlement helpers, gated admin endpoints, Admin UI controls + Audit tab, and focused domain/API tests landed in `ba453ad`.
3. **Report-player path (Bucket B).** Reports table + intake endpoints + admin read surface. Slice 2 has to land first so the admin has somewhere to act *from*. Status: **pending**.
4. **Bucket C slice 2 — NOWPayments wire-up.** Real invoice creation + IPN webhook + idempotent chip credit. Only after the operational floor exists, because any complaint with real money attached needs slice 2's audit trail to resolve. Status: **pending** — slice 1 scaffold already shipped.
5. **FAIR_PLAY slice 1.** PGN storage + offline engine-analysis job + `game_analysis` / `move_analysis` schema + admin review queue. Admin-only; no Secure Play badge until ≥10 games / ~95% confidence per `FAIR_PLAY_NEXT_PASS.md` § Badge gating. Status: **pending**.

Notification center (durable rows + deep links + bell) is already shipped — commit `60e0b35`. It's no longer a "next step" but lives as a peer system that the slices above can publish into (e.g. abort → notification, settle → notification, restriction action → notification).

Everything else named-but-deferred — external error tracker, SQLite backup/restore, uptime monitoring, Open Tables tier filtering, Scout/Profile trust narration, Chess.com verification, Lichess OAuth, `placed` tier, per-tab clock throttling, WS reconnect replay, dropping the matchmaking poll, Phase 5 retention loops, the Postgres swap, rating blocks UX, presence-driven abandonment / claim-victory CTA — lives in **Backlog** above. Items move out of the backlog when their gating condition (external account, real tester traffic, real-money gate, etc.) is met.

**Bucket D (cashout discovery)** is a parallel non-code track. Gaming-attorney conversation, jurisdiction shortlist, custody-model decision, payout/KYC shortlist. Not actively sequenced; doesn't block any of slices 1–5 because Bucket C ships with a no-cashout wall.

Notable de-prioritization: more atmosphere / cosmetics cycles, broad E2E investment, and any cashout code work are intentionally below the items above. The first two don't gate deploy; cashout code is gated on Bucket D answers we don't have.

## First Build Milestone — Local Fake-Money Playable Loop

Scope:
- Real app scaffold. **Done.**
- Lobby with stake/time selection. **Done** — real open/incoming/sent challenges + quick-match form.
- Challenge or quick-match path. **Done** — `POST /api/challenges` for targeted/open challenges; `POST /api/matchmaking/quick` for stake+time pairing.
- Server-authoritative chess game. **Done.**
- Fake-money escrow and settlement. **Done** (decisive + draw + resign).
- Basic post-game settlement/rematch page. **Done** — settlement is real; rematch now issues a real `POST /api/challenges` against the prior opponent at the same stake + time control.

Out of scope for this milestone:
- Cashout / redeemable balances.
- Full anti-cheat.
- Production KYC/compliance.
- Native mobile app.
- Advanced engine evaluation unless a low-risk permissive dependency is chosen.

What stands between now and the milestone being complete:
1. Phase 2 is complete for the dev scaffold. Remaining named follow-ups are scoped product features (premoves, animation, replay polish, etc.), not generic gaps.

Safety note: the manual `POST /api/games/:id/finalize` endpoint is now explicitly dev-gated by `HORSEY_ENABLE_DEV_FINALIZE=1` and still requires the caller to be a player. Normal game completion should flow through moves, resignation, draw agreement, or timeout settlement.

Mocks #1 (persistence), #3 (realtime transport), #4 (challenge create + matchmaking), #5 (server clocks + timeout settlement), and #7 (full game-lifecycle endpoints minus presence-driven abandonment) have all landed. Mock #3 unlocked the rest of Phase 4 by giving every server-push consumer (clocks, draw offers, plus future presence / spectator stream / quick chat) a transport to plug into — see ADR 0004.
