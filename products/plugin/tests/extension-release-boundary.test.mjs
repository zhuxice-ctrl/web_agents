import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(testDir, "../extension");
const repoRoot = path.resolve(testDir, "../../..");

test("normal plugin contains no roundtable runtime", async () => {
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

test("normal plugin is directly loadable from its canonical directory", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "web_Agent");
  assert.equal(manifest.version, "0.6.7");
  assert.equal(manifest.manifest_version, 3);
  await fs.access(path.join(pluginDir, manifest.background.service_worker));
  for (const entry of manifest.content_scripts) {
    for (const script of entry.js ?? []) await fs.access(path.join(pluginDir, script));
    for (const stylesheet of entry.css ?? []) await fs.access(path.join(pluginDir, stylesheet));
  }
});
