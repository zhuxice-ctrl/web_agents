import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const contentBridgePath = fileURLToPath(new URL("../content/roundtable-content-bridge.js", import.meta.url));
const composerSelector = "#prompt-textarea, textarea:not([readonly]):not([disabled]), [role='textbox'][contenteditable='true']";

function toPlain(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function loadBridge(globals = {}) {
  const code = fs.readFileSync(contentBridgePath, "utf8");
  const module = { exports: {} };
  const context = vm.createContext({
    console,
    module,
    exports: module.exports,
    ...globals,
  });
  vm.runInContext(code, context, { filename: contentBridgePath });
  return {
    bridge: module.exports,
    globalExport: vm.runInContext("globalThis.__webAgentRoundtableContentBridge", context),
  };
}

function createNode({
  text = "",
  order = 0,
  role,
  testId,
  className = "",
  parent = null,
  ariaHidden,
  hidden = false,
  connected = true,
} = {}) {
  const attributes = new Map();
  if (role !== undefined) attributes.set("data-message-author-role", role);
  if (testId !== undefined) attributes.set("data-testid", testId);
  if (ariaHidden !== undefined) attributes.set("aria-hidden", ariaHidden);
  const node = {
    innerText: text,
    textContent: text,
    parentElement: parent,
    className,
    hidden,
    isConnected: connected,
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === node) return true;
        current = current.parentElement;
      }
      return false;
    },
    compareDocumentPosition(other) {
      if (other === node || other.order === order) return 0;
      return order < other.order ? 4 : 2;
    },
    order,
  };
  return node;
}

function createDocument({ composer = null, composerBySelector = {}, selectorMatches = {} } = {}) {
  const querySelectorCalls = [];
  const querySelectorAllCalls = [];
  return {
    querySelectorCalls,
    querySelectorAllCalls,
    querySelector(selector) {
      querySelectorCalls.push(selector);
      if (Object.hasOwn(composerBySelector, selector)) return composerBySelector[selector];
      return selector === composerSelector ? composer : null;
    },
    querySelectorAll(selector) {
      querySelectorAllCalls.push(selector);
      return selectorMatches[selector] || [];
    },
  };
}

function createComposer(value = "") {
  const listeners = new Map();
  return {
    value,
    innerText: "",
    textContent: "",
    isConnected: true,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
    },
    emitTrustedInput(type = "input") {
      for (const listener of listeners.get(type) || []) listener({ isTrusted: true });
    },
  };
}

function blankComposer() {
  return createComposer();
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("exposes only sidecar helpers through CommonJS and the browser global", () => {
  const { bridge, globalExport } = loadBridge();

  assert.equal(bridge, globalExport);
  assert.equal(typeof bridge.autoSendText, "function");
  assert.equal(typeof bridge.captureLatest, "function");
  assert.equal(bridge.parseToolCall, undefined);
  assert.equal(bridge.executeTool, undefined);
  assert.equal(Object.keys(bridge).some((key) => /mcp|tool/i.test(key)), false);
});

test("prefers the live plugin registry adapter over legacy globals", () => {
  const { bridge } = loadBridge();
  const active = { insertText() {} };
  const fallback = { insertText() {} };

  assert.equal(bridge.getActiveLegacyAdapter({
    pluginRegistry: { getActivePlugin: () => active },
    getCurrentAdapter: () => ({ instance: fallback }),
    mcpAdapter: fallback,
  }), active);
});

test("prefers an insert-capable legacy fallback over a non-insert registry plugin", () => {
  const { bridge } = loadBridge();
  const registryPlugin = { capabilities: ["sidebar"] };
  const fallback = { insertText() {} };

  assert.equal(bridge.getActiveLegacyAdapter({
    pluginRegistry: { getActivePlugin: () => registryPlugin },
    mcpAdapter: fallback,
  }), fallback);
});

test("activates the legacy hostname adapter before reporting content readiness", async () => {
  const { bridge } = loadBridge();
  const calls = [];
  const adapter = { insertText() {}, submitForm() {} };
  let active = null;
  const windowRef = {
    document: createDocument({ composer: blankComposer() }),
    location: { hostname: "chat.deepseek.com" },
    pluginRegistry: {
      getActivePlugin() { return active; },
      async activatePluginForHostname(hostname) {
        calls.push(hostname);
        active = adapter;
      },
    },
    setTimeout,
    clearTimeout,
  };

  const status = await bridge.detectContentStatus(windowRef, { tabId: 17 }, { activationTimeoutMs: 50 });

  assert.deepEqual(calls, ["chat.deepseek.com"]);
  assert.deepEqual(toPlain(status), {
    provider: "deepseek",
    label: "DeepSeek",
    readiness: "supported",
    canInsert: true,
    reason: "authenticated",
    tabId: 17,
    adapterDiagnostics: {
      bridgeState: "ready",
      adapterSource: "plugin_registry",
      activationState: "succeeded",
      sidecarInjected: false,
      composerFound: true,
      adapterPresent: true,
      hasInsertText: true,
      hasInsertTextIntoInput: false,
      hasSubmitForm: true,
    },
  });
});

test("bounds a legacy hostname activation that never settles", async () => {
  const { bridge } = loadBridge();
  const windowRef = {
    document: createDocument({ composer: blankComposer() }),
    location: { hostname: "www.doubao.com" },
    pluginRegistry: {
      getActivePlugin() { return null; },
      activatePluginForHostname() {
        return new Promise((resolve) => setTimeout(resolve, 50));
      },
    },
    setTimeout,
    clearTimeout,
  };

  const status = await bridge.detectContentStatus(windowRef, { tabId: 23 }, { activationTimeoutMs: 5 });

  assert.equal(status.canInsert, false);
  assert.equal(status.reason, "adapter_activation_timeout");
  assert.equal(status.adapterDiagnostics.activationState, "timed_out");
  assert.equal(status.adapterDiagnostics.adapterPresent, false);
});

test("resolves a registry adapter initialized after the sidecar loads", () => {
  const { bridge } = loadBridge();
  const active = { insertText() {} };
  const windowRef = {};

  assert.equal(bridge.getActiveLegacyAdapter(windowRef), null);
  windowRef.pluginRegistry = { getActivePlugin: () => active };
  assert.equal(bridge.getActiveLegacyAdapter(windowRef), active);
});

test("falls back when the plugin registry is unavailable", () => {
  const { bridge } = loadBridge();
  const active = { insertText() {} };
  const fallback = { insertText() {} };

  assert.equal(bridge.getActiveLegacyAdapter({
    getCurrentAdapter: () => ({ plugin: active }),
    mcpAdapter: fallback,
  }), active);
  assert.equal(bridge.getActiveLegacyAdapter({
    pluginRegistry: { getActivePlugin: () => { throw new Error("not ready"); } },
    getCurrentAdapter: () => { throw new Error("not ready"); },
    mcpAdapter: fallback,
  }), fallback);
});

test("delegates insertion and submission to the active legacy adapter", async () => {
  const { bridge } = loadBridge();
  const calls = [];
  const composer = blankComposer();
  const adapter = {
    async insertText(text, options) {
      assert.equal(options.targetElement, composer);
      composer.value = text;
      calls.push(["insert", text]);
      return true;
    },
    async submitForm() { calls.push(["submit"]); return true; },
  };
  const documentRef = createDocument({ composer });

  const result = await bridge.autoSendText({ adapter, text: "roundtable prompt", documentRef });

  assert.deepEqual(calls, [["insert", "roundtable prompt"], ["submit"]]);
  assert.equal(result.state, "sent");
});

test("supports the legacy insertTextIntoInput fallback with adapter binding", async () => {
  const { bridge } = loadBridge();
  const adapter = {
    marker: "legacy-adapter",
    async insertTextIntoInput(text) {
      assert.equal(this.marker, "legacy-adapter");
      assert.equal(text, "fallback prompt");
      return true;
    },
  };

  assert.equal(await bridge.insertWithAdapter(adapter, "fallback prompt"), true);
});

test("never overwrites a user draft", async () => {
  const { bridge } = loadBridge();
  const calls = [];
  const composer = createComposer("draft");
  const documentRef = createDocument({ composer });
  const adapter = {
    async insertText(text) { calls.push(["insert", text]); return true; },
    async submitForm() { calls.push(["submit"]); return true; },
  };

  const result = await bridge.autoSendText({ adapter, text: "roundtable prompt", documentRef });

  assert.equal(result.state, "input_busy");
  assert.equal(composer.value, "draft");
  assert.deepEqual(calls, []);
});

test("provider-specific draft detection ignores an unrelated plugin textarea", () => {
  const { bridge } = loadBridge();
  const pluginTextarea = { value: "sidebar notes" };
  const modelComposer = { value: "" };
  const documentRef = createDocument({
    composer: pluginTextarea,
    composerBySelector: { 'textarea[spellcheck="false"]': modelComposer },
  });

  assert.deepEqual(toPlain(bridge.readComposerDraft(documentRef, "deepseek")), {
    found: true,
    text: "",
  });
  assert.equal(documentRef.querySelectorCalls[0], 'textarea[spellcheck="false"]');
});

test("fails closed when input, insertion, or submission is unavailable", async () => {
  const { bridge } = loadBridge();
  const missingInput = await bridge.autoSendText({
    adapter: { insertText() { throw new Error("must not run"); } },
    text: "prompt",
    documentRef: createDocument(),
  });
  assert.equal(missingInput.state, "no_input");

  let submitted = false;
  const insertFailed = await bridge.autoSendText({
    adapter: {
      async insertText() { return false; },
      async submitForm() { submitted = true; return true; },
    },
    text: "prompt",
    documentRef: createDocument({ composer: blankComposer() }),
  });
  assert.equal(insertFailed.state, "no_input");
  assert.equal(submitted, false);

  const submitComposer = blankComposer();
  const submitFailed = await bridge.autoSendText({
    adapter: {
      async insertText(text, options) { options.targetElement.value = text; return true; },
      async submitForm() { return false; },
    },
    text: "prompt",
    documentRef: createDocument({ composer: submitComposer }),
  });
  assert.equal(submitFailed.state, "no_submit");
});

test("passes the checked composer to the adapter and refuses an adapter-target mismatch", async () => {
  const { bridge } = loadBridge();
  const composer = blankComposer();
  const unrelated = blankComposer();
  let submitted = false;
  const result = await bridge.autoSendText({
    adapter: {
      async insertText(text) { unrelated.value = text; return true; },
      async submitForm() { submitted = true; return true; },
    },
    text: "roundtable prompt",
    documentRef: createDocument({ composer }),
    providerId: "deepseek",
  });

  assert.equal(result.state, "no_input");
  assert.equal(composer.value, "");
  assert.equal(unrelated.value, "roundtable prompt");
  assert.equal(submitted, false);
});

test("does not submit when trusted user input races with adapter insertion", async () => {
  const { bridge } = loadBridge();
  const composer = blankComposer();
  let releaseInsertion;
  let submitted = false;
  const insertionGate = new Promise((resolve) => { releaseInsertion = resolve; });
  const pending = bridge.autoSendText({
    adapter: {
      async insertText(text, options) {
        await insertionGate;
        options.targetElement.value = text;
        return true;
      },
      async submitForm() { submitted = true; return true; },
    },
    text: "roundtable prompt",
    documentRef: createDocument({ composer }),
    providerId: "deepseek",
  });

  await Promise.resolve();
  composer.value = "user draft";
  composer.emitTrustedInput();
  releaseInsertion();
  const result = await pending;

  assert.equal(result.state, "input_busy");
  assert.equal(submitted, false);
});

test("rechecks the same composer immediately before submit", async () => {
  const { bridge } = loadBridge();
  const composer = blankComposer();
  let submitted = false;
  const result = await bridge.autoSendText({
    adapter: {
      async insertText(text, options) {
        options.targetElement.value = text;
        queueMicrotask(() => {
          options.targetElement.value = `${text} user addition`;
          options.targetElement.emitTrustedInput();
        });
        return true;
      },
      async submitForm() { submitted = true; return true; },
    },
    text: "roundtable prompt",
    documentRef: createDocument({ composer }),
    providerId: "deepseek",
  });

  assert.equal(result.state, "input_busy");
  assert.equal(submitted, false);
});

test("captures only a verified ChatGPT assistant message", () => {
  const { bridge } = loadBridge();
  const userJsonl = createNode({
    text: '{"type":"function_call","name":"write_file"}',
    order: 1,
    role: "user",
  });
  const assistant = createNode({ text: "assistant answer", order: 2, role: "assistant" });
  const documentRef = createDocument({
    selectorMatches: {
      "[data-message-author-role='assistant']": [userJsonl, assistant],
    },
  });

  const result = bridge.captureLatest(documentRef, "chatgpt");

  assert.equal(result.speaker, "assistant");
  assert.equal(result.text, "assistant answer");
  assert.equal(result.provider, "chatgpt");
  assert.match(result.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("captures DeepSeek only through its assistant-specific selector", () => {
  const { bridge } = loadBridge();
  const assistant = createNode({
    text: "DeepSeek answer",
    order: 1,
    className: "ds-markdown ds-assistant-message-main-content",
  });
  const documentRef = createDocument({
    selectorMatches: {
      ".ds-markdown.ds-assistant-message-main-content": [assistant],
      ".ds-markdown": [createNode({ text: "generic markdown", order: 2 })],
    },
  });

  assert.equal(bridge.captureLatest(documentRef, "deepseek").text, "DeepSeek answer");
  assert.equal(documentRef.querySelectorAllCalls.includes(".ds-markdown"), false);
});

test("rejects an unmarked node returned by an assistant selector fixture", () => {
  const { bridge } = loadBridge();
  const documentRef = createDocument({
    selectorMatches: {
      ".ds-markdown.ds-assistant-message-main-content": [
        createNode({ text: "unmarked DeepSeek node", order: 1 }),
      ],
      "[class*='answer-content']": [
        createNode({ text: "unmarked Doubao node", order: 2 }),
      ],
    },
  });

  assert.equal(bridge.captureLatest(documentRef, "deepseek"), null);
  assert.equal(bridge.captureLatest(documentRef, "doubao"), null);
});

test("deduplicates nested Doubao matches and excludes user JSONL", () => {
  const { bridge } = loadBridge();
  const first = createNode({ text: "first assistant answer", order: 1, testId: "message-assistant" });
  const nested = createNode({ text: "first assistant answer", order: 2, parent: first });
  const userContainer = createNode({ text: "", order: 3, role: "user", testId: "message-user" });
  const userJsonl = createNode({
    text: '{"type":"function_call","name":"write_file","arguments":{"path":"F:/secret"}}',
    order: 4,
    parent: userContainer,
  });
  const latestContainer = createNode({ text: "", order: 5, testId: "message-assistant" });
  const latest = createNode({ text: "latest assistant answer", order: 6, parent: latestContainer });
  const documentRef = createDocument({
    selectorMatches: {
      "[data-testid='message-assistant']": [first],
      ".flow-markdown-body": [nested, userJsonl],
      "[class*='answer-content']": [latest],
    },
  });

  const recent = bridge.captureRecent(documentRef, "doubao", 20);

  assert.deepEqual(toPlain(recent.messages.map(({ speaker, text }) => ({ speaker, text }))), [
    { speaker: "assistant", text: "first assistant answer" },
    { speaker: "assistant", text: "latest assistant answer" },
  ]);
  assert.equal(bridge.captureLatest(documentRef, "doubao").text, "latest assistant answer");
});

test("returns no capture for user, unknown-role, hidden, or unsupported nodes", () => {
  const { bridge } = loadBridge();
  const documentRef = createDocument({
    selectorMatches: {
      ".flow-markdown-body": [
        createNode({ text: "user", role: "user", order: 1 }),
        createNode({ text: "unknown", role: "unknown", order: 2 }),
        createNode({ text: "hidden", hidden: true, order: 3 }),
        createNode({ text: "unmarked generic markdown", order: 4 }),
        createNode({ text: "unmarked answer", order: 5 }),
      ],
      "[class*='answer-content']": [createNode({ text: "unmarked answer", order: 6 })],
    },
  });

  assert.equal(bridge.captureLatest(documentRef, "doubao"), null);
  assert.equal(bridge.captureLatest(documentRef, "unknown"), null);
});

test("insert-only mode protects an existing user draft", async () => {
  const listeners = [];
  const adapterCalls = [];
  const documentRef = createDocument({ composer: createComposer("user draft") });
  loadBridge({
    chrome: { runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } } },
    document: documentRef,
    getCurrentAdapter: () => ({
      async insertText(text) { adapterCalls.push(text); return true; },
    }),
    location: { hostname: "chat.deepseek.com" },
  });

  let response;
  assert.equal(listeners[0](
    { type: "tab:insert-text", text: "roundtable prompt" },
    {},
    (value) => { response = toPlain(value); },
  ), true);
  await flushPromises();

  assert.deepEqual(adapterCalls, []);
  assert.deepEqual(response, {
    ok: true,
    type: "tab:insert-text",
    data: {
      ok: false,
      provider: "deepseek",
      state: "input_busy",
      message: "输入框已有用户草稿，未执行圆桌插入。",
    },
  });
});

test("message listener handles only the content-sidecar command allowlist", async () => {
  const listeners = [];
  const runtimeSendCalls = [];
  const adapterCalls = [];
  const documentRef = createDocument({ composer: blankComposer() });
  const adapter = {
    async insertText(text, options) {
      options.targetElement.value = text;
      adapterCalls.push(["insert", text]);
      return true;
    },
    async submitForm() { adapterCalls.push(["submit"]); return true; },
  };
  loadBridge({
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { listeners.push(listener); } },
        sendMessage(message) { runtimeSendCalls.push(message); },
      },
    },
    document: documentRef,
    getCurrentAdapter: () => adapter,
    location: { hostname: "chat.deepseek.com" },
  });
  assert.equal(listeners.length, 1);

  const listener = listeners[0];
  let mcpResponse;
  assert.equal(listener(
    { type: "mcp:call-tool", toolName: "write_file" },
    {},
    (response) => { mcpResponse = response; },
  ), false);
  assert.equal(mcpResponse, undefined);

  let autoSendResponse;
  assert.equal(listener(
    { type: "tab:auto-send-text", text: "roundtable prompt" },
    {},
    (response) => { autoSendResponse = toPlain(response); },
  ), true);
  await flushPromises();

  assert.deepEqual(adapterCalls, [["insert", "roundtable prompt"], ["submit"]]);
  assert.deepEqual(autoSendResponse, {
    ok: true,
    type: "tab:auto-send-text",
    data: {
      provider: "deepseek",
      state: "sent",
      message: "已通过旧插件 adapter 发送。",
    },
  });
  assert.deepEqual(runtimeSendCalls, []);
});
