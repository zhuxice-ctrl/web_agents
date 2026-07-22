import assert from "node:assert/strict";
import test from "node:test";

import {
  consumePendingInterventions,
  normalizeRoleOverrides,
  queueIntervention,
  removeIntervention,
  resolveSeatRole,
  setDefaultSeatRole,
  updateIntervention,
} from "./discussion-session-state.mjs";

test("temporary role overrides the session default", () => {
  const session = { participants: [{ id: "chatgpt" }], participantRoles: {} };
  setDefaultSeatRole(session, { providerId: "chatgpt", role: "学习科学研究者" });
  assert.equal(resolveSeatRole(session, "chatgpt", { chatgpt: "实践派" }), "实践派");
  assert.equal(resolveSeatRole(session, "chatgpt", {}), "学习科学研究者");
  assert.deepEqual(normalizeRoleOverrides(session, { chatgpt: "实践派" }, ["chatgpt"]), { chatgpt: "实践派" });
});

test("pending interventions remain ordered and editable until consumption", () => {
  const session = { pendingInterventions: [] };
  queueIntervention(session, { id: "i1", planId: "p1", content: "第一条", now: "2026-07-23T00:00:00.000Z" });
  queueIntervention(session, { id: "i2", planId: "p1", content: "第二条", now: "2026-07-23T00:00:01.000Z" });
  updateIntervention(session, { id: "i1", content: "修改后第一条", now: "2026-07-23T00:00:02.000Z" });
  removeIntervention(session, { id: "i2" });
  assert.deepEqual(consumePendingInterventions(session, { planId: "p1" }).map((item) => item.content), ["修改后第一条"]);
  assert.deepEqual(session.pendingInterventions, []);
});

test("invalid providers and consumed interventions are rejected", () => {
  const session = { participants: [{ id: "chatgpt" }], pendingInterventions: [] };
  assert.throws(() => setDefaultSeatRole(session, { providerId: "doubao", role: "观察者" }), /PARTICIPANT_NOT_FOUND/);
  assert.throws(() => normalizeRoleOverrides(session, { doubao: "观察者" }, ["chatgpt"]), /ROLE_OVERRIDE_PROVIDER_NOT_SELECTED/);
  queueIntervention(session, { id: "i1", planId: "p1", content: "保留" });
  consumePendingInterventions(session, { planId: "p1" });
  assert.throws(() => updateIntervention(session, { id: "i1", content: "太晚了" }), /INTERVENTION_NOT_PENDING/);
});
