# Dev QA Workflow

This document captures the current manual multiplayer test loop and the lightweight dev tools that should replace repetitive setup over time. The goal is not a large internal control panel. It is a small, reliable set of workflows for testing a wagered multiplayer chess app without re-explaining the setup every session.

Companion docs: `README.md` for local startup, `IMPLEMENTATION_PLAN.md` for roadmap status, `IA_PROPOSAL.md` for surface status, and `SCOUTING_TRUST_NEXT_PASS.md` for trust/tier direction.

## Current manual smoke test

Use this when checking that the core local fake-money loop still works end to end.

### Setup

1. Start the app:

   ```bash
   npm run dev
   ```

2. Open `http://127.0.0.1:8787` in two isolated browser sessions so each has its own `horsey_session` cookie.

   Current habit:
   - Chrome = player A.
   - Edge = player B.

   Equivalent options:
   - Chrome regular + Chrome incognito.
   - Two Chrome profiles.
   - Two Edge profiles.

3. Sign up two fresh accounts.

4. Complete or skip onboarding for each account. New accounts receive the signup fake-money grant automatically.

### Pair a game

Either path is valid:

- Player A hosts a table from Play, then Player B clicks the open table and accepts.
- Both players join Quick Match with the same stake/time control.

Smoke-check while pairing:

- The challenge expiry timer is visible where the responding player can act.
- Stakes respect trust-tier caps.
- Accepting creates exactly one live game.
- Both players land on the game or can return via the Resume pill.
- Wallet escrow changes are visible in Profile.

### Play a quick checkmate

Because colors are randomized, first identify which browser is White.

Fast White checkmate script:

```text
1. e4      e5
2. Bc4     Nc6
3. Qh5     Nf6
4. Qxf7#
```

If the browser you are actively driving as the attacker is Black, either let the White-side browser execute the attacking moves or resign one side to smoke-test settlement without checkmate.

Smoke-check during play:

- Only the side to move can move.
- The other browser receives moves over WebSocket without refresh.
- Clocks tick locally and update after moves.
- Illegal moves are rejected and do not desync the board.
- Draw and resign controls are visible only to players, not spectators.

### Observe settlement

After checkmate, resignation, draw agreement, or timeout:

- Both tabs receive finalization without manual refresh.
- The game swaps to the settlement/replay surface.
- Wallet balance, escrow, credited amount, rake, last move, and rating delta are viewer-relative.
- Settlement audio plays once for the actual finalization, not again when opening Scout/Profile/History or switching tabs.
- Rematch creates a real challenge against the same opponent/stake/time.
- History contains the finalized game and replay.

### Useful alternate checks

- Open a third browser session and watch a live game from the Live now feed. Confirm spectator mode is read-only and watcher counts update.
- Test resignation from each side.
- Test draw offer, decline, offer again, and accept.
- Test challenge expiry by waiting out the 60-second window.
- Test trust-tier stake caps by using a provisional account and trying stakes above its cap.

## Current checks

Run these before committing meaningful changes:

```bash
npm run check
npm test
npm run lint
```

`npm run verify` runs the aggregate check/lint/test sequence. Lint currently reports one pre-existing warning in `tests/api-security.test.mjs` for an unused `carol` fixture.

## Lightweight dev tools worth building

These are normal quality-of-life tools for a multiplayer game in active product iteration. They should be dev-only, boring, and explicit.

### 1. Scenario runner

A CLI script creates a disposable SQLite DB, starts from known users, and runs common setup flows through the real API/domain paths.

Default QA setup:

```bash
npm run scenario:qa
npm run dev:qa
```

Then open `http://127.0.0.1:8787`. In QA mode, the login screen shows a `Dev accounts` picker under the normal login form; clicking a fixture account signs in with the known password.

All fixture accounts use password `password123`.

Known accounts in the default `trust-matrix` scenario:

| Handle | Purpose |
|---|---|
| `alice_provisional` | Fresh low-trust player, useful for provisional stake caps and calibration copy. |
| `bob_claimed` | Claimed external-account tier. |
| `vish_verified` | Verified external-account tier. |
| `mira_established` | Established tier with 50 finalized games. |
| `otto_regular` | Extra opponent used for generated history. |

Useful scenarios:

- `fresh-two-player`: two new accounts with known credentials and balances.
- `live-game`: two accounts already paired into a live game at a selected stake/time.
- `settled-checkmate`: one finalized decisive game with replay/history/wallet state.
- `draw-settlement`: finalized draw agreement.
- `timeout-settlement`: finalized timeout.
- `trust-matrix`: provisional, claimed, verified, and established users with enough supporting data to render each tier honestly.

Run a specific scenario:

```bash
npm run scenario -- settled-checkmate --db /tmp/horsey-qa.db
HORSEY_DB_PATH=/tmp/horsey-qa.db npm run dev
```

This should prefer generating realistic seed data over adding product backdoors. For example, established-tier users should be produced by inserting realistic finalized game history in a dev DB, not by adding a permanent "set tier" field to production code.

### 1b. Bustling mode (bot daemon)

For visual QA of populated lobby surfaces (Live now, Open Tables, recent activity) without needing live human opponents:

```bash
npm run dev:bustling
```

This sets `HORSEY_DB_PATH=/tmp/horsey-bustling.db` (a disposable DB separate from your main local store and from the QA fixtures), enables the dev account picker, and spawns the bot daemon. On first launch the daemon seeds five bot accounts (`bot_anna`, `bot_carlos`, `bot_demi`, `bot_evan`, `bot_finch`) with varied ratings; subsequent launches reuse them.

What the bots do:

- Maintain ~3 open challenges hosted by bots in Open Tables.
- Maintain ~2 concurrent bot-vs-bot live games visible in the Live now feed.
- Each new bot-vs-bot game gets a randomly weighted **outcome plan** so all four settlement reasons get exercised in QA, not just checkmate:
  - 50% **checkmate** — plays Fool's Mate (`1.f3 e5 2.g4 Qh4#`) to natural Qh4#.
  - 20% **resign** — plays 0–2 plies, then the bot on the clock resigns.
  - 20% **draw by agreement** — plays 0–2 plies, then finalizes as a draw (pot splits, 1¢ rounding to house).
  - 10% **timeout** — bots stop moving; the server's clock-timeout scheduler fires when the side-to-move flags.
- Each game's plan is logged at pair time so you can see what's coming: `[bots] paired game_xyz plan=resign atPly=3`.
- If a bot is forced off-script in a checkmate plan (e.g. a real user playing the bot diverges from the expected opener), the bot resigns rather than attempting real chess.
- Bots **auto-greet every non-bot user once** with a direct $1 / 1+0 challenge — your existing account on the first daemon tick after restart, and any newly signed-up account within the next tick (~2s). Greeted IDs are tracked in memory only, so a daemon restart re-greets everyone (intentional — easy way to retest the greeting flow during local QA).

The bots only post and accept *each other's* open challenges plus the one-off direct greeting per user. They don't enter the matchmaking queue — that surface stays untouched so you can test real matchmaking without bot interference.

Safety: the daemon refuses to start if `NODE_ENV=production`, so it can't accidentally run on Fly. Bot data is fully scoped to the bustling DB; wipe with `rm /tmp/horsey-bustling.db` and the next launch reseeds.

### 2. Known dev accounts

For local QA, keep a small set of predictable handles in a disposable DB:

- `alice_provisional`
- `bob_claimed`
- `vish_verified`
- `mira_established`

The purpose is visual and policy coverage: avatar borders, tier chips, stake caps, calibration labels, Scout Card copy, and Profile evidence. These users should live only in generated dev fixtures.

### 3. One-command clean local DB

A documented command or script should make it easy to run the app against a throwaway DB:

```bash
HORSEY_DB_PATH=/tmp/horsey-qa.db npm run dev
```

Shortcut:

```bash
npm run dev:qa
```

Follow-on: a script can delete and recreate that DB before launching, but it should be clearly named so no one mistakes it for a production-safe operation.

### 4. Tiny dev helper surface

If UI help is needed, keep it small and route-scoped. Good candidates:

- show current viewer id/handle/tier/session state;
- copy current game id;
- copy the current route hash;
- show latest WS state;
- show active challenge/game ids;
- quick links for `Play`, active `Game`, latest `History`;
- optional "copy test credentials" when a dev fixture DB is loaded.

Avoid a general-purpose admin/dev panel until Phase 6 admin work starts. Anything that mutates money, trust, or game results belongs in explicit dev scripts or a gated admin tool, not hidden in product UI.

### 5. Focused browser automation

Broad E2E investment is still deferred while the UI is moving, but one or two smoke scripts are now justified because the manual two-browser loop is repetitive.

Good first automation target:

- Launch two isolated browser contexts.
- Sign up or log in known fixture users.
- Pair a game.
- Play the checkmate script.
- Assert both tabs see finalized settlement and History contains the game.

This should be treated as a smoke harness, not a full test pyramid.

## Likely next app steps

Based on the current roadmap and the friction in this workflow, the highest-leverage next steps are:

1. **Build the scenario runner / dev fixtures.** This directly removes the need to grind new accounts through many games just to inspect trust banners, avatar borders, calibration labels, and established-tier surfaces.
2. **Add a tiny multiplayer smoke automation.** Keep it narrow: two sessions, pair, checkmate, settlement. This protects the core loop without freezing fast UI iteration.
3. **Finish trust-tier visibility where it matters.** Tier borders and compact pips are now present on many identity surfaces; Scout Card and Profile should make the tier/evidence relationship clearer without inventing fake trust data.
4. **Add Open Tables tier filtering.** The Quick Match tier floor exists; the Open Tables rail still needs the equivalent filter when there are enough tables to justify it.
5. **Continue Phase 5 retention loops.** Rivalry threads, richer History/Profile stats, and rematch loops are the next product layer after the local playable loop.
6. **Start Phase 6 admin in small slices.** The first admin slice should inspect users, games, ledger, settlements, external account claims, and stuck states. Manual correction should append compensating ledger entries, never edit balances in place.
