import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const extensionRoot = "products/roundtable/compat-extension";
const manifest = JSON.parse(fs.readFileSync(`${extensionRoot}/manifest.json`, "utf8"));

function scriptWith(fileName) {
  return manifest.content_scripts.find((entry) => entry.js?.includes(fileName));
}

test("packages an independent roundtable compatibility extension", () => {
  assert.equal(manifest.version, "0.1.0");
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "scripting"]);
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:3020/*"));
  assert.ok(manifest.host_permissions.includes("http://localhost:3020/*"));
  assert.equal(manifest.host_permissions.includes("http://127.0.0.1/*"), false);
  assert.equal(manifest.host_permissions.includes("http://localhost/*"), false);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
});

test("loads the page bridge only on the fixed roundtable port", () => {
  const localBridge = scriptWith("content/roundtable-page-bridge.js");
  assert.deepEqual(localBridge.js, [
    "content/roundtable-protocol.js",
    "content/roundtable-page-bridge.js",
  ]);
  assert.deepEqual(localBridge.matches, [
    "http://127.0.0.1:3020/*",
    "http://localhost:3020/*",
  ]);
  assert.equal(localBridge.run_at, "document_idle");
});

test("loads provider bridge scripts from the compatibility package", () => {
  const providerBridge = scriptWith("content/roundtable-content-bridge.js");
  assert.deepEqual(providerBridge.js, [
    "content/roundtable-protocol.js",
    "content/roundtable-content-bridge.js",
  ]);
  assert.deepEqual(providerBridge.matches, [
    "*://*.chat.openai.com/*",
    "*://*.chatgpt.com/*",
    "*://*.chat.deepseek.com/*",
    "*://*.doubao.com/*",
  ]);
  assert.equal(providerBridge.run_at, "document_idle");
});

test("manifest never references either normal plugin implementation", () => {
  const serialized = JSON.stringify(manifest).replaceAll("/", "\\");
  assert.doesNotMatch(serialized, /mcp-superassistant-local-fixed/i);
  assert.doesNotMatch(serialized, /web-agents-extension/i);
});
