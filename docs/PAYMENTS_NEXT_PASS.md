# Payments Next Pass

Companion: `docs/OPERATIONAL_POLICY.md` § 3 (Payments / Crypto Operations — deposits, withdrawals, NOWPayments operational risks, policy needs) and § 4.2 (wallet draining / withdrawal abuse). This doc owns *what we build and ship*; the policy doc owns *the rules and user-facing language* around deposits, holds, refunds, disputes, withdrawal review.

**Posture set 2026-05-27, provider locked 2026-05-27.** Horsey ships with a real payments panel. Users buy chips in crypto (stablecoins only, v1) via **NOWPayments**. Cashout is deferred behind a "coming soon" wall — that's the legal model. The ToS at signup makes it explicit: chips are entertainment credit, no cashout, no expectation of cashout, no monetary value outside the platform.

This is a deliberate posture, not a missed step. The old blanket block on money code is narrowed: *cashout* still requires the Bucket D work (payout providers, KYC, AML, jurisdictional opinions). *Inbound* purchases of entertainment chips do not, given a clear ToS and a no-cashout disclaimer.

Card / fiat acquirers (Stripe et al.) are out for v1 — their AUPs broadly disallow wagering on real money even when framed as entertainment credit. Hosted crypto processors that accept wagering merchants are in. See ADR 0007.

## What ships

### Buy Chips panel
- Lives under Profile → Buy Chips (and likely earns a topbar pill once it has traffic).
- Tiered chip packages with mild volume discount, prices forward, casino-grade visual treatment (felt, chip stack, no euphemism — see `PROJECT_SOUL.md` § Intentional casino energy).
- NOWPayments hosted invoice flow: create invoice via `POST https://api.nowpayments.io/v1/invoice`, redirect to the returned `invoice_url`, user picks USDT-TRC20 / USDC-Polygon / USDC-Solana, sends from any wallet, NOWPayments fires a signed IPN. Webhook verifies HMAC-SHA512 against `NOWPAYMENTS_IPN_SECRET` and idempotently credits chips with a `type='purchase'` ledger entry on the existing balance column. Same chip the fake-money loop already uses. The chip is the chip; what changes is *how it got there*.
- Receipts visible in the Profile ledger; a `purchases` table backs refund/dispute audit.

Initial package shape (tune as data comes in):

| Package | USD | Chips | Effective |
|---|---|---|---|
| Starter | $5 | $5 | 1:1 |
| Standard | $20 | $22 | +10% |
| Roller | $100 | $115 | +15% |
| Whale | $500 | $600 | +20% |

### "Cashout — coming soon"
- Locked tile on Buy Chips: "Cashout coming soon. Today, won pots stay as chips."
- "Notify me when cashout opens" toggle — feeds the eventual KYC waitlist.
- This honesty is the differentiator vs. simulated-stakes skill-gaming products. Players who buy in today know what the platform is becoming.

### ToS at signup
- Version-stamped ToS; user accepts at signup. Schema: `users.tos_version_accepted`, `users.tos_accepted_at`.
- The text makes the model explicit: entertainment chips, no cashout in v1, no monetary value outside the platform, refundable on request during the initial period.
- Version bumps require re-acceptance on next session.

### Risk-posture controls
- Geo-block red-line jurisdictions at edge (Cloudflare or the request layer in `apps/api/server.mjs`) *before* a charge is initiated. Initial blocklist comes from a quick survey of known-hostile US states and high-risk regions; refined as we get feedback.
- Kill-switch feature flag (`HORSEY_PAYMENTS_ENABLED=0`) — flips the panel off in 30 seconds if a complaint lands.
- Generous refunds for the initial N weeks, no questions asked. Cheap signal of good faith.
- Soft per-session and per-day spend caps; user-configurable, defaults to a sensible ceiling.

## What stays deferred (cashout = Phase 7 redux)

Phase 7 isn't deleted — it narrows. It's *cashout* and the AML/payout stack, not the entire money system. The current strategic thesis is to investigate a dual-currency / sweepstakes-compatible model as the fastest plausible route to redemption, but that does not remove legal review. Until Bucket D names a jurisdiction, rules model, custody model, and payout provider, the following don't ship:

- Real cashout flow.
- KYC at chip purchase (KYC only at cashout when that lands).
- Tax reporting / 1099-equivalents.
- Dual-currency split in production (`sweeps_cents` remains the right future shape, and is now the favored cashout-discovery model rather than a casual someday idea).
- Sportsbook-style responsible-play controls beyond the soft spend cap.

## Implementation order

**Slice 1 — scaffold (shipped):**

1. ToS module + versioned acceptance at signup (`packages/shared/tos.mjs`, `tos_acceptances` table). Re-acceptance modal on version bump.
2. `purchases` schema: `id, user_id, provider, provider_session_id, provider_payment_id, package_id, amount_usd_cents, chips_credited_cents, status, pay_currency, pay_amount, ledger_entry_id, raw_provider_json, created_at, updated_at`.
3. `cashout_waitlist` schema + `POST /api/cashout-waitlist`.
4. `HORSEY_PAYMENTS_ENABLED=0` kill switch.
5. Chip-package + currency catalog in `packages/shared/payments.mjs`.
6. Geo-block constant + helper (`isGeoBlocked({ country, region })`) — no edge geo lookup wired yet.
7. Profile → Buy Chips panel (locked tiles when killswitch off) + "Cashout coming soon" waitlist card.
8. Route stubs: `GET /api/tos` (public), `POST /api/tos/accept`, `POST /api/payments/checkout` (503 when disabled, 501 until slice 2), `POST /api/payments/webhook` (501), `GET /api/payments/purchases`.

**Slice 2 — NOWPayments wire-up (pending):**

1. NOWPayments merchant account + IPN secret; `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET` / `HORSEY_APP_URL` via `fly secrets set`.
2. `apps/api/payments.mjs` — thin HTTP client (no SDK, see ADR 0007). `createInvoice({ packageId, payCurrency, userId })` and `verifyIpnSignature(rawBody, header)`.
3. `POST /api/payments/checkout` creates a `purchases` row, calls `createInvoice`, persists `provider_session_id`, returns `invoice_url`.
4. `POST /api/payments/webhook` reads raw body, HMAC-SHA512 verifies against `NOWPAYMENTS_IPN_SECRET`, looks up `purchases` row by `provider_session_id`, transitions status via `mapNowPaymentsStatus`. On `finished` (and only once per row), inserts a `purchase` ledger entry inside a transaction that also sets `purchases.ledger_entry_id`.
5. Profile → Buy Chips: unlock tiles, click → `POST /api/payments/checkout` → redirect to `invoice_url`. Success page polls `GET /api/payments/purchases` until the relevant row is `finished`.
6. Edge geo-block check fires before invoice creation.
7. Admin read-out for in-flight + recent purchases (rolls into the admin slice that already shipped).

## Open questions

- Refund flow: self-serve or admin-only initially? Default: admin-only via compensating ledger entries through the Bucket B #1 read-only admin slice. **Decided 2026-05-27.**
- Disputes / IPN replays: log into a `payment_events` table behind the webhook so we can see patterns. Slice 2 follow-on.
- Whether to charge platform fees on chip purchases at all, or rely entirely on rake. Default: chip purchases are 1:1 floor with bonus chips on tiers; revenue is rake on play. **Decided 2026-05-27.**
- BTC / ETH / multi-chain support beyond stablecoins: deferred until v1 loop is proven. ADR 0007 names this as a follow-on.
