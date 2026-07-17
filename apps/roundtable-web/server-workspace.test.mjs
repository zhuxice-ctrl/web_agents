import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";

import { createRoundtableServer } from "./server.mjs";

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  return { response, payload: await response.json() };
}

test("strict runtime requires a validated workspace and stores sessions under .web-agents", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-strict-workspace-"));
  const repoRoot = path.join(root, "repo");
  const workspace = path.join(root, "project");
  await Promise.all([fs.mkdir(repoRoot), fs.mkdir(workspace)]);
  const browserManager = {
    mode: "cdp",
    adapters: new Map(),
    status: () => ({ mode: "cdp", connected: false, bindings: [] }),
    async createProviderThread(providerId, options) {
      return { providerId, ...options, status: "waiting_login", url: "https://example.test/" };
    },
    async close() {},
  };
  const server = createRoundtableServer({ repoRoot, browserManager, requireWorkspaceSelection: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    await fs.rm(root, { recursive: true, force: true });
  });

  const blocked = await request(baseUrl, "/api/sessions", { method: "POST", body: JSON.stringify({ participants: ["deepseek"] }) });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.payload.code, "WORKSPACE_REQUIRED");

  const selected = await request(baseUrl, "/api/workspaces/select", { method: "POST", body: JSON.stringify({ path: workspace }) });
  assert.equal(selected.payload.workspace.root, path.resolve(workspace));
  await fs.access(path.join(workspace, ".web-agents", "workspace.json"));

  const created = await request(baseUrl, "/api/sessions", {
    method: "POST",
    body: JSON.stringify({ participants: ["deepseek"], openThreads: false, settings: { mode: "mock" } }),
  });
  assert.equal(created.payload.session.title, "未命名圆桌");
  assert.equal(created.payload.session.workspaceRoot, path.resolve(workspace));

  const command = await request(baseUrl, `/api/sessions/${created.payload.session.id}/commands`, {
    method: "POST",
    body: JSON.stringify({ text: "如何训练审美", targets: ["deepseek"], settings: { mode: "mock" } }),
  });
  assert.equal(command.response.status, 200);
  assert.match(command.payload.session.title, /如何训练审美/);

  const renamed = await request(baseUrl, `/api/sessions/${created.payload.session.id}/rename`, {
    method: "POST",
    body: JSON.stringify({ title: "审美训练研究" }),
  });
  assert.equal(renamed.payload.session.title, "审美训练研究");
  assert.equal(renamed.payload.session.renamedManually, true);
});
