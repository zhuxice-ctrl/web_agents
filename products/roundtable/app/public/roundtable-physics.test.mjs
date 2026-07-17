import assert from "node:assert/strict";
import test from "node:test";

import { findSnappedHost, HOST_POINT, stepRoundtablePhysics } from "./roundtable-physics.mjs";

test("roundtable attracts nodes while close nodes repel each other", () => {
  const initial = [
    { id: "a", x: 0.2, y: 0.5, vx: 0, vy: 0 },
    { id: "b", x: 0.205, y: 0.5, vx: 0, vy: 0 },
  ];
  const next = stepRoundtablePhysics(initial);
  assert.ok(Math.abs(next[0].x - next[1].x) > Math.abs(initial[0].x - initial[1].x));
  assert.notEqual(next[0].x, initial[0].x);
});

test("only a node near the fixed host point becomes host", () => {
  assert.equal(findSnappedHost([{ id: "ds", x: HOST_POINT.x + 0.02, y: HOST_POINT.y }]), "ds");
  assert.equal(findSnappedHost([{ id: "ds", x: 0.1, y: 0.8 }]), null);
});
