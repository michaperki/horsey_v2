# Mobile next pass

Research + scope note for Horsey's mobile pass. The app has a viewport meta tag and a few media queries, but the layout is desktop-first; almost every action surface assumes a hover-capable pointer and a topbar wide enough to hold seven action chips. This doc is the working scope for the pass.

Companion docs: `PROJECT_SOUL.md` (intentional casino energy — sportsbook / poker, not mobile-game candy-crush), `IMPLEMENTATION_PLAN.md` § Working Principles ("Mobile pass comes before the next product expansion"), `DESIGN_REVIEW.md` (canonical design source), `SCOUTING_TRUST_NEXT_PASS.md` (scout card hierarchy, which the mobile sheet inherits).

## Current state

- `<meta name="viewport" content="width=device-width, initial-scale=1">` is present.
- Three content media queries across ~3,900 lines of CSS: `≤720px` (profile-quick-grid only), `≤920px` (topbar collapse, single-column grids, history-row stack), `≤640px` (replay body). Everything else assumes desktop.
- Board input is HTML5 drag-and-drop (`app.js:5429`). Tap-to-select-then-tap-target is wired as a fallback, so basic moves work on touch, but **HTML5 DnD does not fire on iOS Safari** — drag-to-move is desktop-only today.
- Topbar at `≤920px` becomes `flex-direction: column`; `topbar-actions` (connection pill, sound toggle, bell, resume pill, wallet pill, cashier `+`, "signed in as / log out") wraps to multiple rows and eats 100–150px of vertical space before main content shows.
- Small action buttons (`.bell` 4×8 padding, `.sound-toggle` 36×36, `.cashier-btn` 36×36, `.replay-nav-button`, `.live-table-resign`) are below the 44×44 touch-target floor.
- `.bell-dropdown` uses `min-width: 320px; right: 0` — overflows the viewport on iPhone SE and when the bell anchor lands on the left of a wrapped topbar row.
- `.scout-popover` is anchored from `scoutAnchorFor()` in `app.js:779` with a hard `width: 340` constant. Overflows on 320-wide screens.
- `100vh` / `70vh` / `86vh` / `54vh` are used in auth shell, bell dropdown, ToS modal, cashier modal, and the moves list — none use `dvh`, so iOS Safari clips when the URL bar collapses.
- No `env(safe-area-inset-*)` anywhere. Notch + home-indicator devices don't get padding.
- Admin tables (`.admin-table`) use `white-space: nowrap` with no horizontal scroll wrapper.

## Direction

The mobile shape should read like a **sportsbook app on a phone** — bottom tab bar, compact dark chrome, big tap targets, drag-to-move on the board, bottom sheets for transient surfaces. Casino energy, not candy-crush. Same product, sized for thumbs.

### Decisions (locked)

- **Breakpoint at `≤720px`** for the mobile layout swap. The existing 720px media query is already the only sub-920 cutoff; aligning on it avoids three width regimes to reason about.
- **Bottom tab bar is mobile-only.** Desktop (`≥721px`) keeps the topbar nav exactly as today. Tab bar appears under the breakpoint, fixed to the bottom, `padding-bottom: env(safe-area-inset-bottom)`.
- **Unified pointer events on the board.** Replace HTML5 DnD with `pointerdown` / `pointermove` / `pointerup` so mouse and touch share one code path. Click intent (tap-select then tap-target) and keyboard navigation are preserved.

### Shape

**Compact topbar at `≤720px`** — brand · bell · wallet · cashier `+`. Connection pill, sound toggle, "signed in as / log out" move into Profile (which already owns wallet detail).

**Bottom tab bar at `≤720px`** — Play / History / Profile, with Admin appended when `viewer.isAdmin`. Dark felt background, gold active pip, tabular-nums on counts. Fixed to bottom; main content gets `padding-bottom` equal to tab-bar height + safe-area inset.

**Sheet primitive** — one `.sheet` component that renders as a bottom-sheet on `pointer: coarse` and a popover on `pointer: fine`. Bell dropdown, scout card, and cashier modal route through it.

**Touch-drag board** — pointer-events implementation lifts the piece ~40px above the finger so the source square is never obscured. Highlights legal targets like today's `.drop-ready`. Cancel on `pointerup` outside a legal target. No regression to click or keyboard paths.

**`dvh` + safe-areas** — swap viewport-height units on auth shell, bell dropdown, cashier/ToS/onboarding modals, and the moves list. Topbar gets `padding-top: env(safe-area-inset-top)`; tab bar gets `padding-bottom: env(safe-area-inset-bottom)`.

**`≤480px` sweep** — history-stats stack (currently 3-up), live-table-meta wrap, admin-table inside a horizontal scroll wrapper, promotion dialog spacing at 320px, milestone-stack `top` offset (collides with a wrapped mobile topbar today).

**Touch-target sweep under `@media (pointer: coarse)`** — bumps `.bell`, `.sound-toggle`, `.cashier-btn`, `.replay-nav-button`, `.live-table-resign`, `.inline-dismiss` to 44×44 minimum.

**Polish kept in this pass** — replace hover-only affordances (`.open-table-row:hover` arrow nudge, `.chip-pick:hover` stack fan) with `:active` equivalents on coarse pointers; landscape board gets `max-height` so it doesn't exceed viewport minus controls; scout anchor clamps width to `min(340, 100vw - 24)`.

## Out of scope

- Native iOS / Android app. Web-only.
- PWA install prompt / standalone manifest. Tracked separately.
- Landscape-optimized desktop layouts. The pass keeps desktop behavior identical above 720px.
- Test scaffolding. Mobile pass follows the rapid-iteration mode posture (`IMPLEMENTATION_PLAN.md` § Working Principles).

## Order of operations

1. This doc (anchors scope).
2. Compact topbar + bottom tab bar + `dvh` + safe-areas. Most visible win; touches `app.js` shell and styles.
3. Sheet primitive. Routes bell / scout / cashier through it.
4. Touch-drag board. Self-contained change to `app.js` square handlers.
5. `≤480px` sweep + `(pointer: coarse)` target sweep.
6. Polish (hover→active, landscape, scout clamp, keyboard-open verification).

## Follow-ups landed after the first walkthrough

Lessons from the first user inspection pass. Each is in the shipped code; listed here so the doc stays the durable record.

- **Cascade order matters for sheet variants.** The original mobile `.bell-dropdown` overrides were defined earlier in the file than the desktop defaults, so the desktop `position: absolute; top: calc(100% + 6px); right: 0` rules won and squeezed the dropdown into a single-line strip under the bell. The bottom-sheet `.bell-dropdown` / `.scout-popover` / `.cashier-modal` rules now live in a "Mobile sheet variants (cascade-late)" block at the end of `styles.css` so they always come after the defaults.
- **`backdrop-filter: blur()` creates a containing block for `position: fixed` descendants.** Per the Filter Effects spec. The blur on `.topbar` made the bell dropdown's `bottom: 0` anchor to the topbar (~56px tall) rather than the viewport. Drop the blur on mobile (`backdrop-filter: none`, solid `var(--paper)` bg) at ≤720px.
- **Flex children need explicit `min-width: 0` to honor `text-overflow: ellipsis`.** `.player-main strong` had `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` but no `min-width: 0`, so the default `min-width: auto` (= min-content = the full handle width) refused to shrink and pushed the clock-box off the right edge. Same lesson applies wherever a flex child wants to truncate.
- **Hide redundant text where dots already convey state.** The `<small>` line in the player strip duplicated the presence-dot's "offline / last seen X" info inline. Wrapped that text in a `.player-offline-label` span and hid it under `≤720px`. The presence-dot remains.
- **Hero head row must wrap on mobile.** `.hero-state-head-row` was `flex` no-wrap with `flex-shrink: 0` on the identity badge. Long h1 + identity badge exceeded the felt's content width and created horizontal scroll. Added `flex-wrap: wrap` and `min-width: 0` on children; clamped `.hero h1` / `.match-card h2` to `clamp(32px, 9vw, 48px)` on mobile.
- **Defensive overflow trapping.** `html { overflow-x: clip }` + `main { overflow-x: clip }` at ≤720px catches any future rogue child without breaking `position: sticky` (which `overflow-x: hidden` on `body` would).
- **`isolation: isolate` on the board contains piece z-index.** Pieces are `z-index: 10`; the topbar was `z-index: 5`. On mobile scroll, sticky topbar overlap meant pieces near the top rank punched through. Added `isolation: isolate` to `.board` so piece z-index is scoped to the board's stacking context, and bumped `.topbar` to `z-index: 15` for belt-and-suspenders.
- **Pot felt replaces Settlement felt on game-end.** Game page used to stack two green felts (`The pot` + `Settlement`) after finalization. The settlement panel carries the credited/lost amount and rating delta — there's no remaining need for the live pot panel. Conditional render: pot felt only when `game.state !== "finalized"`.

## Files in scope

- `apps/web/src/app.js` — shell (`~1757`), navLink, scout anchor (`~779`), board square handlers (`~5422`), bell render (`~1884`).
- `apps/web/src/styles.css` — topbar (`~53`), nav (`~86`), board (`~2068`), bell-dropdown (`~3706`), scout-popover (`~1498`), cashier-modal (`~3387`), admin-table (`~3660`), history-stats (`~2985`), `@media` blocks at `1467`, `3181`, `3324`.

## Links

- `IMPLEMENTATION_PLAN.md` § Working Principles, § Where We Are Right Now.
- `PROJECT_SOUL.md` § Intentional casino energy.
- `DESIGN_REVIEW.md` — surface intent.
