import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPermissionRequiredResult,
  callTool,
  getAllowedDirectories,
  getWritablePermissionCheck,
} from "./web-agent-filesystem-server.mjs";
import { approvePermissionRequest } from "./web-agent-permission-store.mjs";

const serverPath = fileURLToPath(new URL("./web-agent-filesystem-server.mjs", import.meta.url));

test("reloads writable whitelist without restarting the process", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-fs-"));
  const repoRoot = path.join(tempRoot, "repo");
  const extraRoot = path.join(tempRoot, "extra");
  const configFile = path.join(tempRoot, "allowed.txt");

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(extraRoot, { recursive: true });
  await fs.writeFile(configFile, `${repoRoot}\n`, "utf8");

  const first = await getAllowedDirectories({ repoRoot, configFile });
  assert.deepEqual(first, [path.resolve(repoRoot)]);

  await fs.appendFile(configFile, `${extraRoot}\n`, "utf8");

  const second = await getAllowedDirectories({ repoRoot, configFile });
  assert.deepEqual(second, [path.resolve(repoRoot), path.resolve(extraRoot)]);
});

test("write outside whitelist returns a reusable Chinese approval command", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-fs-"));
  const repoRoot = path.join(tempRoot, "repo");
  const outsideRoot = path.join(tempRoot, "outside");
  const targetFile = path.join(outsideRoot, "note.md");
  const configFile = path.join(tempRoot, "allowed.txt");

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(configFile, `${repoRoot}\n`, "utf8");

  const allowedDirectories = await getAllowedDirectories({ repoRoot, configFile });
  const permission = await getWritablePermissionCheck(targetFile, allowedDirectories);

  assert.equal(permission.allowed, false);
  assert.deepEqual(permission.directoriesToApprove, [path.resolve(outsideRoot)]);

  const result = buildPermissionRequiredResult({
    operation: "write_file",
    targetPaths: [targetFile],
    directoriesToApprove: permission.directoriesToApprove,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /需要手动授权/);
  assert.match(result.content[0].text, /add-allowed-directory\.local\.ps1/);
  assert.match(result.content[0].text, /不需要重启/);
  assert.match(result.content[0].text, /重新运行|Run again/);
});

test("write outside whitelist returns a structured permission marker for one-click approval", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-fs-"));
  const repoRoot = path.join(tempRoot, "repo");
  const outsideRoot = path.join(tempRoot, "outside");
  const targetFile = path.join(outsideRoot, "note.md");
  const configFile = path.join(tempRoot, "allowed.txt");

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(configFile, `${repoRoot}\n`, "utf8");

  const denied = await callTool(
    "write_file",
    { path: targetFile, content: "pending approval" },
    { repoRoot, configFile }
  );

  assert.equal(denied.isError, true);
  const text = denied.content[0].text;
  const match = text.match(/WEB_AGENT_PERMISSION_REQUEST\s+({[\s\S]+?})\s+END_WEB_AGENT_PERMISSION_REQUEST/);
  assert.ok(match, text);

  const marker = JSON.parse(match[1]);
  assert.equal(marker.version, 1);
  assert.equal(marker.kind, "web_agent_permission_request");
  assert.equal(marker.operation, "write_file");
  assert.equal(marker.toolName, "write_file");
  assert.equal(typeof marker.requestId, "string");
  assert.match(marker.requestId, /^wapr_/);
  assert.deepEqual(marker.targetPaths, [path.resolve(targetFile)]);
  assert.deepEqual(marker.directoriesToApprove, [path.resolve(outsideRoot)]);
  assert.equal(marker.suggestedApprovalRoot, path.resolve(outsideRoot));
  assert.match(marker.argsHash, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(marker.expiresAt) > Date.now());
});

test("write_file consumes one-time permission token and rejects reuse", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-fs-"));
  const repoRoot = path.join(tempRoot, "repo");
  const outsideRoot = path.join(tempRoot, "outside");
  const targetFile = path.join(outsideRoot, "note.md");
  const configFile = path.join(tempRoot, "allowed.txt");
  const permissionStoreDir = path.join(tempRoot, "permissions");
  const args = { path: targetFile, content: "approved by token" };
  const context = { repoRoot, configFile, permissionStoreDir };

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(configFile, `${repoRoot}\n`, "utf8");

  const denied = await callTool("write_file", args, context);
  assert.equal(denied.isError, true);
  const marker = JSON.parse(
    denied.content[0].text.match(/WEB_AGENT_PERMISSION_REQUEST\s+({[\s\S]+?})\s+END_WEB_AGENT_PERMISSION_REQUEST/)[1]
  );

  const approved = await approvePermissionRequest({
    storeDir: permissionStoreDir,
    requestId: marker.requestId,
    argsHash: marker.argsHash,
  });

  const changedArgs = await callTool(
    "write_file",
    { path: targetFile, content: "changed after approval", _webAgentPermission: { requestId: marker.requestId, token: approved.token } },
    context
  );
  assert.equal(changedArgs.isError, true);
  assert.match(changedArgs.content[0].text, /WEB_AGENT_PERMISSION_REQUEST/);
  await assert.rejects(() => fs.readFile(targetFile, "utf8"), /ENOENT/);

  const allowed = await callTool(
    "write_file",
    { ...args, _webAgentPermission: { requestId: marker.requestId, token: approved.token } },
    context
  );
  assert.equal(allowed.isError, undefined);
  assert.match(allowed.content[0].text, /Successfully wrote/);
  assert.equal(await fs.readFile(targetFile, "utf8"), "approved by token");

  const reused = await callTool(
    "write_file",
    { ...args, _webAgentPermission: { requestId: marker.requestId, token: approved.token } },
    context
  );
  assert.equal(reused.isError, true);
  assert.match(reused.content[0].text, /WEB_AGENT_PERMISSION_REQUEST/);
  assert.equal(await fs.readFile(targetFile, "utf8"), "approved by token");
});

test("stdio server flushes async tool calls before stdin closes", async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.resolve(serverPath, "..", ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdin.write(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {} },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_allowed_directories", arguments: {} },
      }),
    ].join("\n") + "\n"
  );
  child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("stdio server timed out"));
    }, 5000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(exitCode, 0, stderr);
  assert.match(stdout, /"id":1/);
  assert.match(stdout, /"id":2/);
  assert.match(stdout, /Writable allowed directories/);
});

test("write_file succeeds after whitelist file is updated without restarting server code", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-fs-"));
  const repoRoot = path.join(tempRoot, "repo");
  const outsideRoot = path.join(tempRoot, "outside");
  const targetFile = path.join(outsideRoot, "approved.md");
  const configFile = path.join(tempRoot, "allowed.txt");

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(configFile, `${repoRoot}\n`, "utf8");

  const denied = await callTool(
    "write_file",
    { path: targetFile, content: "first" },
    { repoRoot, configFile }
  );
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /需要手动授权/);

  await fs.appendFile(configFile, `${outsideRoot}\n`, "utf8");

  const allowed = await callTool(
    "write_file",
    { path: targetFile, content: "second" },
    { repoRoot, configFile }
  );
  assert.equal(allowed.isError, undefined);
  assert.match(allowed.content[0].text, /Successfully wrote/);
  assert.equal(await fs.readFile(targetFile, "utf8"), "second");
});
