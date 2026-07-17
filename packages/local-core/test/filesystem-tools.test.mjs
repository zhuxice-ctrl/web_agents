import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFilesystemTools } from "../src/filesystem-tools.mjs";

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
