import assert from "node:assert/strict";
import test from "node:test";

import {
  appendDiscussionCycle,
  createDiscussionCycle,
  decideCycleContinuation,
  summarizeDiscussionCycle,
} from "./discussion-cycle.mjs";

function fixture() {
  const session = {
    participants: [
      { id: "chatgpt", label: "ChatGPT" },
      { id: "deepseek", label: "DeepSeek" },
      { id: "doubao", label: "豆包" },
    ],
    events: [],
  };
  const plan = { id: "plan-1", targets: ["chatgpt", "deepseek", "doubao"], turns: [], cycles: [] };
  return { session, plan };
}

test("cycle one creates one independent turn per target", () => {
  const { session, plan } = fixture();
  let id = 0;
  const cycle = createDiscussionCycle(plan, session, { cycleNumber: 1, idFactory: () => `turn-${++id}` });
  assert.equal(cycle.turnIds.length, 3);
  assert.deepEqual(cycle.turns.map((turn) => turn.stage), ["independent_position", "independent_position", "independent_position"]);
  assert.deepEqual(cycle.addressedProviderIds, []);
});

test("explicit reply relations require the addressed provider to respond next cycle", () => {
  const { session, plan } = fixture();
  session.events.push({
    id: "gpt-r2",
    type: "reply",
    providerId: "chatgpt",
    commandId: "plan-1",
    round: 2,
    metadata: { replyRelations: [{ providerId: "doubao", eventId: "db-r1" }] },
  });
  const cycle = createDiscussionCycle(plan, session, { cycleNumber: 3 });
  assert.deepEqual(cycle.addressedProviderIds, ["doubao"]);
  assert.equal(cycle.turns.find((turn) => turn.providerId === "doubao").mustRespond, true);
});

test("continuation respects pass convergence, interventions, and capacity", () => {
  assert.equal(decideCycleContinuation({ results: ["passed", "passed", "passed"], cycleNumber: 2, maxCycles: 5 }), "close");
  assert.equal(decideCycleContinuation({ results: ["passed", "passed", "passed"], hasPendingInterventions: true, cycleNumber: 2, maxCycles: 5 }), "continue");
  assert.equal(decideCycleContinuation({ results: ["spoken", "passed", "spoken"], hasPendingInterventions: true, cycleNumber: 5, maxCycles: 5 }), "awaiting_capacity");
});

test("cycle summary separates spoken, passed, and absent turns", () => {
  const { session, plan } = fixture();
  const cycle = appendDiscussionCycle(plan, session, { cycleNumber: 1 });
  plan.turns[0].status = "completed";
  plan.turns[1].status = "passed";
  plan.turns[2].status = "absent";
  assert.deepEqual(summarizeDiscussionCycle(plan, cycle), {
    terminal: true,
    results: ["spoken", "passed", "absent"],
    spokenCount: 1,
    passedCount: 1,
    absentCount: 1,
  });
});
