import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const extensionRoot = path.join(repoRoot, "extensions", "mcp-superassistant-local-fixed");

test("local fixed MCP extension loads the Grok automation sidecar after its input integration", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
  const grokScripts = manifest.content_scripts.filter((entry) =>
    entry.matches.some((match) => /grok\.com|x\.com|twitter\.com/.test(match))
  );

  assert.ok(grokScripts.length >= 2);
  for (const entry of grokScripts) {
    assert.deepEqual(entry.js, ["content/index.iife.js", "content/local-automation-bridge.js"]);
  }
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:3006/*"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:3017/*"));
  assert.notEqual(manifest.version, "0.6.0");
});

test("Grok automation sidecar uses the typed gateway without adding a replacement overlay", async () => {
  const source = await fs.readFile(path.join(extensionRoot, "content", "local-automation-bridge.js"), "utf8");

  assert.match(source, /\/automation\/next/);
  assert.match(source, /\/save-gpt-image/);
  assert.match(source, /\/automation\/tasks\/.*\/result/);
  assert.match(source, /provider/);
  assert.match(source, /sessionId/);
  assert.doesNotMatch(source, /createElement\(["'](?:aside|iframe)["']\)/);
});
