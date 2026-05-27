import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_VERIFY_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  generateEmailToken,
  hashEmailToken,
  isEmailTokenExpired,
  newEmailTokenExpiry,
  validatePasswordInput
} from "../apps/api/auth.mjs";

test("generateEmailToken returns 64 hex chars (32 bytes)", () => {
  const a = generateEmailToken();
  const b = generateEmailToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("hashEmailToken is deterministic and stores SHA-256 hex", () => {
  const token = "deadbeef".repeat(8);
  const h1 = hashEmailToken(token);
  const h2 = hashEmailToken(token);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(hashEmailToken("other"), h1);
});

test("isEmailTokenExpired honors expires_at", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const future = { expiresAt: new Date(now.getTime() + 60_000).toISOString() };
  const past = { expiresAt: new Date(now.getTime() - 60_000).toISOString() };
  assert.equal(isEmailTokenExpired(future, now.toISOString()), false);
  assert.equal(isEmailTokenExpired(past, now.toISOString()), true);
  assert.equal(isEmailTokenExpired(null), true);
});

test("newEmailTokenExpiry adds the given ttl", () => {
  const base = Date.UTC(2026, 0, 1);
  const expiry = newEmailTokenExpiry(EMAIL_VERIFY_TTL_MS, base);
  assert.equal(expiry, new Date(base + EMAIL_VERIFY_TTL_MS).toISOString());
});

test("verify ttl is longer than reset ttl", () => {
  assert.ok(EMAIL_VERIFY_TTL_MS > PASSWORD_RESET_TTL_MS);
});

test("validatePasswordInput accepts 8+ chars, rejects shorter strings", () => {
  assert.equal(validatePasswordInput("abcdefgh"), "abcdefgh");
  assert.throws(() => validatePasswordInput("short"), /at least 8/);
  assert.throws(() => validatePasswordInput(""), /at least 8/);
  assert.throws(() => validatePasswordInput(null), /at least 8/);
});
