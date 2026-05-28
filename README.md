# Horsey

Horsey is a wagered chess product. The current repository starts from Claude's canonical design files and is being built into a real frontend/backend project.

Read these first:

- `AGENTS.md`
- `docs/PROJECT_SOUL.md`
- `docs/DESIGN_REVIEW.md`
- `docs/ARCHITECTURE_FIRST_PASS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DEV_QA_WORKFLOW.md`

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

For the current two-browser multiplayer smoke workflow, see `docs/DEV_QA_WORKFLOW.md`.

Generate and run the disposable QA scenario DB:

```bash
npm run scenario:qa
npm run dev:qa
```

Useful checks:

```bash
npm run check
npm test
npm run lint
npm run format
npm run verify
```

## Project Layout

- `apps/api`: local backend API and static web server.
- `apps/web`: production app shell for the frontend.
- `packages/shared`: shared product/domain helpers.
- `packages/chess`: chess domain workspace. This is intentionally minimal until library and licensing decisions are recorded.
- `docs`: product memory, architecture, implementation planning, and ADRs.
- root `*.jsx` and `*.html`: Claude canonical design files for now.

## Current Milestone

The first build milestone — a local fake-money playable loop — is functionally complete:

- lobby;
- wager/challenge;
- server-authoritative chess game;
- fake-money escrow and settlement;
- post-game rematch path.

Active workstream: **Deploy Readiness Bucket** — host the fake-money loop somewhere closed-beta testers can reach it. See `docs/IMPLEMENTATION_PLAN.md` § Deploy Readiness Bucket.

Inbound chip purchases are wired behind `HORSEY_PAYMENTS_ENABLED=0` using NOWPayments hosted invoices, but should stay dark until provider secrets, focused tests, and live IPN verification are done. Cashout/redeemable balances, KYC/compliance, and full anti-cheat remain explicitly gated. Phase 7 is cashout discovery first (legal, jurisdictions, custody, providers), code second.

## Deploy

Target: Fly.io with a persistent volume for the SQLite database. See `docs/adr/0006-deploy-target.md` for the rationale.

First-time setup:

```bash
fly launch --no-deploy --copy-config            # uses the existing fly.toml
fly volumes create horsey_data --size 1 --region iad
fly deploy
```

Subsequent deploys:

```bash
fly deploy
```

Production env (set in `fly.toml`):

- `HORSEY_DB_PATH=/data/horsey.db` — SQLite file on the mounted volume.
- `HORSEY_TRUST_PROXY=1` — server emits `Secure` on `Set-Cookie` so sessions only flow over TLS.
- `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8787`.

Production secrets (set with `fly secrets set`, not in `fly.toml`):

```bash
fly secrets set \
  RESEND_API_KEY=re_... \
  EMAIL_FROM='Horsey <onboarding@resend.dev>' \
  HORSEY_APP_URL=https://horsey.fly.dev
```

- `RESEND_API_KEY` — Resend API key. If unset, verification + password-reset emails are silently dropped (the server logs a `WARNING` at startup in production).
- `EMAIL_FROM` — sender. `onboarding@resend.dev` works without owning a domain; switch when you verify one.
- `HORSEY_APP_URL` — base URL for verification + reset links in email bodies. Must match the live host.

The app uses long-lived WebSockets and the server-side timeout scheduler ticks game clocks in memory, so `auto_stop_machines = off` and `min_machines_running = 1` are intentional — auto-stop would drop in-flight games.
