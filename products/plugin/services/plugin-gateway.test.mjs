import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  approvePermissionViaGateway,
  createPluginGatewayServer,
  rejectPermissionViaGateway,
  saveToolResult,
  sanitizeToolName,
} from "./plugin-gateway.mjs";
import { createAutomationTaskQueue } from "./automation-task-queue.mjs";
import { createPermissionRequest } from "./permission-store-adapter.mjs";

test("sanitizeToolName produces a filesystem-safe name", () => {
  assert.equal(sanitizeToolName("list directory:*?"), "list-directory");
  assert.equal(sanitizeToolName("   "), "tool-result");
});

test("saveToolResult writes markdown under plugin-owned data", async () => {
  const result = await saveToolResult({
    toolName: "list_directory",
    fileName: `test-tool-result-${Date.now()}.md`,
    text: "[FILE] demo.txt\n[DIR] docs",
  });

  try {
    assert.match(result.filePath, /products[\\/]plugin[\\/]data[\\/]tool-results[\\/]/);
    const saved = await fs.readFile(result.filePath, "utf8");
    assert.match(saved, /# web_Agent 工具结果/);
    assert.match(saved, /Tool: list_directory/);
    assert.match(saved, /\[FILE\] demo\.txt/);
    assert.equal(path.extname(result.filePath), ".md");
  } finally {
    await fs.rm(result.filePath, { force: true });
  }
});

test("gateway permission approval returns a one-time token and rejects duplicate approvals", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-gateway-"));
  const storeDir = path.join(tempRoot, "permissions");
  const targetPath = path.join(tempRoot, "outside", "note.md");

  const request = await createPermissionRequest({
    storeDir,
    operation: "write_file",
    targetPaths: [targetPath],
    directoriesToApprove: [path.dirname(targetPath)],
    args: { path: targetPath, content: "pending" },
    ttlMs: 60_000,
  });

  const approved = await approvePermissionViaGateway({
    storeDir,
    requestId: request.requestId,
    argsHash: request.argsHash,
    mode: "once",
  });

  assert.equal(approved.ok, true);
  assert.match(approved.token, /^wapt_/);

  await assert.rejects(
    () => approvePermissionViaGateway({ storeDir, requestId: request.requestId, argsHash: request.argsHash, mode: "once" }),
    /REQUEST_NOT_PENDING/
  );
});

test("gateway permission rejection updates pending request status", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-gateway-"));
  const storeDir = path.join(tempRoot, "permissions");
  const targetPath = path.join(tempRoot, "outside", "note.md");

  const request = await createPermissionRequest({
    storeDir,
    operation: "write_file",
    targetPaths: [targetPath],
    directoriesToApprove: [path.dirname(targetPath)],
    args: { path: targetPath, content: "pending" },
    ttlMs: 60_000,
  });

  const rejected = await rejectPermissionViaGateway({ storeDir, requestId: request.requestId });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.status, "rejected");
});

function automationTask(clientRequestId) {
  return {
    version: 1,
    type: "provider.generate_image",
    clientRequestId,
    sessionId: `session-${clientRequestId}`,
    provider: "grok",
    workspaceRoot: "F:/project",
    payload: {
      prompt: "Generate an image",
      targetDirectory: "F:/project/assets",
      fileName: "image.png",
    },
  };
}

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("plugin gateway exposes the minimal typed automation task flow", async (t) => {
  const taskQueue = createAutomationTaskQueue({ capacity: 4 });
  const server = createPluginGatewayServer({ taskQueue });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    taskQueue.close();
    server.close();
    await once(server, "close");
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const submitted = await postJson(baseUrl, "/automation/tasks", automationTask("gateway-1"));
  assert.equal(submitted.response.status, 202);
  assert.match(submitted.payload.taskId, /\S+/);

  const nextResponse = await fetch(`${baseUrl}/automation/next?waitMs=10`);
  const next = await nextResponse.json();
  assert.equal(next.task.taskId, submitted.payload.taskId);

  const completed = await postJson(baseUrl, `/automation/tasks/${submitted.payload.taskId}/result`, {
    ok: true,
    filePath: "F:/project/assets/image.png",
  });
  assert.equal(completed.response.status, 200);

  const status = await fetch(`${baseUrl}/automation/tasks/${submitted.payload.taskId}`).then((response) => response.json());
  assert.equal(status.task.state, "done");
  assert.equal(status.task.result.filePath, "F:/project/assets/image.png");
});

test("plugin gateway validates automation tasks and reports queue saturation", async (t) => {
  const taskQueue = createAutomationTaskQueue({ capacity: 1 });
  const server = createPluginGatewayServer({ taskQueue });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    taskQueue.close();
    server.close();
    await once(server, "close");
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const invalid = await postJson(baseUrl, "/automation/tasks", { version: 1 });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error, "INVALID_AUTOMATION_TASK");

  assert.equal((await postJson(baseUrl, "/automation/tasks", automationTask("capacity-1"))).response.status, 202);
  const saturated = await postJson(baseUrl, "/automation/tasks", automationTask("capacity-2"));
  assert.equal(saturated.response.status, 429);
  assert.equal(saturated.payload.error, "AUTOMATION_QUEUE_FULL");
});
