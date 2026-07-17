import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";

import { createFilesystemHttpServer } from "./filesystem-http-server.mjs";

async function startFilesystemServer(t, prefix) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const repoRoot = path.join(tempRoot, "repo");
  const configFile = path.join(tempRoot, "allowed-directories.txt");
  const permissionStoreDir = path.join(tempRoot, "permissions");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(configFile, `${repoRoot}\n`, "utf8");

  const server = createFilesystemHttpServer({
    repoRoot,
    configFile,
    permissionStoreDir,
    port: 0,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllSessions();
    server.close();
    await once(server, "close");
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repoRoot,
    tempRoot,
  };
}

async function callMcp(baseUrl, id, name, args, headers = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return { response, payload: await response.json() };
}

test("filesystem MCP exposes verifiable health and streamable HTTP tools", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-fs-http-"));
  const server = createFilesystemHttpServer({ repoRoot, port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllSessions();
    server.close();
    await once(server, "close");
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.equal(health.service, "web-agents-filesystem-mcp");
  assert.equal(health.pid, process.pid);
  assert.ok(health.tools > 5);

  const listed = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }).then((response) => response.json());
  assert.equal(listed.id, 1);
  assert.ok(listed.result.tools.some((tool) => tool.name === "read_text_file"));

  const source = path.join(repoRoot, "sample.txt");
  await fs.writeFile(source, "UTF-8 测试", "utf8");
  const read = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_text_file", arguments: { path: source } } }),
  }).then((response) => response.json());
  assert.match(read.result.content[0].text, /UTF-8 测试/);
});

test("filesystem MCP SSE announces a session-specific message endpoint", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-fs-sse-"));
  const server = createFilesystemHttpServer({ repoRoot });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllSessions();
    server.close();
    await once(server, "close");
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/sse`);
  const reader = response.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  assert.match(chunk, /event: endpoint/);
  assert.match(chunk, /\/message\?sessionId=/);
  await reader.cancel();
});

test("streamable HTTP blocks unapproved writes to an external absolute path", async (t) => {
  const { baseUrl, tempRoot } = await startFilesystemServer(t, "web-agents-fs-http-permission-");
  const targetFile = path.join(tempRoot, "outside", "owned.txt");

  const { response, payload } = await callMcp(baseUrl, 10, "write_file", {
    path: targetFile,
    content: "written without permission",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.result.isError, true);
  assert.match(payload.result.content[0].text, /WEB_AGENT_PERMISSION_REQUEST/);
  await assert.rejects(fs.access(targetFile), /ENOENT/);
});

test("HTTP MCP rejects a malicious localhost Origin before an allowed write", async (t) => {
  const { baseUrl, repoRoot } = await startFilesystemServer(t, "web-agents-fs-http-origin-");
  const targetFile = path.join(repoRoot, "origin-owned.txt");
  const maliciousOrigin = "http://127.0.0.1:4444";

  const sseResponse = await fetch(`${baseUrl}/sse`, { headers: { Origin: maliciousOrigin } });
  assert.equal(sseResponse.status, 403);
  assert.equal(sseResponse.headers.get("access-control-allow-origin"), null);
  assert.equal((await sseResponse.json()).error, "LOCAL_ORIGIN_REQUIRED");

  const { response, payload } = await callMcp(
    baseUrl,
    11,
    "write_file",
    { path: targetFile, content: "written by another localhost page" },
    { Origin: maliciousOrigin }
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(payload.error, "LOCAL_ORIGIN_REQUIRED");
  await assert.rejects(fs.access(targetFile), /ENOENT/);
});

test("HTTP MCP requires JSON before dispatching a mutating tool", async (t) => {
  const { baseUrl, repoRoot } = await startFilesystemServer(t, "web-agents-fs-http-content-type-");
  const targetFile = path.join(repoRoot, "simple-request-write.txt");
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "write_file",
        arguments: { path: targetFile, content: "simple request write" },
      },
    }),
  });

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error, "APPLICATION_JSON_REQUIRED");
  await assert.rejects(fs.access(targetFile), /ENOENT/);
});

test("HTTP MCP preserves allowed writes from the legacy browser extension without wildcard CORS", async (t) => {
  const { baseUrl, repoRoot } = await startFilesystemServer(t, "web-agents-fs-http-extension-");
  const targetFile = path.join(repoRoot, "extension-write.txt");
  const extensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const { response, payload } = await callMcp(
    baseUrl,
    12,
    "write_file",
    { path: targetFile, content: "allowed extension write" },
    { Origin: extensionOrigin }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), extensionOrigin);
  assert.equal(payload.result.isError, undefined);
  assert.equal(await fs.readFile(targetFile, "utf8"), "allowed extension write");
});
