import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  approvePermissionViaGateway,
  rejectPermissionViaGateway,
  saveToolResult,
  sanitizeToolName,
} from "./web-agent-image-save-gateway.mjs";
import { createPermissionRequest } from "./web-agent-permission-store.mjs";

test("sanitizeToolName produces a filesystem-safe name", () => {
  assert.equal(sanitizeToolName("list directory:*?"), "list-directory");
  assert.equal(sanitizeToolName("   "), "tool-result");
});

test("saveToolResult writes markdown under generated/tool-results", async () => {
  const result = await saveToolResult({
    toolName: "list_directory",
    fileName: `test-tool-result-${Date.now()}.md`,
    text: "[FILE] demo.txt\n[DIR] docs",
  });

  try {
    assert.match(result.filePath, /generated[\\/]tool-results[\\/]/);
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
