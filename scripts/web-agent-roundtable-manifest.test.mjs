import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const extensionRoot = "extensions/mcp-superassistant-local-fixed";
const manifest = JSON.parse(fs.readFileSync(`${extensionRoot}/manifest.json`, "utf8"));
const readme = fs.readFileSync(`${extensionRoot}/README.md`, "utf8");

function scriptWith(fileName) {
  return manifest.content_scripts.find((entry) => entry.js?.includes(fileName));
}

test("packages the legacy roundtable bridge as version 0.6.8", () => {
  assert.equal(manifest.version, "0.6.8");
  assert.deepEqual(manifest.permissions, ["storage", "clipboardWrite", "tabs", "scripting"]);
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(manifest.host_permissions.includes("http://localhost/*"));
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
});

test("loads the page bridge with valid localhost match patterns and enforces the port at runtime", () => {
  const localBridge = scriptWith("content/roundtable-page-bridge.js");
  assert.ok(localBridge);
  assert.deepEqual(localBridge.js, [
    "content/roundtable-protocol.js",
    "content/roundtable-page-bridge.js",
  ]);
  assert.deepEqual(localBridge.matches, [
    "http://127.0.0.1/*",
    "http://localhost/*",
  ]);
  assert.equal(localBridge.run_at, "document_idle");
  assert.match(readme, /脚本只信任 127\.0\.0\.1:3020 和 localhost:3020/);
});

test("loads the provider bridge after every generated legacy content entry", () => {
  const providerBridge = scriptWith("content/roundtable-content-bridge.js");
  assert.ok(providerBridge);
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

  const providerBridgeIndex = manifest.content_scripts.indexOf(providerBridge);
  const generatedIndexes = manifest.content_scripts
    .map((entry, index) => entry.js?.includes("content/index.iife.js") ? index : -1)
    .filter((index) => index >= 0);
  assert.ok(providerBridgeIndex > Math.max(...generatedIndexes));
});

test("manifest never references the rewrite extension", () => {
  const serialized = JSON.stringify(manifest).replaceAll("/", "\\");
  assert.doesNotMatch(serialized, /extensions\\web-agents-extension/i);
  assert.doesNotMatch(serialized, /web-agents-extension\\dist/i);
});

test("README names the single extension runtime and preserves manual mode", () => {
  assert.match(readme, /唯一扩展加载路径：F:\\web_agents\\extensions\\mcp-superassistant-local-fixed/);
  assert.match(readme, /圆桌地址：http:\/\/127\.0\.0\.1:3020/);
  assert.match(readme, /不要同时启用 extensions\\web-agents-extension\\dist/);
  assert.match(readme, /旧侧栏和手动 MCP 模式保持可独立使用/);
});
