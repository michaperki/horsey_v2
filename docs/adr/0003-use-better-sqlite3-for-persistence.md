# ADR 0003: Use better-sqlite3 For Persistence

Status: accepted

## Context

The first cut of the API kept all state in an in-memory `seed` object. Restarting the server wiped every challenge, ledger entry, and in-progress game. Mock #1 in the roadmap calls out persistence as the highest-leverage swap before the rest of the MVP work (matchmaking, realtime, clocks) can land — each of those assumes state survives between requests.

For local development we want:

- A real database (not JSON-on-disk), so the schema can absorb production needs without rewriting later.
- Zero operational overhead (no separate server to install or run).
- A synchronous API, since the rest of the server is already plain Node HTTP with non-async storage paths.

Two candidates fit:

- **better-sqlite3** — mature, synchronous, widely deployed, no experimental flag required. Adds one native dependency that compiles via `prebuild-install` on `npm install`.
- **node:sqlite** — built-in to Node 22.5+, similar synchronous API, zero new dependencies. Still flagged experimental in Node 23.x and requires `--experimental-sqlite` to enable. Less battle-tested in production.

## Decision

Use **better-sqlite3** for the persistence layer.

The dependency-light baseline (ADR 0001) allows additions when they replace a clearly identified mock with a real implementation. Persistence qualifies. The maturity gap and the "no experimental flag" property outweigh the one-dependency cost.

The database file lives at `data/horsey.db` by default and the path is overridable via the `HORSEY_DB_PATH` environment variable. The `data/` directory is gitignored.

## Consequences

- `npm install` now requires a working native toolchain (typically present on macOS/Linux/WSL; pre-built binaries cover most platforms via `prebuild-install`).
- The schema is created if-not-exists at startup; the initial seed data is inserted only when the database is empty, so production-shaped data can persist across restarts during development.
- Multi-step writes (accept a challenge → create two ledger entries → update the game) use `db.transaction(...)` to stay atomic.
- The domain code in `packages/shared/domain.mjs` is unchanged — it still operates on plain JS objects. The DB module is the adapter.
- A future production deployment will likely move to Postgres. Because the domain layer only sees plain objects and the DB module is the only place SQL lives, that swap is contained.
