# Information Architecture Proposal

**Status:** accepted and implemented (initial pass). Continues to serve as the living per-screen real-vs-mocked matrix; promote portions to an ADR if any later decisions need durable rationale.

Decisions taken at acceptance:
- Wallet folds into Profile (canonical pattern; topbar pill remains as everywhere-access).
- "History" is the label; live games stay under Play.
- No landing/marketing page yet — auth gate is the entry point.
- Settlement URL `#settlement` is preserved as a synonym for the History detail view (`#history/:gameId`); both render the same component.

This doc inventories every screen's real-vs-mocked surfaces and proposes a near-term information architecture for Horsey. It exists because the prior top nav (`LOBBY · WAGER · GAME · SETTLEMENT · WALLET`) treated flow stops as destinations — a debug-era affordance that had hardened into product. We fixed it before sinking more UI polish into the same surfaces.

## Context: where today's nav came from

- **Canonical hi-fi design** (`hifi-system.jsx:160-166`) defined the production top nav as: **Play · Live · Friends · History**, with a wallet pill + deposit CTA + avatar in the utility row. Mobile (`hifi-system.jsx:210-217`): **Play · Live · [+ Find] · Friends · Me**.
- **Wireframe doc shell** (`app.jsx:1, 22-25`) defined a *documentation* tab nav: Lobby · Wager · In-Game · Post-Game · Profile. This was the navigation between the design wireframes themselves, not the product nav.
- **Current implementation** (`apps/web/src/app.js:529-535`) inherited the wireframe doc nav, then added conditional `Wager`/`Game`/`Settlement` links so a developer could hop back into in-flight state. That conditional behavior is the smell: nav items that come and go based on transient app state are flow scaffolding, not destinations.

## Proposed near-term nav

Adopt a subset of the canonical hi-fi nav — only what we have real screens for today:

```
[♞ Horsey]   Play   History   Profile          [● Resume game]   [$1,000.00 ▾]   [SP ▾]
```

Three primary destinations now, with named slots ready for canonical destinations as they earn their place.

| Destination | What lives here today | Future additions |
|---|---|---|
| **Play** | Quick-match form, open invites, incoming/sent challenges, create-invite form, matchmaking ticket status, "resume your live game" card when applicable | Rivals shortlist, recent rematch card, live floor preview |
| **History** | Past games + their settlement detail (the existing settlement screen, repurposed as a history entry view) | Replay/review view, head-to-head pages, rating timeline |
| **Profile** | Viewer's handle, rating, ledger + balance + escrow detail (current Wallet content folds in here), account/logout | Stats, trust profile, identity verification surface, social settings |

**Topbar utilities** (right side):
- **Resume game pill** — only appears when a live game exists; one click returns to the board. Replaces the conditional `Game` nav link with something that's clearly an *action*, not a destination.
- **Wallet pill** — current `$balance | $escrow` chip; click opens Profile → Wallet section. Near-term: also exposes Buy Chips once Payments v1 lands. Cashout remains deferred to Phase 7.
- **Avatar / handle** — logout, settings; eventually links to Profile.

**Flow-stop screens (Wager / Game / Settlement) leave the nav entirely:**
- **Wager screen** — reached by clicking a challenge row in Play. Lives at `#play/challenge/:id` (or keep `#wager`, no nav link). Back button returns to Play.
- **Game screen** — reached via the Resume-game pill, or auto-navigated on challenge accept / matchmaking pair. Always has a back-to-Play affordance.
- **Settlement screen** — auto-shown immediately after a game finalizes (existing behavior), then becomes the History detail view for that game. Same component, two entry points.

### Later canonical destinations (named, not built)

We intentionally name these so they have a slot reserved, not so they ship now:

- **Live** (canonical) — a dedicated spectator floor. The first minimal slice now exists inside Play via the `Live now` feed's `Watch` button and read-only `#game/:id`; a full Live destination can land once there is enough density to warrant its own nav.
- **Friends / Rivals** (canonical) — relationship features. Add with Phase 5 rivalry/head-to-head work.
- **Admin** — Phase 6.

### Layered user identity (accepted; in flight)

Identity isn't a single page. The proposed model is a stack of surfaces sized to the moment: inline → compact Scout Card (popover) → full Player Profile at `#user/:id` → Wager-screen dossier → in-game tells rail → Trust & Safety panel. The API foundations, compact Scout Card, and initial `#user/:id` profile route are in place; wager-screen dossier enrichment and Phase-6 trust/tells remain deferred. See `docs/USER_PROFILE_IA.md` for the full plan, API additions (`GET /api/users/:id`, `GET /api/users/:id/recent-games`), per-surface trigger plan, privacy/loss-advertising guardrails, and the buildable-now vs Phase-6-deferred split.

## Per-screen real-vs-mocked matrix

Legend: ✅ real · ⚠️ mocked (looks real, isn't) · 🚫 absent (canonical but not built) · 🧪 stub (button/link exists, action doesn't)

### Play (current `lobby`)

Play-screen internal IA (hero state machine, shared picker for Find vs Host, right-rail liveness) is tracked in `docs/LOBBY_DESIGN_GAP.md`. This matrix stays focused on real-vs-mocked surface status.

| Surface | Status | Notes |
|---|---|---|
| Quick-match form (stake, time) | ✅ | `lobby.stakes` + `lobby.timeControls` are real; rendered as chip-stack + pill pickers since commit `54e7f50` |
| Matchmaking ticket + poll/WS | ✅ | Real ticket lifecycle |
| Incoming / open / sent challenge lists | ✅ | Real `bootstrap.*Challenges` |
| Create-invite form | ✅ | Real `POST /api/challenges` |
| Opponent rating on challenge rows | ✅ | Real ELO; new accounts seed at 1200 and update on every game finalize via `computeRatingChange` + `db.updateUserRating`. |
| Rivals shortlist (canonical) | 🚫 | Deferred to Phase 5 |
| Recent rematch card (canonical) | 🚫 | Deferred to Phase 5 |
| Live floor preview (canonical) | ✅ | `Live now` feed shows in-progress tables and can open a read-only live board via `Watch`. |

### Wager (flow stop, reached from Play)
| Surface | Status | Notes |
|---|---|---|
| Stake / pot / rake math | ✅ | `calculatePot` in shared domain |
| Time control | ✅ | |
| Accept / counter / decline | ✅ | Real state machine |
| Opponent handle | ✅ | |
| Opponent rating | ✅ | Real ELO; updates on every game finalize. |
| Opponent dossier (tenure label, sample frame, win rate / streak / joined, last 10 beads, h2h) | ✅ | Wave U4 landed — wager fetches `GET /api/users/:id` for the opposite party and renders the dossier under the headline. See `docs/USER_PROFILE_IA.md`. |
| Opponent country / reputation / verified / note | 🚫 | Still deferred to Phase 5 + trust subsystem; the dossier deliberately renders only data we can back. |
| Counter terms | ✅ | Inline stake/time picker; server transitions to `countered` and the original challenger becomes the responding party via `requireRespondingParty`. No more no-op counter. |
| Auto-decline countdown timer | ✅ | Live ticking chip on the wager headline (`ACCEPT IN 42s`) with low/critical/expired urgency states. See `docs/LIVENESS_NEXT_PASS.md` item 3. |

### Game (flow stop, reached via Resume pill / auto-nav)
| Surface | Status | Notes |
|---|---|---|
| Board state / FEN | ✅ | |
| Legal-move hints + click-to-move + drag/drop | ✅ | Selection is turn-aware and drag sources are limited to legal mover pieces |
| Move history / SAN | ✅ | Basic two-column |
| Captured trays | ✅ | |
| Promotion picker | ✅ | |
| Turn ownership / illegal-move 403 | ✅ | |
| Clock display + ticking | ✅ | Client shows low/critical pressure states; deeper drift smoothing still pending |
| Pot card | ✅ | |
| Resign | ✅ | |
| Draw offer / accept / decline | ✅ | |
| Table status rail | ✅ | Replaced the mocked Momentum card with real connection, side, last-move, material, and state data |
| Tells / scouting (canonical) | 🚫 | Deferred to trust subsystem |
| Spectator chat (canonical) | 🚫 | Deferred to spectator subsystem |

### Settlement (flow stop, also reused as History detail)
| Surface | Status | Notes |
|---|---|---|
| Result (win/loss/draw) | ✅ | |
| Credited amount + pot + rake | ✅ | |
| Balance after | ✅ | |
| Last move | ✅ | |
| Rating delta | ✅ | Returned by `settlementPayload` when the game has rating-change data; rendered via `formatRatingDelta`. (Pre-rating-pipeline games stay null and the row hides.) |
| Rematch button | ✅ | Issues a real `POST /api/challenges` against the prior opponent at the same stake + time control |
| "Find new opponent" | 🧪 | Still nav-only — fine as a navigation affordance, no action needed |

### Wallet (folds into Profile)
| Surface | Status | Notes |
|---|---|---|
| Balance | ✅ | |
| Escrow held | ✅ | |
| Ledger entries | ✅ | Append-only, real |
| Buy chips | 🚫 | Payments v1: Profile -> Buy Chips, Stripe Checkout, no cashout. See `PAYMENTS_NEXT_PASS.md`. |
| Cashout / payout (canonical) | 🚫 | Deferred to Phase 7 cashout readiness |

### Profile (new destination, partly built from existing pieces)
| Surface | Status | Notes |
|---|---|---|
| Handle, email | ✅ | Already on the viewer object |
| Rating | ✅ | Real ELO; updates on every game finalize and settlement shows viewer-relative delta |
| Wallet section (above) | ✅ | Moves here from its own route |
| Account settings (password change, etc.) | ✅ | Email change, password change, logout-other-sessions shipped |
| Game stats (W/L/D, by stake, by time control) | 🚫 | Phase 5 |
| Trust profile | ⚠️ | Tier, linked-account chips, calibration, stake cap, and avatar trust frame ship; full trust/safety panel and admin review remain Phase 6 |

### History (new destination)
| Surface | Status | Notes |
|---|---|---|
| Past finalized games list | ✅ | `GET /api/games/history`; sorted by ended_at desc, capped at 50 |
| Per-game settlement detail | ✅ | Reuses the existing settlement screen via `#history/:gameId` |
| Per-game replay / move scrubber | ✅ | `GET /api/games/:id/replay`; rendered on history detail and in-place after live game finalization |
| Head-to-head against specific opponent | 🚫 | Phase 5 |

### Auth (not a destination — gate)
| Surface | Status | Notes |
|---|---|---|
| Signup / login / logout | ✅ | Cookie sessions, scrypt hashing |
| Email verification | 🚫 | Mock #2 |
| Password reset | 🚫 | Mock #2 |
| Rate limiting on auth endpoints | ✅ | Conservative in-memory rate limits cover signup/login plus challenge and quick-match creation |

## Implementation status

All five steps below shipped in the initial pass. The proposal stays live as the per-screen matrix is updated as mocks turn real.

1. ✅ **Nav shell rebuilt.** Top nav is now Play · History · Profile. Resume-game pill appears in the topbar utilities only when a live game exists. Wallet pill remains and links to Profile. Wager/Game/Settlement keep their routes but no longer appear as nav items.
2. ✅ **Profile route (new).** Handle + email + rating header above a Wallet section that absorbed the prior standalone Wallet screen. `#wallet` aliases to `#profile`.
3. ✅ **History route (new).** `GET /api/games/history` returns finalized games for the viewer. `#history` shows the list, `#history/:gameId` renders the existing settlement component as the detail view.
4. ✅ **Mock audit, first wave.** `withOpponentDecor` simplified to `{id, handle, rating}` (deleted: country, reputation, verified, h2h, note). Settlement `ratingDelta` returns `null`; the client hides the row when null. Wager template no longer renders the deleted fields.
5. ✅ **Rematch → real action.** Settlement payload exposes `rematchChallenge.opponentId` + `timeControl`. The button now POSTs `/api/challenges` with the prior opponent + stake + time control and routes the user into the Wager screen for confirmation.

## Resolved questions (history)

- **Wallet placement** → folded into Profile (decision at acceptance).
- **"History" vs "Games"** → History (decision at acceptance).
- **Landing page** → deferred; auth gate is the entry point.
- **Settlement URL** → `#settlement` is kept as a synonym for `#history/:gameId`; live finalization stays on `#game` and renders settlement/replay in place.
