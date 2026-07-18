import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const extensionRoot = path.join(repoRoot, "extensions", "mcp-superassistant-local-fixed");

async function sha256(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

test("local fixed MCP extension loads the Grok automation sidecar after its input integration", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
  const grokScripts = manifest.content_scripts.filter((entry) =>
    entry.js.includes("content/index.iife.js")
      && entry.matches.some((match) => /grok\.com|x\.com|twitter\.com/.test(match))
  );

  assert.ok(grokScripts.length >= 2);
  for (const entry of grokScripts) {
    assert.deepEqual(entry.js, ["content/index.iife.js", "content/local-automation-bridge.js"]);
  }
  const enhancer = manifest.content_scripts.find((entry) => entry.js.includes("content/web-agent-result-enhancer.js"));
  assert.deepEqual(enhancer.js, ["content/web-agent-result-enhancer.js", "content/web-agent-insert-fallback.js"]);
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:3006/*"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:3017/*"));
  assert.ok(manifest.host_permissions.includes("*://*.doubao.com/*"));
  assert.equal(manifest.default_locale, "zh_CN");
  assert.equal(manifest.name, "web_Agent");
  assert.equal(manifest.version, "0.6.8");
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

test("entry refresh does not replace the protected MCP bundle or background worker", async () => {
  assert.equal(
    await sha256(path.join(extensionRoot, "content", "index.iife.js")),
    "3b34ee35d671c5f380adad0fd593a839db10ac2dac2de5fadeb924e17ced894f"
  );
  assert.equal(
    await sha256(path.join(extensionRoot, "background.js")),
    "a723c96e83527b9c7788042c916ca6b592b93630d2280d8a1d258aae57ff6d6b"
  );
});
