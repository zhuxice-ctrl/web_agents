import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFilesystemTools,
  getWritablePermissionCheck,
} from "../src/filesystem-tools.mjs";

test("filesystem tools require product-owned paths", () => {
  assert.throws(() => createFilesystemTools({}), /FILESYSTEM_TOOL_PATHS_REQUIRED/);
});

test("filesystem tools use only paths supplied by the product adapter", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-filesystem-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = createFilesystemTools({
    repoRoot: root,
    configFile: path.join(root, "config", "allowed.txt"),
    permissionStoreDir: path.join(root, "permissions"),
    auditFile: path.join(root, "audit", "writes.jsonl"),
  });
  const target = path.join(root, "result.txt");

  const result = await runtime.call("write_file", { path: target, content: "ready" });

  assert.equal(result.isError, undefined);
  assert.equal(await fs.readFile(target, "utf8"), "ready");
  assert.match(await fs.readFile(path.join(root, "audit", "writes.jsonl"), "utf8"), /write_file/);
  assert.equal(runtime.definitions.some((tool) => tool.name === "write_file"), true);
});

test("permission suggestions keep the exact target directory even when it does not exist", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-permission-root-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const targetDirectory = path.join(root, "new-workspace");
  const allowedDirectory = path.join(root, "allowed");
  await fs.mkdir(allowedDirectory);

  const decision = await getWritablePermissionCheck(
    path.join(targetDirectory, "note.txt"),
    [allowedDirectory]
  );

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.directoriesToApprove, [path.resolve(targetDirectory)]);
});

test("delete_file removes only files in allowed directories and records an audit entry", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-delete-file-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const auditFile = path.join(root, "audit", "writes.jsonl");
  const runtime = createFilesystemTools({
    repoRoot: root,
    configFile: path.join(root, "config", "allowed.txt"),
    permissionStoreDir: path.join(root, "permissions"),
    auditFile,
  });
  const target = path.join(root, "remove-me.txt");
  const directory = path.join(root, "keep-directory");
  await fs.writeFile(target, "remove", "utf8");
  await fs.mkdir(directory);

  const result = await runtime.call("delete_file", { path: target });

  assert.equal(result.isError, undefined);
  await assert.rejects(fs.access(target));
  assert.match(await fs.readFile(auditFile, "utf8"), /delete_file/);
  await assert.rejects(runtime.call("delete_file", { path: directory }), /directories cannot be deleted/);
});
