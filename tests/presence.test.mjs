import assert from "node:assert/strict";
import test from "node:test";
import { createPresenceRegistry } from "../packages/shared/presence.mjs";

test("connect on an unknown user transitions offline → online", () => {
  const reg = createPresenceRegistry();
  const change = reg.connect("u1", "2026-05-22T10:00:00.000Z");
  assert.equal(change.previouslyOnline, false);
  assert.equal(change.nowOnline, true);
  assert.deepEqual(reg.snapshot("u1"), { online: true, lastSeenAt: null });
});

test("a second connection keeps the user online without re-firing", () => {
  const reg = createPresenceRegistry();
  reg.connect("u1");
  const change = reg.connect("u1");
  assert.equal(change.previouslyOnline, true);
  assert.equal(change.nowOnline, true);
});

test("disconnect only flips offline once the last connection closes", () => {
  const reg = createPresenceRegistry();
  reg.connect("u1");
  reg.connect("u1");
  const firstClose = reg.disconnect("u1", "2026-05-22T10:00:30.000Z");
  assert.equal(firstClose.nowOnline, true, "still has one tab open");
  assert.equal(reg.snapshot("u1").online, true);

  const lastClose = reg.disconnect("u1", "2026-05-22T10:01:00.000Z");
  assert.equal(lastClose.previouslyOnline, true);
  assert.equal(lastClose.nowOnline, false);
  assert.deepEqual(reg.snapshot("u1"), {
    online: false,
    lastSeenAt: "2026-05-22T10:01:00.000Z"
  });
});

test("disconnecting an unknown or already-offline user is a no-op", () => {
  const reg = createPresenceRegistry();
  const unknown = reg.disconnect("ghost");
  assert.deepEqual(unknown, { previouslyOnline: false, nowOnline: false });

  reg.connect("u1");
  reg.disconnect("u1");
  const again = reg.disconnect("u1");
  assert.deepEqual(again, { previouslyOnline: false, nowOnline: false });
});

test("snapshot for an unknown user is offline with no lastSeenAt", () => {
  const reg = createPresenceRegistry();
  assert.deepEqual(reg.snapshot("nobody"), { online: false, lastSeenAt: null });
});

test("reconnecting after going offline clears lastSeenAt", () => {
  const reg = createPresenceRegistry();
  reg.connect("u1");
  reg.disconnect("u1", "2026-05-22T10:00:00.000Z");
  reg.connect("u1");
  assert.deepEqual(reg.snapshot("u1"), { online: true, lastSeenAt: null });
});
