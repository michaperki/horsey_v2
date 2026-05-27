import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

test("signup creates an unverified account and issues a verify email", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  assert.equal(alice.user.emailVerifiedAt, null);
  const verifyMail = fixture.inbox.find((entry) => entry.subject.includes("Verify"));
  assert.ok(verifyMail, "verification email should have been issued at signup");
  assert.equal(verifyMail.to, alice.user.email);
});

test("verify-email/confirm marks the account verified and is single-use", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const token = fixture.extractToken("verify");
  assert.ok(token, "expected a verify token in the inbox");

  const confirm = await fixture.post(null, "/api/auth/verify-email/confirm", { token });
  assert.equal(confirm.status, 200);

  const me = await fixture.get(alice, "/api/auth/me");
  assert.equal(me.status, 200);
  assert.ok(me.body.viewer.emailVerifiedAt, "viewer should be verified after confirm");

  const replay = await fixture.post(null, "/api/auth/verify-email/confirm", { token });
  assert.equal(replay.status, 410);
  assert.equal(replay.body.error, "invalid_token");
});

test("login succeeds without verification (soft verify)", async (t) => {
  const fixture = await startFixture(t);
  await fixture.signup("alice");
  // Sign up again with the same fixture but use a fresh client to log in
  // by email + password. Soft-verify must not block login.
  const lastSignup = fixture.lastSignupInputs;
  const login = await fixture.post(null, "/api/auth/login", {
    email: lastSignup.email,
    password: lastSignup.password
  });
  assert.equal(login.status, 200);
});

test("password reset request never reveals whether an email exists", async (t) => {
  const fixture = await startFixture(t);
  await fixture.signup("alice");
  const known = fixture.lastSignupInputs.email;

  fixture.inbox.length = 0;
  const knownEmail = await fixture.post(null, "/api/auth/password/reset/request", { email: known });
  assert.equal(knownEmail.status, 200);

  const unknownEmail = await fixture.post(null, "/api/auth/password/reset/request", {
    email: "nobody@example.com"
  });
  assert.equal(unknownEmail.status, 200);

  assert.equal(unknownEmail.body.ok, true);
  assert.equal(knownEmail.body.ok, true);

  const resetMails = fixture.inbox.filter((entry) => entry.subject.includes("Reset"));
  assert.equal(resetMails.length, 1);
  assert.equal(resetMails[0].to, known);
});

test("password reset confirm updates the password and invalidates all sessions", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");

  // Open a second session via login so we can prove all sessions die.
  const secondLogin = await fixture.post(null, "/api/auth/login", {
    email: fixture.lastSignupInputs.email,
    password: fixture.lastSignupInputs.password
  });
  assert.equal(secondLogin.status, 200);
  const secondClient = { cookie: secondLogin.cookie, user: secondLogin.body.viewer };

  // Request and consume a reset.
  fixture.inbox.length = 0;
  const request = await fixture.post(null, "/api/auth/password/reset/request", {
    email: fixture.lastSignupInputs.email
  });
  assert.equal(request.status, 200);

  const token = fixture.extractToken("reset");
  assert.ok(token, "expected a reset token in the inbox");

  const confirm = await fixture.post(null, "/api/auth/password/reset/confirm", {
    token,
    newPassword: "new-strong-password-123"
  });
  assert.equal(confirm.status, 200);

  // Both old sessions are dead.
  const meWithOriginal = await fixture.get(alice, "/api/auth/me");
  assert.equal(meWithOriginal.status, 401);
  const meWithSecond = await fixture.get(secondClient, "/api/auth/me");
  assert.equal(meWithSecond.status, 401);

  // Old password no longer works.
  const reLoginOld = await fixture.post(null, "/api/auth/login", {
    email: fixture.lastSignupInputs.email,
    password: fixture.lastSignupInputs.password
  });
  assert.equal(reLoginOld.status, 401);

  // New password works.
  const reLoginNew = await fixture.post(null, "/api/auth/login", {
    email: fixture.lastSignupInputs.email,
    password: "new-strong-password-123"
  });
  assert.equal(reLoginNew.status, 200);

  // The reset token is single-use.
  const replay = await fixture.post(null, "/api/auth/password/reset/confirm", {
    token,
    newPassword: "another-password-456"
  });
  assert.equal(replay.status, 410);
});

test("password reset rejects weak passwords", async (t) => {
  const fixture = await startFixture(t);
  await fixture.signup("alice");
  fixture.inbox.length = 0;
  await fixture.post(null, "/api/auth/password/reset/request", {
    email: fixture.lastSignupInputs.email
  });
  const token = fixture.extractToken("reset");

  const weak = await fixture.post(null, "/api/auth/password/reset/confirm", {
    token,
    newPassword: "short"
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error, "invalid_password");
});

test("verify-email/send is gated on authentication", async (t) => {
  const fixture = await startFixture(t);
  const unauthed = await fixture.post(null, "/api/auth/verify-email/send");
  assert.equal(unauthed.status, 401);

  const alice = await fixture.signup("alice");
  fixture.inbox.length = 0;
  const ok = await fixture.post(alice, "/api/auth/verify-email/send");
  assert.equal(ok.status, 200);
  assert.equal(fixture.inbox.length, 1);
});

test("verify-email/send short-circuits when already verified", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const token = fixture.extractToken("verify");
  await fixture.post(null, "/api/auth/verify-email/confirm", { token });

  fixture.inbox.length = 0;
  const second = await fixture.post(alice, "/api/auth/verify-email/send");
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyVerified, true);
  assert.equal(fixture.inbox.length, 0);
});

async function startFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-email-"));
  const dbPath = path.join(dir, "test.db");
  const previousDbPath = process.env.HORSEY_DB_PATH;
  process.env.HORSEY_DB_PATH = dbPath;
  // Force dry-run delivery so we capture into the sink.
  const previousKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  const serverModuleUrl = pathToFileURL(path.join(ROOT, "apps/api/server.mjs"));
  serverModuleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  const api = await import(serverModuleUrl.href);
  const emailMod = await import(pathToFileURL(path.join(ROOT, "apps/api/email.mjs")).href);

  const inbox = [];
  const restoreSink = emailMod.setEmailDryRunSink((entry) => inbox.push(entry));

  const fixture = {
    inbox,
    lastSignupInputs: null,
    async signup(prefix) {
      const inputs = {
        email: `${prefix}-${Date.now()}@example.com`,
        handle: `${prefix}_${Math.random().toString(16).slice(2, 8)}`,
        password: "password123",
        acceptedTosVersion: 1
      };
      const response = await request(null, "POST", "/api/auth/signup", inputs);
      assert.equal(response.status, 201);
      this.lastSignupInputs = inputs;
      // Wait a microtask so the best-effort signup verification email
      // resolves before the caller inspects the inbox.
      await new Promise((resolve) => setImmediate(resolve));
      return { cookie: response.cookie, user: response.body.viewer };
    },
    extractToken(type) {
      const needle = type === "verify" ? "verify-email" : "password-reset";
      for (let i = inbox.length - 1; i >= 0; i -= 1) {
        const text = inbox[i].text || inbox[i].html || "";
        const match = text.match(new RegExp(`/#${needle}/([0-9a-f]{64})`));
        if (match) return match[1];
      }
      return null;
    },
    get: (client, pathname) => request(client, "GET", pathname),
    post: (client, pathname, body = {}) => request(client, "POST", pathname, body)
  };

  t.after(async () => {
    restoreSink();
    api.closeServerResources();
    if (previousDbPath === undefined) delete process.env.HORSEY_DB_PATH;
    else process.env.HORSEY_DB_PATH = previousDbPath;
    if (previousKey !== undefined) process.env.RESEND_API_KEY = previousKey;
    await rm(dir, { recursive: true, force: true });
  });

  async function request(client, method, pathname, body) {
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
    req.method = method;
    req.url = pathname;
    req.headers = {
      host: "127.0.0.1",
      ...(client?.cookie ? { cookie: client.cookie } : {})
    };
    return callRoute(api.routeApi, req);
  }

  return fixture;
}

function callRoute(routeApi, req) {
  return new Promise((resolve, reject) => {
    let status = 200;
    const headers = {};
    let raw = "";
    const res = {
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(nextStatus, nextHeaders = {}) {
        status = nextStatus;
        for (const [name, value] of Object.entries(nextHeaders)) {
          headers[name.toLowerCase()] = value;
        }
      },
      end(chunk = "") {
        raw += chunk.toString();
        resolve({
          status,
          headers,
          body: raw ? JSON.parse(raw) : {},
          cookie: String(headers["set-cookie"] ?? "").split(";")[0] || null
        });
      }
    };
    routeApi(req, res).catch(reject);
  });
}
