import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ControllerToolWorker } from "./controller-tool-worker.mjs";
import { PermissionBroker } from "../mcp/permission-broker.mjs";
import { TransactionManager } from "../mcp/transaction-manager.mjs";
import { defaultToolRegistry } from "../mcp/tool-registry.mjs";
import { LocalWorkspaceStore } from "../storage/local-workspace-store.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-controller-tool-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LocalWorkspaceStore({ repoRoot: root, workspaceRoot: root, dataRoot: path.join(root, ".web-agents") });
  const now = new Date().toISOString();
  await store.createSession({ id: "session", title: "tool", createdAt: now, updatedAt: now, participants: [], events: [], plans: [], runtime: {}, artifacts: [] });
  const outputs = [];
  const browserWorker = { async execute(request) {
    outputs.push(request.prompt);
    if (outputs.length === 1) return { text: [
      "```jsonl",
      '{"type":"function_call_start","name":"read_text_file","call_id":"1"}',
      `{"type":"parameter","key":"path","value":${JSON.stringify(path.join(root, "note.txt"))}}`,
      '{"type":"function_call_end","call_id":"1"}',
      "```",
    ].join("\n") };
    return { text: "读取完成" };
  } };
  await fs.writeFile(path.join(root, "note.txt"), "hello", "utf8");
  const executeTool = async (name, args) => ({ content: [{ type: "text", text: await fs.readFile(args.path, "utf8") }] });
  const permissionBroker = new PermissionBroker({ workspaceRoot: root, registry: defaultToolRegistry, audit: store });
  const transactionManager = new TransactionManager({ workspaceRoot: root, registry: defaultToolRegistry, executeTool, audit: store });
  return { root, store, outputs, worker: new ControllerToolWorker({ browserWorker, permissionBroker, transactionManager, registry: defaultToolRegistry, store, executeTool }) };
}

test("controller worker captures a tool call, executes it, injects the result, and captures the final answer", async (t) => {
  const { outputs, worker } = await fixture(t);
  const result = await worker.execute({ sessionId: "session", planId: "plan", turnId: "turn", providerId: "deepseek", prompt: "读取文件" });
  assert.equal(result.text, "读取完成");
  assert.equal(outputs.length, 2);
  assert.match(outputs[1], /<function_result call_id="1">/);
  assert.match(outputs[1], /hello/);
  assert.equal(result.capture.toolCalls.length, 1);
});

async function permissionFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-controller-permission-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)]);
  const store = new LocalWorkspaceStore({
    repoRoot: root,
    workspaceRoot: workspace,
    dataRoot: path.join(workspace, ".web-agents"),
  });
  const now = new Date().toISOString();
  await store.createSession({
    id: "permission-session",
    title: "permission",
    createdAt: now,
    updatedAt: now,
    participants: [],
    events: [],
    plans: [],
    runtime: {},
    artifacts: [],
  });
  const target = path.join(outside, "result.txt");
  const browserWorker = {
    async execute() {
      return { text: [
        "```jsonl",
        '{"type":"function_call_start","name":"write_file","call_id":"write-1"}',
        `{"type":"parameter","key":"path","value":${JSON.stringify(target)}}`,
        '{"type":"parameter","key":"content","value":"approved"}',
        '{"type":"function_call_end","call_id":"write-1"}',
        "```",
      ].join("\n") };
    },
  };
  const executeTool = async () => ({ content: [{ type: "text", text: "not used" }] });
  const permissionBroker = new PermissionBroker({ workspaceRoot: workspace, registry: defaultToolRegistry, audit: store });
  const transactionManager = new TransactionManager({
    workspaceRoot: workspace,
    registry: defaultToolRegistry,
    executeTool,
    audit: store,
  });
  const recoveryActions = [];
  const runRegistry = {
    get() { return { status: "waiting_recovery", failedTurnId: "permission-turn" }; },
    retry(runId, turnId, options) { recoveryActions.push({ action: "retry", runId, turnId, options }); },
    skip(runId, turnId) { recoveryActions.push({ action: "skip", runId, turnId }); },
  };
  const worker = new ControllerToolWorker({
    browserWorker,
    permissionBroker,
    transactionManager,
    registry: defaultToolRegistry,
    store,
    executeTool,
    runRegistry,
  });
  const request = {
    sessionId: "permission-session",
    planId: "permission-plan",
    turnId: "permission-turn",
    runId: "permission-run",
    executionId: "permission-execution",
    providerId: "deepseek",
    prompt: "写入外部文件",
  };
  return { worker, request, recoveryActions };
}

test("permission approval resumes the same controller execution id", async (t) => {
  const { worker, request, recoveryActions } = await permissionFixture(t);
  await assert.rejects(() => worker.execute(request), (error) => error.code === "PERMISSION_REQUIRED");
  const [pending] = worker.listPermissionRequests();
  assert.ok(pending);

  const resolved = await worker.resolvePermission(pending.requestId, "allow_once");

  assert.equal(resolved.executionId, request.executionId);
  assert.deepEqual(recoveryActions, [{
    action: "retry",
    runId: request.runId,
    turnId: request.turnId,
    options: { reuseExecutionId: true },
  }]);
});

test("permission rejection skips the waiting turn instead of leaving the run blocked", async (t) => {
  const { worker, request, recoveryActions } = await permissionFixture(t);
  await assert.rejects(() => worker.execute(request), (error) => error.code === "PERMISSION_REQUIRED");
  const [pending] = worker.listPermissionRequests();

  const resolved = await worker.resolvePermission(pending.requestId, "reject");

  assert.equal(resolved.status, "rejected");
  assert.deepEqual(recoveryActions, [{ action: "skip", runId: request.runId, turnId: request.turnId }]);
  assert.deepEqual(worker.listPermissionRequests(), []);
});

test("low-confidence captured output cannot start a mutating transaction", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-controller-quality-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LocalWorkspaceStore({
    repoRoot: root,
    workspaceRoot: root,
    dataRoot: path.join(root, ".web-agents"),
  });
  const now = new Date().toISOString();
  await store.createSession({
    id: "quality-session",
    title: "quality",
    createdAt: now,
    updatedAt: now,
    participants: [],
    events: [],
    plans: [],
    runtime: {},
    artifacts: [],
  });
  const target = path.join(root, "blocked.txt");
  const browserWorker = {
    async execute() {
      return { text: [
        "[ROUND_TABLE_TASK_BEGIN]",
        "```jsonl",
        '{"type":"function_call_start","name":"write_file","call_id":"write-low"}',
        `{"type":"parameter","key":"path","value":${JSON.stringify(target)}}`,
        '{"type":"parameter","key":"content","value":"must not write"}',
        '{"type":"function_call_end","call_id":"write-low"}',
        "```",
      ].join("\n") };
    },
  };
  let executions = 0;
  const executeTool = async () => {
    executions += 1;
    return { content: [{ type: "text", text: "unexpected" }] };
  };
  const permissionBroker = new PermissionBroker({ workspaceRoot: root, registry: defaultToolRegistry, audit: store });
  const transactionManager = new TransactionManager({
    workspaceRoot: root,
    registry: defaultToolRegistry,
    executeTool,
    audit: store,
  });
  const worker = new ControllerToolWorker({
    browserWorker,
    permissionBroker,
    transactionManager,
    registry: defaultToolRegistry,
    store,
    executeTool,
  });

  await assert.rejects(
    () => worker.execute({
      sessionId: "quality-session",
      planId: "quality-plan",
      turnId: "quality-turn",
      providerId: "deepseek",
      writeExecutorId: "deepseek",
      prompt: "收束并写入",
    }),
    (error) => error.code === "LOW_CONFIDENCE_SIDE_EFFECT_BLOCKED"
      && error.diagnostics?.qualityFlags?.includes("prompt_echo"),
  );
  assert.equal(executions, 0);
  assert.deepEqual(transactionManager.listTransactions(), []);
  await assert.rejects(fs.access(target), /ENOENT/);
});
