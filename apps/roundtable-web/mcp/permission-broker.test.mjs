import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PermissionBroker, PermissionBrokerError } from "./permission-broker.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-permission-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)]);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let requestSequence = 0;
  let tokenSequence = 0;
  const broker = new PermissionBroker({
    workspaceRoot: workspace,
    idFactory: () => `request-${++requestSequence}`,
    tokenFactory: () => `token-${++tokenSequence}`,
  });
  return { root, workspace, outside, broker };
}

test("workspace writes are automatic and external reads are automatic but audited", async (t) => {
  const { workspace, outside, broker } = await fixture(t);
  const workspaceWrite = await broker.authorize({
    taskId: "task-a",
    tool: "write_file",
    args: { path: path.join(workspace, "result.txt"), content: "inside" },
  });
  assert.equal(workspaceWrite.allowed, true);
  assert.equal(workspaceWrite.authorization, "workspace_write");

  const externalRead = await broker.authorize({
    taskId: "task-a",
    tool: "read_text_file",
    args: { path: path.join(outside, "evidence.txt") },
  });
  assert.equal(externalRead.allowed, true);
  assert.equal(externalRead.authorization, "audited_external_read");
  assert.equal(broker.listAudit().some((event) => event.event === "external_read_allowed"), true);

  const unknown = await broker.authorize({ taskId: "task-a", tool: "invented_tool", args: {} });
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.code, "UNKNOWN_TOOL");

  const incompleteBroker = new PermissionBroker({
    workspaceRoot: workspace,
    registry: {
      unsafe_write: { readOnly: false, mutating: true },
    },
  });
  const incomplete = await incompleteBroker.authorize({
    taskId: "task-a",
    tool: "unsafe_write",
    args: { path: path.join(workspace, "unsafe.txt") },
  });
  assert.equal(incomplete.allowed, false);
  assert.equal(incomplete.code, "TOOL_METADATA_INCOMPLETE");
});

test("identical external writes create only one pending request", async (t) => {
  const { outside, broker } = await fixture(t);
  const call = {
    taskId: "task-b",
    tool: "write_file",
    args: { path: path.join(outside, "result.txt"), content: "secret body" },
  };
  const first = await broker.authorize(call);
  const duplicate = await broker.authorize(call);
  assert.equal(first.status, "permission_required");
  assert.equal(duplicate.request.requestId, first.request.requestId);
  assert.equal(broker.listRequests().length, 1);
  assert.deepEqual(first.request.reasons, ["external_write"]);
  assert.equal(JSON.stringify(broker.listAudit()).includes("secret body"), false);
});

test("allow_once binds request, task, tool, paths, and args hash and consumes once", async (t) => {
  const { outside, broker } = await fixture(t);
  const target = path.join(outside, "once.txt");
  const call = {
    taskId: "task-once",
    tool: "write_file",
    args: { path: target, content: "approved" },
  };
  const check = await broker.authorize(call);
  const approval = await broker.resolveRequest({
    requestId: check.request.requestId,
    decision: "allow_once",
  });

  const tampered = await broker.authorize({
    ...call,
    args: { path: target, content: "tampered" },
    permission: { requestId: check.request.requestId, token: approval.token },
  });
  assert.equal(tampered.allowed, false);
  assert.equal(tampered.code, "ARGS_HASH_MISMATCH");

  const allowed = await broker.authorize({
    ...call,
    permission: { requestId: check.request.requestId, token: approval.token },
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.authorization, "allow_once");

  const replay = await broker.authorize({
    ...call,
    permission: { requestId: check.request.requestId, token: approval.token },
  });
  assert.equal(replay.allowed, false);
  assert.equal(replay.code, "TOKEN_ALREADY_USED");
});

test("reject denies consumption and allow_task grants only the same task, tool, and paths", async (t) => {
  const { outside, broker } = await fixture(t);
  const rejectedCall = {
    taskId: "task-reject",
    tool: "write_file",
    args: { path: path.join(outside, "rejected.txt"), content: "no" },
  };
  const rejectedCheck = await broker.authorize(rejectedCall);
  const rejected = await broker.resolveRequest({ requestId: rejectedCheck.request.requestId, decision: "reject" });
  assert.equal(rejected.status, "rejected");
  const rejectedUse = await broker.authorize({
    ...rejectedCall,
    permission: { requestId: rejectedCheck.request.requestId, token: "anything" },
  });
  assert.equal(rejectedUse.code, "REQUEST_NOT_APPROVED");

  const target = path.join(outside, "task.txt");
  const taskCall = {
    taskId: "task-grant",
    tool: "write_file",
    args: { path: target, content: "first" },
  };
  const taskCheck = await broker.authorize(taskCall);
  const taskApproval = await broker.resolveRequest({
    requestId: taskCheck.request.requestId,
    decision: "allow_task",
  });
  const firstUse = await broker.authorize({
    ...taskCall,
    permission: { requestId: taskCheck.request.requestId, token: taskApproval.token },
  });
  assert.equal(firstUse.allowed, true);

  const laterSamePath = await broker.authorize({
    ...taskCall,
    args: { path: target, content: "different arguments are task-approved" },
  });
  assert.equal(laterSamePath.allowed, true);
  assert.equal(laterSamePath.authorization, "task_grant");

  const differentPath = await broker.authorize({
    ...taskCall,
    args: { path: path.join(outside, "other.txt"), content: "not approved" },
  });
  assert.equal(differentPath.status, "permission_required");

  const noTask = await broker.authorize({
    tool: "write_file",
    args: { path: path.join(outside, "no-task.txt"), content: "x" },
  });
  await assert.rejects(
    () => broker.resolveRequest({ requestId: noTask.request.requestId, decision: "allow_task" }),
    (error) => error instanceof PermissionBrokerError && error.code === "TASK_ID_REQUIRED"
  );
});

test("junction writes fail closed while reads remain audited and resolve to the physical target", async (t) => {
  const { workspace, outside, broker } = await fixture(t);
  const junction = path.join(workspace, "linked-outside");
  try {
    await fs.symlink(outside, junction, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`junction unavailable: ${error.code || error.message}`);
    return;
  }
  const linkedTarget = path.join(junction, "result.txt");

  const write = await broker.authorize({
    taskId: "task-junction",
    tool: "write_file",
    args: { path: linkedTarget, content: "must not write" },
  });
  assert.equal(write.allowed, false);
  assert.equal(write.code, "REPARSE_PATH_WRITE_DENIED");

  const read = await broker.authorize({
    taskId: "task-junction",
    tool: "read_text_file",
    args: { path: linkedTarget },
  });
  assert.equal(read.allowed, true);
  assert.equal(read.authorization, "audited_external_read");
  assert.equal(read.paths[0].endsWith("\\outside\\result.txt"), true);
});
