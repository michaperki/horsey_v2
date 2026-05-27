# ADR 0006: Deploy Target And Closed-Beta Storage

Status: accepted

## Context

The fake-money playable loop is functionally complete: lobby, challenge, matchmaking, server-authoritative chess, escrow, settlement, draw/resign/timeout, realtime, replay, history, profile, rating. What's missing is operational — there's no way for anyone-other-than-the-author to reach the app. That gap is named in `docs/IMPLEMENTATION_PLAN.md` as the Deploy Readiness Bucket, and this ADR records the two foundational choices that bucket needed:

1. Where do we host?
2. What does the production data store look like *for the closed-beta phase*, given that real money is gated behind Phase 7 discovery?

A prior conversation framed the Postgres swap as a "contained" change because all SQL lives in one module (`apps/api/db.mjs`). That framing was wrong: `better-sqlite3` is synchronous and `node-postgres` is async, so a swap propagates `await` through every `db.X(...)` call site in `apps/api/server.mjs` (~190 sites), plus `scripts/dev-scenario.mjs` and `apps/api/milestones.mjs`. That refactor earns its place when concurrent-write safety, point-in-time recovery, and audit-grade backups become non-negotiable — i.e., when funds are real. Not before.

Constraints we worked from:

- Node 22, native ESM, `better-sqlite3` (native module), `ws` for WebSockets (long-lived connections).
- Single-process server today; no horizontal-scale requirement during closed beta.
- Low write volume (wagered chess at closed-beta scale is well within SQLite's envelope).
- Same-origin SPA + API on one Node process (see `apps/api/server.mjs`).
- Dependency-light preference (ADR 0001).

## Decision

**Host:** Fly.io.

**Closed-beta data store:** SQLite via `better-sqlite3` (ADR 0003), persisted on a Fly volume mounted at `/data` and pointed to with `HORSEY_DB_PATH=/data/horsey.db`. No Postgres until the real-money gate.

**Cookie hardening:** `Set-Cookie` emits the `Secure` attribute when the server detects it is running behind TLS, gated by `HORSEY_TRUST_PROXY=1` (set in `fly.toml`) or `NODE_ENV=production`. Local dev (`http://127.0.0.1:8787`) continues without `Secure` so the cookie works over plain HTTP.

### Why Fly.io over the alternatives

| Option | Why not the primary choice |
|---|---|
| **Render** | Closed-beta-friendly but its volume model is less flexible than Fly's, and WebSocket pricing on the starter tier is less generous. |
| **Railway** | Simplest to start, but mounted-volume semantics + native-module build path are less well-trodden for `better-sqlite3`. |
| **Heroku-class** | Ephemeral filesystem makes SQLite-on-disk a non-starter without external storage. |
| **Bare VPS (DigitalOcean droplet etc.)** | Works, but we'd be writing the deploy/runtime/observability layer ourselves. Fly gives us deploy-as-config + TLS termination + simple log routing for free. |
| **Vercel / Cloudflare Workers** | Edge-style platforms don't fit a long-lived Node + WebSocket + native-module shape. |

Fly was chosen because it (a) supports the long-lived Node + WebSocket process shape directly, (b) supports `better-sqlite3` as a native module via standard Docker builds, (c) has first-class persistent volumes, and (d) keeps the deploy surface to a single `fly.toml` plus `Dockerfile`.

### Why SQLite-on-volume now, Postgres later

For the fake-money closed-beta phase:

- One process, one writer, low write volume. SQLite in WAL mode handles this without ceremony.
- The entire codebase already assumes synchronous DB calls. Keeping that contract means zero refactor cost to ship.
- Backups are a periodic `litestream`-style replication or a snapshot-to-object-storage cron — sufficient for fake money, where the worst-case loss is reproducible test data.

For Phase 7 (real money), the picture flips:

- Audit-grade backups (point-in-time recovery) are required.
- Multi-process write safety becomes load-bearing if any worker / cron / admin process needs to write concurrently.
- Standard managed-Postgres tooling (Fly Postgres, Neon, RDS) is what payment-provider security reviews expect to see.

The Postgres swap is therefore a *named* Phase-7-adjacent slice in `IMPLEMENTATION_PLAN.md` (mock #1), not a generic next step. Doing it now is premature; doing it before real money flows is mandatory.

## Consequences

- The repo grows two deploy artifacts at root: `fly.toml` and `Dockerfile`.
- `HORSEY_DB_PATH` becomes the production knob. The container reads it from env; the volume mount path is the only thing that has to match.
- `Set-Cookie` now has two modes (with/without `Secure`). Local dev is unchanged; production gets `Secure` automatically when `HORSEY_TRUST_PROXY=1`.
- Better-SQLite3 is compiled in the Docker build, not on the host. Image size grows accordingly (Node 22 base + native build toolchain in a builder stage).
- WebSocket upgrades pass through Fly's proxy and use the same `horsey_session` cookie path the REST surface uses (ADR 0005 unchanged).
- No code path assumes a particular DB technology beyond what `apps/api/db.mjs` already exposes. Phase 7's Postgres swap remains a refactor of that one module plus the `await` propagation called out above.

## What this ADR does not decide

- Backup cadence and target. Documented as a Deploy Readiness Bucket follow-on, not gated by this ADR.
- Observability stack (structured logging library, error tracker). Also a Bucket A follow-on.
- Region selection. Fly's default is `iad`; we'll pick a region when we have a closed-beta tester whose latency we care about.
- Email-sending provider for verification / password reset (mock #2). Independent decision.
