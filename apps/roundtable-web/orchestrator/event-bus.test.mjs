import assert from "node:assert/strict";
import test from "node:test";

import { EventBus } from "./event-bus.mjs";

test("event bus filters subscriptions by session and keeps bounded history", () => {
  const bus = new EventBus({ historyLimit: 2 });
  const all = [];
  const selected = [];
  const unsubscribeAll = bus.subscribe((event) => all.push(event));
  const unsubscribeSelected = bus.subscribe((event) => selected.push(event), { sessionId: "session-a" });
  bus.emit({ type: "one", sessionId: "session-a" });
  bus.emit({ type: "two", sessionId: "session-b" });
  bus.emit({ type: "three", sessionId: "session-a" });
  unsubscribeAll();
  unsubscribeSelected();

  assert.deepEqual(all.map((event) => event.type), ["one", "two", "three"]);
  assert.deepEqual(selected.map((event) => event.type), ["one", "three"]);
  assert.deepEqual(bus.history().map((event) => event.type), ["two", "three"]);
});
