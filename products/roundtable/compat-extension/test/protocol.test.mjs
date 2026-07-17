import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const protocolPath = "products/roundtable/compat-extension/content/roundtable-protocol.js";

function loadProtocol({ includeModule = true } = {}) {
  const code = fs.readFileSync(protocolPath, "utf8");
  const module = { exports: {} };
  const context = { console, URL };
  if (includeModule) {
    context.module = module;
    context.exports = module.exports;
  }
  vm.runInNewContext(code, context, { filename: protocolPath });
  return {
    exported: includeModule ? module.exports : null,
    globalExport: context.__webAgentRoundtableProtocol,
  };
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

const { exported: protocol, globalExport } = loadProtocol();

test("exposes the same protocol through CommonJS and the browser global", () => {
  assert.equal(protocol, globalExport);
  assert.equal(protocol.SOURCE, "web-agents-roundtable-bridge");
  assert.equal(protocol.BRIDGE_REVISION, "legacy-sidecar-v1");
  assert.equal(loadProtocol({ includeModule: false }).globalExport.BRIDGE_REVISION, "legacy-sidecar-v1");
});

test("accepts only the fixed local roundtable origins", () => {
  assert.equal(protocol.isTrustedRoundtableOrigin("http://127.0.0.1:3020"), true);
  assert.equal(protocol.isTrustedRoundtableOrigin("http://localhost:3020"), true);
  assert.equal(protocol.isTrustedRoundtableOrigin("http://127.0.0.1:3021"), false);
  assert.equal(protocol.isTrustedRoundtableOrigin("https://127.0.0.1:3020"), false);
  assert.equal(protocol.isTrustedRoundtableOrigin("http://localhost:3020.example.com"), false);
  assert.equal(protocol.isTrustedRoundtableOrigin("http://localhost:3020/path"), false);
});

test("normalizes every allowlisted roundtable command schema", () => {
  const cases = [
    [{ type: "tabs:open-provider", provider: "deepseek", ignored: true }, { type: "tabs:open-provider", provider: "deepseek" }],
    [{ type: "tabs:discover-providers" }, { type: "tabs:discover-providers" }],
    [
      { type: "tabs:discover-providers", providers: ["doubao", "chatgpt"], token: "secret" },
      { type: "tabs:discover-providers", providers: ["doubao", "chatgpt"] },
    ],
    [
      { type: "tabs:probe-provider", provider: "chatgpt", tabId: 42, extra: "drop" },
      { type: "tabs:probe-provider", provider: "chatgpt", tabId: 42 },
    ],
    [{ type: "tabs:focus-provider", tabId: 42 }, { type: "tabs:focus-provider", tabId: 42 }],
    [{ type: "tab:auth-probe", tabId: 42 }, { type: "tab:auth-probe", tabId: 42 }],
    [{ type: "tab:detect", tabId: 42 }, { type: "tab:detect", tabId: 42 }],
    [
      { type: "tab:insert-text", tabId: 42, text: "hello", cookie: "secret" },
      { type: "tab:insert-text", tabId: 42, text: "hello" },
    ],
    [
      { type: "tab:auto-send-text", tabId: 42, text: "hello" },
      { type: "tab:auto-send-text", tabId: 42, text: "hello" },
    ],
    [{ type: "tab:capture-latest", tabId: 42 }, { type: "tab:capture-latest", tabId: 42 }],
    [
      { type: "tab:capture-recent", tabId: 42, limit: 12 },
      { type: "tab:capture-recent", tabId: 42, limit: 12 },
    ],
  ];

  for (const [request, expected] of cases) {
    assert.deepEqual(toPlain(protocol.validateRoundtableRequest(request)), expected);
  }
});

test("rejects disallowed types and invalid command fields", () => {
  const invalidRequests = [
    null,
    [],
    { type: "bridge:ping" },
    { type: "mcp:call-tool", toolName: "write_file" },
    { type: "tabs:open-provider", provider: "other" },
    { type: "tabs:discover-providers", providers: ["deepseek", "deepseek"] },
    { type: "tabs:probe-provider", provider: "deepseek", tabId: -1 },
    { type: "tabs:focus-provider", tabId: "42" },
    { type: "tab:insert-text", tabId: 42, text: "   " },
    { type: "tab:auto-send-text", tabId: 42, text: "x".repeat(1_000_001) },
    { type: "tab:capture-recent", tabId: 42, limit: 0 },
    { type: "tab:capture-recent", tabId: 42, limit: 81 },
  ];

  for (const request of invalidRequests) {
    assert.throws(() => protocol.validateRoundtableRequest(request), /ROUND_TABLE_REQUEST_NOT_ALLOWED|INVALID_/);
  }
});

test("redacts credentials, query, hash, and secret fields recursively", () => {
  const result = protocol.sanitizeBridgeValue({
    url: "https://chat.deepseek.com/a?token=secret#private",
    token: "secret",
    nested: {
      cookie: "session",
      message: "open https://example.com/p?q=1#x",
      values: [{ authorization: "Bearer secret", safe: "ok" }],
    },
  });

  assert.deepEqual(toPlain(result), {
    url: "https://chat.deepseek.com/a",
    nested: {
      message: "open https://example.com/p",
      values: [{ safe: "ok" }],
    },
  });
});

test("sanitizes URL punctuation and rejects embedded URL credentials", () => {
  assert.equal(
    protocol.sanitizeBridgeValue("See https://example.com/path?q=1#private, then retry."),
    "See https://example.com/path, then retry.",
  );
  assert.equal(
    protocol.sanitizeBridgeValue("Bad https://user:pass@example.com/private?q=1"),
    "Bad [redacted-url]",
  );
  assert.throws(() => protocol.sanitizeUrl("https://user:pass@example.com/private"), /UNSAFE_URL/);
});
