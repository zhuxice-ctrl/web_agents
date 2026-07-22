import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalWorkspaceStore } from "./local-workspace-store.mjs";

async function createFixture() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-store-"));
  const dataRoot = path.join(repoRoot, "roundtable-data");
  const store = new LocalWorkspaceStore({ repoRoot, dataRoot });
  await store.initialize();
  return { repoRoot, dataRoot, store };
}

test("local workspace store writes atomic state and append-only ledger records", async () => {
  const { dataRoot, store } = await createFixture();
  const session = await store.createSession({
    id: "20260715-120000-test0001",
    title: "存储测试",
    objective: "验证 JSONL",
    createdAt: "2026-07-15T04:00:00.000Z",
    updatedAt: "2026-07-15T04:00:00.000Z",
    participants: [],
    hostId: null,
    layout: {},
    settings: {},
    plans: [],
    summary: null,
    runtime: {},
    participantRoles: { chatgpt: "学习科学研究者" },
    pendingInterventions: [{
      id: "i1",
      planId: "p1",
      content: "请考虑时间有限的情况",
      status: "pending",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    }],
    events: [],
  });

  await store.appendEvents(session.id, [
    { id: "event-1", type: "command", content: "@全体 开始", createdAt: "2026-07-15T04:01:00.000Z" },
    { id: "event-2", type: "reply", providerId: "deepseek", content: "第一条回复", createdAt: "2026-07-15T04:02:00.000Z" },
  ]);
  await store.appendEvents(session.id, [
    { id: "event-3", type: "reply", providerId: "doubao", content: "第二条回复", createdAt: "2026-07-15T04:03:00.000Z" },
  ]);

  const sessionDir = path.join(dataRoot, "sessions", session.id);
  const ledgerText = await fs.readFile(path.join(sessionDir, "ledger.jsonl"), "utf8");
  const lines = ledgerText.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.id), ["event-1", "event-2", "event-3"]);
  const savedSession = await store.readSession(session.id);
  assert.equal(savedSession.events.length, 3);
  assert.equal(savedSession.participantRoles.chatgpt, "学习科学研究者");
  assert.equal(savedSession.pendingInterventions[0].content, "请考虑时间有限的情况");

  const directoryEntries = await fs.readdir(sessionDir);
  assert.equal(directoryEntries.some((name) => name.includes(".tmp-")), false);
  assert.ok(directoryEntries.includes("session.json"));
  assert.ok(directoryEntries.includes("state.json"));
  assert.ok(directoryEntries.includes("plans"));
  assert.ok(directoryEntries.includes("replies"));
  assert.ok(directoryEntries.includes("artifacts"));
  assert.ok(directoryEntries.includes("diagnostics"));
  assert.ok(directoryEntries.includes("backups"));
});

test("atomic session updates merge concurrent state changes without stale overwrites", async () => {
  const { store } = await createFixture();
  const session = await store.createSession({
    id: "20260715-120050-atomic01",
    title: "原子更新",
    objective: "并发状态",
    createdAt: "2026-07-15T04:00:00.000Z",
    updatedAt: "2026-07-15T04:00:00.000Z",
    participants: [],
    hostId: null,
    layout: {},
    settings: {},
    plans: [],
    summary: null,
    runtime: {},
    threads: { deepseek: { status: "unprovisioned" } },
    events: [],
  });

  await Promise.all([
    store.updateSession(session.id, async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current.threads.deepseek.status = "waiting_browser";
      return current;
    }),
    store.updateSession(session.id, (current) => {
      current.runtime = { status: "running", activeRunId: "run-atomic" };
      return current;
    }),
  ]);

  const saved = await store.readSession(session.id);
  assert.equal(saved.threads.deepseek.status, "waiting_browser");
  assert.equal(saved.runtime.activeRunId, "run-atomic");
});

test("local workspace store lists, exports, imports, and reindexes sessions", async () => {
  const { repoRoot, store } = await createFixture();
  const session = await store.createSession({
    id: "20260715-120100-test0002",
    title: "可移植会话",
    objective: "验证导入导出",
    createdAt: "2026-07-15T04:01:00.000Z",
    updatedAt: "2026-07-15T04:01:00.000Z",
    participants: [],
    hostId: null,
    layout: {},
    settings: {},
    plans: [],
    summary: null,
    runtime: {},
    events: [],
  });
  await store.appendEvents(session.id, [
    { id: "portable-event", type: "note", content: "可导入", createdAt: "2026-07-15T04:02:00.000Z" },
  ]);

  const exported = await store.exportSession(session.id, path.join(repoRoot, "exports"));
  assert.match(exported.filePath, /\.json$/);

  const secondRoot = path.join(repoRoot, "second-root");
  const importedStore = new LocalWorkspaceStore({ repoRoot, dataRoot: secondRoot });
  await importedStore.initialize();
  const imported = await importedStore.importFromPath(exported.filePath);
  assert.equal(imported.imported.length, 1);
  assert.equal((await importedStore.readSession(session.id)).events[0].content, "可导入");

  await fs.rm(path.join(secondRoot, "indexes", "sessions.json"), { force: true });
  const reindexed = await importedStore.reindex();
  assert.equal(reindexed.sessions.length, 1);
  assert.equal((await importedStore.listSessions())[0].title, "可移植会话");
});

test("local workspace store imports legacy ledger.json sessions", async () => {
  const { repoRoot, store } = await createFixture();
  const legacyRoot = path.join(repoRoot, "legacy-session");
  await fs.mkdir(legacyRoot, { recursive: true });
  await fs.writeFile(
    path.join(legacyRoot, "ledger.json"),
    JSON.stringify({
      id: "20260715-120200-legacy01",
      title: "旧会话",
      objective: "迁移",
      createdAt: "2026-07-15T04:02:00.000Z",
      updatedAt: "2026-07-15T04:03:00.000Z",
      participants: [],
      hostId: null,
      layout: {},
      settings: {},
      plans: [],
      summary: null,
      events: [{ id: "legacy-event", type: "reply", content: "旧记录", createdAt: "2026-07-15T04:03:00.000Z" }],
    }),
    "utf8"
  );

  const imported = await store.importFromPath(legacyRoot);
  assert.deepEqual(imported.imported, ["20260715-120200-legacy01"]);
  assert.equal((await store.readSession("20260715-120200-legacy01")).events[0].content, "旧记录");
});
