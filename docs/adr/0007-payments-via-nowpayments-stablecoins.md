# ADR 0007: Payments v1 via NOWPayments, stablecoins only

Status: accepted

## Context

Horsey ships a fake-money playable loop today. The next product step (Bucket C in `docs/IMPLEMENTATION_PLAN.md`) is letting users buy non-cashout entertainment chips with real money. Cashout / redemption remains gated to Phase 7 — see ADR-pending Bucket D discovery.

Three decisions had to be made before writing payment code:

1. **Card / fiat vs. crypto.** A traditional card acquirer (Stripe et al.) is the simplest engineering but has a structural problem for this product category: card acquirers' AUPs broadly disallow wagering on real money, even for products framed as "entertainment credit." Even pre-cashout, the underlying intent makes onboarding fragile.
2. **If crypto, which provider model.** Hosted invoice provider, self-hosted hot-wallet monitoring, or a wallet-connect / Web3 flow.
3. **Which currencies to accept first.**

## Decision

### Crypto, not fiat. NOWPayments as the provider.

We accept chip purchases through NOWPayments. The selection rationale:

- Hosted invoice flow (create-invoice → hosted page → redirect back → IPN webhook → credit) maps cleanly onto the same engineering pattern we would have used for Stripe Checkout. The `purchases` table, kill switch, ToS, and credit-on-webhook idempotency all stay the same.
- NOWPayments explicitly accepts wagering merchants. Most "respectable" crypto processors (Coinbase Commerce, BitPay) do not — or impose terms we'd violate.
- Signed IPNs (HMAC-SHA512 against the merchant IPN secret) give us a security boundary we can verify, rather than hand-rolling chain monitoring.
- We avoid running production hot-wallet infrastructure during the closed beta. If volume justifies it later, the same `purchases`-and-webhook seam swaps to a self-hosted address-monitoring system without a UI rewrite.

### Stablecoins only for v1: USDT and USDC.

- Stablecoins keep the entertainment-chip framing honest: "$5 in real money buys 5 chips" is only true if the in-between asset doesn't fluctuate. BTC/ETH would force volatility-handling logic (lock invoice price for N minutes, refund or credit the difference) for a marginal v1 audience benefit.
- USDT on TRC-20 (Tron) has near-zero network fees and is overwhelmingly what wagering-product users actually deposit (per the CoinPoker reference).
- USDC on Polygon and Solana similarly keep network fees in the cents-not-dollars range.
- BTC, ETH, and other tokens can be added incrementally without re-shaping the schema or webhook.

### Credit only on `finished`, not on `confirmed`.

NOWPayments reports status transitions `waiting → confirming → confirmed → sending → finished`. We credit chips when status reaches `finished` (funds settled to the merchant payout address). This is slower than crediting on `confirmed` but eliminates reorg risk and matches the no-rush posture of entertainment chips. The `purchases.status` column tracks all states so the user can see "pending" without us having credited yet.

## Departures from prior ADRs

- ADR 0001 declared "no third-party chess, UI, payment, or realtime dependencies yet." This ADR supersedes the *payments* portion of that posture. We're adding the NOWPayments interaction as raw HTTP (matching the `email.mjs` pattern) — the IPN signature check is a plain HMAC-SHA512, well understood, and doesn't justify pulling in their SDK. If a future complication (multi-currency settlement, batched payouts, subscriptions) makes raw HTTP painful, revisit then.

## Consequences

- Net new code surface: `apps/api/payments.mjs` (NOWPayments HTTP client + IPN verification), `purchases` table, `tos_acceptances` table + `users.tos_version_accepted` column, `cashout_waitlist` table, geo-block constant, `HORSEY_PAYMENTS_ENABLED` kill switch.
- New runtime env: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, plus the existing `HORSEY_APP_URL` for the return URL.
- ToS acceptance gate at signup, with re-acceptance required on version bump. Versioned in code (`packages/shared/tos.mjs`) so a version bump is a one-line change and the modal re-fires automatically.
- Geo-block enforced server-side on `/api/payments/*` and the Buy Chips panel UI hides itself client-side. Initial blocklist is conservative; real legal review remains Bucket D's job.
- Phase 7 (cashout) remains gated on Bucket D discovery. Inbound purchases do not change that posture.

## Out of scope

- KYC at purchase. NOWPayments handles its own merchant compliance; chip purchases for entertainment credit do not require KYC under our framing. KYC re-enters scope only at cashout (Phase 7).
- Refund flow: admin-only via compensating ledger/admin tooling. No self-serve refund UI in v1.
- Fiat acquirer: not ruled out forever, but not v1. If a card acquirer is added later, the `purchases` table grows a `provider` column.
- Tax reporting / 1099-equivalents: out of scope until cashout.
