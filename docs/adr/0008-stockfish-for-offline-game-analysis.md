# ADR 0008: Stockfish for offline game analysis

Status: accepted

## Context

The first FAIR_PLAY slice (`docs/IMPLEMENTATION_PLAN.md` § Likely Next Steps slice 5, `docs/FAIR_PLAY_NEXT_PASS.md`) needs a chess engine to compute the post-game metrics that feed the admin review queue: average centipawn loss (ACPL), blunder / mistake / inaccuracy counts, top-engine-move agreement, and time-vs-quality anomalies.

Before writing any analysis code, three decisions need to land:

1. **Which engine.** Stockfish vs. Leela / Lc0 vs. a managed API.
2. **How we run it.** UCI subprocess vs. WASM vs. consumed via a third-party API.
3. **What scope it covers in v1.** Our own games, external (Lichess / Chess.com) game history, or both.

The `FAIR_PLAY_NEXT_PASS` doc already rules out **live in-game evaluation** as a v1 use — it invites mid-game accusations and leaks detection logic — so this ADR is exclusively about offline, post-game work.

## Decision

### Stockfish, run as a long-running UCI subprocess on the server.

We adopt Stockfish 17 (or whatever the apt-stable release happens to be at deploy time) as the analysis engine.

- **Strength.** Free, open source, far above human top-tier — the absolute eval is more than discriminating enough at depth 18–20 for fair-play work.
- **Familiar tooling.** UCI is a stable text protocol; we can write a thin wrapper without an SDK (consistent with ADR 0001's "dependency-light" posture and ADR 0007's no-SDK pattern for NOWPayments).
- **No GPU needed.** Lc0 / Leela would force GPU-class hosting before we have any traffic.
- **No third-party API.** We considered chess-api.com / similar managed analysis services. They'd remove the runtime burden but add a per-call cost, a network dependency in the analysis path, and a vendor we'd have to migrate off if their terms change. Stockfish on the same VM as the API server is the cheaper, less coupled choice at our scale.
- **License.** Stockfish is GPL-3. We run it as a server-side service and **do not redistribute the binary** to clients. That keeps GPL outside our own code's licensing — same posture every commercial service hosting Stockfish takes.

We do not run Stockfish during live games (see `FAIR_PLAY_NEXT_PASS.md`).

### Long-running UCI process, not fork-per-game.

Stockfish startup, transposition-table allocation, and NNUE load each cost real wall time (hundreds of ms). For analyzing 40+ positions per game, this dominates the actual search cost. A persistent worker process that:

- launches one Stockfish on boot,
- streams `position` / `go depth N` / `bestmove` commands over UCI,
- and is owned by a single `analysis_jobs` consumer

is materially cheaper than spawning a fresh process per game. Concurrency is bounded by *one* engine instance per worker — single-threaded analysis at fixed depth is deterministic and easy to reason about. Scaling out (more workers) is a follow-on once load demands it.

### Pin engine version + depth on every persisted analysis row.

Every `move_analysis` row records `engine_version`, `depth`, and `multipv`. When the engine is upgraded, old rows stay valid (we know the conditions they were produced under); we can re-analyze on demand without invalidating history. This mirrors how `ratings.formulaVersion` was handled in `packages/shared/rating.mjs`.

Starting parameters:

| Parameter | Value | Rationale |
|---|---|---|
| `depth` | 18 | Common ACPL baseline. Tunable; record it per row. |
| `multipv` | 1 | We only need the top move per ply; `multipv` is reserved for future "how-close-to-best" variants. |
| `threads` | 1 | Single-worker; predictable CPU footprint. |
| `hash` | 64 MB | Modest; the worker is shared across games. |

### Scope for slice 1: our own games only.

The analysis primitive is reusable across sources, but slice 1 ships the pipeline against games already in our DB. External-account history ingest (Lichess PGN export + Lichess's pre-computed analysis API, Chess.com monthly PGN archives via `api.chess.com/pub`) is **slice 2**. Reasons:

- Our games are already in the DB — no API client, no rate-limit handling, no PGN-parse seam.
- Storage shape (`game_analysis` + `move_analysis`) is the reusable primitive. Once it's stable against our own games, external ingest becomes "different writer, same tables."
- One moving part to debug (engine + worker) instead of three (engine + worker + external API + reconciliation).
- We own the timing — easy to throttle to a small Fly VM.

### Lichess pre-computed analysis is a future shortcut, not a v1 dependency.

Lichess exposes Stockfish-evaluated PGNs through its public API for free. For verified-Lichess users specifically, we can later consume that data directly into the same schema, skipping the engine entirely for those accounts. Slice 2 work — out of scope here, but the schema is shaped to allow it (`source` column).

## Schema

Two new tables. Both are append-mostly; rows are written once and re-analysis writes a new row with a higher `engine_version` rather than mutating.

```sql
CREATE TABLE game_analysis (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  source TEXT NOT NULL,                -- 'horsey' | 'lichess' | 'chesscom'
  engine_version TEXT NOT NULL,         -- 'stockfish-17.0' or 'lichess-precomputed'
  depth INTEGER NOT NULL,
  multipv INTEGER NOT NULL,
  white_acpl INTEGER NOT NULL,          -- average centipawn loss
  black_acpl INTEGER NOT NULL,
  white_blunders INTEGER NOT NULL,
  black_blunders INTEGER NOT NULL,
  white_mistakes INTEGER NOT NULL,
  black_mistakes INTEGER NOT NULL,
  white_inaccuracies INTEGER NOT NULL,
  black_inaccuracies INTEGER NOT NULL,
  white_top_move_match_pct INTEGER NOT NULL,  -- 0–100
  black_top_move_match_pct INTEGER NOT NULL,
  status TEXT NOT NULL,                 -- 'pending' | 'running' | 'complete' | 'failed'
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE move_analysis (
  id TEXT PRIMARY KEY,
  game_analysis_id TEXT NOT NULL,
  ply INTEGER NOT NULL,                 -- 1-indexed
  side TEXT NOT NULL,                   -- 'white' | 'black'
  played_san TEXT NOT NULL,
  best_san TEXT,
  played_eval_cp INTEGER,               -- centipawns from white's perspective
  best_eval_cp INTEGER,
  cp_loss INTEGER,                      -- max(0, best_eval - played_eval) flipped per side
  classification TEXT,                  -- 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
  is_book INTEGER NOT NULL DEFAULT 0,   -- in opening book / first-N-plies skip
  created_at TEXT NOT NULL
);

CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  status TEXT NOT NULL,                 -- 'pending' | 'running' | 'complete' | 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_analysis_jobs_pending ON analysis_jobs(status, created_at);
```

Classification thresholds (centipawns lost, conventional):

| Loss range | Classification |
|---|---|
| 0–10 | `best` (or `good` if not the top move) |
| 11–49 | `good` |
| 50–99 | `inaccuracy` |
| 100–249 | `mistake` |
| 250+ | `blunder` |

These are the Lichess-aligned defaults so future ingest from Lichess-precomputed data lands in the same buckets.

## Implementation shape

- `apps/api/engine.mjs` — UCI wrapper. Spawns one Stockfish, exposes `analyzePosition({ fen, depth })` returning `{ bestMoveUci, evalCp, mateIn }`. Survives the process lifetime; no per-call startup.
- `apps/api/analysis-worker.mjs` — pulls jobs from `analysis_jobs`, runs each ply through `engine.mjs`, writes `move_analysis` + `game_analysis`. Single-flight (one job at a time per worker). Boots from `server.mjs` startup when `HORSEY_ANALYSIS_ENABLED=1` and `STOCKFISH_PATH` is set.
- Job enqueue lives at the existing `settleGame` boundary in `apps/api/server.mjs`: when a game finalizes (chess result, resign, timeout, draw), insert an `analysis_jobs` row for the new `game_id`. Aborted games are skipped (`state='aborted'` — no moves to analyze).
- Engine path comes from env: `STOCKFISH_PATH=/usr/games/stockfish` in production. Dev uses `apt install stockfish` or wherever the local binary lives.
- Dockerfile gains a `RUN apt-get install -y stockfish` line.
- Admin review screens (`/api/admin/games/:id/analysis`, Admin → Games detail) render the `game_analysis` summary + the `move_analysis` rows. Admin-only; no public surface in slice 1.
- Public surfaces (History/Profile/Scout self-improvement stats) stay deferred. `FAIR_PLAY_NEXT_PASS` is explicit about lagging admin surfaces.

## Trade-offs accepted

- **Per-VM CPU cost.** A depth-18 search on every ply of a 40-move game runs ~30–90 seconds on a small Fly VM. The job queue absorbs the latency; finalization is not gated on analysis completion.
- **No multi-worker pool yet.** A single worker means analysis lags under bursty load. Acceptable for closed-beta volume.
- **No book-position handling beyond a flat first-N-ply skip.** Opening theory will inflate `top_move_match_pct` in slice 1; we'll refine when real review surfaces the noise.
- **No Lichess-precomputed ingest yet.** Schema supports it; client code does not.
- **Stockfish version drift.** Tied to whatever `apt install stockfish` resolves to at image-build time. Acceptable if pinned in the Dockerfile and recorded on every row.

## Alternatives considered

- **chess-api.com / managed Stockfish API.** Removes the runtime burden but adds per-call cost, network dependency in the analysis path, and a vendor migration risk. Saved for the day we genuinely outgrow self-hosted.
- **Lc0 / Leela.** Stronger move suggestions but needs GPU hosting and brings NNUE-file complexity. Overkill for the use case.
- **WASM Stockfish in the browser.** Useful for a future "review your own game" client-side feature, not for admin-trust work — clients can't be trusted to report their own analysis.
- **Eager / synchronous analysis at finalize time.** Blocks the response, couples chess result presentation to engine load. The job queue is strictly better.

## Out of scope

- Per-platform external history ingest (Lichess / Chess.com). Slice 2.
- Lichess pre-computed analysis API ingest. Slice 2.
- Multi-worker scaling, GPU-class engines, in-process Stockfish via WASM in the worker.
- Public Profile / History / Scout self-improvement stats from analysis. Lags admin per `FAIR_PLAY_NEXT_PASS.md`.
- Live in-game evaluation. Explicitly ruled out v1.
- Premove patterns, time-quality anomaly detection, suspicious-helper detection. Future slices once the per-ply CPL primitive is shipped.
