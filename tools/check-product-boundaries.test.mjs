import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkProductBoundaries } from "./check-product-boundaries.mjs";

async function writeFixture(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

async function createValidFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-boundaries-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeFixture(root, "products/plugin/legacy-extension/manifest.json", "{}");
  await writeFixture(root, "products/plugin/extension/public/manifest.json", "{}");
  await writeFixture(root, "products/roundtable/package.json", JSON.stringify({
    scripts: { test: "node --test", "test:compat": "node --test compat/*.test.mjs" },
  }));
  await fs.mkdir(path.join(root, "packages/local-core/src"), { recursive: true });
  return root;
}

for (const fixture of [
  ["plugin-imports-roundtable", "products/plugin/index.mjs", 'import "@web-agents/roundtable";'],
  ["roundtable-imports-plugin", "products/roundtable/index.mjs", 'import "@web-agents/plugin";'],
  ["core-imports-product", "packages/local-core/src/index.mjs", 'import "../../../products/plugin/index.mjs";'],
  ["normal-manifest-has-roundtable", "products/plugin/legacy-extension/manifest.json", '{"name":"roundtable"}'],
]) {
  test(`rejects ${fixture[0]}`, async (t) => {
    const root = await createValidFixture(t);
    await writeFixture(root, fixture[1], fixture[2]);
    await assert.rejects(() => checkProductBoundaries({ repoRoot: root }), /PRODUCT_BOUNDARY_VIOLATION/);
  });
}

test("accepts products that share only local-core exports", async (t) => {
  const root = await createValidFixture(t);
  await writeFixture(root, "products/plugin/index.mjs", 'import "@web-agents/local-core/paths";');
  await writeFixture(root, "products/roundtable/index.mjs", 'import "@web-agents/local-core/paths";');
  assert.deepEqual(await checkProductBoundaries({ repoRoot: root }), { ok: true, violations: [] });
});
