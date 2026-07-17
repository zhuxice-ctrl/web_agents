import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceRegistry, validateWorkspacePath } from "./workspace-registry.mjs";

test("workspace validation requires an existing directory and creates the internal layout", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-workspace-"));
  const root = path.join(parent, "project");
  await fs.mkdir(root);
  t.after(() => fs.rm(parent, { recursive: true, force: true }));

  await assert.rejects(validateWorkspacePath(path.join(parent, "missing")), /WORKSPACE_NOT_FOUND/);
  const file = path.join(parent, "file.txt");
  await fs.writeFile(file, "x", "utf8");
  await assert.rejects(validateWorkspacePath(file), /WORKSPACE_NOT_DIRECTORY/);

  const workspace = await validateWorkspacePath(root);
  assert.equal(workspace.root, path.resolve(root));
  for (const name of ["sessions", "handoffs", "artifacts", "audit", "backups", "indexes"]) {
    assert.equal((await fs.stat(path.join(root, ".web-agents", name))).isDirectory(), true);
  }
  const metadata = JSON.parse(await fs.readFile(path.join(root, ".web-agents", "workspace.json"), "utf8"));
  assert.equal(metadata.id, workspace.id);
});

test("workspace registry persists recent roots and keeps stores isolated", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-registry-"));
  const repoRoot = path.join(parent, "repo");
  const first = path.join(parent, "first");
  const second = path.join(parent, "second");
  await Promise.all([repoRoot, first, second].map((directory) => fs.mkdir(directory, { recursive: true })));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));

  const configFile = path.join(repoRoot, "config", "workspace.local.json");
  const registry = new WorkspaceRegistry({ repoRoot, configFile });
  assert.equal(registry.requireActive.bind(registry) instanceof Function, true);
  await assert.rejects(async () => registry.requireActive(), /WORKSPACE_REQUIRED/);

  const firstEntry = await registry.select(first);
  const secondEntry = await registry.select(second);
  assert.notEqual(firstEntry.store.dataRoot, secondEntry.store.dataRoot);
  assert.equal(registry.active.descriptor.root, path.resolve(second));

  const restored = new WorkspaceRegistry({ repoRoot, configFile });
  await restored.initialize();
  assert.equal(restored.list().length, 2);
  assert.equal(restored.active.descriptor.root, path.resolve(second));
});

test("controller validation is part of workspace selection", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-controller-probe-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    validateWorkspacePath(root, { controllerProbe: async () => ({ ok: false, service: "filesystem" }) }),
    /LOCAL_CONTROLLER_UNAVAILABLE/
  );
});
