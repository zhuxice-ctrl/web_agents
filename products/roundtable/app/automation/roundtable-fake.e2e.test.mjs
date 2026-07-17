import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSession, updateSessionSettings } from "../server.mjs";
import { LocalWorkspaceStore } from "../storage/local-workspace-store.mjs";
import { RoundtableScheduler } from "../orchestrator/scheduler.mjs";
import { startFakeProviderServer } from "../test-support/fake-provider-server.mjs";
import { createProviderAdapters } from "./adapters/index.mjs";
import { BrowserManager } from "./browser-manager.mjs";
import { BrowserWorker } from "./worker.mjs";

test("real browser worker completes discussion snapshots and host-final relay against fake providers", { timeout: 120000 }, async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-full-browser-e2e-"));
  const fake = await startFakeProviderServer();
  const adapters = createProviderAdapters({
    urlOverrides: {
      chatgpt: `${fake.baseUrl}/chatgpt`,
      deepseek: `${fake.baseUrl}/deepseek`,
      doubao: `${fake.baseUrl}/doubao`,
    },
  });
  const manager = new BrowserManager({
    profileDir: path.join(repoRoot, "profile"),
    adapters,
    headless: true,
    channel: "chrome",
  });
  t.after(async () => {
    await manager.close();
    await fake.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  const store = new LocalWorkspaceStore({ repoRoot, dataRoot: path.join(repoRoot, "data") });
  await store.initialize();
  const worker = new BrowserWorker({ manager, adapters });
  const scheduler = new RoundtableScheduler({ store, worker });
  const session = await createSession({
    title: "Fake provider full loop",
    objective: "验证真实浏览器调度",
    participants: ["chatgpt", "deepseek", "doubao"],
    settings: {
      mode: "playwright",
      conversationMode: "discussion",
      defaultRounds: 2,
      executionTimeoutMs: 10000,
      settleMs: 120,
      autoSend: true,
      autoCapture: true,
      maxContextEvents: 30,
    },
  }, { store });

  const discussion = await scheduler.executeCommand(session.id, { text: "@全体 讨论两轮" });
  assert.equal(discussion.plan.status, "completed");
  const roundOneTurns = discussion.plan.turns.filter((turn) => turn.round === 1);
  const roundTwoTurns = discussion.plan.turns.filter((turn) => turn.round === 2);
  assert.equal(roundOneTurns.every((turn) => !turn.prompt.includes("FAKE_RESPONSE[")), true);
  for (const turn of roundTwoTurns) {
    assert.match(turn.prompt, /FAKE_RESPONSE\[chatgpt\]#1/);
    assert.match(turn.prompt, /FAKE_RESPONSE\[deepseek\]#1/);
    assert.match(turn.prompt, /FAKE_RESPONSE\[doubao\]#1/);
  }

  await updateSessionSettings(session.id, {
    settings: {
      ...discussion.session.settings,
      mode: "playwright",
      conversationMode: "relay",
      executionTimeoutMs: 10000,
      settleMs: 120,
    },
  }, { store });
  const relay = await scheduler.executeCommand(session.id, { text: "如何训练审美" });
  assert.deepEqual(relay.plan.route, ["deepseek", "doubao", "chatgpt"]);
  assert.equal(relay.plan.turns.at(-1).role, "host_summary");
  assert.match(relay.plan.turns[1].prompt, /FAKE_RESPONSE\[deepseek\]#3/);
  assert.match(relay.plan.turns[2].prompt, /FAKE_RESPONSE\[doubao\]#3/);
  assert.match(relay.plan.turns[2].prompt, /你是东家/);
  assert.deepEqual(
    relay.session.events.filter((event) => event.commandId === relay.plan.id && event.type === "reply").map((event) => event.providerId),
    ["deepseek", "doubao", "chatgpt"]
  );
});
