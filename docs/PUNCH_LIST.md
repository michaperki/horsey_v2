# Punch List

Living backlog of fixes, polish, and small enhancements discovered during a full codebase + docs review on 2026-05-22. Items here are smaller than a roadmap phase but bigger than a one-line comment. When something ships, check it off and link the commit when available; when something turns into a real workstream, promote it to `IMPLEMENTATION_PLAN.md`.

This is intentionally scoped to *visible* product issues and immediate code hygiene. Subsystem mocks (#1–#9) and phased work live in `IMPLEMENTATION_PLAN.md`; durable preferences live in `PROJECT_SOUL.md`; per-screen real-vs-mocked status lives in `IA_PROPOSAL.md`.

## Dashboard / Play

- [x] **Live game doesn't surface on `/play`.** The header Resume pill was the only entry back to a game in progress. Added a "Live game" banner on the Play page that links to the board, and guarded both banner + shell pill so finalized games cannot linger as resumable. (`app.js:renderPlay`)
- [ ] **Your own open invite doesn't show in "Open tables".** Filtered out in `renderPlay` (`c.challengerId !== me`). It only appears under "Your sent". Decide on one canonical home, or show in both with a "yours" tag.
- [x] **No way to cancel a sent open invite.** Added a challenger-only `DELETE /api/challenges/:id` route and a Wager-screen "Withdraw invite" action for pending sent invites.
- [x] **Sent/incoming rows show no time-remaining hint.** Play rows now include a live seconds-left / expired hint beside the challenge state.

## Wager screen

- [x] **Auto-decline timer is fake.** The wager screen now counts down from `updatedAt + expiresInSeconds` and disables challenge actions once the client-side timer reaches zero.

## In-game polish

- [x] **`window.confirm` for resign** (`resignGame`) breaks the design language. Replaced with an in-app confirmation dialog.
- [x] **Promotion dialog has no Escape-to-cancel.** Global Escape handling now cancels an open promotion choice.
- [x] **Move history isn't numbered.** Move rows now include an explicit move number column.
- [ ] **`gameError` persists in the turn strip with no dismissal.** Only clears when the next action fires.
- [x] **Buttons don't disable during in-flight requests.** Accept / Resign / Offer draw / Join quick match now disable while their POST is in flight.

## Realtime / connection

- [x] **"Reconnecting" pill is only rendered on the game page.** The shell now shows the realtime live/reconnecting/offline pill across Play / History / Profile.
- [x] **`game.finalized` auto-navigates to settlement from any route** (`handleRealtimeMessage`). Realtime settlement still refreshes state, but only auto-navigates when the viewer is on the game page.

## Settlement / History

- [x] **`endReason` is rendered raw** in history rows ("checkmate", "resignation", "timeout", "agreement"). Added friendly labels.
- [x] **History list has no filters/grouping.** Added Wins / Losses / Draws result counts without aggregate net-loss money.

## Profile

- [ ] **Ledger entries show no timestamp or running balance.** Each row is `type · delta · note` only.
- [ ] **No account settings.** Password change, email change, log out from other sessions — named in IMPLEMENTATION_PLAN mock #2 but no entry surface yet.

## Auth / hardening

- [ ] **Signup vs login error messages allow account enumeration.** "email already registered" vs "invalid email or password". Tighten messaging at the signup surface (or accept it as a known dev-mode trade-off and document).
- [ ] **No rate limiting** on signup / login / challenges / matchmaking. Already named in mocks #2 / #4 — keeping it visible.

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
