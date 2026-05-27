# Scouting + trust next pass

Research note for the next product/design pass on Open Tables, compact Scout Card, Player Profile, and chess-account-backed trust. This is not an implementation spec yet; it is the judgment layer that should guide the next code changes.

Companion docs: `docs/LOBBY_DESIGN_GAP.md` (Play/Open Tables IA), `docs/USER_PROFILE_IA.md` (identity/profile surfaces), `docs/IMPLEMENTATION_PLAN.md` (trust subsystem phasing), `docs/DESIGN_REVIEW.md` (canonical design source).

## Current finding

Two separate symptoms have the same cause: Horsey is showing correct atoms, but not yet enough product meaning.

- **Open Tables** currently reads as boxed widgets inside a boxed widget: avatar tile, chip stack, time-control pill, and CTA rectangle all compete as independent primary shapes.
- **Scout Card / Profile** currently gives too little reveal. The player clicks avatar + handle + rating and gets a larger avatar + handle + rating, followed by stat fragments. That is truthful, but it feels closer to an expanded business card than a wagering scout read.

The next pass should not remove the chip/poker identity or invent fake trust data. It should reorganize hierarchy so each surface answers the decision at hand:

- Open Tables: "Which table is this, and do I want to sit?"
- Scout Card: "What kind of risk/opponent am I about to face?"
- Full Profile: "Can I trust this player's record, history, and account?"

## 1. Open Tables redesign direction

### Problem

The current card is over-componentized. The visual hierarchy is:

1. avatar tile
2. chip stack
3. time pill
4. CTA block

All four use strong bounded shapes, so the card feels like a panel full of smaller panels. The chip stack is especially loud because it is circular, saturated, and spatially isolated.

### Direction

Make each open table read as a single table listing, not a dashboard card.

Recommended anatomy:

```text
[avatar] Vish 1842                         Sit
        $25 · 3+0 blitz
        established · 147 games · 61% WR
        [small chip accent / felt edge]
```

Changes to make when implementing:

- Preserve avatar + handle + rating as the top identity read.
- Collapse stake + time into one central **table identity row**: `$25 · 3+0 blitz`.
- Move chip stack from primary object to accent: small left rail, background watermark, or tiny inline stack next to stake.
- Replace the boxed CTA with a quiet inline action or small right-aligned `Sit` button. The card itself can remain clickable for wager flow.
- Avoid placing a bordered time pill inside the bordered card; typography can carry time control.
- Add at most one trust/status clue under the table identity, and only if real: `new`, `established`, `147 games`, `online`, `you lead 3-2`.

### Do not do

- Do not remove chip language entirely; chips are part of Horsey's identity.
- Do not add more badges to solve the density problem.
- Do not show "verified", "fair play", "country", or "style" unless backed by real data.

## 2. Scout Card redesign direction

### Problem

The current compact card begins by repeating the clicked identity: avatar, handle, rating, joined date. That is necessary context but not enough reveal. The surface should feel like a small wagering HUD: a two-second risk read.

### Direction

Make the first meaningful line after identity a **scout read**, not another profile header.

Recommended anatomy:

```text
Vish · 1842                         established
147 games · 61% WR · avg $18 table

"High-volume blitz regular"

Recent form     W W L W D W
H2H vs you      3-2, you lead
Risk notes      low timeout rate · account 8mo

[Challenge $25]                         Profile
```

The key shift is that the card should answer "what kind of opponent is this?" using simple, interpretable metrics.

### First-generation metrics

Prefer metrics that are understandable, hard to humiliate with, and hard to overinterpret:

| Metric | Why it belongs | Data status |
|---|---|---|
| Games played | Experience / sample size | available from finalized games |
| Win rate | Basic strength context | available |
| Current streak | Recent heat without pretending to be predictive | available |
| Recent form beads | Fast visual read | available |
| Account age | Smurf/provisional context | available |
| H2H vs viewer | Rivalry context | available |
| Average stake band | Wager comfort level | derivable from games/challenges, should be bucketed |
| Biggest win / largest pot won | Stakes experience | derivable, but aggregate only; avoid per-victim details |
| Rematch rate | Social/competitive reliability | needs challenge/history aggregation |
| Timeout/disconnect rate | Reliability | timeout partly available; disconnect needs event policy |
| Established / provisional | Summary trust state | needs policy threshold |
| Verified chess account | External identity confidence | needs integration |

Avoid first-generation metrics that feel precise but are not ready:

- Centipawn loss / accuracy until there is an engine pipeline and clear caveats.
- Opening score / favorite openings until ECO classification exists.
- "Aggression" or "pressure collapse" until there is enough time/move data and a defensible definition.
- Fair-play score until trust review and anti-cheat pipelines exist.

## 3. Full Profile / dossier direction

The full profile should become a dossier, not an expanded Scout Card. The compact card makes the quick decision; the profile explains the evidence.

Recommended first pass:

- Left rail: identity, account age, provisional/established state, H2H summary, challenge/rematch CTAs.
- Center: record, win rate, recent form, stake comfort, rating timeline, recent games.
- Right rail: reliability and trust evidence, but only from real data: timeout rate, disconnect rate when available, linked chess accounts, verification status.

The profile should not contain empty "Trust & Safety" cards before the trust subsystem exists. A missing trust block is better than a fake one.

## 4. Narrative layer

The missing emotional layer is narrative: the player should come away with a compact read of the opponent.

Good eventual labels:

- Blitz regular
- High-volume low-stakes player
- Provisional account
- Established rival
- Rematch-heavy opponent
- Time-pressure survivor

Guardrails:

- Labels must be descriptive, not moralizing. Avoid "sandbagger", "smurf", "choker", "risky", "weak", "tilter".
- Every label must map to visible evidence. If the label cannot explain itself from data shown on the card/profile, do not render it.
- Use cautious wording for low sample sizes: `new account`, `still calibrating`, `limited record`.
- For money-related labels, prefer buckets and tendencies over exact flex numbers: `mostly $5-$25 tables`, not `avg $17.42`.

## 5. Trust metrics and wagering policy

> **See `IMPLEMENTATION_PLAN.md` § Trust Tiers for the unified tier ladder.** The model below pre-dates that consolidation and is preserved as the signal/UX taxonomy; the tier ladder is the authoritative source on what each state means policy-wise (stake caps, matchmaking pool, dual-currency gates).

This is trust infrastructure for betting, not social decoration. The trust system should help answer:

- Is this account established enough for this stake?
- Does this player finish games reliably?
- Does the rating/history look calibrated?
- Does this player have external chess history?
- What stake band do they normally play?

Recommended trust model:

| Signal | Display form | Product use |
|---|---|---|
| Account age | `joined Mar 2026` / `new account` | user interpretation; provisional state |
| Games played | exact count until large, then bucket | sample size |
| Rating uncertainty / provisional | `provisional`, `established` | stake limits and matchmaking pools |
| External chess account link | `Lichess linked`, `Chess.com linked` | calibration and trust |
| Timeout rate | percentage or low/medium/high band | reliability |
| Disconnect adjudications | rate / count band | reliability; needs event logging |
| Avg stake band | `$5-$25 tables` | wager comfort context |
| Largest pot won | bucketed aggregate | stakes experience |
| Rematch rate | percentage / `often rematched` | social trust / rivalry |

Policy proposal:

- New/unverified users should start in a **provisional pool** with lower stake limits.
- External chess-account verification can reduce friction, but should not automatically unlock high stakes.
- Stake limits should combine internal Horsey record + external account age/history + payment/KYC gates later.
- Do not display accusations. Use restrictions and review queues behind the scenes.

## 6. External chess-account onboarding

This idea is strong and should become part of the trust roadmap, but it should be treated as identity/calibration infrastructure, not a decorative badge.

### Lichess

Current official docs indicate Lichess supports OAuth/PCKE login and API access with long-lived access tokens, and the API exposes user, rating-history, performance, crosstable, and game-export endpoints. The official API docs also warn that requests are rate limited and recommend only one request at a time. Sources:

- https://lichess.org/api
- https://github.com/lichess-org/api/blob/master/doc/specs/lichess-api.yaml

Useful future data:

- account identity and account age
- rating history / per-speed ratings
- game export for calibration samples
- crosstable-style history if both linked users have Lichess accounts

### Chess.com

Chess.com's Published Data API is public and read-only. Its official docs list profile, stats, online status, monthly game archives, and PGN downloads. The docs note that public data excludes private logged-in information, endpoints are cached, and parallel requests can hit `429 Too Many Requests`. Source:

- https://www.chess.com/news/view/published-data-api

Useful future data:

- public profile, account age, status
- per-time-control stats and records
- timeout percentage where available
- monthly game archives for calibration samples

Important limitation: because Chess.com PubAPI is read-only public data, "verified Chess.com account" needs a separate proof flow. Options include OAuth if available through a later partnership/product path, or a claim-challenge flow such as asking the user to place a Horsey verification token in a public profile field if the platform permits it. Do not treat a typed Chess.com username as verified.

### Onboarding intake (the near-term entrance ramp)

External chess-account linking is the long-term identity story (Wave T2 below), but a meaningful v1 of this work can land much sooner as an **optional onboarding intake step**: ask new (and existing) users for their Lichess and/or Chess.com handle, fetch their public stats, and use them to seed a more honest initial rating + scout-card reads. This is high product leverage because right now every new account begins at the seeded 1200 ELO regardless of how strong they actually are, which makes early matches mis-calibrated and the dossier reads feel ungrounded.

Two-tier verification model — both tiers can ship before full OAuth:

| Tier | What it means | How we get there |
|---|---|---|
| **Claimed** | User typed a handle; we fetched public stats for them | Lichess `/api/user/{handle}` (no auth, rate-limited) and Chess.com `pub/player/{handle}/stats` (no auth, cached). Returned data is real, the *binding to this Horsey user* is not. |
| **Verified** | We have proof the Horsey user controls the external account | Lichess: OAuth/PKCE — full Wave T2. Chess.com: claim-challenge (user places a Horsey-issued token in their Chess.com profile bio; we fetch the profile and look for it; if present, mark verified). |

UX shape:

- **Onboarding modal** after signup with three options: `Link Lichess`, `Link Chess.com`, `Skip for now`. Skip is fully allowed — onboarding can't gate play.
- **Settings → linked accounts** so existing users can add a handle later. Re-syncs stats on demand and at some background cadence.
- **Profile chip:** `Lichess linked · 2148 blitz` / `Chess.com claimed · 1980 rapid`. Two tiers visually distinct — verified gets a check glyph, claimed gets a "?" or muted treatment. Never call something "verified" unless the proof actually exists.

Rating seeding strategy (v1, conservative):

- Take the user's Lichess blitz rating if linked, else Chess.com blitz, else default 1200.
- Cap the seed to avoid runaway calibration: max 1800 from claimed-only data; verified can seed higher.
- Apply a "still calibrating" provisional flag for the first N (~10) Horsey games regardless of seed — the seed is a starting point, the on-platform K-factor still moves it.
- Don't import historical rating timelines into Horsey's rating-change ledger — confusing provenance. The Horsey rating starts at the seed and evolves from there.

Admin / manual approval surface (the question raised in the roadmap conversation):

- For the **claim-challenge Chess.com flow**, the verification can be fully automated: server fetches the public profile, looks for the token, marks verified. No human in the loop for the happy path.
- But there's a class of edge cases where manual review is the right answer: handle disputes (two Horsey accounts claim the same Chess.com handle), suspected bot/farmed accounts on the external platform, profile data that doesn't match the user's pattern. For these, a tiny admin queue is sufficient:
  - `GET /api/admin/external-account-claims?state=pending`
  - admin clicks `approve` or `reject`
  - audit log entry
- Admin surface itself is its own small UI route, gated behind a role flag on the user record. Don't build a full RBAC system for this — a single `isAdmin` boolean on `users` is sufficient until it isn't.

Server data needed (additive to the schema):

```
external_accounts(
  id, user_id, provider ('lichess' | 'chesscom'),
  external_username, external_id,
  status ('claimed' | 'verification_pending' | 'verified' | 'rejected'),
  claim_token, claim_token_expires_at,
  imported_stats_json, last_synced_at,
  verified_at, verified_by ('oauth' | 'profile_token' | 'admin'),
  created_at, updated_at
)
```

Plus a small background sync to refresh imported_stats periodically (cron or on profile view, lazy is fine).

Sequencing inside the trust roadmap:

1. **Schema + manual handle intake.** *(shipped)* `external_accounts` table (schema v3) with the columns spec'd above. Settings → Linked chess accounts card lets the user add a Lichess or Chess.com handle; the server validates via `/api/external-accounts`, fetches Lichess `/api/user/{handle}` or Chess.com `/pub/player/{handle}` + `/stats`, stores normalized ratings in `imported_stats_json`, and tags status `claimed`. UNIQUE(user_id, provider) so a user can have at most one of each. Public payload on `/api/users/:id` and `/api/auth/me` now includes `externalAccounts[]` with a `status` chip plus per-time-control ratings; the user profile rail renders a `Lichess claimed · 1791 blitz` chip. Initial rating seed (blitz only, capped at 1800) is applied **only** when the user has zero finalized Horsey games — once they play, the K-factor owns the rating. A `calibrating` flag is exposed for the first 10 games regardless of seed.
2. **Onboarding modal on signup.** *(shipped)* `users.onboarding_completed_at` column (schema v4, backfilled from `created_at` for pre-existing accounts so they don't get prompted). Modal renders on `#play` whenever `viewer.onboardingCompletedAt` is null, with provider select + handle input (reuses `/api/external-accounts`) and a Skip button (`POST /api/auth/onboarding/complete`). A successful link auto-marks onboarding done inside the same transaction. Modal can't gate play — Skip is always reachable and writes the completion timestamp so the prompt never re-appears.
3. **Claim-challenge verification.** *(shipped, Lichess only)* `POST /api/external-accounts/:id/verify/start` issues an 8-char `horsey-XXXXXXXX` token with a 30-minute TTL and sets the row to `verification_pending`. The user pastes the token into their Lichess bio (or first/last name / location). `POST /api/external-accounts/:id/verify/check` fetches the raw Lichess profile, scans those fields case-insensitively for the token, and on match flips `status='verified'`, populates `verified_at` + `verified_by='profile_token'`, runs the verified-tier reseed (cap 2400) when the user has no Horsey games yet, and deletes any conflicting claimed rows for the same provider+handle from other Horsey users. The Verify button is shown only on Lichess rows; the `/verify/start` call is idempotent (returns the same token on repeat clicks unless `regenerate: true` is set).

   **Chess.com verification is not implemented.** The public API exposes no reliable user-editable text field — the "About me" field isn't in the API at all, and `name`/`location` aren't editable on every account tier. A working Chess.com verification path will need a different mechanism (OAuth, club-name claim, or a played-game challenge) and is tracked under the Lichess OAuth slice / Chess.com follow-on.
4. **Admin queue.** Build only when there are real edge cases to triage; until then the claim flow can run open-loop.
5. **Lichess OAuth/PKCE.** Full Wave T2 — the gold-standard verification. Token storage, refresh, scopes.
6. **Cross-platform calibration.** Use imported game samples to calibrate the Horsey rating model, not just the seed. Phase 6+.

This sub-section sits above Wave T2 because the claimed-tier work is much smaller in scope and unblocks the rating-calibration problem today, without waiting for OAuth integration.

## 7. Data/API changes to plan

Do not overload the current `GET /api/users/:id` forever. Add explicit profile/trust fields once backing data exists.

Proposed API shape extensions:

```ts
trust: {
  state: "provisional" | "established" | "verified",
  sampleSize: number,
  accountAgeDays: number,
  timeoutRate: number | null,
  disconnectRate: number | null,
  externalAccounts: {
    provider: "lichess" | "chesscom",
    username: string,
    verifiedAt: string,
    publicRating?: number,
    gamesImported?: number
  }[]
}

wagerProfile: {
  averageStakeBand: "$1-$5" | "$5-$25" | "$25-$100" | "$100+",
  largestPotWonBand: "$10+" | "$50+" | "$250+" | "$1k+",
  rematchRate: number | null
}

scoutNarrative: {
  label: string,
  evidence: string[]
}
```

Data work needed:

- Aggregate stake statistics server-side without publishing per-game opponent stake rows.
- Add challenge/game-derived rematch aggregation.
- Add disconnect/abandonment event policy before displaying disconnect rate.
- Add external account tables: provider, provider user id, username, verified_at, last_sync_at, imported summary JSON.
- Add calibration job for imported games; keep raw PGNs optional and retention-limited.

## 8. Recommended sequencing

### Wave O1 - Open Tables hierarchy fix  *(shipped)*

The first cut tried to fix hierarchy inside the original 2-column mini-card grid by demoting the chip stack and the CTA. That improved the visual hierarchy but didn't fix the *structural* problem: the right rail is already a ~30% column, and a 2-column grid inside it gives each card ~140px to fit avatar + handle + rating + chip accent + stake + time + Sit. Handle and terms truncated even after typography tuning. The shape itself was the constraint.

Final shape (`renderOpenTableRow` + `.open-table-row`):

- [x] **Single-column full-rail-width list rows**, not a 2-column card grid. Each table is one horizontal row separated by thin dividers, no per-row box/border/radius. Reads as a table listing, not a card.
- [x] **Row anatomy is three grid cells** — identity (`1fr` with `min-width: 0`), terms (`auto`), Sit (`auto`) — so the handle is the only element that ellipsises under pressure and everything else stays whole.
- [x] **Identity = initial avatar + handle + rating** only. Chip stack dropped entirely from this surface; chips remain part of Horsey's voice in the hero picker and Scout Card, but Open Tables doesn't try to carry chip identity at row scale. Stake is typographic: `$25 · 3+0 blitz`.
- [x] **Terms row uses `timeControlKind` suffix** (`bullet / blitz / rapid`) inline; no nested time pill.
- [x] **Sit -> is typography-only** — muted by default, brightens to gold and slides 2px on row hover. No padding/border/background. The whole row is the click target via `data-select-challenge`; Sit -> is a directional hint, not a nested CTA. Avoids the button-in-button geometry that two earlier passes accidentally rebuilt.
- [x] **Row hover paints a faint gold wash** as the only chrome cue — lighter than the original card hover (`var(--paper)` background + gold border), since rows are smaller targets and benefit from a lighter touch.
- [x] **Scout trigger stays on the identity span** (now classed `open-row-scout`) so opponent inspection still works; stopPropagation keeps the parent row click from also firing.
- [x] No narrative labels or trust clues rendered here per the locked decision — those live in the Scout Card. Open Tables stays typographically quiet.

### Wave S1 - Scout Card reveal fix  *(shipped)*

- [x] Reveal block (`.scout-reveal`) lives immediately under the identity header. First line is a cautious narrative label, second line is the sample-size + relationship frame.
- [x] Narrative labels come from current data only via `scoutNarrative(stats, h2h)`: `new account` when `finishedGames < 20`, `established regular` at or above. The frame appends ` · shared history` when h2h has any games. The `no shared games` case is conveyed by the empty H2H block below rather than as a redundant label.
- [x] Threshold `ESTABLISHED_GAMES_THRESHOLD = 20` is the locked initial cutoff per design call. Easy to retune as data lands.
- [x] Third stat tile changed from a duplicated `Games` (already in the reveal frame) to `Joined Xmo / Xy` via the new `accountAgeLabel()` helper. The header `small` now carries only the rating since tenure has its own dedicated surface.
- [x] No fake trust badges. CTAs, last10, and H2H unchanged.

### Wave P1 - Profile evidence pass  *(shipped)*

- [x] Rail now carries the same narrative reveal as the Scout Card via `scoutNarrative()` and `accountAgeLabel()` — `established regular` / `new account` label plus the sample-size + relationship frame line. Consistent voice between popover and full profile.
- [x] Rail subtitle dropped the verbose `joined Mar 2026` form in favor of the compact `joined 8mo ago` to match the Scout Card's `Joined` tile.
- [x] Center column's Record block is now explicitly separated from a labelled `Recent form` block (Last 10 + rating timeline) via a real `<h3>`. The umbrella `Record` header no longer subsumes the form rail; each block reads as its own evidence type.
- [x] **Wager profile + Reliability sections shipped** (2026-05-25). Server-side `evidenceForUser(userId, games)` aggregates per-user evidence: dominant stake band (bucketed `$1–$5` / `$5–$25` / `$25–$100` / `$100+`), biggest pot won (positive-only, per `project_no_loss_advertising`), and timeout-loss rate (only after the 5-game sample threshold). Surfaced as:
  - Profile `Wager profile` block: stake comfort + biggest pot won.
  - Profile `Reliability` block: timeout rate as low/moderate/high band + raw %.
  - Scout Card "risk notes" line: one-liner `low timeout rate · mostly $5–$25 tables`.
  - Wager dossier: same one-liner at decision time.
  - All blocks skip rendering entirely when no signal crosses the threshold — missing block beats a fake one.
- Disconnect-rate remains pending the event-policy slice (Trust roadmap).

### Wave T1 - Trust foundation  *(partial)*

- [x] Define provisional/claimed/verified/established policy in `IMPLEMENTATION_PLAN.md` and `packages/shared/trust.mjs`.
- [x] Add external account linking tables and claimed-tier sync for Lichess/Chess.com public stats.
- [x] Add Lichess profile-token verification.
- [x] Gate stake limits by trust state before real-money readiness.
- [x] Surface trust state through tier pips and avatar trust frames.
- [x] Add timeout-rate reliability evidence where sample size is sufficient.
- [ ] Add disconnect rate after the event-policy slice.
- [ ] Add Open Tables tier filtering.
- [ ] Add dev fixtures/scenario runner for local trust-tier coverage without manually grinding 50 games.

### Wave T2 - External chess-account calibration

- Lichess OAuth PKCE first because official docs support login-style OAuth.
- Chess.com public import second, with a separate proof/claim mechanism if no first-party auth path is available.
- Show external badges only after verification, and include enough evidence to avoid "badge as decoration".

## Open questions

- Should average stake and biggest win be shown as exact numbers, bands, or only on the full profile? Recommendation: bands on public surfaces; exact internal values can exist server-side.
- Should provisional users be visibly labeled in public HUDs, or only constrained by stake/matchmaking policy? Recommendation: visible but neutral wording: `provisional`, `calibrating`.
- Should linked external accounts be optional forever, or required above a stake threshold? Recommendation: optional at fake-money launch, required or strongly incentivized for high-stakes/real-money readiness.
- What is the first "narrative label" threshold set? Recommendation: ship only three safe labels initially: `new account`, `established regular`, `shared history`.
