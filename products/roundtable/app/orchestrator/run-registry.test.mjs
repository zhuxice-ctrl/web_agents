import assert from "node:assert/strict";
import test from "node:test";

import { RunRegistry } from "./run-registry.mjs";

test("run registry pauses and resumes at scheduler checkpoints", async () => {
  const registry = new RunRegistry();
  const controller = new AbortController();
  registry.create({ runId: "run-pause", sessionId: "session", planId: "plan", controller });
  registry.pause("run-pause");
  let passed = false;
  const checkpoint = registry.waitIfPaused("run-pause").then(() => { passed = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(passed, false);
  registry.resume("run-pause");
  await checkpoint;
  assert.equal(passed, true);
  assert.equal(registry.get("run-pause").status, "running");
});

test("run registry resolves retry, skip, and manual recovery actions", async () => {
  const registry = new RunRegistry();
  registry.create({ runId: "run-recovery", sessionId: "session", planId: "plan", controller: new AbortController() });

  const retryWait = registry.waitForRecovery("run-recovery", { id: "turn-1" }, new Error("failed"));
  registry.retry("run-recovery", "turn-1");
  assert.deepEqual(await retryWait, { action: "retry", reuseExecutionId: false });

  const skipWait = registry.waitForRecovery("run-recovery", { id: "turn-2" }, new Error("failed"));
  registry.skip("run-recovery", "turn-2");
  assert.deepEqual(await skipWait, { action: "skip" });

  const manualWait = registry.waitForRecovery("run-recovery", { id: "turn-3" }, new Error("failed"));
  registry.manual("run-recovery", "turn-3", "人工粘贴的真实回复");
  assert.deepEqual(await manualWait, { action: "manual", content: "人工粘贴的真实回复" });
});

test("duplicate recovery decisions with the same key are idempotent", async () => {
  const registry = new RunRegistry();
  registry.create({ runId: "run-idempotent", sessionId: "session", planId: "plan" });
  const waiting = registry.waitForRecovery("run-idempotent", { id: "turn-1" }, new Error("SEND_UNKNOWN"));
  const first = registry.retry("run-idempotent", "turn-1", { decisionKey: "decision-1" });
  const duplicate = registry.retry("run-idempotent", "turn-1", { decisionKey: "decision-1" });
  assert.equal(first.status, duplicate.status);
  await waiting;
});

test("pausing a run waiting for recovery is an idempotent no-op", async () => {
  const registry = new RunRegistry();
  registry.create({ runId: "run-waiting", sessionId: "session", planId: "plan", controller: new AbortController() });
  const recovery = registry.waitForRecovery("run-waiting", { id: "turn" }, new Error("failed"));
  const paused = registry.pause("run-waiting");
  assert.equal(paused.status, "waiting_recovery");
  registry.skip("run-waiting", "turn");
  await recovery;
});

test("run registry cancellation aborts browser work and recovery waits", async () => {
  const registry = new RunRegistry();
  const controller = new AbortController();
  registry.create({ runId: "run-cancel", sessionId: "session", planId: "plan", controller });
  const recovery = registry.waitForRecovery("run-cancel", { id: "turn" }, new Error("failed"));
  registry.cancel("run-cancel", "用户终止");
  await assert.rejects(recovery, /用户终止/);
  assert.equal(controller.signal.aborted, true);
  assert.equal(registry.get("run-cancel").status, "cancelled");
});

test("run registry exposes awaiting continuation without reporting completion", () => {
  const registry = new RunRegistry();
  registry.create({ runId: "run-cap", sessionId: "session", planId: "plan" });
  const run = registry.awaitContinuation("run-cap");
  assert.equal(run.status, "awaiting_continuation");
  assert.equal(registry.get("run-cap").status, "awaiting_continuation");
});
