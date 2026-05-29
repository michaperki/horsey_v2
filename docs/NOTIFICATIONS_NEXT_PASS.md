# Notifications Next Pass

**Posture set 2026-05-27, surface choice locked 2026-05-27.** Horsey cannot rely on "the event fired" as the user experience. If a bot, rival, or stranger challenges a player, the recipient needs a visible route to receive it, inspect it, and act before expiry. If a pot is held for security review, the player needs a reliable place to find the verdict later. Notifications are part of the wager loop.

The current realtime layer is necessary but not sufficient. WebSocket events wake the UI while the user is online; durable notification rows provide the inbox, unread count, reconnect recovery, and audit trail.

## Two jobs, one surface

The notification system serves two cognitively distinct jobs:

1. **Time-bounded actionable.** Bob challenged you; draw offered; the clock will flag in 30s. These need to wake the user; if missed, they become irrelevant.
2. **Async resolution of something the user already did.** Your pot from game #X cleared security review and $42 was credited. Your $20 payment cleared. Your cashout was declined, reason: …. Not actionable in the moment; not time-bounded; but the user *will* come looking later, sometimes hours later, and trust depends on the record being there.

Both ship through the same surface (the bell, below). The data model has to recognise that they have opposite shapes — actionable items have a short life and resolve into oblivion; async resolutions have a long tail and must persist.

## Surface — bell only

One surface. No toasts. No persistent banner stack. No conditional chrome chips.

- **Topbar bell with unread count** on every authenticated page.
- **Compact dropdown** on click: recent items, scrollable, each with a one-line title + relative timestamp + one-tap deep link.
- **Full panel at Profile → Notifications** for history beyond the dropdown's window.
- **Read/unread state** per user, survives refresh, updates in-place when the row is opened or its underlying entity changes.

Surface explicitly rejected (and why):
- **Toast popups** — interrupt focus; user explicitly opted out.
- **Persistent banner stack** — would compete with the verify-email banner pattern and lose its meaning as "this is the one important nag."
- **Conditional chrome chips** ("1 challenge", "1 pot pending") — clever but loses history that pot/payment/cashout events must keep around for trust.

## Settlement is the source of truth for pot state

When pot disbursement is gated on security review (future Phase 6/7 work — not today), the **settlement page itself shows the pending state** with a clear "review in progress, typical ~N min" cue. The notification is a *deep link into settlement*, not a parallel display of pot state.

This means:
- One canonical place to read pot state (settlement / history detail).
- Notifications carry "here's where to look," not "here's the current value." They redirect.
- A user can open settlement directly (history detail link) and see the same pending → resolved transition without ever touching the bell.
- The bell row for a pot is one logical thread that updates in place: title moves from "Pot pending review" → "Pot awarded $42" → "Pot held for review (escalated)" on the same row. No double-write, no scroll-burying.

The same principle extends to payment and cashout flows: their canonical state lives on a Profile sub-page; the notification redirects there.

## Data model — entity-anchored, state mutates

Rows are anchored to `(user_id, entity_type, entity_id)` and update in place rather than being append-only. A pot's lifecycle is one row whose `status` and `title` mutate.

`notifications` schema:

```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL
type            TEXT NOT NULL          -- 'challenge_received', 'pot_state', 'payment_state', ...
entity_type     TEXT NOT NULL          -- 'challenge' | 'game' | 'payment' | 'cashout' | 'account'
entity_id       TEXT NOT NULL
status          TEXT NOT NULL          -- type-specific: 'pending' | 'resolved' | 'expired' | 'failed' | ...
title           TEXT NOT NULL          -- denormalized at create/update
body            TEXT
data_json       TEXT                   -- route hint, action context, money amount, etc.
read_at         TEXT
created_at      TEXT NOT NULL
updated_at      TEXT NOT NULL
UNIQUE(user_id, entity_type, entity_id)
```

The UNIQUE constraint enforces the one-thread-per-entity rule. `createNotification` becomes upsert-shaped: if a row already exists for the same `(user_id, entity_type, entity_id)`, mutate it; otherwise insert. The realtime layer publishes `notification.created` or `notification.updated` accordingly.

Read/unread semantics on update: an entity transitioning to a *new* status (pending → awarded) flips `read_at` back to null so the user notices the resolution. An entity transitioning to a *terminal-but-uninteresting* status (challenge expired without action) does not — there's no reason to nag.

## Event taxonomy

Time-bounded actionable:
- `challenge_received` (entity = challenge) — direct challenges only; open-table fanout would drown the bell.
- `challenge_countered` (entity = challenge).
- `draw_offered` (entity = game).
- `turn_started` (entity = game) — async/correspondence modes only when those land; do not spam blitz.

Async resolution:
- `pot_state` (entity = game) — `pending_review` → `awarded` / `held` / `disputed`. The notification redirects to settlement.
- `payment_state` (entity = payment) — `processing` → `completed` / `failed` / `refunded`. Redirects to Profile → Payments.
- `cashout_state` (entity = cashout) — `submitted` → `approved` / `paid` / `rejected`. Redirects to Profile → Cashouts.
- `account_action_required` (entity = account) — verification expired, password reset confirmed, suspicious sign-in, ToS bump.
- `cashout_waitlist_opened` (entity = account) — sent to waitlist subscribers when the gate opens.

Terminal but worth filing as record:
- `game_finalized` for non-player observers / record-keeping. Players see this through settlement directly; the row exists so the audit trail is complete in the inbox.

Explicitly out of scope:
- Open-table challenge fanout — would generate one row per recipient and overwhelm the bell.
- Per-move notifications in live games — the board is the surface.
- Marketing / re-engagement nudges — different system if it ever exists.

## Product rules

- Notifications should be actionable or load-bearing for trust. Never both noisy and disposable.
- Loss copy stays neutral or winner-centric; never "you lost $X."
- Settlement / Profile sub-pages are canonical for entity state. Notifications redirect, they don't reproduce.
- Challenge expiry is honest urgency. Payment and retention surfaces must not manufacture urgency.
- Browser push / email / SMS are later channels. The first product requirement is in-app durability.

## Implementation shape

1. `notifications` table per the schema above. Migration adds the table; no backfill (notifications are forward-looking).
2. API:
   - `GET /api/notifications` — list for viewer, paginated, newest first.
   - `GET /api/notifications/unread-count` — number; cheap; pollable until the WS event lands.
   - `POST /api/notifications/:id/read` — flip `read_at`.
   - `POST /api/notifications/read-all` — sweep.
3. Server helper: `upsertNotification({ userId, type, entityType, entityId, status, title, body, data })` colocated with challenge / game / payment mutations. Upsert keyed on the UNIQUE triple; inserts → publish `notification.created`; updates → publish `notification.updated`.
4. Realtime: `notification.created` and `notification.updated` published to `user:<userId>`. Client bumps unread count and slides the row to the top of the bell.
5. Bootstrap response includes unread count and the most recent N rows so reconnect/refresh is correct.
6. Client topbar bell renders unread count, dropdown, and route-aware deep links. Profile → Notifications renders the full list.
7. Challenge lifecycle mutations (`createChallenge`, accept, decline, counter, withdraw, expire) upsert the matching row to its new status.
8. Dev-bot greeting path uses the same direct-challenge upsert. No bot-only side channel.
9. Settlement page renders pot pending state directly (when the security-review pipeline lands) — the bell is the redirector, not the source.

## What lands first

The pot-review / payment / cashout pipelines that justify the async-resolution side of this design **do not exist yet**. Today's slice is just:

- Schema + upsert + read/unread API + realtime publish + bootstrap + client bell.
- Challenge lifecycle wired in (the only live event source we have now).
- `pot_state`, `payment_state`, `cashout_state` event types reserved in the taxonomy so when those systems land, they plug into an already-built inbox without surface churn.

The data model is doing the future-proofing here. The visible surface is small.

## Open questions

- Pagination: cursor by `updated_at` or `created_at`? Probably `updated_at` so an entity that just moved to "awarded" lifts back to the top.
- Whether `account_action_required` should also mirror to email when the address is verified. Default: yes once email is configured (Resend is already wired).
- How long to keep terminal rows. Default: forever for money-related events (audit trail), 90 days for resolved social events.
- ~~Whether the bell should render a soft sound on `notification.created`.~~ **Decided 2026-05-27:** yes. A soft two-note rising chime (`notification_arrived`, tier-2 ambient) plays when a new row arrives in real time. Honors the existing sound-mode setting — silenced under `essentials` and `mute`. Distinct timbre from milestone and check chimes.

## Fair-play & enforcement: event taxonomy & surface selection (decided 2026-05-29)

Motivating gap: admin enforcement is built end-to-end (`apps/api/server.mjs` — void, adjust, restrict, ban, report resolution, all with an `admin_actions` audit trail), but today the only persisted notifications are `challenge_received` / `challenge_countered`. Review outcomes, voids, payout adjustments, resolved reports, and restrictions never reach the user. This section is the canonical record of *which* outcomes surface and *where*.

### Be selective — a notification is not the default

A bell notification is the *loudest* surface and the easiest to overuse. Reserve it for things that (a) happened while the user was not looking and (b) need their attention. Specifically:

- **No "game finished" notification when the user was actively playing the game** — the settlement screen already tells them. A notification would be noise.
- Most state belongs in a surface the user visits on their own (settlement, history, balance), not pushed to the bell.
- Quiet/shadow enforcement gets *no* surface at all by design (see `OPERATIONAL_POLICY.md` § 1.14).

### Surfaces available

- **Notification (bell)** — async, pushed; for outcomes that occurred while the user was away and changed something material.
- **Settlement UI** — the post-game screen (`settlementPayload`); already renders `voided` / `aborted` / `draw` / win / loss.
- **Game history** — the per-game list; reflects final state (e.g. a "Voided" tag).
- **Balance history** — the ledger view; every credit/refund/reversal already appears here as an entry.
- **Account state** — persistent status on Profile/account (badge, calibration, suspension banner).
- **Error / inline copy** — shown at the moment an action is blocked (over-wager, blocked login).

### Event → surface matrix

| Event | Notification? | Primary surface(s) | Notes |
|---|---|---|---|
| Game finished, user present | No | Settlement UI, History | Live result already shown; bell would be noise. |
| Game finished, user away (disconnect/timeout while gone) | Yes (lightweight) | Settlement UI, History | They left mid-flow; let them know it resolved. |
| Payout credited | No | Balance history, Settlement UI | Part of game end, not its own event. |
| Game **voided** after review | **Yes** | Notification + Settlement UI + History ("Voided") + Balance history (reversal) | Async, money + rating moved. Neutral copy from `OPERATIONAL_POLICY.md` § 2.6: *"This match was voided after review; stakes were returned."* Same copy for the innocent opponent. |
| Result **adjusted** by admin | **Yes** | Notification + Settlement UI + Balance/rating history | Same rationale as void. |
| Report submitted (acknowledge receipt) | No | Inline confirmation at submit time | A toast/inline "thanks, we'll review" — not a bell entry. |
| Report **resolved** | **Yes** | Notification | Vague copy only, from `OPERATIONAL_POLICY.md` § 5.2 — never reveals the outcome for the other account. |
| Restriction — **loud** (`hard_ban`) | **Yes** | Notification + blocked-login banner | Reason category only. |
| Restriction — **state-only** (`reduced_stake_limits`, and `manual_review_required` / `delayed_withdrawals` once cashout exists) | No | Error/inline copy at point of action | Reuse `stake_exceeds_trust_cap` copy for stake caps; withdrawal copy only when cashout ships. |
| Restriction — **quiet/shadow** (the remaining rungs) | No | None | Deliberately invisible. |
| Secure Play badge / calibration | No | Account state (Profile/History/Settlement) | Calibrating must not look negative — see `FAIR_PLAY_NEXT_PASS.md` § "What calibrating users see". |

The loud / state-only / quiet split is owned by `OPERATIONAL_POLICY.md` § 1.14; this table only maps each class onto a delivery surface.

### Implementation note

When these are built, the new persisted notification types (e.g. `game_voided`, `result_adjusted`, `report_resolved`, `account_suspended`) follow the existing entity-anchored, update-in-place pattern (`upsertNotification`, keyed on `entityType`/`entityId`). Emit them from `finalizeGame` (away-case only), `adminVoidGame`, `adminAdjustGame`, report resolution, and `adminSetRestrictions` (loud rungs only).
