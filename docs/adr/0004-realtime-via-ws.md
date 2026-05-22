# ADR 0004: Realtime Via WebSockets

Status: accepted

## Context

Mock #3 in `docs/IMPLEMENTATION_PLAN.md` called out the lack of any server→client
transport as the highest-leverage gap before the rest of Phase 4. Without push,
the opponent's move only appeared after a manual refresh, and every other live
feature (server clocks, draw offers, timeout settlement, presence, spectator
streams) was blocked on the same transport choice.

The dependency-light baseline (ADR 0001) allows additions when they replace a
clearly identified mock with a real implementation. Mock #3 qualifies.

We considered:

- **WebSockets via `ws`** — the de facto standard Node WS library. BSD-2-Clause.
  Tiny, mature, well-supported across hosting providers. Bidirectional frames
  let future consumers (client clocks, draw offers, presence pings) reuse the
  same connection.
- **Hand-rolled WS on `node:http`** — preserves the zero-runtime-deps posture
  but adds ~200 LOC of upgrade/framing/ping-pong code we'd have to maintain.
  No payoff vs. `ws` for this project's scale.
- **Server-Sent Events (no deps)** — viable for the narrow "push moves to the
  opponent" case, but server-only push closes the door on the future consumers
  listed below without adding a second channel back to the server.

## Decision

Use WebSockets via the `ws` package as the realtime transport. The server
attaches a `WebSocketServer({ noServer: true })` to the existing `node:http`
server and handles `/ws` upgrades manually so authentication can run during
the handshake.

### Channel shape

Two scopes, both `:<id>`-suffixed:

- `user:<userId>` — events relevant to a specific viewer: `challenge.created`,
  `challenge.updated`, `matchmaking.matched`, and a per-user
  `game.finalized` notification.
- `game:<gameId>` — events scoped to a single game: `game.updated` after each
  move, `game.finalized` after settlement.

Each socket auto-subscribes to its own `user:<viewerId>` channel on connect.
Game channels are opt-in via `{type:"subscribe", channel:"game:<id>"}` and the
server rejects subscriptions for users who are not players on that game.
Spectator access stays closed in this slice but is a natural extension of the
same channel.

### Auth

The WS handshake authenticates via `?as=<userId>` on the upgrade URL, mirroring
the REST `x-viewer-id` header sourced from the same query string. This keeps
the dev seam identical between transports. When real auth lands (Mock #2), both
seams collapse onto session cookies — the WS handshake already carries cookies,
so the swap is contained in `resolveViewerById`.

### Publishing

The broker (`apps/api/realtime.mjs`) is a transport-agnostic pub/sub keyed by
channel. Publishes happen at the REST endpoint sites, immediately before the
response is written, so the publish is co-located with the state mutation it
describes. Payloads reuse `enrichGame` and `challengePayload`, so realtime
clients see the same shapes as REST responses.

## Scope

This ADR establishes the WebSocket transport and the channel/event
architecture. The intended consumers below are **deferred future slices, not
rejected features**. Each is expected to plug into this same broker without
re-litigating transport choices:

- **Mock #5 — server-authoritative clocks**: publish `clock.tick` (or piggyback
  on `game.updated`) from a tick scheduler to `game:<id>` subscribers.
- **Mock #7 — draw offers, timeout settlement, abandonment/disconnect**: new
  REST endpoints publish `draw.offered`, `draw.accepted`, `draw.declined`, and
  reuse `game.finalized` for timeout and abandonment outcomes.
- **Presence / online filter**: per-connection lifecycle plus a `presence.*`
  channel surface aggregated state to the lobby.
- **Spectator stream**: relax the player-only guard on `game:<id>` subscribes
  for games that opt into spectator visibility.
- **Per-game quick chat**: publish chat to `game:<id>` once the channel proves
  reliable under live play.

## Consequences

- One new dependency: `ws@^8`. Pure-JS, no native build step, BSD-2-Clause.
- Identity is sourced from a query-string parameter on the WS URL — adequate
  for the dev seam, swap-target for cookie auth in Mock #2.
- Broker state lives in the same Node process as the HTTP server. A future
  horizontal-scale deployment will need a fan-out layer (Redis pub/sub, NATS,
  managed realtime provider). The publish call sites do not change.
- Server-pushed payloads share the same shape as REST responses, so the client
  can replace its state from either source without translation.
- A 2-second matchmaking poll remains as a belt-and-suspenders fallback on the
  client; it will be removed once reconnect behavior has been observed in the
  browser under production-like conditions.
