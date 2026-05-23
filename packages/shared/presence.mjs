export function createPresenceRegistry() {
  const state = new Map();

  function record(userId) {
    let entry = state.get(userId);
    if (!entry) {
      entry = { connections: 0, connectedAt: null, lastSeenAt: null };
      state.set(userId, entry);
    }
    return entry;
  }

  return {
    connect(userId, nowIso = new Date().toISOString()) {
      const entry = record(userId);
      const previouslyOnline = entry.connections > 0;
      entry.connections += 1;
      if (!previouslyOnline) {
        entry.connectedAt = nowIso;
        entry.lastSeenAt = null;
      }
      return { previouslyOnline, nowOnline: true };
    },
    disconnect(userId, nowIso = new Date().toISOString()) {
      const entry = state.get(userId);
      if (!entry || entry.connections === 0) {
        return { previouslyOnline: false, nowOnline: false };
      }
      entry.connections -= 1;
      const nowOnline = entry.connections > 0;
      if (!nowOnline) {
        entry.lastSeenAt = nowIso;
        entry.connectedAt = null;
      }
      return { previouslyOnline: true, nowOnline };
    },
    snapshot(userId) {
      const entry = state.get(userId);
      if (!entry) return { online: false, lastSeenAt: null };
      return {
        online: entry.connections > 0,
        lastSeenAt: entry.connections > 0 ? null : entry.lastSeenAt
      };
    },
    onlineCount() {
      let count = 0;
      for (const entry of state.values()) {
        if (entry.connections > 0) count += 1;
      }
      return count;
    }
  };
}
