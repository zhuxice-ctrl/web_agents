import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const protocolPath = "extensions/mcp-superassistant-local-fixed/content/roundtable-protocol.js";
const pageBridgePath = "extensions/mcp-superassistant-local-fixed/content/roundtable-page-bridge.js";

function loadContentScriptExports(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console, URL }, { filename: filePath });
  return module.exports;
}

function toPlain(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createHarness({
  origin = "http://127.0.0.1:3020",
  version = "0.6.8",
  sendMessage = async (request) => ({ ok: true, type: request.type, data: {} }),
} = {}) {
  const protocol = loadContentScriptExports(protocolPath);
  const listeners = new Map();
  const posted = [];
  const sendMessageCalls = [];
  const sandbox = {
    __webAgentRoundtableProtocol: protocol,
    chrome: {
      runtime: {
        getManifest: () => ({ version }),
        sendMessage(request) {
          sendMessageCalls.push(toPlain(request));
          return sendMessage(request);
        },
      },
    },
    console,
    location: { origin },
    postMessage(payload, targetOrigin) {
      posted.push({ payload: toPlain(payload), targetOrigin });
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const context = vm.createContext(sandbox);
  const code = fs.readFileSync(pageBridgePath, "utf8");
  vm.runInContext(code, context, { filename: pageBridgePath });
  const windowRef = vm.runInContext("globalThis", context);

  return {
    posted,
    sendMessageCalls,
    windowRef,
    dispatch(overrides = {}) {
      listeners.get("message")?.({
        source: windowRef,
        origin,
        data: {
          source: protocol.SOURCE,
          direction: "page-to-extension",
          requestId: "request-1",
          request: { type: "tabs:discover-providers" },
        },
        ...overrides,
      });
    },
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("announces the legacy extension version and bridge revision", () => {
  const { posted } = createHarness();

  assert.deepEqual(posted, [{
    payload: {
      source: "web-agents-roundtable-bridge",
      direction: "extension-to-page",
      type: "bridge:ready",
      extensionVersion: "0.6.8",
      bridgeRevision: "legacy-sidecar-v1",
    },
    targetOrigin: "http://127.0.0.1:3020",
  }]);
});

test("does not initialize on an untrusted page", () => {
  const harness = createHarness({ origin: "http://127.0.0.1:3021" });
  harness.dispatch();

  assert.equal(harness.posted.length, 0);
  assert.equal(harness.sendMessageCalls.length, 0);
});

test("ignores wrong-origin, wrong-source, and malformed envelopes", async () => {
  const harness = createHarness();
  const validData = {
    source: "web-agents-roundtable-bridge",
    direction: "page-to-extension",
    requestId: "request-1",
    request: { type: "tabs:discover-providers" },
  };

  harness.dispatch({ origin: "http://localhost:3020", data: validData });
  harness.dispatch({ source: {}, data: validData });
  harness.dispatch({ data: { ...validData, source: "other" } });
  harness.dispatch({ data: { ...validData, direction: "extension-to-page" } });
  harness.dispatch({ data: { ...validData, requestId: "" } });
  await flushPromises();

  assert.equal(harness.sendMessageCalls.length, 0);
  assert.equal(harness.posted.length, 1);
});

test("answers bridge ping locally", () => {
  const harness = createHarness();
  harness.dispatch({
    data: {
      source: "web-agents-roundtable-bridge",
      direction: "page-to-extension",
      requestId: "ping-1",
      request: { type: "bridge:ping" },
    },
  });

  assert.equal(harness.sendMessageCalls.length, 0);
  assert.deepEqual(harness.posted.at(-1), {
    payload: {
      source: "web-agents-roundtable-bridge",
      direction: "extension-to-page",
      type: "bridge:response",
      requestId: "ping-1",
      response: {
        ok: true,
        type: "bridge:ping",
        data: { extensionVersion: "0.6.8", bridgeRevision: "legacy-sidecar-v1" },
      },
    },
    targetOrigin: "http://127.0.0.1:3020",
  });
});

test("forwards only a normalized request and sanitizes the response", async () => {
  const harness = createHarness({
    sendMessage: async (request) => ({
      ok: true,
      type: request.type,
      data: {
        url: "https://chat.deepseek.com/a?token=secret#private",
        token: "secret",
        nested: { cookie: "session", message: "retry https://example.com/p?q=1#x" },
      },
    }),
  });
  harness.dispatch({
    data: {
      source: "web-agents-roundtable-bridge",
      direction: "page-to-extension",
      requestId: "send-1",
      request: {
        type: "tab:auto-send-text",
        tabId: 42,
        text: "roundtable prompt",
        authorization: "Bearer secret",
      },
    },
  });
  await flushPromises();

  assert.deepEqual(harness.sendMessageCalls, [{
    type: "tab:auto-send-text",
    tabId: 42,
    text: "roundtable prompt",
  }]);
  assert.deepEqual(harness.posted.at(-1).payload.response, {
    ok: true,
    type: "tab:auto-send-text",
    data: {
      url: "https://chat.deepseek.com/a",
      nested: { message: "retry https://example.com/p" },
    },
  });
});

test("rejects non-roundtable commands before the runtime boundary", () => {
  const harness = createHarness();
  harness.dispatch({
    data: {
      source: "web-agents-roundtable-bridge",
      direction: "page-to-extension",
      requestId: "mcp-1",
      request: { type: "mcp:call-tool", toolName: "write_file" },
    },
  });

  assert.equal(harness.sendMessageCalls.length, 0);
  assert.deepEqual(harness.posted.at(-1).payload.response, {
    ok: false,
    type: "mcp:call-tool",
    error: "ROUND_TABLE_REQUEST_NOT_ALLOWED",
  });
});

test("returns a sanitized response when runtime messaging rejects", async () => {
  const harness = createHarness({
    sendMessage: async () => {
      throw new Error("failed https://example.com/private?token=secret#trace");
    },
  });
  harness.dispatch();
  await flushPromises();

  assert.deepEqual(harness.posted.at(-1).payload.response, {
    ok: false,
    type: "tabs:discover-providers",
    error: "failed https://example.com/private",
  });
});
