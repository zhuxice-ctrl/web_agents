import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(testDir, "../legacy-extension");
const repoRoot = path.resolve(testDir, "../../..");

test("legacy normal plugin contains no roundtable runtime", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
  const background = await fs.readFile(path.join(pluginDir, "background.js"), "utf8");
  const serialized = JSON.stringify(manifest);

  assert.doesNotMatch(background, /roundtable-background/);
  assert.doesNotMatch(serialized, /roundtable-|127\.0\.0\.1\/\*|localhost\/\*/i);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
});

test("root scripts keep normal plugin and compatibility tests separate", async () => {
  const rootPackage = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.doesNotMatch(rootPackage.scripts["test:plugin"], /roundtable|compat-extension/i);
  assert.match(rootPackage.scripts["test:roundtable-compat-extension"], /products\/roundtable\/compat-extension/);
  assert.doesNotMatch(rootPackage.scripts["test:roundtable-compat-extension"], /insert-fallback|result-enhancer|background-permission/);
});
