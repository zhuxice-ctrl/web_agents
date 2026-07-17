import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HandoffManager, estimateThreadCapacity } from "./handoff-manager.mjs";
import { LocalWorkspaceStore } from "../storage/local-workspace-store.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-handoff-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LocalWorkspaceStore({ repoRoot: root, dataRoot: path.join(root, ".web-agents"), workspaceRoot: root });
  const now = new Date().toISOString();
  await store.createSession({
    id: "handoff-session",
    title: "交接测试",
    objective: "保持上下文",
    createdAt: now,
    updatedAt: now,
    participants: [{ id: "deepseek", label: "DeepSeek" }],
    settings: {},
    events: [{ id: "e1", type: "command", content: "分析任务", createdAt: now }],
    plans: [],
    artifacts: [],
    runtime: { status: "idle" },
    threads: { deepseek: { id: "old", threadKey: "old-key", status: "ready" } },
    context: { seatCursors: { deepseek: 0 } },
  });
  return { root, store };
}

test("handoff preview and confirmation atomically replace the seat thread", async (t) => {
  const { store } = await fixture(t);
  const browserManager = {
    async createProviderThread(providerId, options) {
      return { providerId, ...options, status: "verified", url: "https://chat.deepseek.com/" };
    },
  };
  const worker = { async execute(request) {
    await request.checkpoint("submitting", { test: true });
    await request.checkpoint("submitted", { test: true });
    await request.checkpoint("captured", { test: true });
    return { text: "交接完成：任务与分歧已理解" };
  } };
  const manager = new HandoffManager({ store, browserManager, worker });
  const preview = await manager.preview("handoff-session", "deepseek");
  assert.equal(preview.previousThread.id, "old");
  const result = await manager.confirm("handoff-session", preview.id, { timeoutMs: 1000 });
  assert.equal(result.handoff.status, "completed");
  assert.equal(result.session.handoffs[0].status, "completed");
  assert.equal(Object.values(result.session.handoffs[0].executionCheckpoints)[0].phase, "captured");
  assert.notEqual(result.session.threads.deepseek.id, "old");
  assert.equal(result.session.context.seatCursors.deepseek, 0);
});

test("concurrent handoff confirmation claims the preview only once", async (t) => {
  const { store } = await fixture(t);
  let releaseThread;
  const threadGate = new Promise((resolve) => { releaseThread = resolve; });
  const manager = new HandoffManager({
    store,
    browserManager: {
      async createProviderThread(providerId, options) {
        await threadGate;
        return { providerId, ...options, status: "verified", url: "https://chat.deepseek.com/" };
      },
    },
    worker: { async execute() { return { text: "交接完成" }; } },
  });
  const preview = await manager.preview("handoff-session", "deepseek");
  const first = manager.confirm("handoff-session", preview.id, { timeoutMs: 1000 });
  while ((await store.readSession("handoff-session")).handoffs[0].status !== "creating_thread") {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  await assert.rejects(manager.confirm("handoff-session", preview.id), /HANDOFF_NOT_CONFIRMABLE/);
  releaseThread();
  const result = await first;
  assert.equal(result.handoff.status, "completed");
});

test("failed handoff keeps the previous thread binding", async (t) => {
  const { store } = await fixture(t);
  const manager = new HandoffManager({
    store,
    browserManager: { async createProviderThread() { return { status: "waiting_login" }; } },
    worker: { async execute() { throw new Error("must not execute"); } },
  });
  const preview = await manager.preview("handoff-session", "deepseek");
  await assert.rejects(manager.confirm("handoff-session", preview.id), /LOGIN_REQUIRED/);
  const session = await store.readSession("handoff-session");
  assert.equal(session.threads.deepseek.id, "old");
  assert.equal(session.handoffs[0].status, "failed");
});

test("capacity estimates are explicitly marked and provide handoff thresholds", () => {
  assert.deepEqual(estimateThreadCapacity({ deliveredChars: 80 }, [], 100), {
    estimated: true,
    usedChars: 80,
    maxChars: 100,
    percent: 80,
    recommendation: "suggest_handoff",
  });
});
