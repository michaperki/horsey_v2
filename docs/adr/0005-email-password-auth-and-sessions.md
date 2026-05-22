# ADR 0005: Email/Password Auth With DB-Backed Sessions

Status: accepted

## Context

The first cut of the API identified the viewer through an `x-viewer-id` HTTP header set client-side from a `?as=` query string. Trivially spoofable, no concept of an account, and only useful for the dev workflow that opened two tabs as two pre-seeded users. Mock #2 in `docs/IMPLEMENTATION_PLAN.md` always treated this as a placeholder for real auth.

We need a first real account model. Constraints:

- Stay dependency-light (ADR 0001). Avoid adding a third-party auth framework when Node primitives are enough.
- Server stays authoritative for identity (downstream guards `requireRecipient`, `requireTurnOwner`, `requirePlayer` already key off `viewer.id`).
- The two-tab dev workflow can break — the user has accepted that trade-off as the app grows up.
- The four hardcoded seed users were mocks and can be wiped.

Three pieces had to be chosen: how passwords are stored, how sessions are tracked, and how the session token reaches the server.

## Decision

- **Password storage:** `crypto.scryptSync` via promisified `crypto.scrypt` in `apps/api/auth.mjs`. 64-byte key, 16-byte random salt, hex-encoded. Verify with `timingSafeEqual` against the freshly derived key. No new dependency.
- **Sessions:** opaque 32-byte random tokens stored in a new `sessions(id, user_id, created_at, expires_at)` table. 30-day TTL. Expired rows are swept on every session-create call. Logout deletes the row.
- **Transport:** `Set-Cookie: horsey_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=...`. Same-origin fetches send the cookie automatically. No `Secure` flag while the dev server is HTTP-only on localhost; production must add it when TLS lands.
- **`resolveViewer`** reads the cookie, looks up the session, returns 401 (`unauthenticated`) if missing/expired/revoked. The downstream domain guards are unchanged.
- **WebSocket auth** uses the same cookie. The `/ws` upgrade handler reads `horsey_session` from `req.headers.cookie` instead of the prior `?as=<userId>` query string seam, so identity matches the REST surface and can't be spoofed by URL editing.
- **Signup grants** $1,000 fake-money via a `seed_grant` ledger entry inside the same transaction as the user insert, so the playable loop works for a brand-new account with no manual ledger setup.
- **Migration:** a `PRAGMA user_version` jump (0 → 1) drops every user-keyed table on first run after this change. The wiped seed (users, ledger, challenges, games, tickets) was always a mock.

## Consequences

- No new npm dependency. Node's `crypto` covers hashing, salting, comparison, and token generation.
- All `/api/*` endpoints except `/api/health`, `/api/auth/signup`, and `/api/auth/login` return 401 when the cookie is missing or stale. The client surfaces a login/signup screen instead of falling back to a default identity.
- The four seed users (Sam, Vish, Kobe, Mira) and the demo challenge are gone. Local play now requires creating accounts through the signup form, which is a small step backward for "open the app and start clicking" testing but a step forward in product realism.
- The two-tab dev workflow (`?as=sam` / `?as=vish`) is dead. To play both sides on one machine, use two browser profiles or one regular + one incognito window — the cookie is the identity.
- Targeted challenges by id still work server-side, but the lobby's "Send to opponent" picker is gone because we no longer ship the user directory in `/api/bootstrap`. Future work can re-introduce targeted invites via a handle lookup once a rivals/friends surface exists.
- CSRF risk is mitigated by `SameSite=Lax` + the API being same-origin with the SPA. If the API is ever served from a different origin or accepts cross-site state-changing requests, this needs a CSRF token.
- Rate limiting on signup/login is still absent. Acceptable while everything is fake-money but should be added before any external test.
