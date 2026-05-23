# Lobby (Play screen) design gap

Findings from a 2026-05-23 walkthrough of the current `renderPlay()` (`apps/web/src/app.js`) against the canonical designs in `hifi-lobby.jsx` and `lobby.jsx`. The current implementation is functional but has drifted far enough from the intended visual language that the screen no longer reads as "a poker room with chess inside." This doc tracks the deltas so we can chip away at them.

Companion docs: `docs/DESIGN_REVIEW.md` (canonical source treatment), `docs/PUNCH_LIST.md` (smaller polish items), `docs/IMPLEMENTATION_PLAN.md` (phased roadmap).

## Items

- [x] **Stake + time controls are `<select>` dropdowns, not chips and pills.** ~~`app.js:994-1002` and `1029-1036`.~~ Hi-fi (`hifi-lobby.jsx:82-115`) and wireframe (`lobby.jsx:217-229`) both call for: stake = a horizontal row of clickable poker chips, time = pill buttons with a lowercase category label (`bullet / blitz / rapid`). Both the Quick match and Open invite forms now use chip + pill pickers backed by `state.picker.{quick,invite}` and hidden inputs. **Stakes use real-poker denomination stacks** (denoms 1/5/25/100/500 with white/red/green/black/purple coloring); `stakeChipStack(cents)` greedy-decomposes each stake into denom chips so `$50 = [25, 25]`, `$250 = [100, 100, 25, 25]`, `$1K = [500, 500]`, and the stack tells the magnitude story at a glance (more chips and/or hotter color = bigger stake). **Chips carry no inner text** — they read as casino tokens (color + dashed border + inner ring); the precise amount lives in the `$25 / $50 / $1K` label below the stack, which turns gold on the active chip. Active state also draws a gold ring around the topmost chip in the stack.

- [ ] **No Live Floor right column.** Design's right rail (`hifi-lobby.jsx:LiveFloor`) is a column of: heartbeat (`1,204 online · 412 in active games`), Hot Upset card, Live Games feed with watch / join buttons, and Rivals list with online status. Current right rail is `Incoming / Open tables / Open an invite` — entirely functional, no liveness. The room reads as empty.

- [ ] **No Open Tables card grid.** Design (`hifi-lobby.jsx:OpenTables`) shows a 6-up grid of opponent cards: avatar + flag + ELO + stake chip + time pill + style tag + sparkline + RIVAL ribbon + `Sit · $50` CTA. Current renders each open challenge as a one-line `challengeRow` inside an aside.

- [ ] **No "Pot if you win" summary beside the CTA.** Design pairs the gold CTA with a panel showing `+$48` and `5% rake · escrowed`. Current copy only says "Both sides escrow before the first move." — the player can't see what they're playing for without doing arithmetic.

- [ ] **No "Pick up where you left off" rematch strip.** Design (`hifi-lobby.jsx:138-155`) shows the last 4 opponents with avatar + P/L delta + stake (`↺ Vish +$225 · $250`). Currently no rematch surface on Play.

- [ ] **CTA styling.** Design CTA is XL with `animation: ho-glow 3s ease-in-out infinite` and right arrow (`hifi-lobby.jsx:120-123`). Current is a stock `.primary` button labeled "Join quick match" — no glow, no arrow, no scale.

- [ ] **Hero voice.** Design hero copy is "Pick a chip. Sit down." (52px hand). Current is "Pick a stake. Find a game." The "chip" vocabulary is the poker-room voice; "stake" alone loses it.

- [ ] **No filter chips above tables** (`all / bullet / blitz / rapid / $100+ / rivals`).

- [ ] **No "You're playing as" identity badge** inside the hero (avatar + handle + rating in the felt card's top-right).

- [ ] **TopNav visual weight.** Design top bar (`hifi-app.jsx`) is avatar + wallet pill, clean and quiet. Current adds connection pill + inline `signed in as <handle>` + `Log out` link — functionally useful, visually busier than designed. Possibly fold the logout/identity into a profile-avatar menu later.

## How to use

- Tackle items in order of visible impact, not file order.
- When a fix lands, check the box and link the commit in the body of the item.
- When an item turns into a multi-screen workstream (e.g. Live Floor likely pulls in realtime presence), promote it to `IMPLEMENTATION_PLAN.md` and leave a one-line pointer here.
