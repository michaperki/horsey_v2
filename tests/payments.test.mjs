import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";

import {
  CHIP_PACKAGES,
  isGeoBlocked,
  mapNowPaymentsStatus,
  packageById
} from "../packages/shared/payments.mjs";
import { verifyIpnSignature } from "../apps/api/payments.mjs";
import { walletSummary } from "../packages/shared/domain.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const IPN_SECRET = "test-ipn-secret";
const API_KEY = "test-api-key";

// --- Unit-level: shared payments module -------------------------------------

test("mapNowPaymentsStatus maps every documented provider status", () => {
  assert.equal(mapNowPaymentsStatus("waiting"), "pending");
  assert.equal(mapNowPaymentsStatus("confirming"), "confirming");
  assert.equal(mapNowPaymentsStatus("confirmed"), "confirmed");
  assert.equal(mapNowPaymentsStatus("sending"), "confirmed");
  assert.equal(mapNowPaymentsStatus("finished"), "finished");
  assert.equal(mapNowPaymentsStatus("failed"), "failed");
  assert.equal(mapNowPaymentsStatus("expired"), "expired");
  assert.equal(mapNowPaymentsStatus("refunded"), "refunded");
  assert.equal(mapNowPaymentsStatus("FINISHED"), "finished"); // case-insensitive
});

test("mapNowPaymentsStatus falls back to pending on unknown or missing input", () => {
  assert.equal(mapNowPaymentsStatus(""), "pending");
  assert.equal(mapNowPaymentsStatus(null), "pending");
  assert.equal(mapNowPaymentsStatus(undefined), "pending");
  assert.equal(mapNowPaymentsStatus("definitely-not-a-status"), "pending");
});

test("isGeoBlocked enforces country and us-state codes from the blocklist", () => {
  assert.equal(isGeoBlocked({ country: "FR" }), true);
  assert.equal(isGeoBlocked({ country: "fr" }), true);
  assert.equal(isGeoBlocked({ country: "US", region: "WA" }), true);
  assert.equal(isGeoBlocked({ country: "US", region: "wa" }), true);
  assert.equal(isGeoBlocked({ country: "US", region: "CA" }), false);
  assert.equal(isGeoBlocked({ country: "CA" }), false);
  assert.equal(isGeoBlocked({}), false);
});

test("packageById returns the catalog entry or null", () => {
  const starter = packageById("starter");
  assert.equal(starter?.id, "starter");
  assert.equal(starter.priceUsdCents, 500);
  assert.equal(packageById("not-a-package"), null);
  assert.equal(packageById(undefined), null);
  for (const pkg of CHIP_PACKAGES) {
    assert.equal(packageById(pkg.id)?.id, pkg.id);
  }
});

// --- Unit-level: IPN signature verification ---------------------------------

test("verifyIpnSignature accepts a valid HMAC-SHA512 over the canonical body", () => {
  const previousSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  try {
    const payload = {
      payment_status: "finished",
      order_id: "pur_abc",
      payment_id: "12345",
      price_amount: 5,
      price_currency: "usd"
    };
    const raw = JSON.stringify(payload);
    const signature = canonicalHmacSha512(raw, IPN_SECRET);
    assert.equal(verifyIpnSignature(raw, signature), true);
  } finally {
    restoreEnv("NOWPAYMENTS_IPN_SECRET", previousSecret);
  }
});

test("verifyIpnSignature rejects a tampered body even with the right signature length", () => {
  const previousSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  try {
    const original = JSON.stringify({ payment_status: "finished", order_id: "pur_abc" });
    const signature = canonicalHmacSha512(original, IPN_SECRET);
    const tampered = JSON.stringify({ payment_status: "finished", order_id: "pur_xyz" });
    assert.equal(verifyIpnSignature(tampered, signature), false);
  } finally {
    restoreEnv("NOWPAYMENTS_IPN_SECRET", previousSecret);
  }
});

test("verifyIpnSignature is robust to key reordering — canonical form sorts keys", () => {
  const previousSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  try {
    const reordered = JSON.stringify({ order_id: "pur_abc", payment_status: "finished" });
    const original = JSON.stringify({ payment_status: "finished", order_id: "pur_abc" });
    const signature = canonicalHmacSha512(original, IPN_SECRET);
    // The provider may serialize keys in any order; the receiver canonicalizes
    // before HMAC. Both bodies must verify under the same signature.
    assert.equal(verifyIpnSignature(reordered, signature), true);
  } finally {
    restoreEnv("NOWPAYMENTS_IPN_SECRET", previousSecret);
  }
});

test("verifyIpnSignature returns false when the secret is unset", () => {
  const previousSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  delete process.env.NOWPAYMENTS_IPN_SECRET;
  try {
    const raw = JSON.stringify({ payment_status: "finished" });
    assert.equal(verifyIpnSignature(raw, "deadbeef"), false);
  } finally {
    restoreEnv("NOWPAYMENTS_IPN_SECRET", previousSecret);
  }
});

test("verifyIpnSignature rejects missing or malformed signature headers", () => {
  const previousSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  try {
    const raw = JSON.stringify({ payment_status: "finished" });
    assert.equal(verifyIpnSignature(raw, ""), false);
    assert.equal(verifyIpnSignature(raw, null), false);
    assert.equal(verifyIpnSignature(raw, undefined), false);
    assert.equal(verifyIpnSignature(raw, "not-hex"), false);
    assert.equal(verifyIpnSignature(raw, "abcd"), false); // valid hex, wrong length
  } finally {
    restoreEnv("NOWPAYMENTS_IPN_SECRET", previousSecret);
  }
});

test("verifyIpnSignature rejects malformed JSON bodies", () => {
  const previousSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  try {
    assert.equal(verifyIpnSignature("not-json", "ab".repeat(64)), false);
  } finally {
    restoreEnv("NOWPAYMENTS_IPN_SECRET", previousSecret);
  }
});

// --- API-level: checkout failure modes --------------------------------------

test("POST /api/payments/checkout returns 503 when the kill switch is off", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: false });
  const alice = await fixture.signup("alice");
  const response = await fixture.post(alice, "/api/payments/checkout", { packageId: "starter" });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, "payments_disabled");
});

test("POST /api/payments/checkout returns 400 on unknown package", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const alice = await fixture.signup("alice");
  const response = await fixture.post(alice, "/api/payments/checkout", { packageId: "fictional" });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "payments_unknown_package");
});

test("POST /api/payments/checkout calls the provider and persists the invoice id", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const alice = await fixture.signup("alice");
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "inv_555",
          invoice_url: "https://nowpayments.example/invoice/inv_555"
        };
      },
      async text() { return ""; }
    };
  };
  try {
    const response = await fixture.post(alice, "/api/payments/checkout", { packageId: "starter" });
    assert.equal(response.status, 200);
    assert.equal(response.body.invoiceUrl, "https://nowpayments.example/invoice/inv_555");
    assert.match(response.body.purchaseId, /^pur_/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.nowpayments\.io\/v1\/invoice$/);

    const purchases = await fixture.get(alice, "/api/payments/purchases");
    assert.equal(purchases.status, 200);
    assert.equal(purchases.body.purchases.length, 1);
    assert.equal(purchases.body.purchases[0].providerSessionId, "inv_555");
    assert.equal(purchases.body.purchases[0].status, "pending");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("POST /api/payments/checkout marks the purchase failed when the provider rejects", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const alice = await fixture.signup("alice");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    async text() { return "bad gateway"; }
  });
  try {
    const response = await fixture.post(alice, "/api/payments/checkout", { packageId: "starter" });
    assert.equal(response.status, 502);
    assert.equal(response.body.error, "payments_provider_error");

    const purchases = await fixture.get(alice, "/api/payments/purchases");
    assert.equal(purchases.body.purchases.length, 1);
    assert.equal(purchases.body.purchases[0].status, "failed");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

// --- API-level: IPN webhook -------------------------------------------------

test("POST /api/payments/webhook rejects unsigned and tampered payloads", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const payload = { payment_status: "finished", order_id: "pur_anything", payment_id: "1" };
  const raw = JSON.stringify(payload);

  const noSig = await fixture.rawPost("/api/payments/webhook", raw, {});
  assert.equal(noSig.status, 401);
  assert.equal(noSig.body.error, "invalid_signature");

  const badSig = await fixture.rawPost("/api/payments/webhook", raw, { "x-nowpayments-sig": "00".repeat(64) });
  assert.equal(badSig.status, 401);
  assert.equal(badSig.body.error, "invalid_signature");
});

test("POST /api/payments/webhook acks an unknown purchase without erroring", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const payload = { payment_status: "finished", order_id: "pur_does_not_exist", payment_id: "1" };
  const raw = JSON.stringify(payload);
  const sig = canonicalHmacSha512(raw, IPN_SECRET);
  const response = await fixture.rawPost("/api/payments/webhook", raw, { "x-nowpayments-sig": sig });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.skipped, "unknown_purchase");
});

test("POST /api/payments/webhook credits chips on 'finished' and is idempotent on replay", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const alice = await fixture.signup("alice");
  const purchaseId = await createPurchaseFor(fixture, alice, "starter");
  const startingBalance = readBalance(fixture, alice.user.id);

  const payload = {
    payment_status: "finished",
    order_id: purchaseId,
    payment_id: "np_pay_1",
    pay_currency: "usdttrc20",
    pay_amount: "5.00",
    price_amount: 5,
    price_currency: "usd"
  };
  const raw = JSON.stringify(payload);
  const sig = canonicalHmacSha512(raw, IPN_SECRET);

  const first = await fixture.rawPost("/api/payments/webhook", raw, { "x-nowpayments-sig": sig });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);

  const balanceAfterFirst = readBalance(fixture, alice.user.id);
  assert.equal(balanceAfterFirst - startingBalance, 500); // starter = 500 chip-cents

  // Replay the same IPN — provider behavior we have to expect. Status stays
  // finished but no second ledger entry should land.
  const second = await fixture.rawPost("/api/payments/webhook", raw, { "x-nowpayments-sig": sig });
  assert.equal(second.status, 200);
  const balanceAfterReplay = readBalance(fixture, alice.user.id);
  assert.equal(balanceAfterReplay, balanceAfterFirst);

  // Purchase row reflects the terminal state and the linked ledger entry.
  const purchases = await fixture.get(alice, "/api/payments/purchases");
  const purchase = purchases.body.purchases.find((p) => p.id === purchaseId);
  assert.equal(purchase.status, "finished");
  assert.equal(purchase.payCurrency, "usdttrc20");
  assert.equal(purchase.providerPaymentId, "np_pay_1");
  assert.ok(purchase.ledgerEntryId, "ledgerEntryId should be set after crediting");
});

test("POST /api/payments/webhook does not credit on non-finished statuses", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const alice = await fixture.signup("alice");
  const purchaseId = await createPurchaseFor(fixture, alice, "standard");
  const startingBalance = readBalance(fixture, alice.user.id);

  for (const providerStatus of ["waiting", "confirming", "confirmed", "sending"]) {
    const payload = { payment_status: providerStatus, order_id: purchaseId, payment_id: "np_pay_x" };
    const raw = JSON.stringify(payload);
    const sig = canonicalHmacSha512(raw, IPN_SECRET);
    const response = await fixture.rawPost("/api/payments/webhook", raw, { "x-nowpayments-sig": sig });
    assert.equal(response.status, 200);
  }

  assert.equal(readBalance(fixture, alice.user.id), startingBalance);

  const purchases = await fixture.get(alice, "/api/payments/purchases");
  const purchase = purchases.body.purchases.find((p) => p.id === purchaseId);
  assert.equal(purchase.status, "confirmed");
  assert.equal(purchase.ledgerEntryId, null);
});

test("GET /api/admin/purchases is admin-gated and joins user info", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  db.close();

  const alicePurchase = await createPurchaseFor(fixture, alice, "starter");
  await createPurchaseFor(fixture, bob, "standard");

  const nonAdmin = await fixture.get(alice, "/api/admin/purchases");
  assert.equal(nonAdmin.status, 403);
  assert.equal(nonAdmin.body.error, "admin_only");

  const adminView = await fixture.get(admin, "/api/admin/purchases?limit=10");
  assert.equal(adminView.status, 200);
  assert.equal(adminView.body.purchases.length, 2);
  const aliceRow = adminView.body.purchases.find((p) => p.id === alicePurchase);
  assert.ok(aliceRow, "admin should see alice's purchase row");
  assert.equal(aliceRow.user.handle, alice.user.handle);
  assert.equal(aliceRow.packageId, "starter");
});

test("GET /api/payments/purchases is viewer-scoped", async (t) => {
  const fixture = await startFixture(t, { paymentsEnabled: true });
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  await createPurchaseFor(fixture, alice, "starter");
  await createPurchaseFor(fixture, bob, "standard");

  const aliceView = await fixture.get(alice, "/api/payments/purchases");
  assert.equal(aliceView.body.purchases.length, 1);
  assert.equal(aliceView.body.purchases[0].packageId, "starter");

  const bobView = await fixture.get(bob, "/api/payments/purchases");
  assert.equal(bobView.body.purchases.length, 1);
  assert.equal(bobView.body.purchases[0].packageId, "standard");
});

// --- Helpers ----------------------------------------------------------------

function restoreEnv(key, previous) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

function canonicalHmacSha512(rawBody, secret) {
  const parsed = JSON.parse(rawBody);
  const canonical = JSON.stringify(sortKeysDeep(parsed));
  return crypto.createHmac("sha512", secret).update(canonical).digest("hex");
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

async function createPurchaseFor(fixture, client, packageId) {
  const previousFetch = globalThis.fetch;
  let invoiceCounter = 0;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      invoiceCounter += 1;
      return {
        id: `inv_${Date.now()}_${invoiceCounter}`,
        invoice_url: "https://nowpayments.example/invoice/x"
      };
    },
    async text() { return ""; }
  });
  try {
    const response = await fixture.post(client, "/api/payments/checkout", { packageId });
    assert.equal(response.status, 200, `checkout failed: ${JSON.stringify(response.body)}`);
    return response.body.purchaseId;
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function readBalance(fixture, userId) {
  const db = new Database(fixture.dbPath);
  try {
    const rows = db.prepare(
      "SELECT id, user_id, available_delta_cents, escrow_delta_cents FROM ledger_entries WHERE user_id = ?"
    ).all(userId);
    const entries = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      availableDeltaCents: r.available_delta_cents,
      escrowDeltaCents: r.escrow_delta_cents
    }));
    return walletSummary(entries, userId).balanceCents;
  } finally {
    db.close();
  }
}

async function startFixture(t, { paymentsEnabled = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-payments-"));
  const dbPath = path.join(dir, "test.db");

  const previousEnv = {
    HORSEY_DB_PATH: process.env.HORSEY_DB_PATH,
    HORSEY_PAYMENTS_ENABLED: process.env.HORSEY_PAYMENTS_ENABLED,
    NOWPAYMENTS_API_KEY: process.env.NOWPAYMENTS_API_KEY,
    NOWPAYMENTS_IPN_SECRET: process.env.NOWPAYMENTS_IPN_SECRET,
    HORSEY_APP_URL: process.env.HORSEY_APP_URL
  };
  process.env.HORSEY_DB_PATH = dbPath;
  process.env.HORSEY_PAYMENTS_ENABLED = paymentsEnabled ? "1" : "0";
  process.env.NOWPAYMENTS_API_KEY = API_KEY;
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  process.env.HORSEY_APP_URL = "https://horsey.test";

  const serverModuleUrl = pathToFileURL(path.join(ROOT, "apps/api/server.mjs"));
  serverModuleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  const api = await import(serverModuleUrl.href);

  t.after(async () => {
    api.closeServerResources();
    for (const [key, value] of Object.entries(previousEnv)) restoreEnv(key, value);
    await rm(dir, { recursive: true, force: true });
  });

  async function request(client, method, pathname, body, extraHeaders = {}) {
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
    req.method = method;
    req.url = pathname;
    req.headers = {
      host: "127.0.0.1",
      ...(client?.cookie ? { cookie: client.cookie } : {}),
      ...extraHeaders
    };
    return callRoute(api.routeApi, req);
  }

  async function rawRequest(method, pathname, rawBody, extraHeaders = {}) {
    const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
    req.method = method;
    req.url = pathname;
    req.headers = { host: "127.0.0.1", ...extraHeaders };
    return callRoute(api.routeApi, req);
  }

  return {
    dbPath,
    get: (client, pathname) => request(client, "GET", pathname),
    post: (client, pathname, body = {}) => request(client, "POST", pathname, body),
    rawPost: (pathname, rawBody, headers) => rawRequest("POST", pathname, rawBody, headers),
    async signup(prefix) {
      const response = await request(null, "POST", "/api/auth/signup", {
        email: `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@example.com`,
        handle: `${prefix}_${Math.random().toString(16).slice(2, 8)}`,
        password: "password123",
        acceptedTosVersion: 1
      });
      assert.equal(response.status, 201, `signup failed: ${JSON.stringify(response.body)}`);
      return { cookie: response.cookie, user: response.body.viewer };
    }
  };
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
