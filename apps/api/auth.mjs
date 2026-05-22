import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const SCRYPT_KEY_LEN = 64;
const SCRYPT_SALT_LEN = 16;
const SESSION_TOKEN_BYTES = 32;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function hashPassword(password) {
  const salt = randomBytes(SCRYPT_SALT_LEN).toString("hex");
  const derived = await scrypt(password, salt, SCRYPT_KEY_LEN);
  return { passwordHash: derived.toString("hex"), passwordSalt: salt };
}

export async function verifyPassword(password, passwordHash, passwordSalt) {
  const derived = await scrypt(password, passwordSalt, SCRYPT_KEY_LEN);
  const stored = Buffer.from(passwordHash, "hex");
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(stored, derived);
}

export function generateSessionToken() {
  return randomBytes(SESSION_TOKEN_BYTES).toString("hex");
}

export function newSessionExpiry(now = Date.now()) {
  return new Date(now + SESSION_TTL_MS).toISOString();
}

export function isSessionExpired(session, nowIso = new Date().toISOString()) {
  return !session || session.expiresAt <= nowIso;
}

export function validateSignupInput({ email, handle, password }) {
  const e = (code, message) => {
    const err = new RangeError(message);
    err.code = code;
    return err;
  };
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    throw e("invalid_email", "email must look like name@example.com");
  }
  if (typeof handle !== "string" || !HANDLE_RE.test(handle)) {
    throw e("invalid_handle", "handle must be 3–20 chars: letters, numbers, _ or -");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw e("invalid_password", "password must be at least 8 characters");
  }
  return { email: email.toLowerCase().trim(), handle: handle.trim(), password };
}

export function validateEmailInput(email) {
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    const err = new RangeError("email must look like name@example.com");
    err.code = "invalid_email";
    throw err;
  }
  return email.toLowerCase().trim();
}

export function validateLoginInput({ email, password }) {
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    const err = new RangeError("email and password are required");
    err.code = "invalid_credentials";
    throw err;
  }
  return { email: email.toLowerCase().trim(), password };
}
