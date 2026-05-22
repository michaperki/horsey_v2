import assert from "node:assert/strict";
import test from "node:test";
import { createBroker, CHANNELS } from "../apps/api/realtime.mjs";

function mockClient() {
  const messages = [];
  let closed = false;
  return {
    messages,
    send(payload) {
      if (closed) throw new Error("client closed");
      messages.push(payload);
    },
    close() { closed = true; },
    isClosed() { return closed; }
  };
}

test("publish delivers a serialized payload to every subscriber of the channel", () => {
  const broker = createBroker();
  const a = mockClient();
  const b = mockClient();
  const c = mockClient();
  broker.subscribe(CHANNELS.game("g1"), a);
  broker.subscribe(CHANNELS.game("g1"), b);
  broker.subscribe(CHANNELS.game("g2"), c);

  const delivered = broker.publish(CHANNELS.game("g1"), { type: "game.updated", id: "g1" });

  assert.equal(delivered, 2);
  assert.deepEqual(JSON.parse(a.messages[0]), { type: "game.updated", id: "g1" });
  assert.deepEqual(JSON.parse(b.messages[0]), { type: "game.updated", id: "g1" });
  assert.equal(c.messages.length, 0);
});

test("publish to an empty channel is a no-op", () => {
  const broker = createBroker();
  assert.equal(broker.publish("user:nobody", { type: "noop" }), 0);
});

test("unsubscribe removes a client and prunes the channel when empty", () => {
  const broker = createBroker();
  const a = mockClient();
  const off = broker.subscribe(CHANNELS.user("u1"), a);

  assert.equal(broker.channelSize(CHANNELS.user("u1")), 1);
  off();
  assert.equal(broker.channelSize(CHANNELS.user("u1")), 0);
  assert.ok(!broker.channelNames().includes(CHANNELS.user("u1")));
});

test("unsubscribeAll removes a client from every channel it joined", () => {
  const broker = createBroker();
  const a = mockClient();
  broker.subscribe(CHANNELS.user("u1"), a);
  broker.subscribe(CHANNELS.game("g1"), a);
  broker.subscribe(CHANNELS.game("g2"), a);

  broker.unsubscribeAll(a);

  assert.equal(broker.channelNames().length, 0);
});

test("publish prunes clients whose send throws or that report closed", () => {
  const broker = createBroker();
  const healthy = mockClient();
  const closed = mockClient();
  closed.close();
  const throwing = {
    send() { throw new Error("transport broken"); },
    isClosed() { return false; }
  };

  broker.subscribe(CHANNELS.game("g1"), healthy);
  broker.subscribe(CHANNELS.game("g1"), closed);
  broker.subscribe(CHANNELS.game("g1"), throwing);

  const delivered = broker.publish(CHANNELS.game("g1"), { type: "game.updated" });

  assert.equal(delivered, 1);
  assert.equal(broker.channelSize(CHANNELS.game("g1")), 1);
});
