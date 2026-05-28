# Rating Blocks Next Pass

Working note for the rating-blocks UX direction. The doctrinal "why" lives in `OPERATIONAL_POLICY.md` § 1.4 (Smurfing / Bum Hunting). This doc captures *how* a rating-blocks UI would land across the existing surfaces if and when we lock the direction.

Companion docs: `OPERATIONAL_POLICY.md` § 1.4, `SCOUTING_TRUST_NEXT_PASS.md` (scout card hierarchy), `USER_PROFILE_IA.md` (profile surfaces), `LOBBY_DESIGN_GAP.md` (open tables IA), `DESIGN_REVIEW.md` (canonical design).

## What's being proposed

The policy doc suggests hiding exact ratings behind class bands:

| Class | Range |
|---|---|
| Class D | 800–1000 |
| Class C | 1000–1200 |
| Class B | 1200–1400 |
| Class A | 1400–1600 |
| Expert | 1600–1800 |
| Master | 1800+ |

Example display: `Micha — Class A (1400–1600)`.

The product reason is bum-hunting reduction: exact ratings make it trivial to seek out the weakest viable opponent. Bands make it harder to optimize against without losing all rating signal.

## Surfaces this would touch

Today's UI shows the exact integer rating in many places. Each surface needs a decision: keep exact, show class, or show both.

- **Lobby / Open Tables** (`apps/web/src/app.js` `renderOpenTablesList` ~2820; `.open-row-rating` in styles). Drives the table-pick decision — strongest case for hiding exact.
- **Live Table module** (`renderLiveTableModule`; `.live-table-rating`). In-game opponent rating display.
- **Scout Card** (`renderScoutPopover` ~2312). Reveals more than the lobby — could show class while exact stays in admin/internal.
- **Player Profile** (`renderProfile` ~4176; `.user-profile`). Player's own page. Open question: do players see *their own* exact rating?
- **Player Strip** on game page (`playerStrip` ~3613; `.player-strip` markup includes `· {rating}` in the `<small>` next to the handle).
- **History** (`renderHistory`; opponent rating in each row).
- **Settlement** (rating delta reveal). If we hide exact ratings, do we still show ±N delta or just "+ rating gained"?
- **Admin** (read-only `.admin-table`). Internal — keeps exact, always.
- **Matchmaking + challenge create** (the wager form; tier-pref picker already exists as a related concept). Stake gating decisions ride on rating gaps.

## Product decisions (locked 2026-05-28)

- **Asymmetric reveal.** Player sees their own exact rating. Opponents are shown as class only. Class + range format: `Class A (1400–1600)`. No class-plus-exact-on-hover — that would just reintroduce the bum-hunting affordance.
- **Soft pairing gates only, in the early days.** The empty-bar problem is the binding concern — too few users online means strict band-gating produces an empty lobby. Default to wide tolerance. No hard wager-gate at v1. Soft warning ("you're betting two classes up") is fine; outright blocking is not.
- **Admin always sees exact**, everywhere.
- **The `ratingDisplay(user, { surface })` helper** is still the right abstraction — it just returns `"exact"` for self and admin surfaces, `"class"` for everywhere else. The helper makes the asymmetric rule a one-line policy decision instead of N scattered conditionals.

## Still open (deferred)

- **Stake-gap gating.** Should higher stake limits require tighter rating-band matching? Couples to trust-tier stake caps in `IMPLEMENTATION_PLAN.md`; resolve as one decision when both are active.
- **Reveal-after-match.** Should opponent rating be hidden during matchmaking and revealed only after settlement? Edge case; revisit if bum-hunting persists once class display is live.
- **Profitability anomaly tracking.** Independent of bands — should an absurdly profitable account get reviewed regardless of class? Folds into `FAIR_PLAY_NEXT_PASS.md`, not strictly a rating-blocks concern.

## Suggested order if we ship this

1. **Decide the open questions above** (no code yet). One reviewer / one writeup. Land it in this doc and policy § 1.4.
2. **Server-side**: keep exact internal rating on `users.rating` (already there). Add a derived `ratingClass` field exposed in API responses where the public surfaces consume it.
3. **One client helper**: `ratingDisplay(user, { surface })` returns either `"1450"`, `"Class A"`, or `"Class A (1400–1600)"` based on the surface's policy. Avoids scattering rules across surfaces.
4. **Sweep surfaces**: lobby → live-table → scout → profile → history → settlement. Ship in that order — strongest user-facing impact first.
5. **Matchmaking gate** (if open-question 3 says yes): wager form blocks/warns on cross-band picks. This is a real product change; might earn its own slice.
6. **Admin stays exact.** Always.

## Out of scope

- Provisional / uncertainty bands (e.g. "Class B?"). The trust-tier `calibrating` state already exists; revisit if rating uncertainty needs to surface as a separate visual concept.
- Glicko/Elo math changes. The bands are a display layer over whatever rating system we use.
- Tournament/leaderboard ranking. Those can show exact since they're competitive context, not matchmaking context.

## Status

**Direction locked, not started.** Self-exact / opponent-class is decided; soft pairing gates only. Implementation is still deferred — it's a multi-surface sweep and not on the critical path until either bum-hunting becomes a real complaint or we have enough liquidity that strict pairing isn't an onboarding tax.
