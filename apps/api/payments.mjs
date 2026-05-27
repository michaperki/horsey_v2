// Thin NOWPayments HTTP client + IPN signature verification.
// Raw fetch, no SDK — ADR 0001 / ADR 0007. Mirrors the email.mjs pattern.
//
// Production env:
//   fly secrets set NOWPAYMENTS_API_KEY=...  NOWPAYMENTS_IPN_SECRET=...  HORSEY_APP_URL=https://...
//
// Local dev: leave keys unset. createInvoice will refuse to call the API and
// throw a `payments_not_configured` domain error so the cashier surfaces it.

import crypto from "node:crypto";

const NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1";

export function paymentsConfig() {
  return {
    apiKey: process.env.NOWPAYMENTS_API_KEY || null,
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || null,
    appUrl: process.env.HORSEY_APP_URL || "http://127.0.0.1:8787"
  };
}

// Create a hosted invoice. We pass the package price in USD; NOWPayments
// handles the USD→USDT/USDC quote at the hosted page. order_id is our
// purchases.id so the IPN can be reconciled even if the invoice id is lost.
export async function createInvoice(
  { purchaseId, amountUsdCents, packageLabel },
  fetchImpl = globalThis.fetch
) {
  const config = paymentsConfig();
  if (!config.apiKey) {
    const e = new RangeError("Payments are not configured on this server.");
    e.code = "payments_not_configured";
    throw e;
  }
  const priceAmount = (amountUsdCents / 100).toFixed(2);
  const body = {
    price_amount: Number(priceAmount),
    price_currency: "usd",
    order_id: purchaseId,
    order_description: `Horsey chips · ${packageLabel}`,
    ipn_callback_url: `${config.appUrl}/api/payments/webhook`,
    success_url: `${config.appUrl}/#profile?purchase=${encodeURIComponent(purchaseId)}`,
    cancel_url: `${config.appUrl}/#profile?purchase=${encodeURIComponent(purchaseId)}&cancelled=1`
  };
  const response = await fetchImpl(`${NOWPAYMENTS_BASE}/invoice`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const err = new Error(`NOWPayments rejected invoice (HTTP ${response.status}): ${raw || "no body"}`);
    err.code = "payments_provider_error";
    err.status = response.status;
    throw err;
  }
  const payload = await response.json();
  if (!payload?.id || !payload?.invoice_url) {
    const err = new Error("NOWPayments returned an unexpected invoice payload");
    err.code = "payments_provider_error";
    throw err;
  }
  return { invoiceId: String(payload.id), invoiceUrl: String(payload.invoice_url), raw: payload };
}

// HMAC-SHA512 of the canonical body (keys alphabetized, JSON-stringified
// deterministically) against NOWPAYMENTS_IPN_SECRET. Their reference
// implementation sorts top-level keys; if nested objects ever appear, they
// must be sorted too — handled by sortKeysDeep below.
export function verifyIpnSignature(rawBody, signatureHeader) {
  const config = paymentsConfig();
  if (!config.ipnSecret) return false;
  if (!signatureHeader || typeof signatureHeader !== "string") return false;
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const canonical = JSON.stringify(sortKeysDeep(parsed));
  const expected = crypto
    .createHmac("sha512", config.ipnSecret)
    .update(canonical)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signatureHeader, "hex")
    );
  } catch {
    return false;
  }
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}
