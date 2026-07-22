import assert from "node:assert/strict";
import test from "node:test";

import { TurnProgressStore } from "./turn-progress-store.mjs";

function startedEvent(patch = {}) {
  return {
    type: "turn.started",
    sessionId: "session-1",
    planId: "plan-1",
    at: "2026-07-20T01:00:00.000Z",
    turn: {
      id: "turn-1",
      executionId: "turn-1:chatgpt:1",
      providerId: "chatgpt",
      providerLabel: "ChatGPT",
      round: 1,
      stage: "independent",
      sequence: 1,
      status: "running",
    },
    ...patch,
  };
}

test("turn progress store creates, updates, and rejects stale execution snapshots", () => {
  const store = new TurnProgressStore();
  store.setActiveSession("session-1");
  store.handleStarted(startedEvent());
  store.handleProgress({
    type: "turn.progress",
    sessionId: "session-1",
    turnId: "turn-1",
    executionId: "turn-1:chatgpt:1",
    text: "部分结果",
    at: "2026-07-20T01:00:01.000Z",
  });

  assert.equal(store.list("session-1")[0].partialText, "部分结果");
  assert.equal(store.list("session-1")[0].updatedAt, "2026-07-20T01:00:01.000Z");

  store.handleProgress({
    type: "turn.progress",
    sessionId: "session-1",
    turnId: "turn-1",
    executionId: "turn-1:chatgpt:0",
    text: "迟到执行文本",
    at: "2026-07-20T01:00:02.000Z",
  });
  store.handleProgress({
    type: "turn.progress",
    sessionId: "session-1",
    turnId: "turn-1",
    executionId: "turn-1:chatgpt:1",
    text: "迟到时间文本",
    at: "2026-07-20T01:00:00.500Z",
  });

  assert.equal(store.list("session-1")[0].partialText, "部分结果");
});

test("a retry replaces the prior execution and clears its partial text", () => {
  const store = new TurnProgressStore();
  store.setActiveSession("session-1");
  store.handleStarted(startedEvent());
  store.handleProgress({
    sessionId: "session-1",
    turnId: "turn-1",
    executionId: "turn-1:chatgpt:1",
    text: "旧尝试",
    at: "2026-07-20T01:00:01.000Z",
  });
  store.handleStarted(startedEvent({
    at: "2026-07-20T01:00:02.000Z",
    recovery: "retry",
    turn: { ...startedEvent().turn, executionId: "turn-1:chatgpt:2" },
  }));

  const [item] = store.list("session-1");
  assert.equal(item.executionId, "turn-1:chatgpt:2");
  assert.equal(item.partialText, "");
});

test("session synchronization rebuilds running turns and removes terminal turns", () => {
  const store = new TurnProgressStore();
  const runningSession = {
    id: "session-1",
    plans: [{
      id: "plan-1",
      turns: [{
        id: "turn-2",
        executionId: "turn-2:deepseek:1",
        providerId: "deepseek",
        providerLabel: "DeepSeek",
        round: 2,
        stage: "critique",
        status: "running",
        startedAt: "2026-07-20T01:00:00.000Z",
      }],
    }],
  };

  store.syncSession(runningSession);
  assert.deepEqual(store.list("session-1").map((item) => item.turnId), ["turn-2"]);

  store.handleTerminal({ sessionId: "session-1", turn: { id: "turn-2" }, at: "2026-07-20T01:00:03.000Z" });
  assert.equal(store.list("session-1")[0].status, "terminal");
  store.syncSession({ ...runningSession, plans: [{ id: "plan-1", turns: [{ ...runningSession.plans[0].turns[0], status: "completed" }] }] });
  assert.deepEqual(store.list("session-1"), []);
});

test("switching sessions clears transient entries from the prior session", () => {
  const store = new TurnProgressStore();
  store.setActiveSession("session-1");
  store.handleStarted(startedEvent());
  store.setActiveSession("session-2");

  assert.deepEqual(store.list("session-1"), []);
  assert.deepEqual(store.list("session-2"), []);
});

test("a private pass removes transient streaming output immediately", () => {
  const store = new TurnProgressStore();
  store.setActiveSession("session-1");
  store.handleStarted(startedEvent());
  store.handleProgress({
    sessionId: "session-1",
    turnId: "turn-1",
    executionId: "turn-1:chatgpt:1",
    text: "PASS",
    at: "2026-07-20T01:00:01.000Z",
  });
  store.handlePassed({ sessionId: "session-1", turn: { id: "turn-1" } });
  assert.deepEqual(store.list("session-1"), []);
});
