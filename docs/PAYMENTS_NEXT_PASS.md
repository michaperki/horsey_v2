# Payments Next Pass

**Posture set 2026-05-27.** Horsey ships with a real payments panel. Users buy chips with real money via Stripe. Cashout is deferred behind a "coming soon" wall — that's the legal model. The ToS at signup makes it explicit: chips are entertainment credit, no cashout, no expectation of cashout, no monetary value outside the platform.

This is a deliberate posture, not a missed step. The old blanket block on money code is narrowed: *cashout* still requires the Bucket D work (payout providers, KYC, AML, jurisdictional opinions). *Inbound* purchases of entertainment chips do not, given a clear ToS and a no-cashout disclaimer.

## What ships

### Buy Chips panel
- Lives under Profile → Buy Chips (and likely earns a topbar pill once it has traffic).
- Tiered chip packages with mild volume discount, prices forward, casino-grade visual treatment (felt, chip stack, no euphemism — see `PROJECT_SOUL.md` § Intentional casino energy).
- Stripe Checkout redirect; webhook credits the ledger with a `type='purchase'` entry on the existing `play_tokens_cents` column. Same chip the fake-money loop already uses. The chip is the chip; what changes is *how it got there*.
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

Phase 7 isn't deleted — it narrows. It's *cashout* and the AML/payout stack, not the entire money system. Until Bucket D names a jurisdiction, custody model, and payout provider, the following don't ship:

- Real cashout flow.
- KYC at chip purchase (KYC only at cashout when that lands).
- Tax reporting / 1099-equivalents.
- Dual-currency split (`sweeps_cents` remains the right future shape — useful only once cashout exists).
- Sportsbook-style responsible-play controls beyond the soft spend cap.

## Implementation order

1. Stripe account + product/price setup; sandbox keys; `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` via `fly secrets set`.
2. `purchases` schema: `id, user_id, stripe_session_id, stripe_payment_intent_id, amount_usd_cents, chips_credited_cents, status, created_at, completed_at`.
3. `POST /api/payments/checkout` — creates a Stripe Checkout Session for a chosen package; returns redirect URL.
4. `POST /api/payments/webhook` — verifies signature, idempotently credits chips via a ledger entry, marks `purchases.status='completed'`. Idempotency keyed on `stripe_session_id`.
5. Profile → Buy Chips UI with package tiles + Stripe redirect + post-redirect success page that polls/reads ledger.
6. ToS acceptance flow at signup (and re-acceptance on version bump). Schema migration to add columns.
7. Geo-block at edge.
8. Kill-switch flag + a tiny admin readout (rolls into Bucket B #1 admin slice).
9. Cashout-coming-soon tile + waitlist email collection.

## Open questions

- Stripe vs. another acquirer. Default: Stripe. Revisit if their AUP flags chess-wagering chips.
- Refund flow: self-serve or admin-only initially? Default: admin-only via compensating ledger entries through the Bucket B #1 read-only admin slice.
- Disputes/chargebacks: log into a `chargebacks` table behind the webhook so we can see patterns.
- Whether to charge platform fees on chip purchases at all, or rely entirely on rake. Default: chip purchases are 1:1 floor with bonus chips on tiers; revenue is rake on play.
