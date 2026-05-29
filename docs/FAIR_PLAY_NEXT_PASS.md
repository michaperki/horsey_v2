# Fair Play Next Pass

Living note for anti-cheat, fair-play review, and the admin/user surfaces that make Horsey feel trustworthy. This is intentionally product-shaped, not a research survey. The goal is to know what the system must eventually observe and where those observations belong.

Companion docs: `docs/OPERATIONAL_POLICY.md` (§1.11 engine cheating, §1.12 external human assistance, §1.13 suspicious value transfer, §1.14 shadow restrictions vs hard bans — policy framing and enforcement language; this doc owns *how we detect and act*, the policy doc owns *what's allowed and how we explain it*), `docs/IMPLEMENTATION_PLAN.md` (roadmap and admin slice), `docs/USER_PROFILE_IA.md` (profile/scout surfaces), `docs/SCOUTING_TRUST_NEXT_PASS.md` (trust signal taxonomy), `docs/PAYMENTS_NEXT_PASS.md` (cashout/payment gates).

## Priority

Do the full mobile pass first. A wagered chess app has to work in the hand before the fair-play dashboard earns more UI work.

Immediately after mobile, the fair-play pass becomes a real product slice, because money plus chess creates two obvious cheating paths:

- **Engine assistance:** a player follows Stockfish or another engine during the game.
- **Human assistance:** a stronger player helps, coaches, or takes over.

Do not pretend these can be solved with one badge or one score. The first version should collect evidence, make admin review practical, and expose cautious summaries only when the evidence is mature.

## Metrics That Matter

Engine-analysis metrics should be computed after games, not during live play in v1:

- average centipawn loss / accuracy by game and rolling window;
- blunder, mistake, and inaccuracy rate;
- top-engine-move match rate, especially in sharp or high-leverage positions;
- consistency of move quality across time pressure, stake, and opponent rating;
- suspicious deltas versus the player's established baseline;
- opening-book depth and sudden out-of-profile theory;
- time-to-move patterns, especially instant engine-like moves in complex positions or repeated uniform delays.

These metrics belong in admin first. They can later graduate into History/Profile/HUD only as carefully worded review and improvement signals. Public surfaces should not render a "cheater score."

## Human-Help Problem

Human assistance is harder than engine use because the moves can look natural. The product needs to treat it as pattern review, not certainty:

- rating/quality spikes clustered around high-stake games;
- sharp improvement after pauses or tab/background changes;
- sudden style shift within a game or across a session;
- stronger performance when a suspected helper is online nearby or in the same device/network cluster;
- mismatch between external linked-account history and Horsey play strength.

Some of these require data Horsey does not collect today. Record the need, but do not add invasive telemetry without a product/legal decision.

## Admin Surface

The current admin portal is read-only and operational. The next fair-play admin slice should add:

- reports inbox (`reports` table + `GET /api/admin/reports`);
- game review queue sorted by risk indicators;
- per-game engine-analysis panel with move list, CPL/accuracy, blunders, and top-engine agreement;
- player-level fair-play dossier with rolling metrics, external-account comparison, stake history, timeout/disconnect rate, and prior reports;
- admin notes and review outcomes with audit log;
- no punitive mutations until the evidence model and appeal policy are documented.

Correction/refund actions remain separate from fair-play accusations. A review can lead to a support action, but the ledger should stay append-only and auditable.

## User Surfaces

User-facing surfaces should lag admin:

- **History:** post-game review can show accuracy/blunders as self-improvement stats once engine analysis exists.
- **Profile:** rolling accuracy or "reviewed games" can appear only with caveats and sample size.
- **HUD:** live fair-play signals should be avoided in v1; they invite accusations mid-game and can leak detection logic.
- **Scout Card:** keep it to trust tier, sample size, reliability, and history until the fair-play pipeline has real outcomes.

### Review outcomes must reach the user (gap identified 2026-05-29)

Admin enforcement is built end-to-end — void, adjust, restrict, ban, report resolution all exist in `apps/api/server.mjs` with a full `admin_actions` audit trail — but **none of it currently surfaces to the affected user**. There is no notification, no settlement-screen explanation, and no account-state copy for any of these outcomes; voids, payout reversals, resolved reports, and even loud restrictions land silently. The only persisted notifications today are `challenge_received` / `challenge_countered`. Closing this gap is the next user-facing fair-play slice.

Be selective about *how* each outcome surfaces — not everything is a bell notification. The canonical decisions live elsewhere so this doc doesn't fork them:

- enforcement visibility (loud / quiet / state-only) → `OPERATIONAL_POLICY.md` § 1.14;
- which event uses which surface (notification vs settlement UI vs game history vs balance history vs account state vs error copy) → `NOTIFICATIONS_NEXT_PASS.md`;
- settlement model + void copy + report-resolution copy → `OPERATIONAL_POLICY.md` § 2.6, § 5.2.

Innocent-opponent case: when a shared game is voided because the *other* player was sanctioned, the clean player also sees a result/rating reversal and a returned stake. They must get the same neutral void copy — they did nothing wrong, so the message can't read as an accusation.

## Implementation Shape

Likely first technical slice:

1. Store full PGN/move history in an analysis-friendly form.
2. Add an offline engine-analysis job using a license-compatible engine path.
3. Persist `game_analysis` and `move_analysis` rows.
4. Add report intake from game/profile/settlement.
5. Add read-only admin review screens.
6. Only then decide which summary fields become public.

Open question: choose the engine/runtime path and license posture. Do not import an engine until licensing, CPU budget, and deployment implications are documented.

## Enforcement Ladder (from policy §1.14)

Hard bans aren't the only response. The shadow-restriction options below give us granular control without revealing detection logic. These are the *internal* states; user-facing language stays broad (see policy §1.14 user-facing wording).

States to build into the account model, ordered from softest to hardest:

- **Lower trust score** — internal only, affects matchmaking + withdrawal review priority.
- **Reduced stake limits** — user sees a cap when they try to wager above it; reason stays vague.
- **Delayed withdrawals** — flat hold (e.g. 24–72h) on all withdrawal requests.
- **Promotion ineligibility** — silently excluded from bonuses/quests/rewards.
- **Restricted matchmaking** — paired only against similar-risk accounts, or only at their own (lower) stake ceiling.
- **Manual review required** — every withdrawal goes to admin queue.
- **Reduced visibility** — open tables not shown to general lobby (functional shadowban).
- **No rewards from suspicious matches** — settlement still happens but doesn't count toward quests/streaks/trust.
- **Hard ban** — terminal. Used when evidence is high-confidence or repeat offender.

Account-status enum should support multiple of these in combination (a user can be on "delayed withdrawals + manual review" without being banned). Every state change needs an internal note + reviewer + reason field; the audit log is the trust artifact, not the score itself.

**v1 scope (locked 2026-05-28):** ship the full ladder. Hard ban is the terminal state — it exists, gated behind admin discretion, but is expected to be rarely used in the early days (no one to ban yet). The other eight states all live in the account-status flags from day one of the admin mutation slice (Bucket B). Reasoning: building the ladder partial is more work than building it whole, and the data model needs the full enum anyway. Ship the schema, the toggles, and the audit trail together. Land it around the time we open the door to closed-beta users.

## Branded integrity surface

**Locked 2026-05-28: the public-facing brand for the anti-cheat surface is "Horsey Secure Play."** This becomes the badge / section name in History / Profile / Settlement when fair-play status surfaces publicly. The doctrine is that we don't reveal detection details, so the brand has to carry the trust signal alone. Use exactly this phrase in user-facing copy; internal docs and code can use shorter handles (`secure_play`, `fair_play_review`, etc.).

### Badge gating — wait for data

The badge does **not** appear on day one. It waits until the analysis pipeline has enough signal that the badge actually means something. Showing a badge before there's data behind it is exactly the kind of empty-trust signal Horsey is trying to avoid.

Activation rule (locked 2026-05-28):

- **Minimum 10 games** of analysis-eligible data per user, sourced from either (a) external Lichess / Chess.com import (extends the existing verification path under `external_accounts`), or (b) Horsey platform games once enough have been played, or (c) both pooled together.
- **Per-user rolling metrics**: average centipawn loss (CPL) and blunder rate at minimum. Other metrics in the "Metrics That Matter" section feed admin review but don't gate the badge.
- **Confidence threshold ~95%** — interpret loosely as "the rolling estimate has narrow enough error bars to be meaningful." Operationally: 10 games is the floor; tighter caps (≥30 games for a "settled" reading) graduate the badge from `calibrating` to a confirmed state. This mirrors the existing trust-tier `calibrating` UX.
- **Badge states**: `calibrating` (sample below threshold) → `clean` (below review thresholds) → `under_review` (admin-flagged; not user-visible until policy says so) → `restricted` (one of the shadow states in the ladder below).
- **Calibrating users are not punished.** They just don't display a Secure Play badge yet. Matchmaking and play work normally.

### What calibrating users see (decided 2026-05-29)

Absence of a Secure Play badge must never read as a *negative* mark — most early users will be calibrating simply because not enough of their games have been analyzed yet, not because anything is wrong. So:

- Show a neutral, mildly-positive calibration state, not an empty slot. Copy direction: *"Secure Play: calibrating — we analyze your games to confirm fair play. Your badge appears once enough games are reviewed."*
- Never use a red / "unverified" / warning treatment that implies suspicion. Calibrating is the default, expected state.
- Use the same surface slot as the eventual badge (Profile / History / Settlement) so the calibrating → clean transition is a fill-in, not a new element popping into existence.
- Reuse the existing trust-tier `calibrating` visual language for consistency.

The external-import path is the same `external_accounts` infrastructure Lichess verification already uses; extending it to pull recent game histories for analysis is a known follow-up. Document the licensing posture of any engine before importing.
