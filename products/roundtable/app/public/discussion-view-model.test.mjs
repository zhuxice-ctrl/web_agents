import assert from "node:assert/strict";
import test from "node:test";

import { resolveDiscussionView } from "./discussion-view-model.mjs";

test("discussion view projects cycle progress, listening seats, and queued interventions", () => {
  const session = {
    participants: [{ id: "chatgpt" }, { id: "deepseek" }, { id: "doubao" }],
    participantRoles: { doubao: "反方观察者" },
    pendingInterventions: [{ id: "i1", planId: "p1", content: "补充考虑时间有限的情况", status: "pending" }],
    plans: [{
      id: "p1",
      conversationMode: "discussion",
      status: "running",
      currentCycle: 3,
      maxCycles: 5,
      roleOverrides: {},
      cycles: [{ number: 3, turnIds: ["t1", "t2", "t3"] }],
      turns: [
        { id: "t1", providerId: "chatgpt", status: "completed" },
        { id: "t2", providerId: "deepseek", status: "completed" },
        { id: "t3", providerId: "doubao", status: "passed" },
      ],
    }],
    events: [],
  };
  const view = resolveDiscussionView(session);
  assert.deepEqual(view.progress, { current: 3, maximum: 5, spoken: 2, passed: 1 });
  assert.equal(view.seats.doubao.state, "listening");
  assert.equal(view.seats.doubao.role, "反方观察者");
  assert.equal(view.pendingInterventions[0].content, "补充考虑时间有限的情况");
});

test("reply relations remain message scoped and never infer camps", () => {
  const view = resolveDiscussionView({
    participants: [{ id: "chatgpt" }, { id: "doubao" }],
    plans: [],
    events: [{
      id: "reply-2",
      metadata: { replyRelations: [{ providerId: "doubao", eventId: "reply-1", extraction: "explicit_name" }] },
    }],
  });
  assert.deepEqual(view.replyRelations, [{
    sourceEventId: "reply-2",
    providerId: "doubao",
    eventId: "reply-1",
    extraction: "explicit_name",
  }]);
  assert.equal("camp" in view, false);
  assert.equal("stance" in view, false);
});
