import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SqliteControlStore } from "./sqlite-control-store.mjs";
import { LocalWorkspaceStore } from "./local-workspace-store.mjs";
import { PageLeaseRegistry } from "../automation/page-lease-registry.mjs";

async function createStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-sqlite-"));
  const store = new SqliteControlStore({ dbPath: path.join(root, "roundtable.db") });
  const status = await store.initialize();
  assert.equal(status.available, true);
  t.after(async () => {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return store;
}

test("SQLite control store transactionally upserts executions and pending state", async (t) => {
  const store = await createStore(t);
  store.importExecutions([{
    executionId: "exec-1",
    attemptId: "attempt-1",
    idempotencyKey: "logical-1",
    sessionId: "session",
    planId: "plan",
    turnId: "turn",
    providerId: "chatgpt",
    status: "running",
    executionPhase: "submitting",
    sendState: "SEND_UNKNOWN",
    error: { code: "SEND_UNKNOWN" },
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:01.000Z",
  }]);
  assert.equal(store.listExecutions({ sessionId: "session", pending: true }).length, 1);
  store.upsertExecution({
    ...store.listExecutions({ sessionId: "session" })[0],
    status: "completed",
    sendState: "COMMITTED",
    updatedAt: "2026-07-21T00:00:02.000Z",
  });
  assert.equal(store.listExecutions({ sessionId: "session", pending: true }).length, 0);
});

test("SQLite control store persists page binding epochs", async (t) => {
  const store = await createStore(t);
  store.importPageBindings([{
    pageBindingId: "binding-1",
    providerId: "deepseek",
    sessionId: "session",
    threadKey: "thread",
    targetId: "target",
    state: "BUSY",
    leaseEpoch: 3,
    ownerExecutionId: "exec-1",
    createdAt: "2026-07-21T00:00:00.000Z",
    lastHeartbeatAt: "2026-07-21T00:00:01.000Z",
  }]);
  const binding = store.listPageBindings()[0];
  assert.equal(binding.pageBindingId, "binding-1");
  assert.equal(binding.leaseEpoch, 3);
  assert.equal(binding.ownerExecutionId, "exec-1");
});

test("SQLite control store degrades to JSON fallback when the module is unavailable", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-sqlite-fallback-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SqliteControlStore({
    dbPath: path.join(root, "roundtable.db"),
    sqliteLoader: async () => { throw Object.assign(new Error("module unavailable"), { code: "MODULE_NOT_FOUND" }); },
  });
  const status = await store.initialize();
  assert.equal(status.available, false);
  assert.equal(status.mode, "json_fallback");
  assert.equal(status.lastError.code, "MODULE_NOT_FOUND");
});

test("JSON stores dual-write executions and page bindings to SQLite", async (t) => {
  const control = await createStore(t);
  const root = path.dirname(control.dbPath);
  const workspace = new LocalWorkspaceStore({ repoRoot: root, dataRoot: path.join(root, "data"), controlStore: control });
  await workspace.initialize();
  const now = new Date().toISOString();
  await workspace.createSession({
    id: "session-dual-write",
    title: "dual write",
    objective: "",
    createdAt: now,
    updatedAt: now,
    participants: [],
    plans: [],
    events: [],
    executionIndex: [],
  });
  await workspace.updateSession("session-dual-write", (session) => {
    session.executionIndex = [{
      executionId: "exec-dual",
      attemptId: "attempt-dual",
      idempotencyKey: "logical-dual",
      sessionId: session.id,
      planId: "plan",
      turnId: "turn",
      providerId: "chatgpt",
      status: "running",
      executionPhase: "prepared",
      sendState: "NOT_SENT",
      createdAt: now,
      updatedAt: now,
    }];
    return session;
  });
  assert.equal(control.listExecutions({ sessionId: "session-dual-write" }).length, 1);

  const leases = new PageLeaseRegistry({ filePath: path.join(root, "page-leases.json"), controlStore: control });
  await leases.initialize();
  const lease = await leases.reserve({ providerId: "chatgpt", sessionId: "session-dual-write", threadKey: "thread", targetId: "target" });
  await leases.bind(lease.pageBindingId, { url: "https://chatgpt.com/" });
  assert.equal(control.listPageBindings().some((binding) => binding.pageBindingId === lease.pageBindingId), true);
  await fs.rm(path.join(root, "page-leases.json"));
  const restoredLeases = new PageLeaseRegistry({ filePath: path.join(root, "page-leases.json"), controlStore: control });
  await restoredLeases.initialize();
  assert.equal(restoredLeases.get(lease.pageBindingId).leaseEpoch, lease.leaseEpoch);
  assert.equal(await fs.stat(path.join(root, "page-leases.json")).then(() => true), true);
});

test("existing phase-one database migrates to schema v2 exactly once", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-sqlite-v1-"));
  const dbPath = path.join(root, "roundtable.db");
  const { DatabaseSync } = await import("node:sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE control_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO control_meta VALUES ('schema_version', '1', '2026-07-21T00:00:00.000Z');
    CREATE TABLE turn_executions (
      execution_id TEXT PRIMARY KEY, attempt_id TEXT, idempotency_key TEXT,
      session_id TEXT NOT NULL, plan_id TEXT, turn_id TEXT NOT NULL, provider_id TEXT,
      status TEXT, execution_phase TEXT, send_state TEXT, error_json TEXT,
      payload_json TEXT NOT NULL, created_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE page_bindings (
      page_binding_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, session_id TEXT,
      thread_key TEXT, browser_context_id TEXT, target_id TEXT, state TEXT NOT NULL,
      lease_epoch INTEGER NOT NULL, owner_execution_id TEXT, url TEXT,
      page_fingerprint TEXT, payload_json TEXT NOT NULL, created_at TEXT,
      last_heartbeat_at TEXT, lease_expires_at TEXT, released_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  legacy.close();

  const first = new SqliteControlStore({ dbPath });
  assert.equal((await first.initialize()).appliedSchemaVersion, 2);
  first.close();

  const second = new SqliteControlStore({ dbPath });
  const status = await second.initialize();
  assert.equal(status.appliedSchemaVersion, 2);
  assert.equal(status.migrationStatus, "current");
  assert.deepEqual(
    second.database.prepare("SELECT version FROM control_migrations ORDER BY version").all().map((row) => row.version),
    [1, 2],
  );
  assert.equal(second.database.prepare("PRAGMA user_version").get().user_version, 2);
  second.close();
  await fs.rm(root, { recursive: true, force: true });
  t.after(() => second.close());
});

test("v1 duplicate execution attempts are deleted and audited during migration", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-sqlite-v1-conflict-"));
  const dbPath = path.join(root, "roundtable.db");
  const { DatabaseSync } = await import("node:sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE control_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO control_meta VALUES ('schema_version', '1', '2026-07-21T00:00:00.000Z');
    CREATE TABLE turn_executions (
      execution_id TEXT PRIMARY KEY, attempt_id TEXT, idempotency_key TEXT,
      session_id TEXT NOT NULL, plan_id TEXT, turn_id TEXT NOT NULL, provider_id TEXT,
      status TEXT, execution_phase TEXT, send_state TEXT, error_json TEXT,
      payload_json TEXT NOT NULL, created_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE page_bindings (
      page_binding_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, session_id TEXT,
      thread_key TEXT, browser_context_id TEXT, target_id TEXT, state TEXT NOT NULL,
      lease_epoch INTEGER NOT NULL, owner_execution_id TEXT, url TEXT,
      page_fingerprint TEXT, payload_json TEXT NOT NULL, created_at TEXT,
      last_heartbeat_at TEXT, lease_expires_at TEXT, released_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO turn_executions(
      execution_id, attempt_id, idempotency_key, session_id, turn_id, payload_json, updated_at
    ) VALUES
      ('exec-kept', 'attempt-dup', 'logical-dup', 'session', 'turn',
       '{"executionId":"exec-kept","attemptId":"attempt-dup","idempotencyKey":"logical-dup"}',
       '2026-07-21T00:00:01.000Z'),
      ('exec-newest', 'attempt-dup', 'logical-dup', 'session', 'turn',
       '{"executionId":"exec-newest","attemptId":"attempt-dup","idempotencyKey":"logical-dup"}',
       '2026-07-21T00:00:02.000Z');
  `);
  legacy.close();

  const store = new SqliteControlStore({ dbPath });
  const status = await store.initialize();
  assert.equal(status.available, true);
  assert.equal(status.conflictCount, 1);
  assert.equal(store.listConflicts()[0].conflictCode, "EXECUTION_ATTEMPT_CONFLICT");
  assert.deepEqual(store.listExecutions().map((record) => record.executionId), ["exec-newest"]);
  assert.equal(store.upsertExecution({
    executionId: "exec-third",
    attemptId: "attempt-dup",
    idempotencyKey: "logical-dup",
    sessionId: "session",
    turnId: "turn",
    updatedAt: "2026-07-21T00:00:03.000Z",
  }), false);
  store.close();
  await fs.rm(root, { recursive: true, force: true });
  t.after(() => store.close());
});

test("stale execution writes cannot replace newer SQLite state", async (t) => {
  const store = await createStore(t);
  const base = {
    executionId: "exec-stale",
    attemptId: "attempt-stale",
    idempotencyKey: "logical-stale",
    sessionId: "session",
    turnId: "turn",
    providerId: "chatgpt",
    status: "completed",
    sendState: "COMMITTED",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:02.000Z",
  };
  assert.equal(store.upsertExecution(base), true);
  assert.equal(store.upsertExecution({
    ...base,
    status: "running",
    sendState: "SENT",
    updatedAt: "2026-07-21T00:00:01.000Z",
  }), false);
  assert.equal(store.listExecutions()[0].sendState, "COMMITTED");
  assert.equal(store.listConflicts()[0].conflictCode, "EXECUTION_STALE_WRITE");
  assert.equal(store.describe().conflictCount, 1);
  assert.equal(store.describe().lastConflict.conflictCode, "EXECUTION_STALE_WRITE");
});

test("execution identity pair cannot be claimed by another execution", async (t) => {
  const store = await createStore(t);
  const first = {
    executionId: "exec-first",
    attemptId: "attempt-shared",
    idempotencyKey: "logical-shared",
    sessionId: "session",
    turnId: "turn",
    updatedAt: "2026-07-21T00:00:01.000Z",
  };
  assert.equal(store.upsertExecution(first), true);
  assert.equal(store.upsertExecution({ ...first, executionId: "exec-second" }), false);
  assert.deepEqual(store.listExecutions().map((record) => record.executionId), ["exec-first"]);
  assert.equal(store.listConflicts()[0].conflictCode, "EXECUTION_ATTEMPT_CONFLICT");
});

test("lower page lease epochs are rejected and audited", async (t) => {
  const store = await createStore(t);
  const current = {
    pageBindingId: "binding-stale",
    providerId: "chatgpt",
    sessionId: "session",
    threadKey: "thread",
    targetId: "target-current",
    state: "BUSY",
    leaseEpoch: 4,
    ownerExecutionId: "exec-current",
    createdAt: "2026-07-21T00:00:00.000Z",
    lastHeartbeatAt: "2026-07-21T00:00:04.000Z",
  };
  assert.equal(store.upsertPageBinding(current), true);
  assert.equal(store.upsertPageBinding({
    ...current,
    targetId: "target-stale",
    leaseEpoch: 3,
    ownerExecutionId: "exec-stale",
    lastHeartbeatAt: "2026-07-21T00:00:05.000Z",
  }), false);
  assert.equal(store.listPageBindings()[0].leaseEpoch, 4);
  assert.equal(store.listPageBindings()[0].targetId, "target-current");
  assert.equal(store.listConflicts()[0].conflictCode, "PAGE_BINDING_STALE_EPOCH");
});

test("same-epoch page ownership cannot be replaced before lease expiry", async (t) => {
  const store = await createStore(t);
  const current = {
    pageBindingId: "binding-owner",
    providerId: "chatgpt",
    sessionId: "session",
    threadKey: "thread",
    targetId: "target",
    state: "BUSY",
    leaseEpoch: 7,
    ownerExecutionId: "exec-current",
    createdAt: "2026-07-21T00:00:00.000Z",
    lastHeartbeatAt: "2026-07-21T00:00:04.000Z",
    leaseExpiresAt: "2026-07-21T00:00:10.000Z",
  };
  store.upsertPageBinding(current);
  assert.equal(store.upsertPageBinding({
    ...current,
    ownerExecutionId: "exec-intruder",
    lastHeartbeatAt: "2026-07-21T00:00:05.000Z",
  }), false);
  assert.equal(store.listPageBindings()[0].ownerExecutionId, "exec-current");
  assert.equal(store.listConflicts()[0].conflictCode, "PAGE_BINDING_OWNER_CONFLICT");
});

test("page lease registry treats SQLite as primary and repairs stale JSON", async (t) => {
  const store = await createStore(t);
  const root = path.dirname(store.dbPath);
  const filePath = path.join(root, "primary-page-leases.json");
  const current = {
    pageBindingId: "binding-primary",
    providerId: "chatgpt",
    sessionId: "session",
    threadKey: "thread",
    targetId: "target-current",
    state: "BOUND_IDLE",
    leaseEpoch: 5,
    createdAt: "2026-07-21T00:00:00.000Z",
    lastHeartbeatAt: "2026-07-21T00:00:05.000Z",
  };
  store.upsertPageBinding(current);
  await fs.writeFile(filePath, JSON.stringify({
    schema: "web-agents-page-leases.v1",
    records: [{
      ...current,
      targetId: "target-stale",
      leaseEpoch: 2,
      lastHeartbeatAt: "2026-07-21T00:00:02.000Z",
    }],
  }));

  const registry = new PageLeaseRegistry({ filePath, controlStore: store });
  await registry.initialize();
  assert.equal(registry.get("binding-primary").leaseEpoch, 5);
  assert.equal(registry.get("binding-primary").targetId, "target-current");
  const repaired = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(repaired.records[0].leaseEpoch, 5);
});
