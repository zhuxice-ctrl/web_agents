import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PathLockManager } from "./path-lock-manager.mjs";
import { atomicWriteJson, TransactionError, TransactionManager } from "./transaction-manager.mjs";

function createFaultInjectingFileSystem({ failures, onRename } = {}) {
  let renameCalls = 0;
  const removedPaths = [];
  return {
    fileSystem: {
      mkdir: (...args) => fs.mkdir(...args),
      writeFile: (...args) => fs.writeFile(...args),
      async rename(source, destination) {
        renameCalls += 1;
        await onRename?.({ call: renameCalls, source, destination });
        const code = failures?.get(renameCalls);
        if (code) throw Object.assign(new Error(`Injected rename failure ${code}`), { code });
        return fs.rename(source, destination);
      },
      async rm(target, options) {
        removedPaths.push(target);
        return fs.rm(target, options);
      },
    },
    get renameCalls() {
      return renameCalls;
    },
    removedPaths,
  };
}

async function createFixture(t, executeTool) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-transaction-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let id = 0;
  const manager = new TransactionManager({
    workspaceRoot: workspace,
    transactionRoot: path.join(workspace, ".web-agents", "transactions"),
    pathLockManager: new PathLockManager({ cwd: workspace, isolated: true }),
    executeTool,
    idFactory: () => `tx-${++id}`,
  });
  return { root, workspace, manager };
}

async function writeExecutor(name, args) {
  if (name !== "write_file") throw new Error(`Unexpected tool ${name}`);
  await fs.mkdir(path.dirname(args.path), { recursive: true });
  await fs.writeFile(args.path, args.content, "utf8");
  return { content: [{ type: "text", text: `wrote ${args.path}` }] };
}

test("transaction JSON replacement keeps a recoverable original on Windows conflicts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-transaction-atomic-success-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "transaction.json");
  await fs.writeFile(target, '{"status":"before"}\n', "utf8");

  let exchangePath = null;
  let recoverableContent = null;
  const injected = createFaultInjectingFileSystem({
    failures: new Map([[1, "EEXIST"]]),
    async onRename({ call, destination }) {
      if (call === 2) exchangePath = destination;
      if (call === 3) recoverableContent = await fs.readFile(exchangePath, "utf8");
    },
  });

  await atomicWriteJson(target, { status: "after" }, {
    fileSystem: injected.fileSystem,
    idFactory: () => "success",
  });

  assert.equal(recoverableContent, '{"status":"before"}\n');
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), { status: "after" });
  assert.equal(injected.removedPaths.includes(target), false);
  assert.equal(injected.renameCalls, 3);
  assert.deepEqual((await fs.readdir(root)).filter((name) => /\.(?:tmp|swap)-/.test(name)), []);
});

test("transaction JSON replacement restores the original after a second rename failure", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-transaction-atomic-restore-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "transaction.json");
  await fs.writeFile(target, '{"status":"before"}\n', "utf8");
  const injected = createFaultInjectingFileSystem({
    failures: new Map([
      [1, "EPERM"],
      [3, "EEXIST"],
    ]),
  });

  await assert.rejects(
    () => atomicWriteJson(target, { status: "after" }, {
      fileSystem: injected.fileSystem,
      idFactory: () => "restore",
    }),
    (error) => error?.code === "EEXIST"
  );

  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), { status: "before" });
  assert.equal(injected.removedPaths.includes(target), false);
  assert.equal(injected.renameCalls, 4);
  assert.deepEqual((await fs.readdir(root)).filter((name) => /\.(?:tmp|swap)-/.test(name)), []);
});

test("transactions record sequence, hashes, backups, UTF-8 instruction, and idempotent execution IDs", async (t) => {
  let executions = 0;
  const { workspace, manager } = await createFixture(t, async (...args) => {
    executions += 1;
    return writeExecutor(...args);
  });
  const target = path.join(workspace, "result.txt");
  await fs.writeFile(target, "before", "utf8");
  const transaction = await manager.begin({
    taskId: "task-success",
    executorId: "provider-b",
    originalInstruction: "写入 UTF-8 结果",
    executionId: "loop-success:transaction",
  });
  const call = {
    executionId: "loop-success:call-1",
    executorId: "provider-b",
    tool: "write_file",
    args: { path: target, content: "after" },
  };
  const first = await manager.execute(transaction.id, call);
  const replay = await manager.execute(transaction.id, call);
  assert.deepEqual(replay.call, first.call);
  assert.equal(executions, 1);
  await assert.rejects(
    () => manager.execute(transaction.id, {
      ...call,
      args: { path: target, content: "same execution ID, different input" },
    }),
    (error) => error instanceof TransactionError && error.code === "EXECUTION_ID_MISMATCH"
  );
  const committed = await manager.commit(transaction.id);

  assert.equal(await fs.readFile(target, "utf8"), "after");
  assert.equal(committed.status, "committed");
  assert.equal(committed.calls[0].sequence, 1);
  assert.notEqual(committed.calls[0].pathRecords[0].before.hash, committed.calls[0].pathRecords[0].after.hash);
  await fs.access(committed.calls[0].pathRecords[0].before.backupPath);
  const manifestPath = path.join(workspace, ".web-agents", "transactions", transaction.id, "transaction.json");
  assert.match(await fs.readFile(manifestPath, "utf8"), /写入 UTF-8 结果/);
});

test("persisted execution IDs are reloaded after a service restart without repeating a write", async (t) => {
  let executions = 0;
  const { workspace, manager } = await createFixture(t, async (...args) => {
    executions += 1;
    return writeExecutor(...args);
  });
  const target = path.join(workspace, "restart.txt");
  const metadata = {
    taskId: "task-restart",
    executorId: "deepseek",
    originalInstruction: "重启后不要重复写入",
    executionId: "restart:transaction",
  };
  const call = {
    executionId: "restart:call-1",
    executorId: "deepseek",
    tool: "write_file",
    args: { path: target, content: "once" },
  };
  const transaction = await manager.begin(metadata);
  await manager.execute(transaction.id, call);
  await manager.commit(transaction.id);
  assert.equal(executions, 1);

  const restored = new TransactionManager({
    workspaceRoot: workspace,
    transactionRoot: path.join(workspace, ".web-agents", "transactions"),
    pathLockManager: new PathLockManager({ cwd: workspace, isolated: true }),
    executeTool: async (...args) => {
      executions += 1;
      return writeExecutor(...args);
    },
  });
  await restored.initialize();
  const sameTransaction = await restored.begin(metadata);
  const replay = await restored.execute(sameTransaction.id, call);
  assert.equal(replay.replayed, true);
  assert.equal(executions, 1);
  assert.equal(await fs.readFile(target, "utf8"), "once");
});

test("a failed write automatically rolls back every earlier and partially changed path", async (t) => {
  let invocation = 0;
  const { workspace, manager } = await createFixture(t, async (name, args) => {
    invocation += 1;
    await writeExecutor(name, args);
    if (invocation === 2) throw new Error("simulated partial failure");
    return { ok: true };
  });
  const firstPath = path.join(workspace, "first.txt");
  const secondPath = path.join(workspace, "second.txt");
  await Promise.all([
    fs.writeFile(firstPath, "first-before", "utf8"),
    fs.writeFile(secondPath, "second-before", "utf8"),
  ]);
  const transaction = await manager.begin({
    taskId: "task-failure",
    executorId: "provider-b",
    originalInstruction: "two writes",
  });
  await manager.execute(transaction.id, {
    executionId: "first-write",
    tool: "write_file",
    args: { path: firstPath, content: "first-after" },
  });
  await assert.rejects(
    () => manager.execute(transaction.id, {
      executionId: "second-write",
      tool: "write_file",
      args: { path: secondPath, content: "second-after" },
    }),
    (error) => error instanceof TransactionError
      && error.code === "TRANSACTION_CALL_FAILED"
      && /simulated partial failure/.test(error.message)
  );

  assert.equal(await fs.readFile(firstPath, "utf8"), "first-before");
  assert.equal(await fs.readFile(secondPath, "utf8"), "second-before");
  const rolledBack = manager.getTransaction(transaction.id);
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.calls.length, 2);
  assert.equal(rolledBack.rollback.status, "completed");
});

test("rollback hash conflicts preserve the later edit and create a recovery copy", async (t) => {
  const { workspace, manager } = await createFixture(t, writeExecutor);
  const target = path.join(workspace, "conflict.txt");
  await fs.writeFile(target, "original", "utf8");
  const transaction = await manager.begin({
    taskId: "task-conflict",
    executorId: "provider-b",
    originalInstruction: "change then rollback",
  });
  await manager.execute(transaction.id, {
    executionId: "conflict-write",
    tool: "write_file",
    args: { path: target, content: "generated" },
  });
  await manager.commit(transaction.id);
  await fs.writeFile(target, "later user edit", "utf8");

  const rollback = await manager.rollback(transaction.id);
  assert.equal(rollback.status, "conflicted");
  assert.equal(rollback.conflicts.length, 1);
  assert.equal(await fs.readFile(target, "utf8"), "later user edit");
  assert.equal(await fs.readFile(rollback.conflicts[0].recoveryPath, "utf8"), "original");
  assert.equal(manager.getTransaction(transaction.id).status, "rollback_conflicted");
});

test("rollback rejects a transaction owned by another roundtable session", async (t) => {
  const { manager } = await createFixture(t, writeExecutor);
  const transaction = await manager.begin({
    taskId: "session-owned-task",
    sessionId: "session-a",
    executorId: "provider-b",
    originalInstruction: "session-owned rollback",
  });

  assert.equal(transaction.sessionId, "session-a");
  await assert.rejects(
    () => manager.rollback(transaction.id, { sessionId: "session-b" }),
    (error) => error instanceof TransactionError && error.code === "TRANSACTION_SESSION_MISMATCH",
  );
  assert.equal(manager.getTransaction(transaction.id).status, "active");
});

test("trusted rollback binds one legacy transaction to its verified session", async (t) => {
  const { manager } = await createFixture(t, writeExecutor);
  const transaction = await manager.begin({
    taskId: "legacy-session-task",
    executorId: "provider-b",
    originalInstruction: "legacy transaction without a session owner",
  });

  const rollback = await manager.rollback(transaction.id, {
    sessionId: "session-a",
    bindLegacySession: true,
  });
  assert.equal(rollback.status, "completed");
  assert.equal(manager.getTransaction(transaction.id).sessionId, "session-a");
  await assert.rejects(
    () => manager.rollback(transaction.id, { sessionId: "session-b", bindLegacySession: true }),
    (error) => error instanceof TransactionError && error.code === "TRANSACTION_SESSION_MISMATCH",
  );
});

test("only one write executor can own a task", async (t) => {
  const { manager } = await createFixture(t, writeExecutor);
  await manager.begin({ taskId: "single-writer", executorId: "provider-a" });
  await assert.rejects(
    () => manager.begin({ taskId: "single-writer", executorId: "provider-b" }),
    (error) => error instanceof TransactionError && error.code === "WRITE_EXECUTOR_MISMATCH"
  );
});

test("transactions reject workspace junction aliases before writing or locking the external target", async (t) => {
  const { root, workspace, manager } = await createFixture(t, writeExecutor);
  const outside = path.join(root, "outside");
  const junction = path.join(workspace, "linked-outside");
  await fs.mkdir(outside);
  try {
    await fs.symlink(outside, junction, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`junction unavailable: ${error.code || error.message}`);
    return;
  }
  const target = path.join(junction, "result.txt");
  const transaction = await manager.begin({ taskId: "junction-write", executorId: "provider-a" });

  await assert.rejects(
    () => manager.execute(transaction.id, {
      executionId: "junction-write-call",
      executorId: "provider-a",
      tool: "write_file",
      args: { path: target, content: "must not write" },
    }),
    (error) => error instanceof TransactionError && error.code === "REPARSE_PATH_WRITE_DENIED",
  );
  await assert.rejects(fs.access(path.join(outside, "result.txt")), /ENOENT/);
});

test("transactions reject a physical path set that differs from permission authorization", async (t) => {
  const { workspace, manager } = await createFixture(t, writeExecutor);
  const target = path.join(workspace, "authorized.txt");
  const other = path.join(workspace, "other.txt");
  const transaction = await manager.begin({ taskId: "permission-paths", executorId: "provider-a" });

  await assert.rejects(
    () => manager.execute(transaction.id, {
      executionId: "permission-paths-call",
      executorId: "provider-a",
      tool: "write_file",
      args: { path: target, content: "must not write" },
      context: { permission: { paths: [other] } },
    }),
    (error) => error instanceof TransactionError && error.code === "PERMISSION_PATHS_CHANGED",
  );
  await assert.rejects(fs.access(target), /ENOENT/);
});

test("transactions execute against the physical path when the workspace root is a junction", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-workspace-junction-"));
  const physicalWorkspace = path.join(root, "physical-workspace");
  const workspaceJunction = path.join(root, "workspace-link");
  await fs.mkdir(physicalWorkspace);
  try {
    await fs.symlink(physicalWorkspace, workspaceJunction, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`junction unavailable: ${error.code || error.message}`);
    return;
  }
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let executedPath = null;
  const manager = new TransactionManager({
    workspaceRoot: workspaceJunction,
    transactionRoot: path.join(physicalWorkspace, ".web-agents", "transactions"),
    pathLockManager: new PathLockManager({ cwd: workspaceJunction, isolated: true }),
    executeTool: async (name, args) => {
      executedPath = args.path;
      return writeExecutor(name, args);
    },
    idFactory: () => "tx-workspace-junction",
  });
  const target = path.join(workspaceJunction, "result.txt");
  const transaction = await manager.begin({ taskId: "workspace-junction", executorId: "provider-a" });
  await manager.execute(transaction.id, {
    executionId: "workspace-junction-call",
    executorId: "provider-a",
    tool: "write_file",
    args: { path: target, content: "physical" },
  });

  assert.equal(path.resolve(executedPath), path.resolve(physicalWorkspace, "result.txt"));
  assert.equal(await fs.readFile(path.join(physicalWorkspace, "result.txt"), "utf8"), "physical");
});
