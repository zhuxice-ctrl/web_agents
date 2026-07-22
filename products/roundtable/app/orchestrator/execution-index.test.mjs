import test from "node:test";
import assert from "node:assert/strict";

import {
  executionRecordFromTurn,
  listExecutionIndex,
  listPendingExecutions,
  upsertExecutionIndex,
} from "./execution-index.mjs";

test("execution index upserts by execution id and exposes send uncertainty", () => {
  const session = { id: "session", updatedAt: "2026-07-21T00:00:00.000Z", executionIndex: [] };
  const plan = { id: "plan" };
  const turn = {
    id: "turn",
    executionId: "exec-1",
    attemptId: "attempt-1",
    idempotencyKey: "logical-1",
    providerId: "deepseek",
    providerLabel: "DeepSeek",
    status: "running",
    executionPhase: "submitting",
    sendState: "SEND_UNKNOWN",
  };
  upsertExecutionIndex(session, executionRecordFromTurn(session, plan, turn));
  const indexed = listExecutionIndex(session);
  assert.equal(indexed.length, 1);
  assert.equal(listPendingExecutions(session)[0].sendState, "SEND_UNKNOWN");
  turn.status = "completed";
  turn.sendState = "COMMITTED";
  upsertExecutionIndex(session, executionRecordFromTurn(session, plan, turn));
  assert.equal(listPendingExecutions(session).length, 0);
});

test("legacy sessions derive execution records from turns and checkpoints", () => {
  const session = {
    id: "session",
    updatedAt: "2026-07-21T00:00:00.000Z",
    plans: [{ id: "plan", turns: [{ id: "turn", executionId: "exec", providerId: "chatgpt", status: "failed", error: { code: "SEND_UNKNOWN" } }] }],
    checkpoints: [{ executionId: "exec", turnId: "turn", phase: "submitting", metadata: { sendState: "SEND_UNKNOWN" } }],
  };
  const pending = listPendingExecutions(session);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].executionId, "exec");
});
