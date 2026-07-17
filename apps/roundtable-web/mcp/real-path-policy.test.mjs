import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertMutationPathIdentity, resolvePathIdentity } from "./real-path-policy.mjs";

test("missing targets resolve through the nearest existing ancestor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-real-path-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const identity = await resolvePathIdentity(path.join(workspace, "new", "result.txt"), {
    workspaceRoot: workspace,
  });
  assert.equal(identity.isInsideWorkspace, true);
  assert.equal(identity.throughAlias, false);
  assert.match(identity.physicalPath, /new[\\/]result\.txt$/i);
});

test("junction aliases resolve to the physical external target and fail closed for mutation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-real-junction-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  const junction = path.join(workspace, "linked-outside");
  await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)]);
  try {
    await fs.symlink(outside, junction, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`junction unavailable: ${error.code || error.message}`);
    return;
  }
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const identity = await resolvePathIdentity(path.join(junction, "result.txt"), {
    workspaceRoot: workspace,
  });
  assert.equal(identity.lexicalInsideWorkspace, true);
  assert.equal(identity.isInsideWorkspace, false);
  assert.equal(identity.throughAlias, true);
  assert.throws(
    () => assertMutationPathIdentity(identity),
    (error) => error.code === "REPARSE_PATH_WRITE_DENIED" && error.details.resolvedPath === identity.physicalPath,
  );
});
