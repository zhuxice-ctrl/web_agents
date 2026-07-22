import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSession } from "../server.mjs";
import { LocalWorkspaceStore } from "../storage/local-workspace-store.mjs";
import { RoundtableScheduler } from "./scheduler.mjs";

test("turn retries keep one idempotency key while attempts remain distinct", () => {
  const scheduler = new RoundtableScheduler({ store: { } });
  const turn = { id: "turn-1", providerId: "deepseek", status: "planned", attempts: 0, providerAttempts: {} };
  scheduler.markTurnRunning(turn);
  const first = { idempotencyKey: turn.idempotencyKey, attemptId: turn.attemptId, executionId: turn.executionId };
  scheduler.markTurnRunning(turn);
  assert.equal(turn.idempotencyKey, first.idempotencyKey);
  assert.notEqual(turn.attemptId, first.attemptId);
  assert.notEqual(turn.executionId, first.executionId);
});

test("send uncertainty is persisted and never treated as an automatic retry", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-send-unknown-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const store = new LocalWorkspaceStore({ repoRoot, dataRoot: path.join(repoRoot, "data") });
  await store.initialize();
  const session = await createSession({
    title: "send unknown",
    objective: "test send uncertainty",
    participants: ["deepseek"],
    settings: { mode: "playwright", defaultRounds: 1 },
  }, { store });
  let observedRequest = null;
  const scheduler = new RoundtableScheduler({
    store,
    worker: { async execute(request) {
      observedRequest = request;
      await request.checkpoint("submitting");
      throw new Error("connection lost after submit started");
    } },
  });

  await assert.rejects(
    () => scheduler.executeCommand(session.id, { text: "@ds test" }),
    (error) => error.code === "SEND_UNKNOWN",
  );
  const saved = await store.readSession(session.id);
  const turn = saved.plans[0].turns[0];
  assert.equal(turn.sendState, "SEND_UNKNOWN");
  assert.equal(turn.error.code, "SEND_UNKNOWN");
  assert.ok(turn.idempotencyKey);
  assert.ok(turn.attemptId);
  assert.equal(observedRequest.idempotencyKey, turn.idempotencyKey);
  assert.equal(observedRequest.attemptId, turn.attemptId);
  const checkpoint = saved.checkpoints.find((candidate) => candidate.turnId === turn.id);
  assert.equal(checkpoint.phase, "submitting");
  assert.equal(checkpoint.metadata.sendState, "SEND_UNKNOWN");
  assert.equal(checkpoint.idempotencyKey, turn.idempotencyKey);
  assert.equal(checkpoint.attemptId, turn.attemptId);
});
