import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PathLockManager } from "@web-agents/local-core/paths";
import { PermissionBroker } from "./permission-broker.mjs";
import { ToolLoop } from "./tool-loop.mjs";
import { TransactionManager } from "./transaction-manager.mjs";

function protocolCall(name, callId, args = {}) {
  return [
    "```jsonl",
    JSON.stringify({ type: "function_call_start", name, call_id: callId }),
    ...Object.entries(args).map(([key, value]) => JSON.stringify({ type: "parameter", key, value })),
    JSON.stringify({ type: "function_call_end", call_id: callId }),
    "```",
  ].join("\n");
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-tool-loop-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)]);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const permissionBroker = new PermissionBroker({ workspaceRoot: workspace });
  const transactionManager = new TransactionManager({
    workspaceRoot: workspace,
    transactionRoot: path.join(workspace, ".web-agents", "transactions"),
    pathLockManager: new PathLockManager({ cwd: workspace, isolated: true }),
    executeTool: async (name, args) => {
      if (name !== "write_file") throw new Error(`Unexpected mutating tool: ${name}`);
      await fs.mkdir(path.dirname(args.path), { recursive: true });
      await fs.writeFile(args.path, args.content, "utf8");
      return { content: [{ type: "text", text: `wrote ${args.path}` }] };
    },
  });
  return { root, workspace, outside, permissionBroker, transactionManager };
}

test("tool loop captures, executes one read call, injects function_result, and is idempotent", async (t) => {
  const { workspace, permissionBroker } = await fixture(t);
  const target = path.join(workspace, "evidence.txt");
  const responses = [protocolCall("read_text_file", "read-1", { path: target }), "Final answer from evidence."];
  const inputs = [];
  let executions = 0;
  const loop = new ToolLoop({
    permissionBroker,
    captureText: async ({ input }) => {
      inputs.push(input);
      return responses.shift();
    },
    executeTool: async () => {
      executions += 1;
      return { content: [{ type: "text", text: "evidence body" }] };
    },
  });
  const request = {
    executionId: "loop-read",
    taskId: "task-read",
    executorId: "provider-b",
    prompt: "Read evidence and answer.",
  };
  const firstPromise = loop.run(request);
  const concurrentReplay = loop.run(request);
  assert.equal(concurrentReplay, firstPromise);
  const first = await firstPromise;
  assert.equal(first.status, "completed");
  assert.equal(first.finalText, "Final answer from evidence.");
  assert.equal(executions, 1);
  assert.match(inputs[1], /^<function_result call_id="read-1">/);
  assert.match(inputs[1], /evidence body/);

  const replay = await loop.run(request);
  assert.deepEqual(replay, first);
  assert.equal(inputs.length, 2);
  assert.equal(executions, 1);
});

test("mutating calls execute in one committed transaction", async (t) => {
  const { workspace, permissionBroker, transactionManager } = await fixture(t);
  const target = path.join(workspace, "generated.txt");
  const responses = [
    protocolCall("write_file", "write-1", { path: target, content: "generated in transaction" }),
    "Write completed.",
  ];
  const loop = new ToolLoop({
    permissionBroker,
    transactionManager,
    captureText: async () => responses.shift(),
    executeTool: async () => {
      throw new Error("Read executor should not handle writes.");
    },
  });
  const result = await loop.run({
    executionId: "loop-write",
    taskId: "task-write",
    executorId: "provider-b",
    prompt: "请写入结果",
    context: { request: { sessionId: "session-write" } },
  });
  assert.equal(result.status, "completed");
  assert.equal(await fs.readFile(target, "utf8"), "generated in transaction");
  assert.ok(result.transactionId);
  const transaction = transactionManager.getTransaction(result.transactionId);
  assert.equal(transaction.status, "committed");
  assert.equal(transaction.sessionId, "session-write");
  assert.equal(transaction.originalInstruction, "请写入结果");
  assert.equal(transaction.calls.length, 1);
});

test("external writes pause once for permission and resume with the bound token", async (t) => {
  const { outside, permissionBroker, transactionManager } = await fixture(t);
  const target = path.join(outside, "approved.txt");
  const responses = [
    protocolCall("write_file", "external-write", { path: target, content: "approved external write" }),
    "External write completed.",
  ];
  let captures = 0;
  const loop = new ToolLoop({
    permissionBroker,
    transactionManager,
    captureText: async () => {
      captures += 1;
      return responses.shift();
    },
    executeTool: async () => null,
  });
  const request = {
    executionId: "loop-permission",
    taskId: "task-permission",
    executorId: "provider-b",
    prompt: "Write outside the workspace.",
  };
  const paused = await loop.run(request);
  assert.equal(paused.status, "awaiting_permission");
  assert.equal(captures, 1);
  await assert.rejects(fs.access(target), /ENOENT/);

  const approval = await permissionBroker.resolveRequest({
    requestId: paused.permissionRequest.requestId,
    decision: "allow_once",
  });
  const resumed = await loop.run({
    executionId: request.executionId,
    permission: { requestId: paused.permissionRequest.requestId, token: approval.token },
  });
  assert.equal(resumed.status, "completed");
  assert.equal(await fs.readFile(target, "utf8"), "approved external write");
  assert.equal(captures, 2);
  assert.equal(permissionBroker.getRequest(paused.permissionRequest.requestId).tokenUsed, true);
});

test("repeated calls are not re-executed and the protocol turn limit is finite", async (t) => {
  const { workspace, permissionBroker } = await fixture(t);
  const repeated = protocolCall("get_file_info", "same-call", { path: path.join(workspace, "item.txt") });
  let executions = 0;
  let captures = 0;
  const loop = new ToolLoop({
    permissionBroker,
    maxToolCalls: 2,
    captureText: async () => {
      captures += 1;
      return repeated;
    },
    executeTool: async () => {
      executions += 1;
      return { content: [{ type: "text", text: "info" }] };
    },
  });
  const result = await loop.run({
    executionId: "loop-bounded",
    taskId: "task-bounded",
    executorId: "provider-b",
    prompt: "Keep calling.",
  });
  assert.equal(result.status, "tool_limit_exceeded");
  assert.equal(result.protocolTurns, 3);
  assert.equal(captures, 3);
  assert.equal(executions, 1);
  assert.equal(result.toolCalls.length, 1);
});

test("malformed multi-call output fails before any tool execution", async (t) => {
  const { workspace, permissionBroker } = await fixture(t);
  const output = [
    protocolCall("read_text_file", "one", { path: path.join(workspace, "one.txt") }),
    protocolCall("get_file_info", "two", { path: path.join(workspace, "two.txt") }),
  ].join("\n");
  let executions = 0;
  const loop = new ToolLoop({
    permissionBroker,
    captureText: async () => output,
    executeTool: async () => {
      executions += 1;
    },
  });
  await assert.rejects(
    () => loop.run({
      executionId: "loop-malformed",
      taskId: "task-malformed",
      executorId: "provider-b",
      prompt: "Do not run malformed output.",
    }),
    /Only one tool call/
  );
  assert.equal(executions, 0);
  assert.equal(loop.getState("loop-malformed").status, "failed");
});
