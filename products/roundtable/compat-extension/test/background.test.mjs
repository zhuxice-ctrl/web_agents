import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  chooseProviderTab,
  providerIdForUrl,
  runProviderAuthProbe,
  sanitizeDetectedStatus,
  sanitizeProviderUrl,
} from "../background/background-core.js";
import {
  createRoundtableBackgroundRouter,
  registerRoundtableBackground,
} from "../background.js";

const NORMAL_BACKGROUND_PATH = "extensions/mcp-superassistant-local-fixed/background.js";
const COMPAT_BACKGROUND_PATH = "products/roundtable/compat-extension/background.js";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDocument(bodyText = "", { title = "", composer = false, login = false, challenge = false } = {}) {
  const visibleNode = {
    hidden: false,
    disabled: false,
    readOnly: false,
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 100, height: 40 }; },
    closest() { return null; },
  };
  return {
    title,
    body: { innerText: bodyText },
    querySelector(selector) {
      if (challenge && /captcha|challenge|turnstile|geetest|verify-dialog|sec-check/.test(selector)) {
        return visibleNode;
      }
      if (composer && /prompt-textarea|textarea|contenteditable/.test(selector)) return visibleNode;
      if (login && /login|sign-in|登录/.test(selector)) return visibleNode;
      return null;
    },
  };
}

async function executeProbeInMainWorld(provider, globals) {
  const source = `(${runProviderAuthProbe.toString()})(${JSON.stringify(provider)})`;
  return vm.runInNewContext(source, { JSON, ...globals });
}

function createFakeChrome(initialTabs) {
  const tabs = new Map(initialTabs.map((tab) => [tab.id, { ...tab }]));
  const calls = {
    created: [],
    executeScript: [],
    focusedWindows: [],
    listeners: [],
    queries: [],
    removedListeners: [],
    sent: [],
    updated: [],
  };
  const authResults = new Map();
  const contentHandlers = new Map();
  let nextTabId = 100;

  const chromeApi = {
    runtime: {
      id: "roundtable-test-extension",
      onMessage: {
        addListener(listener) {
          calls.listeners.push(listener);
        },
      },
    },
    scripting: {
      async executeScript(options) {
        calls.executeScript.push(options);
        const tab = tabs.get(options.target.tabId);
        const provider = options.args[0];
        return [{
          result: authResults.get(tab.id) || {
            provider,
            authenticated: true,
            reason: "authenticated",
            verificationRequired: false,
          },
        }];
      },
    },
    tabs: {
      async create(createProperties) {
        const tab = {
          id: nextTabId++,
          active: createProperties.active === true,
          lastAccessed: Date.now(),
          url: createProperties.url,
          windowId: 1,
        };
        tabs.set(tab.id, tab);
        calls.created.push(createProperties);
        return { ...tab };
      },
      async get(tabId) {
        if (!tabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
        return { ...tabs.get(tabId) };
      },
      onRemoved: {
        addListener(listener) {
          calls.removedListeners.push(listener);
        },
      },
      async query(queryInfo = {}) {
        calls.queries.push(queryInfo);
        return [...tabs.values()].map((tab) => ({ ...tab }));
      },
      async sendMessage(tabId, message) {
        calls.sent.push({ tabId, message: { ...message } });
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        const provider = providerIdForUrl(tab.url);
        if (contentHandlers.has(message.type)) {
          return contentHandlers.get(message.type)({ message, provider, tab, tabId });
        }
        if (message.type === "tab:detect") {
          return {
            ok: true,
            type: message.type,
            data: {
              provider,
              readiness: "supported",
              canInsert: true,
              token: "must-not-cross-the-bridge",
            },
          };
        }
        return {
          ok: true,
          type: message.type,
          data: { provider, state: "sent", text: message.text },
        };
      },
      async update(tabId, updateProperties) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        Object.assign(tab, updateProperties);
        calls.updated.push({ tabId, updateProperties });
        return { ...tab };
      },
    },
    windows: {
      async update(windowId, updateInfo) {
        calls.focusedWindows.push({ windowId, updateInfo });
        return { id: windowId, ...updateInfo };
      },
    },
  };

  return { authResults, calls, chromeApi, contentHandlers, tabs };
}

test("matches only supported HTTPS provider URLs", () => {
  assert.equal(providerIdForUrl("https://chatgpt.com/c/123"), "chatgpt");
  assert.equal(providerIdForUrl("https://chat.openai.com/"), "chatgpt");
  assert.equal(providerIdForUrl("https://chat.deepseek.com/a"), "deepseek");
  assert.equal(providerIdForUrl("https://www.doubao.com/chat/"), "doubao");
  assert.equal(providerIdForUrl("https://chat.deepseek.com.evil.example/"), null);
  assert.equal(providerIdForUrl("http://chat.deepseek.com/"), null);
  assert.equal(providerIdForUrl("https://user:pass@chat.deepseek.com/"), null);
  assert.equal(providerIdForUrl("not a URL"), null);
});

test("sanitizes provider URLs without returning credentials, queries, or hashes", () => {
  assert.equal(
    sanitizeProviderUrl("https://chat.deepseek.com/a?token=secret#private"),
    "https://chat.deepseek.com/a",
  );
  assert.equal(sanitizeProviderUrl("https://user:pass@chat.deepseek.com/a"), null);
  assert.equal(sanitizeProviderUrl("http://chat.deepseek.com/a"), null);
  assert.equal(sanitizeProviderUrl("https://example.com/a?token=secret"), null);
});

test("keeps the current ready tab instead of drifting to another conversation", () => {
  const selected = chooseProviderTab([
    { tabId: 10, provider: "deepseek", ready: true },
    { tabId: 11, provider: "deepseek", ready: true, authenticated: true, active: true },
  ], 10);
  assert.equal(selected.tabId, 10);
});

test("scores ready provider tabs deterministically and skips explicit failures", () => {
  const selected = chooseProviderTab([
    { tabId: 10, ready: false, authenticated: true, active: true },
    { tabId: 11, ready: true, authenticated: false, active: true, lastAccessed: 20 },
    { tabId: 12, ready: true, authenticated: true, active: false, lastAccessed: 10 },
  ]);
  assert.equal(selected.tabId, 12);
  assert.equal(chooseProviderTab([{ tabId: 10, ready: false }]), null);
});

test("sanitizes detected status to an explicit secret-free shape", () => {
  const result = sanitizeDetectedStatus({
    provider: "deepseek",
    authenticated: true,
    ready: true,
    reason: "authenticated",
    token: "secret",
    body: { user: { email: "private@example.com" } },
    account: { id: "private" },
  }, {
    id: 42,
    url: "https://chat.deepseek.com/a?token=secret#private",
  });

  assert.deepEqual(plain(result), {
    tabId: 42,
    provider: "deepseek",
    url: "https://chat.deepseek.com/a",
    authenticated: true,
    ready: true,
    verificationRequired: false,
    reason: "authenticated",
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|body|account|email|user/i);
});

test("fails detected status closed when the provider or URL drifts", () => {
  assert.deepEqual(plain(sanitizeDetectedStatus({
    provider: "chatgpt",
    authenticated: true,
    ready: true,
    reason: "authenticated",
  }, {
    id: 42,
    url: "https://chat.deepseek.com/a?token=secret",
  })), {
    tabId: 42,
    provider: "deepseek",
    url: "https://chat.deepseek.com/a",
    authenticated: false,
    ready: false,
    verificationRequired: false,
    reason: "provider_url_mismatch",
  });
});

test("provider auth probe uses visible DOM state without reading storage or making requests", async () => {
  let fetched = false;
  let storageRead = false;
  const result = await executeProbeInMainWorld("deepseek", {
    document: createDocument("", { composer: true }),
    localStorage: {
      getItem() {
        storageRead = true;
        throw new Error("storage must not be read");
      },
    },
    async fetch() {
      fetched = true;
      throw new Error("network must not be used");
    },
  });

  assert.equal(storageRead, false);
  assert.equal(fetched, false);
  assert.deepEqual(plain(result), {
    provider: "deepseek",
    authenticated: true,
    reason: "authenticated",
    verificationRequired: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|token|body|account|email|user/i);
});

test("DeepSeek and Doubao visible composers produce bounded authenticated results", async () => {
  const deepseek = await executeProbeInMainWorld("deepseek", {
    document: createDocument("", { composer: true }),
  });
  const doubao = await executeProbeInMainWorld("doubao", {
    document: createDocument("", { composer: true }),
  });

  for (const result of [deepseek, doubao]) {
    assert.deepEqual(Object.keys(result), ["provider", "authenticated", "reason", "verificationRequired"]);
    assert.equal(result.authenticated, true);
    assert.equal(result.reason, "authenticated");
    assert.doesNotMatch(JSON.stringify(result), /secret|token|account|email|user_id/i);
  }
});

test("auth probe reports human verification without making an auth request", async () => {
  let fetched = false;
  const result = await executeProbeInMainWorld("deepseek", {
    document: createDocument("", { challenge: true }),
    localStorage: { getItem() { return "secret"; } },
    async fetch() {
      fetched = true;
      throw new Error("must not fetch");
    },
  });

  assert.equal(fetched, false);
  assert.deepEqual(plain(result), {
    provider: "deepseek",
    authenticated: false,
    reason: "human_verification_required",
    verificationRequired: true,
  });
});

test("auth probe recognizes a Chinese verification page title", async () => {
  let fetched = false;
  const result = await executeProbeInMainWorld("doubao", {
    document: createDocument("", { title: "安全验证 - 豆包" }),
    localStorage: { getItem() { return null; } },
    async fetch() {
      fetched = true;
      throw new Error("must not fetch");
    },
  });

  assert.equal(fetched, false);
  assert.equal(result.reason, "human_verification_required");
  assert.equal(result.verificationRequired, true);
});

test("auth probe does not read ordinary conversation text or infer authentication from it", async () => {
  let fetched = false;
  const result = await executeProbeInMainWorld("chatgpt", {
    document: createDocument("Explain why a page might say Verify you are human.", { title: "ChatGPT" }),
    localStorage: { getItem() { return null; } },
    async fetch() {
      fetched = true;
      throw new Error("network must not be used");
    },
  });

  assert.equal(fetched, false);
  assert.deepEqual(plain(result), {
    provider: "chatgpt",
    authenticated: false,
    reason: "probe_failed",
    verificationRequired: false,
  });
});

test("auth probe reports a visible login gate without inspecting credentials", async () => {
  const result = await executeProbeInMainWorld("doubao", {
    document: createDocument("", { login: true }),
  });

  assert.deepEqual(plain(result), {
    provider: "doubao",
    authenticated: false,
    reason: "login_required",
    verificationRequired: false,
  });
});

test("router bounds a MAIN-world probe that settles too late", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  fake.chromeApi.scripting.executeScript = async (options) => {
    fake.calls.executeScript.push(options);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return [{
      result: {
        provider: "deepseek",
        authenticated: true,
        reason: "authenticated",
        verificationRequired: false,
      },
    }];
  };
  const router = createRoundtableBackgroundRouter(fake.chromeApi, {
    authProbeTimeoutMs: 5,
    contentMessageTimeoutMs: 50,
  });

  const response = await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "deepseek",
    tabId: 10,
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.authenticated, false);
  assert.equal(response.data.reason, "probe_timeout");
});

test("router reinjects only the roundtable sidecars when a provider receiver is missing", async () => {
  const fake = createFakeChrome([
    { id: 23, url: "https://www.doubao.com/chat/1", active: true, windowId: 1 },
  ]);
  let receiverMissing = true;
  fake.chromeApi.scripting.executeScript = async (options) => {
    fake.calls.executeScript.push(options);
    if (options.files) return [];
    return [{
      result: {
        provider: "doubao",
        authenticated: true,
        reason: "authenticated",
        verificationRequired: false,
      },
    }];
  };
  fake.chromeApi.tabs.sendMessage = async (tabId, message) => {
    fake.calls.sent.push({ tabId, message: { ...message } });
    if (receiverMissing) {
      receiverMissing = false;
      throw new Error("Could not establish connection. Receiving end does not exist.");
    }
    return {
      ok: true,
      type: message.type,
      data: {
        provider: "doubao",
        label: "豆包",
        readiness: "supported",
        canInsert: true,
        reason: "authenticated",
        tabId,
        adapterDiagnostics: {
          bridgeState: "ready",
          adapterSource: "plugin_registry",
          activationState: "not_needed",
          sidecarInjected: false,
          composerFound: true,
          adapterPresent: true,
          hasInsertText: true,
          hasInsertTextIntoInput: false,
          hasSubmitForm: true,
          token: "must-not-cross",
        },
      },
    };
  };
  const router = createRoundtableBackgroundRouter(fake.chromeApi, {
    authProbeTimeoutMs: 50,
    contentMessageTimeoutMs: 50,
  });

  const response = await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "doubao",
    tabId: 23,
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.canInsert, true);
  assert.deepEqual(response.data.adapterDiagnostics, {
    bridgeState: "ready",
    adapterSource: "plugin_registry",
    activationState: "not_needed",
    sidecarInjected: true,
    composerFound: true,
    adapterPresent: true,
    hasInsertText: true,
    hasInsertTextIntoInput: false,
    hasSubmitForm: true,
  });
  assert.deepEqual(fake.calls.executeScript.find((call) => call.files)?.files, [
    "content/roundtable-protocol.js",
    "content/roundtable-content-bridge.js",
  ]);
  assert.doesNotMatch(JSON.stringify(response), /must-not-cross|token/i);
});

test("router bounds a content-sidecar response that settles too late", async () => {
  const fake = createFakeChrome([
    { id: 23, url: "https://www.doubao.com/chat/1", active: true, windowId: 1 },
  ]);
  fake.chromeApi.tabs.sendMessage = async (tabId, message) => {
    fake.calls.sent.push({ tabId, message: { ...message } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      ok: true,
      type: message.type,
      data: { provider: "doubao", label: "豆包", readiness: "supported", canInsert: true, tabId },
    };
  };
  const router = createRoundtableBackgroundRouter(fake.chromeApi, {
    authProbeTimeoutMs: 50,
    contentMessageTimeoutMs: 5,
  });

  const response = await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "doubao",
    tabId: 23,
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.ready, false);
  assert.equal(response.data.reason, "content_bridge_timeout");
  assert.equal(response.data.adapterDiagnostics.bridgeState, "timed_out");
});

test("router probes and preserves the exact bound provider tab", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a?token=one#x", active: false, lastAccessed: 10, windowId: 1 },
    { id: 11, url: "https://chat.deepseek.com/b?token=two#y", active: true, lastAccessed: 20, windowId: 1 },
  ]);
  const router = createRoundtableBackgroundRouter(fake.chromeApi);

  const exact = await router.handleRequest({ type: "tabs:probe-provider", provider: "deepseek", tabId: 10 });
  assert.equal(exact.ok, true);
  assert.equal(exact.data.tabId, 10);
  assert.equal(exact.data.url, "https://chat.deepseek.com/a");
  assert.equal(exact.data.canInsert, true);
  assert.equal(exact.data.label, "DeepSeek");
  assert.equal(exact.data.readiness, "supported");

  const preserved = await router.handleRequest({ type: "tabs:probe-provider", provider: "deepseek" });
  assert.equal(preserved.ok, true);
  assert.equal(preserved.data.tabId, 10);
  assert.equal(router.bindings.get("deepseek"), 10);
  assert.doesNotMatch(JSON.stringify(preserved), /token=|#x|#y|must-not-cross/i);
});

test("router open-provider output satisfies the relay metadata contract", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  const router = createRoundtableBackgroundRouter(fake.chromeApi);

  const response = await router.handleRequest({ type: "tabs:open-provider", provider: "deepseek" });

  assert.deepEqual(response, {
    ok: true,
    type: "tabs:open-provider",
    data: {
      provider: "deepseek",
      label: "DeepSeek",
      tabId: 10,
      url: "https://chat.deepseek.com/a",
      status: "ready",
      reused: true,
    },
  });
});

test("router routes commands only to the requested tabId", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
    { id: 11, url: "https://chat.deepseek.com/b", active: false, windowId: 1 },
  ]);
  const router = createRoundtableBackgroundRouter(fake.chromeApi);
  assert.equal((await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "deepseek",
    tabId: 11,
  })).ok, true);
  const response = await router.handleRequest({
    type: "tab:auto-send-text",
    tabId: 11,
    text: "roundtable prompt",
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.provider, "deepseek");
  assert.deepEqual(fake.calls.sent.at(-1), {
    tabId: 11,
    message: { type: "tab:auto-send-text", tabId: 11, text: "roundtable prompt" },
  });
});

test("router refuses content commands for a supported but unbound tab", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  const router = createRoundtableBackgroundRouter(fake.chromeApi);

  const response = await router.handleRequest({
    type: "tab:auto-send-text",
    tabId: 10,
    text: "must not be sent",
  });

  assert.deepEqual(response, {
    ok: false,
    type: "tab:auto-send-text",
    error: "PROVIDER_PAGE_NOT_BOUND",
  });
  assert.equal(fake.calls.sent.length, 0);
});

test("router fails closed when a bound tab drifts to another provider", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  const router = createRoundtableBackgroundRouter(fake.chromeApi);
  assert.equal((await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "deepseek",
    tabId: 10,
  })).ok, true);
  fake.calls.sent.length = 0;
  fake.tabs.get(10).url = "https://chatgpt.com/c/changed?token=secret#private";

  const response = await router.handleRequest({
    type: "tab:insert-text",
    tabId: 10,
    text: "must not be sent",
  });

  assert.deepEqual(response, {
    ok: false,
    type: "tab:insert-text",
    error: "PROVIDER_URL_MISMATCH",
  });
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(router.bindings.has("deepseek"), false);
  assert.doesNotMatch(JSON.stringify(response), /secret|token|private/i);
});

test("router runs auth probes in MAIN world and returns no extra fields", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  fake.authResults.set(10, {
    provider: "deepseek",
    authenticated: true,
    reason: "authenticated",
    verificationRequired: false,
    token: "secret",
    body: { account: { id: "private" } },
  });
  const router = createRoundtableBackgroundRouter(fake.chromeApi);
  assert.equal((await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "deepseek",
    tabId: 10,
  })).ok, true);
  fake.calls.executeScript.length = 0;
  const response = await router.handleRequest({ type: "tab:auth-probe", tabId: 10 });

  assert.deepEqual(response, {
    ok: true,
    type: "tab:auth-probe",
    data: {
      provider: "deepseek",
      authenticated: true,
      reason: "authenticated",
      verificationRequired: false,
    },
  });
  assert.equal(fake.calls.executeScript.length, 1);
  assert.equal(fake.calls.executeScript[0].world, "MAIN");
  assert.deepEqual(fake.calls.executeScript[0].target, { tabId: 10 });
  assert.equal(fake.calls.executeScript[0].func, runProviderAuthProbe);
  assert.doesNotMatch(JSON.stringify(response), /secret|body|account|token/i);
});

test("router preserves complete assistant captures while sanitizing their URLs", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  const longText = `${"x".repeat(1_200)} https://example.com/path?token=secret#private`;
  fake.contentHandlers.set("tab:capture-latest", ({ message, provider }) => ({
    ok: true,
    type: message.type,
    data: {
      provider,
      speaker: "assistant",
      text: longText,
      source: "legacy-sidecar:deepseek",
    },
  }));
  const router = createRoundtableBackgroundRouter(fake.chromeApi);
  assert.equal((await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "deepseek",
    tabId: 10,
  })).ok, true);
  const response = await router.handleRequest({ type: "tab:capture-latest", tabId: 10 });

  assert.equal(response.ok, true);
  assert.equal(response.data.text.length, 1_225);
  assert.equal(response.data.text, `${"x".repeat(1_200)} https://example.com/path`);
});

test("router rejects captures without an explicit assistant speaker", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  fake.contentHandlers.set("tab:capture-latest", ({ message, provider }) => ({
    ok: true,
    type: message.type,
    data: { provider, speaker: "user", text: "must not cross" },
  }));
  const router = createRoundtableBackgroundRouter(fake.chromeApi);
  assert.equal((await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "deepseek",
    tabId: 10,
  })).ok, true);

  const userCapture = await router.handleRequest({ type: "tab:capture-latest", tabId: 10 });
  assert.deepEqual(userCapture, {
    ok: false,
    type: "tab:capture-latest",
    error: "INVALID_CAPTURE_SPEAKER",
  });

  fake.contentHandlers.set("tab:capture-latest", ({ message, provider }) => ({
    ok: true,
    type: message.type,
    data: { provider, text: "missing speaker" },
  }));
  const missingSpeaker = await router.handleRequest({ type: "tab:capture-latest", tabId: 10 });
  assert.equal(missingSpeaker.ok, false);
  assert.equal(missingSpeaker.error, "INVALID_CAPTURE_SPEAKER");
});

test("router clears an exact binding when authentication expires", async () => {
  const fake = createFakeChrome([
    { id: 10, url: "https://chat.deepseek.com/a", active: true, windowId: 1 },
  ]);
  const router = createRoundtableBackgroundRouter(fake.chromeApi);
  assert.equal((await router.handleRequest({
    type: "tabs:probe-provider",
    provider: "deepseek",
    tabId: 10,
  })).ok, true);
  assert.equal(router.bindings.get("deepseek"), 10);

  fake.authResults.set(10, {
    provider: "deepseek",
    authenticated: false,
    reason: "login_required",
    verificationRequired: false,
    account: { id: "private" },
  });
  const response = await router.handleRequest({ type: "tab:auth-probe", tabId: 10 });

  assert.equal(response.ok, true);
  assert.equal(response.data.authenticated, false);
  assert.equal(response.data.reason, "login_required");
  assert.equal(router.bindings.has("deepseek"), false);
});

test("background listener ignores legacy and MCP messages", async () => {
  const fake = createFakeChrome([]);
  const registration = registerRoundtableBackground(fake.chromeApi);
  assert.equal(fake.calls.listeners.length, 1);

  let response;
  const keepChannelOpen = fake.calls.listeners[0](
    { type: "mcp:call-tool", command: "webAgentManualToolCall", token: "secret" },
    { id: fake.chromeApi.runtime.id, tab: { url: "http://127.0.0.1:3020/" } },
    (value) => { response = value; },
  );
  await Promise.resolve();

  assert.equal(keepChannelOpen, false);
  assert.equal(response, undefined);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.executeScript.length, 0);
  assert.equal(registration.bindings.size, 0);
});

test("background listener rejects roundtable commands from provider and extension pages", async () => {
  const fake = createFakeChrome([]);
  registerRoundtableBackground(fake.chromeApi);
  const listener = fake.calls.listeners[0];

  for (const sender of [
    { id: fake.chromeApi.runtime.id, tab: { url: "https://chat.deepseek.com/" } },
    { id: fake.chromeApi.runtime.id, url: `chrome-extension://${fake.chromeApi.runtime.id}/popup.html` },
    { id: "another-extension", tab: { url: "http://127.0.0.1:3020/" } },
  ]) {
    let response;
    assert.equal(listener(
      { type: "tabs:discover-providers", providers: ["deepseek"] },
      sender,
      (value) => { response = value; },
    ), false);
    assert.equal(response, undefined);
  }

  assert.equal(fake.calls.queries.length, 0);
});

test("background listener accepts allowlisted commands from the fixed local roundtable origin", async () => {
  const fake = createFakeChrome([]);
  registerRoundtableBackground(fake.chromeApi);
  let response;

  assert.equal(fake.calls.listeners[0](
    { type: "tabs:discover-providers", providers: ["deepseek"] },
    { id: fake.chromeApi.runtime.id, tab: { url: "http://localhost:3020/room" } },
    (value) => { response = value; },
  ), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(response, {
    ok: true,
    type: "tabs:discover-providers",
    data: { tabs: [] },
  });
});

test("compatibility background is isolated from the normal plugin", () => {
  const normalBackground = fs.readFileSync(NORMAL_BACKGROUND_PATH, "utf8");
  const compatBackground = fs.readFileSync(COMPAT_BACKGROUND_PATH, "utf8");
  assert.doesNotMatch(normalBackground, /roundtable-background|background-core/);
  assert.match(compatBackground, /\.\/background\/background-core\.js/);
});
