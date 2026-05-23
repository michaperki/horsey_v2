// Channel-based pub/sub for the realtime layer.
//
// Channels follow a `<scope>:<id>` convention:
//   - `user:<userId>` — events relevant to a specific viewer
//     (challenge created/updated, matchmaking matched, game finalized notification).
//   - `game:<gameId>` — events scoped to a single game (move applied, finalized).
//
// The broker is transport-agnostic: subscribers are duck-typed clients with a
// `send(payload)` method and an optional `isClosed()` predicate. The WS wiring
// in server.mjs adapts `ws` connections to that shape.

export function createBroker() {
  const channels = new Map();

  function subscribe(channel, client) {
    if (!channel || !client) return () => {};
    let set = channels.get(channel);
    if (!set) {
      set = new Set();
      channels.set(channel, set);
    }
    set.add(client);
    return () => unsubscribe(channel, client);
  }

  function unsubscribe(channel, client) {
    const set = channels.get(channel);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) channels.delete(channel);
  }

  function unsubscribeAll(client) {
    for (const [channel, set] of channels) {
      if (set.delete(client) && set.size === 0) channels.delete(channel);
    }
  }

  function publish(channel, payload) {
    const set = channels.get(channel);
    if (!set || set.size === 0) return 0;
    const serialized = JSON.stringify(payload);
    let delivered = 0;
    for (const client of set) {
      if (client.isClosed?.()) {
        set.delete(client);
        continue;
      }
      try {
        client.send(serialized);
        delivered += 1;
      } catch {
        set.delete(client);
      }
    }
    if (set.size === 0) channels.delete(channel);
    return delivered;
  }

  function channelSize(channel) {
    return channels.get(channel)?.size ?? 0;
  }

  function channelNames() {
    return [...channels.keys()];
  }

  return { subscribe, unsubscribe, unsubscribeAll, publish, channelSize, channelNames };
}

export const CHANNELS = {
  user: (userId) => `user:${userId}`,
  game: (gameId) => `game:${gameId}`,
  lobby: "lobby"
};
