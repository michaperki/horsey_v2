# Horsey Operational Policy & Integrity Doctrine

This document is a working internal policy/implementation reference for Horsey. It is not yet a public FAQ, Terms of Service, or legal document, but it is intended to become the source material for those later documents.

Horsey is a competitive chess wagering product where players are primarily betting on themselves. That makes game integrity, payout confidence, account trust, and economy design core product features, not afterthoughts.

The goal is not to overbuild every possible defense before scale. The goal is to identify which risks matter now, which risks should be deferred, and which product/code decisions should leave room for future enforcement.

---

## Policy Status Labels

Use these labels throughout implementation planning:

- **Immediate**: Needed before or near first real-money users.
- **Soon**: Not required for launch, but should be designed for now.
- **Deferred until scale**: Real concern, but not worth building deeply yet.
- **Watchlist**: Track with logs/metrics; intervene manually if needed.
- **User-facing**: Should appear in FAQ, match rules, payout rules, or trust language.
- **Internal only**: Should not be described precisely to users because it could help abuse.

---

## 1. Match Integrity & Abuse

### 1.1 Self-Match Prevention

**Problem**  
A user could create two accounts and match against themselves.

**Why it may matter**

Self-matching is not automatically profitable in Horsey because the user may pay rake on the match. However, it becomes meaningful if users can farm trust, leaderboard status, quests, bonuses, onboarding rewards, avatar currency, or promotional currency.

**Current stance**  
Deferred until scale, unless incentives emerge that make self-matching profitable.

**Implementation notes**

- Log repeated matches between the same accounts.
- Log shared IP/device/payment/wallet signals once available.
- Prevent obvious same-session self-matching if easy.
- Do not overbuild this before real abuse exists.

**Future plan**

- Add account-linking heuristics.
- Restrict rewards/trust progression from suspicious repeated pairings.
- Add manual review flags for repeated value transfer between linked accounts.

**User-facing wording**

Horsey may restrict, void, or review matches that appear to involve account manipulation, self-dealing, or artificial progression.

---

### 1.2 Collusion Rings

**Problem**  
Multiple users could coordinate to manipulate outcomes, transfer value, farm rewards, or distort trust/reputation systems.

**Why it may matter**

In 1v1 chess, collusion is less central than in poker because there are no multi-player tables where several users team against one victim. The risk mostly appears in surrounding systems: reputation boosting, fake activity, laundering value, coordinated throws, referral/quest abuse, and promotional farming.

**Current stance**  
Deferred until scale / watchlist.

**Implementation notes**

- Track repeated clusters of users playing each other.
- Track suspicious win/loss cycling.
- Track suspicious transfer-like match behavior once real currency exists.
- Avoid exposing exact detection logic.

**Future plan**

- Graph-based abuse detection.
- Cluster-level trust penalties.
- Manual investigation tooling.

**User-facing wording**

Coordinated play, artificial match outcomes, and attempts to manipulate rewards or account status are prohibited.

---

### 1.3 Intentional Throws / Sandbagging

**Problem**  
A player may intentionally lose games to lower rating, boost another account, move value, or manipulate matchmaking.

**Why it may matter**

This becomes important when rating affects trust, rewards, matchmaking, access to stakes, or promotion eligibility.

**Current stance**  
Watchlist now; more serious once real-money and dual-currency systems mature.

**Implementation notes**

- Track noncompetitive losses.
- Track repeated losses to the same account or cluster.
- Track sudden rating drops followed by profitable streaks.
- Consider separating chess rating from trust/economy eligibility.

**Future plan**

- Automated suspicious-loss flags.
- Stake limits after abnormal rating movement.
- Manual review for high-value suspicious games.

**User-facing wording**

Players may not intentionally lose, manipulate ratings, or participate in artificial match outcomes.

---

### 1.4 Smurfing / Bum Hunting

**Problem**  
A strong player may use a fresh or lower-rated account to prey on weaker players. Public exact ratings may also encourage users to only seek weaker opponents.

**Why it matters**

This is likely one of the main fairness concerns users will understand. If a user is consistently and heavily profitable over a large sample, that may indicate rating mismatch, smurfing, selective opponent hunting, or cheating.

**Current stance**  
Important product-design question. Needs more discussion before final implementation.

**Possible design direction: Rating Blocks**

Instead of showing exact opponent ratings, Horsey could show rating bands/classes:

- Class D: 800–1000
- Class C: 1000–1200
- Class B: 1200–1400
- Class A: 1400–1600
- Expert: 1600–1800
- Master: 1800+

Example display:

> Micha — Class A (1800–2000)

This may reduce exact bum-hunting while still giving players a useful sense of opponent strength.

**Decided 2026-05-28**

- **Asymmetric reveal**: the player sees their own exact rating; opponents are displayed as a rating class only. Internal rating stays exact for matchmaking and admin.
- **Matchmaking gates are soft, not hard**, in the early days. The empty-bar problem is real — when there are few players online, strict band-gating kills the liquidity needed for an enjoyable lobby. Default to wider tolerance; revisit once volume can support tighter pairing. Stake-gap rules can tighten later as a Soon-class concern.

**Also decided 2026-05-28**

- **Reveal during matchmaking, not after.** Opponent class is shown upfront in the lobby — hiding then revealing on game-start would feel slot-machine, not sportsbook. Honesty in pairing reads better than a tease.
- **Profitability review is admin discretion, not automation.** No automatic flag-and-restrict pipeline for high-win-rate accounts; admins can review whoever they want, whenever they want, through the admin portal. Profitability is a signal an admin can sort by, not a rule the system enforces.

**Still open**

- Should higher stake limits require tighter rating-band matching? (Open question 4 — couples to trust-tier stake caps; resolve as one decision.)

**Implementation notes**

- Consider storing exact internal rating while displaying public rating blocks.
- Use rating class for matchmaking UI.
- Avoid exposing too much detail about profitability-based review.
- Consider stake caps when rating uncertainty is high.

**Future plan**

- Rating uncertainty / provisional rating state.
- Profitability anomaly tracking.
- Smurf-detection heuristics.
- Trust penalties or stake limits for suspicious accounts.

**User-facing wording**

Horsey may use rating bands, trust scores, and match history to promote fair pairings and reduce abusive matchmaking behavior.

---

### 1.5 Multi-Account Farming

**Problem**  
Users may create many accounts to collect starter tokens, promotional rewards, quests, spins, or future dual-currency benefits.

**Current situation**

Right now, each account receives 1000 virtual tokens used for low-value cosmetics/avatars. These are currently not economically meaningful. Multi-account farming is therefore possible but low-impact.

**Current stance**  
Deferred until dual currency / meaningful rewards. Add basic prevention and roadmap the rest.

**Implementation notes**

- Keep virtual starter-token farming low priority while tokens are worthless.
- Do not allow starter tokens to become directly withdrawable.
- When dual currency launches, separate free cosmetic currency from redeemable/promotional currency.
- Track account creation velocity by IP/device/email/wallet.
- Add rate limits around signup and reward claiming.

**Future plan**

- Device/IP/account-linking heuristics.
- Reward eligibility rules.
- Manual review for suspicious reward farming.
- Restrict promotional withdrawals from suspicious accounts.

**User-facing wording**

Promotional rewards and account benefits are limited to legitimate individual users. Horsey may restrict rewards or withdrawals from accounts created or used abusively.

---

### 1.6 Referral Abuse

**Problem**  
Users may create fake referred accounts to farm rewards.

**Current stance**  
Not relevant until referrals exist.

**Implementation notes**

- Do not build referral complexity before the referral system exists.
- When added, avoid instantly withdrawable referral rewards.
- Require referred users to complete meaningful activity before rewards unlock.

**Future plan**

- Referral fraud scoring.
- Delayed reward vesting.
- Device/IP/wallet uniqueness checks.

**User-facing wording**

Referral rewards may be withheld or revoked for fake, duplicate, or abusive account activity.

---

### 1.7 Bonus / Quest Exploitation

**Problem**  
Users may optimize around quests, daily rewards, spins, milestones, or promotions instead of real play.

**Current stance**  
Mostly deferred because bonuses and quests are not yet central.

**Implementation notes**

- Avoid rewards that can be farmed through trivial repeated actions.
- Do not make onboarding rewards directly withdrawable.
- Require real match activity and risk before meaningful rewards unlock.
- Separate cosmetic progression from cash-equivalent rewards.

**Future plan**

- Abuse-resistant quest design.
- Reward caps.
- Suspicious reward-claim monitoring.

**User-facing wording**

Promotions, quests, and rewards are subject to abuse review and may be limited, withheld, or changed.

---

### 1.8 Bots

**Problem**  
Bots could be used to farm rewards, simulate activity, manipulate liquidity, or create fake opponents.

**Current situation**

There are no bots on the real platform. Bots exist only in the development environment.

**Current stance**  
Not an immediate production risk, but user trust requires clarity if bots ever appear.

**Implementation notes**

- Keep dev bots clearly separated from production.
- Do not silently mix bots into real-money matchmaking.
- If bots are ever user-facing, label them clearly.

**Future plan**

- Bot detection if users script play.
- Distinguish platform bots, user bots, and engine assistance.

**User-facing wording**

Real-money matches should be against real users unless explicitly labeled otherwise.

---

### 1.9 VPN / Region Spoofing

**Problem**  
Users may use VPNs to bypass jurisdiction restrictions, duplicate-account checks, or abuse controls.

**Current stance**  
Deferred until geofencing or jurisdiction exclusions exist.

**Implementation notes**

- No need to overbuild VPN detection before there is a geofencing policy.
- Track IP country and obvious datacenter/VPN signals if easy.
- Keep the option to restrict withdrawals or rewards by region later.

**Future plan**

- Geo restrictions if required.
- VPN/datacenter IP risk scoring.
- Region-based terms and eligibility controls.

**User-facing wording**

Users may be required to comply with location-based eligibility rules. Horsey may restrict access, rewards, or withdrawals where eligibility cannot be verified.

---

### 1.10 Timeout / Disconnect Policy

**Problem**  
Users need to know what happens when a player disconnects, times out, reloads, loses internet, or the server has an issue.

**Why it matters**

This is an immediate trust issue. Users will care about this from day one.

**Current stance**  
Immediate.

**Policy (locked 2026-05-28)**

- Chess clocks are server-authoritative.
- **Pre-first-move abort.** Each side has **15 seconds** to play their first move once it's their turn. If white doesn't play move 1 in 15s, the match aborts; same for black after white moves. On abort, both stakes are returned via compensating ledger entries — no rake, no rating change, no winner. Nothing was risked yet, so nothing is taken. Disconnect, AFK, and tab-close all fall under this rule because the trigger is "no move in the window," not "we detected a disconnect."
- **Main clock is paused during the first-move window.** A player's main game clock (e.g. their 3 minutes on a 3+0) does not start ticking until they play their first move. The only timer the player is racing pre-move-1 is the 15s first-move window. After both sides have made their first move, the main clock runs normally. This prevents a player from being unfairly drained of clock time while the table is just being seated.
- **Pre-move resign collapses to abort.** If a player clicks "resign" before any move has been played, the game aborts rather than finalizing as a loss. Otherwise closing-the-tab and clicking-resign would have different money consequences, which is a footgun.
- **Post-first-move: the clock just runs.** Once at least one move has been played, the disconnect is treated like any other clock event. A disconnected player may reconnect and continue; if their clock expires while away, they lose on time. No pause, no grace beyond normal reconnect attempts.
- If the *server* or platform has a confirmed outage, Horsey may void / refund affected matches.
- If both players disconnect or the match state becomes unrecoverable, Horsey may void, refund, or manually settle the match.
- Users are responsible for their own internet connection; platform-side failures are handled fairly.
- **Repeat-offender escalation.** A pattern of pre-move aborts by the same account is a slice-2 (admin mutation + audit) signal, not a slice-1 concern. The schema captures `state='aborted'` per game; admins can sort/filter on it and escalate through the shadow-restriction ladder (§ 1.14) if a user is using aborts to dodge unfavorable pairings.

**Implementation notes**

- Server-authoritative game state and clocks.
- Pre-first-move abort path needs to exist on settlement: `settleGame(reason='aborted_pre_move')` returns both stakes via compensating ledger entries, no rake.
- Match status states: active, aborted, timeout, resigned, completed, voided, under review.
- Audit logs for disconnects, reconnects, timeout settlement, aborts, and refunds.

**Future plan**

- **Claim-victory button (Lichess-style).** If your opponent has been disconnected long enough that their inactivity is unreasonable for the time control, a "claim victory" CTA appears for you and forces a settlement. Spec out later; the threshold should be tied to time-control class (faster TCs need shorter grace). On the roadmap, not v1.
- Better connection quality indicators.
- Automatic platform-outage detection.
- Support tooling to inspect disconnect disputes.

**User-facing wording**

You have 15 seconds to play your first move. If you don't move in time, the match aborts and your stake is returned — same for your opponent. After the first moves on both sides, your clock keeps running while you're away — if it expires, you lose on time. Platform-side outages may be reviewed and refunded or voided at Horsey's discretion.

---

### 1.11 Engine-Assisted Cheating

**Problem**  
Users may use a chess engine, analysis board, external tool, or automated move assistance during a match.

**Why it matters**

This is likely the first and most obvious integrity concern users will raise. Any real-money chess product must visibly address it.

**Current stance**  
Immediate.

**Detection direction**

Horsey should monitor games for suspicious chess patterns without revealing exact detection thresholds. Internally, signals may include:

- centipawn loss patterns,
- blunder rate,
- engine correlation,
- move timing,
- strength consistency,
- rating/profitability mismatch,
- suspicious improvement curves,
- high-accuracy play in tactically complex positions,
- repeated suspicious behavior across games.

Externally, we should avoid precise details and instead use a branded integrity phrase. **Locked 2026-05-28:** the public-facing brand is **Horsey Secure Play**. Use exactly that phrase in user-facing copy (badges, History/Profile/Settlement sections, dispute responses, the eventual FAQ).

**Implementation notes**

- Build or integrate post-game analysis.
- Store enough game data for later review.
- Keep exact thresholds internal.
- Reserve the right to void games, ban users, withhold payouts, or award funds.
- Avoid promising perfect real-time detection.

**Future plan**

- Post-game automated analysis.
- Manual review queue.
- Risk scoring by account.
- Stake limits for suspicious accounts.
- Public enforcement summaries without revealing detection methods.

**User-facing wording**

Horsey monitors games for engine assistance, suspicious play patterns, and other integrity violations. External move assistance is prohibited. Matches may be reviewed, voided, or reassigned if cheating is detected or strongly suspected.

---

### 1.12 External Human Assistance

**Problem**  
A user may receive help from a stronger player, coach, friend, Discord call, stream chat, or shared account rather than directly using an engine.

**Why it matters**

Users need confidence that “cheating” includes more than engine use.

**Current stance**  
Immediate as policy language; detection can mature over time.

**Implementation notes**

- Use broad prohibition: “external assistance of any kind.”
- Do not limit language only to engines.
- Track suspicious play patterns rather than only engine correlation.
- Consider account-sharing signals later.

**Future plan**

- Broader suspicious-performance review.
- Account-sharing detection.
- Manual investigation tooling.

**User-facing wording**

Players must make their own moves. Engines, analysis tools, coaching, shared-account play, or outside help during a match are prohibited.

---

### 1.13 Suspicious Value Transfer / Noncompetitive Games

**Problem**  
Some games may function less like real competition and more like value transfer between accounts.

**Current stance**  
Watchlist now; important once real currency and withdrawals exist.

**Better framing**

Avoid generic sportsbook language like “unnatural betting patterns.” For Horsey, the relevant concepts are:

- suspicious stake movement,
- repeated value transfer between accounts,
- coordinated win/loss cycling,
- suspiciously noncompetitive games,
- rating/reputation manipulation,
- laundering-like match behavior.

**Implementation notes**

- Track repeated high-value matches between same users.
- Track one-sided noncompetitive outcomes.
- Track value flow between account clusters.
- Flag games for review before large withdrawals.

**Future plan**

- Account graph analytics.
- Withdrawal review triggers.
- Automated holds for suspicious flows.

**User-facing wording**

Horsey may review matches that appear noncompetitive, coordinated, artificial, or designed primarily to transfer value.

---

### 1.14 Shadow Restrictions vs Hard Bans

**Problem**  
When users are suspicious, Horsey needs enforcement options beyond only “do nothing” or “permanent ban.”

**Current stance**  
Important but not urgent. Mostly internal.

**Hard ban**

Pros:

- clear,
- decisive,
- easy to understand,
- strong signal to community.

Cons:

- creates appeals,
- creates conflict,
- may teach abusers what was detected,
- may cause them to return with new accounts.

**Shadow / soft restrictions**

Examples:

- lower trust score,
- reduced stake limits,
- delayed withdrawals,
- promotion ineligibility,
- restricted matchmaking,
- manual review requirement,
- reduced visibility,
- no rewards from suspicious matches.

Pros:

- less confrontational,
- preserves investigation flexibility,
- limits damage without revealing detection logic.

Cons:

- can feel unfair if discovered,
- needs careful internal governance,
- support must be prepared.

**Implementation notes**

- Build account status states beyond banned/not banned.
- Add internal notes/review reasons.
- Keep user-facing language broad.

**Future plan**

- Trust-tier enforcement ladder.
- Manual review dashboard.
- Appeal process for serious sanctions.

**User-facing wording**

Horsey may limit, suspend, review, or close accounts that violate integrity rules or present elevated risk.

---

## 2. Economy Design

### 2.1 Currency Model

**Problem**  
Horsey needs a clear distinction between cosmetic/play value and economically meaningful value.

**Current stance**  
Moving toward dual currency.

**Current situation**

- Users currently receive 1000 virtual tokens.
- These are used for avatars/cosmetics.
- They are currently not meaningful money.

**Future direction**

A standard dual-currency model may include:

- **Cosmetic / play currency**: purchased or granted; not withdrawable.
- **Promotional / redeemable currency**: earned through promotions, play, or other eligible methods; potentially redeemable under rules.

**Implementation notes**

- Never casually make existing free tokens withdrawable.
- Keep ledgers separate.
- Make every currency movement auditable.
- Avoid ambiguous wallet language.

---

### 2.2 Rake

**Problem**  
Horsey needs to earn revenue from matches without making the economy feel predatory or confusing.

**Current stance**  
Rake is core to the model.

**Implementation notes**

- Rake should be visible before match confirmation.
- Settlement should clearly show stake, rake, and payout.
- Rake may differ by currency type.
- Rake policy affects whether self-matching/value transfer is profitable.

**User-facing wording**

Before entering a match, players should be able to see the stake, fee/rake, and potential payout.

---

### 2.3 Inflation / Sinks / Sources

**Problem**  
If currency can be earned, transferred, spent, or redeemed, the system needs controlled sources and sinks.

**Current stance**  
Important before meaningful rewards scale.

**Implementation notes**

Sources may include:

- purchases,
- daily rewards,
- promotions,
- quests,
- match winnings,
- milestone rewards.

Sinks may include:

- rake,
- cosmetics,
- entry fees,
- upgrades,
- tournament fees,
- limited items.

**Risk**

If rewards are too generous, farmers/bots exploit them. If rewards are too stingy, the product feels dead.

---

### 2.4 Cosmetic Economy

**Problem**  
Cosmetics create progression, identity, and retention without necessarily creating direct gambling exposure.

**Current stance**  
Core product layer.

**Implementation notes**

- Cosmetic currency can absorb reward pressure safely.
- Avatars, frames, badges, trails, and table effects can serve as sinks.
- Cosmetic progression should not create unfair chess advantages.
- Some cosmetics may reflect trust, rank, or achievement.

---

### 2.5 Reward Farming

**Problem**  
Any reward can become a farming target.

**Current stance**  
Design against obvious farming; defer advanced controls until needed.

**Implementation notes**

- Do not make signup rewards cash-equivalent.
- Cap daily promotional rewards.
- Require real match activity for meaningful rewards.
- Delay or review withdrawals tied to promotions.
- Track unusual reward efficiency.

---

## 3. Payments / Crypto Operations

### 3.1 NOWPayments / Crypto Model

**Current stance**  
Horsey is using NOWPayments / crypto, not Stripe.

**Why this matters**

This avoids some card/chargeback issues but creates different operational risks:

- wrong-chain deposits,
- delayed confirmations,
- irreversible transactions,
- wallet security,
- sanctions/AML exposure,
- withdrawal mistakes,
- provider downtime,
- crypto volatility if non-stable assets are used.

**Implementation notes**

- Treat every deposit and withdrawal as an auditable ledger event.
- Store provider invoice/payment IDs.
- Handle delayed/partial/failed payments.
- Use idempotency for checkout and webhooks.
- Never rely only on frontend state for payment status.

---

### 3.2 Deposits

**Policy needs**

- What currencies are accepted?
- What confirmation count is required?
- What happens if payment is late?
- What happens if user sends wrong amount?
- What happens if user sends on wrong chain?
- What happens if provider says pending/expired/failed?

**Implementation notes**

- Display clear payment status.
- Reconcile provider status server-side.
- Keep raw webhook payloads or normalized payment event logs.

---

### 3.3 Withdrawals

**Policy needs**

- Minimum withdrawal.
- Manual vs automatic review.
- Withdrawal delay/hold.
- Wallet confirmation.
- Suspicious account restrictions.
- Fees.
- Failed withdrawal handling.

**Implementation notes**

- Consider withdrawal holds for new accounts.
- Consider manual review for large or suspicious withdrawals.
- Add a withdrawal state machine: requested, reviewing, approved, sent, failed, canceled.
- Require re-authentication or confirmation before withdrawal.

---

## 4. Security

### 4.1 Account Takeover

**Problem**  
If accounts hold balances, attackers will try to steal them.

**Current stance**  
Soon / important before meaningful balances.

**Implementation notes**

- Strong session security.
- Rate limits on login.
- Email verification if applicable.
- Optional 2FA later.
- Withdrawal confirmation.
- New-device withdrawal holds.
- Audit logs for login, wallet change, withdrawal request.

---

### 4.2 Wallet Draining / Withdrawal Abuse

**Problem**  
An attacker who controls an account may attempt to drain funds quickly.

**Current stance**  
Important before withdrawals.

**Implementation notes**

- Withdrawal cooldowns after password/email/wallet changes.
- Manual review for suspicious withdrawals.
- Per-account withdrawal limits.
- Velocity limits.
- Admin ability to freeze withdrawals.

---

### 4.3 Admin / Insider Risk

**Problem**  
Admins may have the ability to alter balances, settle matches, ban users, or approve withdrawals.

**Current stance**  
Soon.

**Implementation notes**

- Admin actions must be logged.
- Avoid silent balance edits.
- Require reason fields for manual settlement/adjustment.
- Separate read-only support from powerful admin controls.

---

### 4.4 API / Websocket Abuse

**Problem**  
Users may spam matchmaking, reconnects, game actions, chat, or payment endpoints.

**Current stance**  
Basic protection soon; advanced protection later.

**Implementation notes**

- Rate-limit sensitive endpoints.
- Validate every game action server-side.
- Make game state authoritative on the server.
- Avoid trusting client clocks, balances, or match results.

---

## 5. Support / Human Operations

### 5.1 Payout Disputes

**Problem**  
Users will dispute lost funds, delayed deposits, failed withdrawals, and match settlements.

**Current stance**  
Immediate once money is live.

**Implementation notes**

- Every match needs a clear settlement record.
- Every payment needs a provider reference.
- Support should be able to inspect match, payment, and ledger history.
- Do not rely on screenshots from users as source of truth.

---

### 5.2 “The System Cheated Me” / “Opponent Cheated”

**Problem**  
Real-money losses create emotional support load.

**Current stance**  
Immediate.

**Implementation notes**

- Create a standard dispute flow.
- Let users report suspicious games.
- Do not promise instant reversal.
- Preserve game data for review.
- Communicate that integrity reviews may affect settlement.

**User-facing wording**

Players may report suspicious games. Horsey may review games and take action, including voiding games, adjusting settlement, limiting accounts, or banning users.

---

### 5.3 Addiction / Responsible Play Complaints

**Problem**  
Any real-money wagering product may receive complaints about excessive play, losses, or addiction.

**Current stance**  
Needs basic policy before scale.

**Implementation notes**

- Consider self-exclusion.
- Consider deposit/stake limits.
- Consider cooling-off periods.
- Avoid aggressive dark-pattern reactivation after losses.

---

### 5.4 Ban Appeals / Enforcement Support

**Problem**  
Users will ask why they were banned, limited, or denied withdrawal.

**Current stance**  
Soon.

**Implementation notes**

- Keep internal evidence and notes.
- Avoid revealing exact anti-cheat methods.
- Use broad categories: integrity violation, suspicious activity, account abuse, payment risk.

---

## 6. Trust System

### 6.1 Purpose

The trust system should help Horsey manage risk without forcing every issue into a public rating or binary ban.

Trust may affect:

- stake limits,
- matchmaking access,
- withdrawal review,
- promotion eligibility,
- account visibility,
- manual review priority.

---

### 6.2 Inputs

Possible trust inputs:

- account age,
- match history,
- completed payments,
- withdrawal history,
- dispute history,
- cheat flags,
- suspicious pairing patterns,
- rating/profit mismatch,
- device/IP/account-linking signals,
- verified identity if ever added.

---

### 6.3 User-Facing vs Internal Trust

**Important distinction**

Some trust signals can be public, such as verified/provisional badges. Other trust signals should remain internal because exposing them helps abuse.

**Implementation notes**

- Public trust tiers should be simple.
- Internal risk score can be more detailed.
- Avoid telling users exactly how to increase risk score or bypass restrictions.

---

## 7. Public FAQ / Terms Source Material

These are candidate user-facing principles derived from the internal doctrine.

### Fair Play

Horsey monitors games for engine assistance, outside help, suspicious play patterns, artificial outcomes, and other integrity violations.

### External Assistance

Players must make their own moves. Engines, analysis tools, coaching, shared-account play, or outside help during a match are prohibited.

### Match Settlement

Match outcomes are settled according to server-authoritative game state, chess rules, clock rules, and Horsey integrity review policies.

### Disconnects

If a player disconnects, their clock may continue running. Platform-side outages may be reviewed and may result in a void, refund, or manual settlement.

### Reviews

Horsey may review matches, accounts, payments, and withdrawals for fraud, abuse, cheating, or suspicious activity.

### Enforcement

Horsey may limit, suspend, ban, restrict rewards, delay withdrawals, void matches, or adjust settlements when integrity or abuse concerns exist.

### Promotions

Promotions, bonuses, quests, and rewards are subject to abuse controls and eligibility rules.

---

## 8. Implementation Priorities

### Before first real-money users

- Server-authoritative match state and clocks.
- Basic disconnect/timeout policy.
- Clear settlement records.
- Payment webhook reliability.
- Ledger/event history for deposits, matches, rake, payouts.
- Basic report/dispute flow.
- Broad anti-cheat / external assistance policy.
- Ability to manually void/refund/adjust a match.
- Ability to freeze or restrict an account.

### Soon after launch

- Post-game engine-analysis pipeline.
- Manual review dashboard.
- Public rating blocks or rating-display decision.
- Basic multi-account and signup abuse signals.
- Withdrawal holds/review states.
- Admin audit logs.
- Trust-tier effects on stake limits.

### Deferred until scale

- Graph-based collusion detection.
- Advanced VPN/geofencing enforcement.
- Referral fraud systems.
- Sophisticated quest/bonus farming detection.
- Full risk-scoring engine.
- Automated enforcement ladders.
- Advanced responsible-play tooling.

---

## 9. Open Questions

### Answered (2026-05-28)

- **Q1+Q2: rating display** → asymmetric. Player sees their own exact rating; opponents are shown as class only. Soft matchmaking gates only, in deference to the empty-bar problem. Opponent class is **revealed during matchmaking, not after** — a reveal-after-match approach would feel slot-machine, not sportsbook. See § 1.4 and `RATING_BLOCKS_NEXT_PASS.md`.
- **Q4: profitable users reviewed automatically?** → No. Admin discretion only. Admins can sort by profitability in the admin portal and act on whoever they want, but no automated flag-and-restrict pipeline. See § 1.4.
- **Q5: how loud the anti-cheat messaging?** → Wait for data. The "Horsey Secure Play" badge does not appear until per-user analysis has ≥10 games (Lichess / Chess.com import + Horsey platform games pooled), with average centipawn loss and blunder rate as the floor metrics, ~95% confidence on the rolling estimate. Calibrating users get no badge but play normally. See `FAIR_PLAY_NEXT_PASS.md` § Badge gating.
- **Q6: minimum viable disconnect policy** → pre-first-move disconnect aborts the match and returns both stakes; post-first-move the clock just runs. Lichess-style "claim victory" on the roadmap, not v1. See § 1.10.
- **Q7: what match outcomes can be reversed, and by whom?** → All of them, admin discretion. The Bucket B admin mutation slice owns the audit-trail mechanics (`admin_actions` table, reason fields, before/after capture). No rules on *what* can be reversed, only rules on *how*. See `IMPLEMENTATION_PLAN.md` Bucket B.
- **Q8: what account restrictions besides full bans?** → Ship the full shadow-restriction ladder at v1 (lower trust score → reduced stake limits → delayed withdrawals → promotion ineligibility → restricted matchmaking → manual review required → reduced visibility → no-rewards-from-suspicious-matches → hard ban). Hard ban exists but is expected to be rare early. See `FAIR_PLAY_NEXT_PASS.md` § Enforcement Ladder.
- **Q9 (working answer): dual-currency** → sweepstakes-compatible framing remains the favored direction. Cosmetic / play chips stay non-withdrawable; promotional / redeemable sweeps credits are a future separate ledger. The free 1000 starter tokens are play-chips only and never become directly withdrawable. See § 2.1 and `IMPLEMENTATION_PLAN.md` Trust Tiers § Dual-currency model.
- **Q10: FAQ vs internal** → User-facing FAQ language is drafted in `FAQ_DRAFT.md`, assembled from this doc's "user-facing wording" snippets. The draft is internal until the gaming-attorney conversation (Bucket D, deferred) clears it for publication. Internal-only items (detection thresholds, exact restriction triggers, the `admin_actions` audit format) stay in this doc and `FAIR_PLAY_NEXT_PASS.md`.

### Still open

3. Should stake limits depend on rating gap? (Couples to trust-tier stake caps. Resolve as one decision.)
