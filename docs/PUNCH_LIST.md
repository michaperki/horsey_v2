# Punch List

Living backlog of fixes, polish, and small enhancements discovered during a full codebase + docs review on 2026-05-22. Items here are smaller than a roadmap phase but bigger than a one-line comment. When something ships, check it off and link the commit when available; when something turns into a real workstream, promote it to `IMPLEMENTATION_PLAN.md`.

This is intentionally scoped to *visible* product issues and immediate code hygiene. Subsystem mocks (#1–#9) and phased work live in `IMPLEMENTATION_PLAN.md`; durable preferences live in `PROJECT_SOUL.md`; per-screen real-vs-mocked status lives in `IA_PROPOSAL.md`.

## Dashboard / Play

- [ ] **Auto-clean contradictory matchmaking state on game start.** When a game is created (from a matchmaking pair OR a challenge accept), the viewer's open queue ticket should be auto-removed and any pending open invites they hold should be auto-withdrawn. Companion: `POST /api/matchmaking/quick`, `POST /api/challenges`, and challenge-accept should reject with a clean error code when the viewer already has a live game. Lets the dashboard keep the matchmaking surfaces fully enabled while the server stays the source of truth. See `docs/LOBBY_DESIGN_GAP.md` Wave 2.5 for the UI side of this.
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
- [x] **`game.finalized` auto-navigates to settlement from any route** (`handleRealtimeMessage`). Realtime settlement still refreshes state, but only auto-navigates when the viewer is on the game page.

## Settlement / History

- [x] **`endReason` is rendered raw** in history rows ("checkmate", "resignation", "timeout", "agreement"). Added friendly labels.
- [x] **History list has no filters/grouping.** Added Wins / Losses / Draws result counts without aggregate net-loss money.

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
