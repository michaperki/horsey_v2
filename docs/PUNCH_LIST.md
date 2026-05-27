# Punch List

Living backlog of fixes, polish, and small enhancements discovered during a full codebase + docs review on 2026-05-22. Items here are smaller than a roadmap phase but bigger than a one-line comment. When something ships, check it off and link the commit when available; when something turns into a real workstream, promote it to `IMPLEMENTATION_PLAN.md`.

This is intentionally scoped to *visible* product issues and immediate code hygiene. Subsystem mocks (#1–#9) and phased work live in `IMPLEMENTATION_PLAN.md`; durable preferences live in `PROJECT_SOUL.md`; per-screen real-vs-mocked status lives in `IA_PROPOSAL.md`.

## Dashboard / Play

- [x] **Auto-clean contradictory matchmaking state on game start.** When a game is created (from a matchmaking pair OR a challenge accept), both players' open queue tickets are removed and their other pending hosted invites are auto-withdrawn. `POST /api/matchmaking/quick`, `POST /api/challenges`, and challenge-accept now reject with `has_live_game` when the viewer already has a live game. Lets the dashboard keep the matchmaking surfaces fully enabled while the server stays the source of truth. See `docs/LOBBY_DESIGN_GAP.md` Wave 2.5 for the UI side of this.
- [x] **Live game doesn't surface on `/play`.** The header Resume pill was the only entry back to a game in progress. Added a "Live game" banner on the Play page that links to the board, and guarded both banner + shell pill so finalized games cannot linger as resumable. (`app.js:renderPlay`)
- [x] **Your own open invite doesn't show in "Open tables".** Open tables now includes your own open invite with a "yours" marker while still listing it under sent for withdrawal.
- [x] **No way to cancel a sent open invite.** Added a challenger-only `DELETE /api/challenges/:id` route and a Wager-screen "Withdraw invite" action for pending sent invites.
- [x] **Sent/incoming rows show no time-remaining hint.** Play rows now include a live seconds-left / expired hint beside the challenge state.

## Wager screen

- [x] **Auto-decline timer is fake.** The wager screen now counts down from `updatedAt + expiresInSeconds` and disables challenge actions once the client-side timer reaches zero.

## In-game polish

- [x] **`window.confirm` for resign** (`resignGame`) breaks the design language. Replaced with an in-app confirmation dialog.
- [x] **Promotion dialog has no Escape-to-cancel.** Global Escape handling now cancels an open promotion choice.
- [x] **Move history isn't numbered.** Move rows now include an explicit move number column.
- [x] **`gameError` persists in the turn strip with no dismissal.** Added an inline dismiss action in the turn strip.
- [x] **Buttons don't disable during in-flight requests.** Accept / Resign / Offer draw / Join quick match now disable while their POST is in flight.

## Realtime / connection

- [x] **"Reconnecting" pill is only rendered on the game page.** The shell now shows the realtime live/reconnecting/offline pill across Play / History / Profile.
- [x] **`game.finalized` auto-navigates to settlement from any route** (`handleRealtimeMessage`). Realtime settlement now refreshes game, wallet, settlement, and replay state in place; the game page stays on the board and swaps the right rail to settlement.
- [x] **Onboarding modal couldn't accept input** with bots active. `manageChallengeCountdown`'s 1Hz `setInterval(() => render(), 1000)` was blowing away the entire DOM each tick, including focused inputs. Replaced with targeted text + class updates on `[data-expiry-base]` / `[data-row-time-hint]` / `[data-ticket-elapsed]` nodes — no `render()` calls per tick.
- [x] **`challenge.*` realtime events triggered full re-renders on every route.** Now route-guarded: only Play (via targeted `updatePlayChallengeRailsDom`) and Wager re-render. Profile / Game / History keep their DOM intact, so modals + focused inputs survive.
- [x] **Open Tables / Live now rails rebuilt their innerHTML on every tick.** Both `updateLiveGamesFeedDom` and `updatePlayChallengeRailsDom` now cache the last rendered HTML on the container's dataset and skip the swap when nothing changed. Click targets stay stable under the cursor.
- [x] **Sidebar bouncing when Live now grew/shrank pushed click targets around.** Live now / Incoming / Open tables card bodies now have `max-height` + `overflow-y: auto` (Live now also has a `min-height` to prevent empty-state collapse). Rails stay anchored as games rotate.

## In-game polish (continued)

- [x] **Post-finalize `#game` showed both a static end-state board AND the replay panel.** Two boards on one page, redundant. The board column now swaps to the replay board in place when finalized, the move history becomes click-to-jump, and the turn-strip is replaced with inline replay nav (⏮ ◀ <san> ▶ ⏭). Capture trays drop in replay mode (they'd be stale at scrubbed plies). `renderSettlement` (the `#history/:gameId` route) is unchanged.
- [x] **Live-feed name overflow.** Two long bot handles + "vs" + ratings used to wrap onto a second line. `.live-feed-players` now `flex-wrap: nowrap` with `min-width: 0`; each scout wrapper truncates with ellipsis via `flex: 1 1 0; overflow: hidden`; `vs` and rating chip stay intact with `flex-shrink: 0`.

## Settlement / History

- [x] **`endReason` is rendered raw** in history rows ("checkmate", "resignation", "timeout", "agreement"). Added friendly labels.
- [x] **History list has no filters/grouping.** Added Wins / Losses / Draws result counts without aggregate net-loss money.
- [ ] **Spectator settlement shows "Loading…" indefinitely.** When a watched game finalizes, the spectator's right rail says "Table settled · Loading pot settlement…" forever — because `state.activeSettlement` only fills from `/api/games/:id/settlement`, which is player-scoped. The game record itself already carries everything a spectator should see: winner handle, end reason, pot, players + ratings, move count. The fix is a spectator-flavored panel rendered from `game` directly (no settlement fetch) — third-person headline like "alice won by checkmate", end-reason chip, pot stake, optional rating deltas if `game.ratingChange` is populated, and a CTA back to Play. Privacy guardrail per `project_no_loss_advertising`: winner-centric or neutral copy only, no "Y lost $X" framing. (`app.js:finalizedGameSettlementPanel`)

## Profile

- [x] **Ledger entries show no timestamp or running balance.** Profile ledger rows now show timestamps plus running available/escrow balances.
- [x] **No account settings.** Profile now exposes email change, password change, and log-out-other-sessions actions.

## Auth / hardening

- [x] **Signup vs login error messages allow account enumeration.** Signup email/handle conflicts now use generic copy.
- [x] **No rate limiting** on signup / login / challenges / matchmaking. Added conservative in-memory per-client limits for auth, challenge creation, and quick matchmaking.

## Docs

- [x] **`AGENTS.md` is stale.** Refreshed the working path and git repository status.
- [x] **README "Useful checks"** lists `npm test / npm run lint / npm run verify` but doesn't mention `npm run check` or `npm run format`. Added both commands.

---

## In flight (this session)

- [x] Live-game card on Play dashboard
- [x] Cancel a sent open invite (DELETE endpoint + Withdraw button)
- [x] Replace `window.confirm` resign
- [x] Live auto-decline countdown on Wager
- [x] Refresh `AGENTS.md` stale facts

## Completed this session

- Play dashboard live-game banner.
- Stale Resume-game cleanup after realtime finalization.
- Sent invite withdrawal via API and Wager UI.
- Wager challenge countdown from challenge timestamps.
- Promotion Escape-to-cancel.
- Numbered move history.
- Route-aware `game.finalized` realtime behavior.
- Friendly history end-reason labels.
- Environment and useful-check docs refresh.
- In-app resign confirmation dialog.
- Challenge row time-remaining hints.
- In-flight disabling for accept, resign, draw, and quick-match actions.
- Global realtime connection pill in the shell.
- History Wins / Losses / Draws counts.
- Own open invite marker in Open tables.
- Dismissible game errors.
- Ledger timestamps and running balances.
- Profile account settings.
- Generic signup conflict messaging and basic rate limiting.
