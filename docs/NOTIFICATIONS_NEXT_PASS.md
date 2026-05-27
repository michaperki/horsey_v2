# Notifications Next Pass

**Posture set 2026-05-27.** Horsey cannot rely on "the event fired" as the user experience. If a bot, rival, or stranger challenges a player, the recipient needs a visible route to receive it, inspect it, and act before expiry. Notifications are part of the wager loop.

The current realtime layer is necessary but not sufficient. WebSocket events wake the UI while the user is online; durable notification rows provide the inbox, unread count, reconnect recovery, and audit trail.

## What ships

### Notification center
- Topbar bell/inbox with unread count.
- Compact dropdown for recent items; full Profile -> Notifications panel for history.
- Items deep-link into the right surface: challenge -> Wager, live game -> Game, settlement -> History detail, account/payment notices -> Profile.
- Read/unread state is per user and survives refresh.

### Challenge delivery
- Direct challenges create a durable notification for the recipient at the same time as the challenge row.
- Bot greetings use the same path as human direct challenges. No special hidden route.
- Incoming challenge toast appears when the recipient is online; inbox item remains if they miss the toast.
- Challenge notifications expire in place when the challenge expires, is withdrawn, declined, accepted, or countered.
- Countered challenges notify the new responding party.

### Event types for the first pass
- `challenge_received`
- `challenge_countered`
- `challenge_expiring`
- `challenge_accepted`
- `draw_offered`
- `turn_started` for async/future slower modes only; do not spam blitz.
- `game_finalized`
- `payment_completed`
- `cashout_waitlist_opened`
- `account_action_required`

## Product rules

- Notifications should be actionable, not noisy. A user should see why the item matters and have one obvious next action.
- Blitz/live games must not become notification spam. Turn notifications are for future slower/async modes, not rapid live play.
- Challenge expiry is honest urgency. Payment and retention surfaces must not manufacture urgency.
- Loss copy stays neutral or winner-centric; no push notification should advertise "you lost $X."
- Browser push/email/SMS are later channels. The first product requirement is in-app durability.

## Implementation shape

1. `notifications` table: `id, user_id, type, entity_type, entity_id, title, body, read_at, expires_at, created_at, data_json`.
2. API: `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
3. Server helper: `createNotification(userId, type, entity, payload)` colocated with challenge/game/payment mutations.
4. Realtime publish: after inserting a notification, publish `notification.created` to `user:<userId>`.
5. Bootstrap includes unread count and recent notifications so reconnect/refresh is correct.
6. Client topbar bell renders unread count, dropdown, and route-aware deep links.
7. Challenge lifecycle mutations update or expire existing related notification rows.
8. Dev-bot greeting path uses the same direct-challenge notification helper.

## Open questions

- Whether notification text should be fully denormalized at creation or derived at render. Default: denormalize title/body plus keep `data_json` for route/action context.
- Whether challenge-expiring should be a stored row or only an in-app urgency state. Default: store only for direct challenges with more than a minimal lifetime, not for every open-table row.
- Whether email should mirror account/security/payment notices before social notices. Default: yes, when email infrastructure is already configured.
