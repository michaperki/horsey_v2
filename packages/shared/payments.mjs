// Payments v1 — chip-purchase package catalog and provider constants.
// Shared between API and client so the same prices/labels render in both.
//
// USD-denominated. NOWPayments handles the USD→USDT/USDC quote at invoice
// creation; we don't carry crypto amounts in the catalog. See ADR 0007.

export const PAYMENT_PROVIDER = "nowpayments";

// The currencies a user can choose at checkout. Stablecoins-only for v1
// (see ADR 0007 § "Stablecoins only for v1"). Codes match NOWPayments'
// currency identifiers.
export const SUPPORTED_PAY_CURRENCIES = [
  { code: "usdttrc20", label: "USDT (TRC-20)", network: "Tron", recommended: true },
  { code: "usdcmatic", label: "USDC (Polygon)", network: "Polygon" },
  { code: "usdcsol",   label: "USDC (Solana)",  network: "Solana" }
];

export const CHIP_PACKAGES = [
  {
    id: "starter",
    label: "Starter",
    priceUsdCents: 500,
    chipsCents: 500,
    bonusPct: 0
  },
  {
    id: "standard",
    label: "Standard",
    priceUsdCents: 2000,
    chipsCents: 2200,
    bonusPct: 10
  },
  {
    id: "roller",
    label: "Roller",
    priceUsdCents: 10000,
    chipsCents: 11500,
    bonusPct: 15
  },
  {
    id: "whale",
    label: "Whale",
    priceUsdCents: 50000,
    chipsCents: 60000,
    bonusPct: 20
  }
];

export function packageById(id) {
  return CHIP_PACKAGES.find((p) => p.id === id) || null;
}

// Two-letter ISO country codes + US state codes (prefixed `us-`) where
// chip purchases are not offered in v1. Conservative starter list —
// legal review remains Bucket D's job.
//
// Sources of inspiration (not legal advice):
//   - US: states with explicit anti-online-wagering posture or unsettled
//     skill-game classification.
//   - Country list: places where wagering on skill games is restricted
//     under common frameworks we'd be operating under.
//
// Edit this constant before deploy. The check is enforced server-side on
// /api/payments/* and hidden in the UI when the viewer is geo-blocked.
export const GEO_BLOCK_LIST = new Set([
  // US states (we'll resolve country=US + region in the request).
  "us-WA",
  "us-ID",
  "us-MT",
  "us-NV",
  "us-NY",
  "us-WA",
  // Countries — restrictive skill-game / sweepstakes posture.
  "FR",
  "CN",
  "KR",
  "IR",
  "KP",
  "SY"
]);

export function isGeoBlocked({ country, region }) {
  if (!country) return false;
  const cc = String(country).toUpperCase();
  if (GEO_BLOCK_LIST.has(cc)) return true;
  if (region) {
    const key = `${cc.toLowerCase()}-${String(region).toUpperCase()}`;
    if (GEO_BLOCK_LIST.has(key)) return true;
  }
  return false;
}

// Status mapping from NOWPayments IPN states to our purchases.status column.
// We credit chips only when status reaches 'finished' (ADR 0007).
//   waiting     → 'pending'      (no payment yet)
//   confirming  → 'confirming'   (in mempool / unconfirmed)
//   confirmed   → 'confirmed'    (chain-confirmed, not yet settled to us)
//   sending     → 'confirmed'    (provider sweeping to our payout)
//   finished    → 'finished'     (credit chips here)
//   failed      → 'failed'
//   expired     → 'expired'
//   refunded    → 'refunded'
export const NOWPAYMENTS_STATUS_MAP = {
  waiting: "pending",
  confirming: "confirming",
  confirmed: "confirmed",
  sending: "confirmed",
  finished: "finished",
  failed: "failed",
  expired: "expired",
  refunded: "refunded"
};

export function mapNowPaymentsStatus(raw) {
  return NOWPAYMENTS_STATUS_MAP[String(raw || "").toLowerCase()] || "pending";
}
