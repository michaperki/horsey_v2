# Horsey

Horsey is a wagered chess product. The current repository starts from Claude's canonical design files and is being built into a real frontend/backend project.

Read these first:

- `AGENTS.md`
- `docs/PROJECT_SOUL.md`
- `docs/DESIGN_REVIEW.md`
- `docs/ARCHITECTURE_FIRST_PASS.md`
- `docs/IMPLEMENTATION_PLAN.md`

## Local Development

Prerequisite:

- Node.js 22 or newer

Run the app:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:8787
```

The current baseline uses a built-in Node HTTP server, SQLite via `better-sqlite3`, `chess.js` behind Horsey's local chess wrapper, and `ws` for WebSockets. The backend serves the web app and local fake-money API endpoints.

## Project Layout

- `apps/api`: local backend API and static web server.
- `apps/web`: production app shell for the frontend.
- `packages/shared`: shared product/domain helpers.
- `packages/chess`: chess domain workspace. This is intentionally minimal until library and licensing decisions are recorded.
- `docs`: product memory, architecture, implementation planning, and ADRs.
- root `*.jsx` and `*.html`: Claude canonical design files for now.

## Current Milestone

The first build milestone is a local fake-money playable loop:

- lobby;
- wager/challenge;
- server-authoritative chess game;
- fake-money escrow and settlement;
- post-game rematch path.

Real payments, real KYC/compliance, and full anti-cheat are explicitly out of scope until the real-money readiness gate is passed.
