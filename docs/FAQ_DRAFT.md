# Horsey FAQ Draft

Internal draft of user-facing FAQ language. **Not yet public.** Sourced primarily from `OPERATIONAL_POLICY.md`'s "User-facing wording" snippets — that doc is the canonical policy source, this doc is the rendering layer for a public audience.

Goes live when (a) Bucket D's gaming-attorney conversation clears the wording, and (b) we have closed-beta traction that justifies publishing it. Until then, this is the answer sheet Horsey support uses to respond consistently when users ask.

Keep it short, factual, and matched to what's actually shipped. Don't write language for features that don't exist yet. When policy and product disagree, the product wins — fix one or the other and update this file in the same change.

---

## How Horsey works

Horsey is a chess wagering platform. Two players agree on a stake and time control, escrow their wagers, play a chess game with server-authoritative state, and the winner takes the pot minus rake. Chips bought through Horsey are entertainment credit — see "Cashout" below.

## Fair Play

Horsey monitors games for engine assistance, outside help, suspicious play patterns, artificial outcomes, and other integrity violations. The program is called **Horsey Secure Play**.

### What's not allowed

Players must make their own moves. Engines, analysis tools, opening-book apps, coaching during a match, shared-account play, or any outside help while a game is in progress are prohibited.

### How reviews work

Horsey may review matches, accounts, payments, and withdrawals for fraud, abuse, cheating, or suspicious activity. We won't describe exactly how detection works — that would help abuse. Matches may be reviewed, voided, or reassigned if cheating is detected or strongly suspected.

### What happens if a review finds something

Horsey may limit, suspend, ban, restrict rewards, delay withdrawals, void matches, or adjust settlements when integrity or abuse concerns exist. Severity depends on the evidence and the user's history.

## Match Rules

### Settlement

Match outcomes are settled according to server-authoritative game state, chess rules, clock rules, and Horsey integrity-review policies. The result you see in your client matches the result on Horsey's servers — your client cannot change the outcome.

### Disconnects

You have 15 seconds to play your first move once it's your turn. If you don't move in that window — whether you closed the tab, lost connection, or just walked away — the match aborts and both players' stakes are returned. Same for your opponent. Your main game clock (the 3 minutes, 5 minutes, whatever you picked) doesn't start ticking down until you actually play your first move.

After the first moves on both sides, your clock keeps running while you're away. If your clock expires while you're disconnected, you lose on time. Reconnect quickly.

If Horsey itself has a confirmed outage that affects your match, we may void, refund, or manually settle. Platform-side failures are on us; your own internet connection is on you.

### Reporting an opponent

You can report a game from the History or Settlement screen. Horsey will preserve the game data for review. We don't promise instant reversal — reviews take time, especially for engine-assistance cases that need post-game analysis. We'll communicate the outcome when the review is complete.

## Account

### Restrictions

Horsey may limit, suspend, review, or close accounts that violate integrity rules or present elevated risk. Restrictions range from soft (slower withdrawals, lower stake limits, no eligibility for promotions) to hard (full ban). The wording you see in your account status reflects what's restricted; we don't always explain *why* in detail, because doing so would help abuse.

### Rewards and promotions

Promotional rewards and account benefits are limited to legitimate individual users. Horsey may restrict rewards or withdrawals from accounts created or used abusively. Referral rewards may be withheld or revoked for fake, duplicate, or abusive account activity.

### Multi-accounting and self-dealing

Horsey may restrict, void, or review matches that appear to involve account manipulation, self-dealing, or artificial progression. Coordinated play, artificial match outcomes, and attempts to manipulate rewards or account status are prohibited.

## Wallet and Payments

### Buying chips

You can buy chips through the Buy Chips panel using supported stablecoins via NOWPayments. Receipts are visible in your Profile ledger.

### Refunds

We offer generous refunds during the initial period — contact support with your payment ID. After the initial window, refunds become case-by-case.

### Cashout

**Cashout is not currently available.** Chips bought through Horsey are entertainment credit and have no monetary value outside the platform. You can sign up to be notified when cashout opens.

This is by design: it's the honest answer to "what is this product?" right now. We'll let you know if and when that changes.

## Responsible Play

If you need to take a break from Horsey, contact support and we'll help you set up a self-exclusion or a cooling-off period. More tools are on the way. Don't wager money you can't afford to lose.

---

## Notes for future updates

When the gaming-attorney conversation happens (Bucket D), this doc gets a legal review pass before going live. Likely additions at that point:

- Jurisdiction-specific eligibility language (geo restrictions per region).
- Dual-currency disclosure if/when promotional sweeps credits launch.
- KYC requirements for users above a threshold.
- Formal dispute / appeal procedure beyond "contact support."
- Tax / reporting note for users in jurisdictions that require it.

Until then, the doc above is the working answer sheet.
