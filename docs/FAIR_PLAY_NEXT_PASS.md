# Fair Play Next Pass

Living note for anti-cheat, fair-play review, and the admin/user surfaces that make Horsey feel trustworthy. This is intentionally product-shaped, not a research survey. The goal is to know what the system must eventually observe and where those observations belong.

Companion docs: `docs/IMPLEMENTATION_PLAN.md` (roadmap and admin slice), `docs/USER_PROFILE_IA.md` (profile/scout surfaces), `docs/SCOUTING_TRUST_NEXT_PASS.md` (trust signal taxonomy), `docs/PAYMENTS_NEXT_PASS.md` (cashout/payment gates).

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

## Implementation Shape

Likely first technical slice:

1. Store full PGN/move history in an analysis-friendly form.
2. Add an offline engine-analysis job using a license-compatible engine path.
3. Persist `game_analysis` and `move_analysis` rows.
4. Add report intake from game/profile/settlement.
5. Add read-only admin review screens.
6. Only then decide which summary fields become public.

Open question: choose the engine/runtime path and license posture. Do not import an engine until licensing, CPU budget, and deployment implications are documented.
