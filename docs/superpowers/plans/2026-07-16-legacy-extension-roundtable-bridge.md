# Legacy Extension Roundtable Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `extensions/mcp-superassistant-local-fixed` the only browser extension required by the roundtable MVP while preserving its existing manual MCP workflow.

**Architecture:** Add three isolated sidecars to the legacy extension: a localhost page bridge, a provider content bridge that delegates insertion/submission to the legacy adapter, and a background router for exact-tab discovery/auth probing. The legacy bundle remains the sole MCP/tool executor; the roundtable sidecars only transport commands and capture verified assistant text.

**Tech Stack:** Chrome MV3, plain JavaScript content scripts, ES-module service worker sidecar, Node.js 24 test runner, `vm` fixtures, existing roundtable HTTP/SSE service.

---

## File Map

**Create**

- `extensions/mcp-superassistant-local-fixed/content/roundtable-protocol.js`: shared request validation, provider metadata, origin checks, URL/error redaction.
- `extensions/mcp-superassistant-local-fixed/content/roundtable-page-bridge.js`: trusted localhost `window.postMessage` bridge.
- `extensions/mcp-superassistant-local-fixed/content/roundtable-content-bridge.js`: legacy-adapter delegation and assistant-only capture.
- `extensions/mcp-superassistant-local-fixed/roundtable/background-core.js`: pure tab/provider/auth helpers.
- `extensions/mcp-superassistant-local-fixed/roundtable-background.js`: Chrome tab router and message listener.
- `scripts/web-agent-roundtable-protocol.test.mjs`: protocol unit tests.
- `scripts/web-agent-roundtable-page-bridge.test.mjs`: localhost bridge unit tests.
- `scripts/web-agent-roundtable-content-bridge.test.mjs`: adapter/capture unit tests.
- `scripts/web-agent-roundtable-background.test.mjs`: background router unit tests.
- `scripts/web-agent-roundtable-manifest.test.mjs`: manifest/version/single-runtime assertions.

**Modify**

- `extensions/mcp-superassistant-local-fixed/background.js`: one static sidecar import only.
- `extensions/mcp-superassistant-local-fixed/manifest.json`: permissions, content script entries, bridge resources, version `0.6.8`.
- `extensions/mcp-superassistant-local-fixed/README.md`: roundtable setup and single-extension warning.
- `apps/roundtable-web/automation/extension-relay.mjs`: carry bounded `bridgeRevision` client metadata.
- `apps/roundtable-web/automation/extension-relay.test.mjs`: revision and schema tests.
- `apps/roundtable-web/server.mjs`: register/heartbeat revision metadata.
- `apps/roundtable-web/server-runtime.test.mjs`: legacy extension relay fixture.
- `apps/roundtable-web/public/app.js`: revision state and legacy runtime labels.
- `apps/roundtable-web/public/index.html`: `web_Agent` execution-mode label.
- `apps/roundtable-web/orchestrator/prompt-header.mjs`: remove executable JSONL example.
- `apps/roundtable-web/orchestrator/prompt-header.test.mjs`: prove prompt header cannot parse as a complete tool call.
- `package.json`: add legacy-sidecar tests to the normal verification chain.
- `docs/web-agents-development-plan.md`: change the MVP load path and runtime ownership.
- `docs/product-unification-roadmap.md`: record the legacy-sidecar decision and quarantine the rewrite runtime.
- `.adworkflow/verification_commands.md`: add legacy bridge and non-GPT live checks.

Do not edit `extensions/mcp-superassistant-local-fixed/content/index.iife.js` or rewrite the main body of `extensions/mcp-superassistant-local-fixed/background.js`.

---

### Task 1: Shared Roundtable Protocol

**Files:**
- Create: `extensions/mcp-superassistant-local-fixed/content/roundtable-protocol.js`
- Create: `scripts/web-agent-roundtable-protocol.test.mjs`

- [ ] **Step 1: Write failing protocol tests**

Test exports through the same `vm` loader used by the existing legacy content tests:

```js
test("accepts only the fixed local roundtable origins", () => {
  assert.equal(protocol.isTrustedRoundtableOrigin("http://127.0.0.1:3020"), true);
  assert.equal(protocol.isTrustedRoundtableOrigin("http://localhost:3020"), true);
  assert.equal(protocol.isTrustedRoundtableOrigin("http://127.0.0.1:3021"), false);
  assert.equal(protocol.isTrustedRoundtableOrigin("https://127.0.0.1:3020"), false);
});

test("allows only the roundtable command schema", () => {
  assert.deepEqual(
    protocol.validateRoundtableRequest({ type: "tab:auto-send-text", tabId: 42, text: "hello" }),
    { type: "tab:auto-send-text", tabId: 42, text: "hello" },
  );
  assert.throws(
    () => protocol.validateRoundtableRequest({ type: "mcp:call-tool", toolName: "write_file" }),
    /ROUND_TABLE_REQUEST_NOT_ALLOWED/,
  );
});

test("redacts credentials, query, hash, and secret fields recursively", () => {
  const result = protocol.sanitizeBridgeValue({
    url: "https://chat.deepseek.com/a?token=secret#private",
    token: "secret",
    nested: { cookie: "session", message: "open https://example.com/p?q=1#x" },
  });
  assert.deepEqual(result, {
    url: "https://chat.deepseek.com/a",
    nested: { message: "open https://example.com/p" },
  });
});
```

- [ ] **Step 2: Run the protocol tests and verify failure**

Run:

```powershell
node --test scripts/web-agent-roundtable-protocol.test.mjs
```

Expected: FAIL because `roundtable-protocol.js` does not exist.

- [ ] **Step 3: Implement the UMD-compatible protocol module**

The browser path must expose `globalThis.__webAgentRoundtableProtocol`; the Node test path must set `module.exports`.

```js
(function initRoundtableProtocol(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.__webAgentRoundtableProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createProtocol() {
  "use strict";

  const SOURCE = "web-agents-roundtable-bridge";
  const BRIDGE_REVISION = "legacy-sidecar-v1";
  const PROVIDERS = Object.freeze({
    chatgpt: { label: "ChatGPT", origins: ["https://chatgpt.com", "https://chat.openai.com"], defaultUrl: "https://chatgpt.com/" },
    deepseek: { label: "DeepSeek", origins: ["https://chat.deepseek.com"], defaultUrl: "https://chat.deepseek.com/" },
    doubao: { label: "豆包", origins: ["https://www.doubao.com", "https://doubao.com"], defaultUrl: "https://www.doubao.com/chat/" },
  });
  const ALLOWED_TYPES = new Set([
    "tabs:open-provider", "tabs:discover-providers", "tabs:probe-provider", "tabs:focus-provider",
    "tab:auth-probe", "tab:detect", "tab:insert-text", "tab:auto-send-text",
    "tab:capture-latest", "tab:capture-recent",
  ]);
  const SECRET_KEYS = /^(?:access_?token|refresh_?token|token|cookie|cookies|authorization|session|account|email|user)$/i;

  function isTrustedRoundtableOrigin(value) {
    return value === "http://127.0.0.1:3020" || value === "http://localhost:3020";
  }

  function sanitizeUrl(value) {
    const url = new URL(String(value));
    if (url.username || url.password) throw new Error("UNSAFE_URL");
    return `${url.origin}${url.pathname}`;
  }

  function sanitizeBridgeValue(value) {
    if (Array.isArray(value)) return value.map(sanitizeBridgeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !SECRET_KEYS.test(key))
        .map(([key, item]) => [key, sanitizeBridgeValue(item)]));
    }
    if (typeof value !== "string") return value;
    return value.replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
      try { return sanitizeUrl(match); } catch { return "[redacted-url]"; }
    });
  }

  function requireTabId(value) {
    const tabId = Number(value);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error("INVALID_TAB_ID");
    return tabId;
  }

  function validateRoundtableRequest(request) {
    if (!request || typeof request !== "object" || !ALLOWED_TYPES.has(request.type)) {
      throw new Error("ROUND_TABLE_REQUEST_NOT_ALLOWED");
    }
    if (request.type.startsWith("tab:")) {
      const result = { type: request.type, tabId: requireTabId(request.tabId) };
      if (request.type === "tab:insert-text" || request.type === "tab:auto-send-text") {
        if (typeof request.text !== "string" || !request.text.trim() || request.text.length > 1_000_000) {
          throw new Error("INVALID_TEXT_PAYLOAD");
        }
        result.text = request.text;
      }
      if (request.type === "tab:capture-recent" && request.limit !== undefined) {
        const limit = Number(request.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 80) throw new Error("INVALID_CAPTURE_LIMIT");
        result.limit = limit;
      }
      return result;
    }
    return structuredClone(request);
  }

  return { SOURCE, BRIDGE_REVISION, PROVIDERS, isTrustedRoundtableOrigin, sanitizeUrl, sanitizeBridgeValue, validateRoundtableRequest };
});
```

- [ ] **Step 4: Run the protocol tests and verify pass**

Run: `node --test scripts/web-agent-roundtable-protocol.test.mjs`

Expected: all protocol tests PASS.

- [ ] **Step 5: Commit the protocol module**

```powershell
git add extensions/mcp-superassistant-local-fixed/content/roundtable-protocol.js scripts/web-agent-roundtable-protocol.test.mjs
git commit -m "feat: add legacy roundtable bridge protocol"
```

---

### Task 2: Trusted Localhost Page Bridge

**Files:**
- Create: `extensions/mcp-superassistant-local-fixed/content/roundtable-page-bridge.js`
- Create: `scripts/web-agent-roundtable-page-bridge.test.mjs`

- [ ] **Step 1: Write failing page-bridge tests**

Create a fake `window`, fake `chrome.runtime.sendMessage`, and dispatch message events. Assert:

```js
test("announces the legacy extension version and bridge revision", async () => {
  assert.deepEqual(posted[0], {
    source: "web-agents-roundtable-bridge",
    direction: "extension-to-page",
    type: "bridge:ready",
    extensionVersion: "0.6.8",
    bridgeRevision: "legacy-sidecar-v1",
  });
});

test("ignores a message from another origin", async () => {
  dispatch({ origin: "http://127.0.0.1:3021", data: validEnvelope });
  assert.equal(sendMessageCalls.length, 0);
});
```

- [ ] **Step 2: Run the page-bridge tests and verify failure**

Run: `node --test scripts/web-agent-roundtable-page-bridge.test.mjs`

Expected: FAIL because the bridge script does not exist.

- [ ] **Step 3: Implement the page bridge**

Implement these exact guards before forwarding:

```js
const protocol = globalThis.__webAgentRoundtableProtocol;
const targetOrigin = globalThis.location?.origin || "";

function postToPage(payload) {
  globalThis.postMessage({
    source: protocol.SOURCE,
    direction: "extension-to-page",
    ...payload,
  }, targetOrigin);
}

if (protocol?.isTrustedRoundtableOrigin(targetOrigin)) {
  globalThis.addEventListener("message", (event) => {
    const envelope = event.data;
    if (event.source !== globalThis || event.origin !== targetOrigin) return;
    if (!envelope || envelope.source !== protocol.SOURCE || envelope.direction !== "page-to-extension") return;
    if (typeof envelope.requestId !== "string") return;
    if (envelope.request?.type === "bridge:ping") {
      postToPage({
        type: "bridge:response",
        requestId: envelope.requestId,
        response: { ok: true, type: "bridge:ping", data: {
          extensionVersion: chrome.runtime.getManifest().version,
          bridgeRevision: protocol.BRIDGE_REVISION,
        } },
      });
      return;
    }
    let request;
    try { request = protocol.validateRoundtableRequest(envelope.request); }
    catch (error) {
      postToPage({ type: "bridge:response", requestId: envelope.requestId,
        response: { ok: false, type: envelope.request?.type || "unknown", error: String(error.message || error) } });
      return;
    }
    void chrome.runtime.sendMessage(request).then((response) => {
      postToPage({ type: "bridge:response", requestId: envelope.requestId,
        response: protocol.sanitizeBridgeValue(response) });
    });
  });
  postToPage({ type: "bridge:ready", extensionVersion: chrome.runtime.getManifest().version,
    bridgeRevision: protocol.BRIDGE_REVISION });
}
```

- [ ] **Step 4: Run page-bridge and protocol tests**

Run:

```powershell
node --test scripts/web-agent-roundtable-protocol.test.mjs scripts/web-agent-roundtable-page-bridge.test.mjs
```

Expected: PASS with no message forwarded from an untrusted origin.

- [ ] **Step 5: Commit the local bridge**

```powershell
git add extensions/mcp-superassistant-local-fixed/content/roundtable-page-bridge.js scripts/web-agent-roundtable-page-bridge.test.mjs
git commit -m "feat: bridge local roundtable page to legacy extension"
```

---

### Task 3: Provider Content Sidecar

**Files:**
- Create: `extensions/mcp-superassistant-local-fixed/content/roundtable-content-bridge.js`
- Create: `scripts/web-agent-roundtable-content-bridge.test.mjs`

- [ ] **Step 1: Write failing adapter-delegation tests**

Cover the existing adapter API and fail-closed behavior:

```js
test("delegates insertion and submission to the active legacy adapter", async () => {
  const calls = [];
  const adapter = {
    async insertText(text) { calls.push(["insert", text]); return true; },
    async submitForm() { calls.push(["submit"]); return true; },
  };
  const result = await bridge.autoSendText({ adapter, text: "roundtable prompt", documentRef });
  assert.deepEqual(calls, [["insert", "roundtable prompt"], ["submit"]]);
  assert.equal(result.state, "sent");
});

test("never overwrites a user draft", async () => {
  documentRef.body.innerHTML = '<textarea style="width:200px;height:40px">draft</textarea>';
  const result = await bridge.autoSendText({ adapter, text: "roundtable prompt", documentRef });
  assert.equal(result.state, "input_busy");
  assert.equal(documentRef.querySelector("textarea").value, "draft");
});

test("captures only a verified assistant message", () => {
  documentRef.body.innerHTML = `
    <div data-message-author-role="user" style="width:200px;height:40px">user prompt</div>
    <div data-message-author-role="assistant" style="width:200px;height:40px">assistant answer</div>`;
  const result = bridge.captureLatest(documentRef, "chatgpt");
  assert.equal(result.speaker, "assistant");
  assert.equal(result.text, "assistant answer");
});
```

Add DeepSeek and Doubao fixtures using these assistant selectors:

```text
DeepSeek: .ds-markdown.ds-assistant-message-main-content
Doubao: [data-testid='message-assistant'], .flow-markdown-body, [class*='answer-content']
```

Include a valid JSONL tool example under a user node and assert that this sidecar exports no tool parser and sends no runtime MCP message.

- [ ] **Step 2: Run the content-sidecar tests and verify failure**

Run: `node --test scripts/web-agent-roundtable-content-bridge.test.mjs`

Expected: FAIL because the sidecar does not exist.

- [ ] **Step 3: Implement adapter resolution and guarded auto-send**

The implementation must use the legacy adapter and never click provider DOM controls itself:

```js
function getActiveLegacyAdapter(windowRef = globalThis) {
  const current = typeof windowRef.getCurrentAdapter === "function" ? windowRef.getCurrentAdapter() : null;
  return current?.instance || current?.plugin || current || windowRef.mcpAdapter || null;
}

function readComposerDraft(documentRef) {
  const candidate = documentRef.querySelector(
    "#prompt-textarea, textarea:not([readonly]):not([disabled]), [role='textbox'][contenteditable='true']",
  );
  if (!candidate) return { found: false, text: "" };
  const text = "value" in candidate ? candidate.value : candidate.innerText || candidate.textContent || "";
  return { found: true, text: String(text).trim() };
}

async function insertWithAdapter(adapter, text) {
  const insert = adapter?.insertText || adapter?.insertTextIntoInput;
  if (typeof insert !== "function") return false;
  return (await insert.call(adapter, text)) !== false;
}

async function autoSendText({ adapter, text, documentRef }) {
  const draft = readComposerDraft(documentRef);
  if (!draft.found) return { state: "no_input", message: "未找到可用输入框。" };
  if (draft.text) return { state: "input_busy", message: "输入框已有用户草稿，未执行圆桌发送。" };
  if (!(await insertWithAdapter(adapter, text))) return { state: "no_input", message: "旧插件 adapter 插入失败。" };
  if (typeof adapter?.submitForm !== "function" || (await adapter.submitForm()) === false) {
    return { state: "no_submit", message: "旧插件 adapter 提交失败。" };
  }
  return { state: "sent", message: "已通过旧插件 adapter 发送。" };
}
```

- [ ] **Step 4: Implement assistant-only capture**

Use provider-specific selectors, deduplicate nested matches, sort in DOM order, and require `speaker: "assistant"`. Return `null` when the role is user or unknown. The message listener must handle only `tab:detect`, `tab:insert-text`, `tab:auto-send-text`, `tab:capture-latest`, and `tab:capture-recent`.

```js
if (message.type === "tab:capture-latest") {
  const snapshot = captureLatest(document, providerId);
  sendResponse(snapshot
    ? { ok: true, type: message.type, data: snapshot }
    : { ok: false, type: message.type, error: "暂未找到新的 assistant 回复。" });
  return false;
}
```

- [ ] **Step 5: Run content-sidecar tests**

Run: `node --test scripts/web-agent-roundtable-content-bridge.test.mjs`

Expected: PASS for ChatGPT fixtures, DeepSeek fixtures, Doubao fixtures, user draft protection, and JSONL non-execution.

- [ ] **Step 6: Commit the provider sidecar**

```powershell
git add extensions/mcp-superassistant-local-fixed/content/roundtable-content-bridge.js scripts/web-agent-roundtable-content-bridge.test.mjs
git commit -m "feat: delegate roundtable turns to legacy adapters"
```

---

### Task 4: Background Tab Router and Auth Probes

**Files:**
- Create: `extensions/mcp-superassistant-local-fixed/roundtable/background-core.js`
- Create: `extensions/mcp-superassistant-local-fixed/roundtable-background.js`
- Create: `scripts/web-agent-roundtable-background.test.mjs`
- Modify: `extensions/mcp-superassistant-local-fixed/background.js:1`

- [ ] **Step 1: Write failing background-core tests**

Test provider URL matching, URL sanitization, tab scoring, exact-tab preservation, and secret-free auth results:

```js
test("keeps the current ready tab instead of drifting to another conversation", () => {
  const selected = core.chooseProviderTab([
    { tabId: 10, provider: "deepseek", ready: true },
    { tabId: 11, provider: "deepseek", ready: true },
  ], 10);
  assert.equal(selected.tabId, 10);
});

test("sanitizes provider URLs", () => {
  assert.equal(
    core.sanitizeProviderUrl("https://chat.deepseek.com/a?token=secret#x"),
    "https://chat.deepseek.com/a",
  );
});
```

- [ ] **Step 2: Run background tests and verify failure**

Run: `node --test scripts/web-agent-roundtable-background.test.mjs`

Expected: FAIL because the background modules do not exist.

- [ ] **Step 3: Implement pure background helpers**

Export these complete helpers from `background-core.js`. The auth probe is deliberately self-contained so the same exported function can be passed directly to `chrome.scripting.executeScript({ world: "MAIN" })` without closing over module state:

```js
const PROVIDER_HOSTS = Object.freeze({
  chatgpt: ["chatgpt.com", "chat.openai.com"],
  deepseek: ["chat.deepseek.com"],
  doubao: ["doubao.com"],
});

const SAFE_REASONS = new Set([
  "authenticated", "login_required", "token_missing", "probe_failed",
  "unsupported_provider", "human_verification_required", "adapter_not_ready",
  "provider_url_mismatch",
]);

export function providerIdForUrl(value) {
  try {
    const hostname = new URL(String(value)).hostname.toLowerCase();
    for (const [provider, hosts] of Object.entries(PROVIDER_HOSTS)) {
      if (hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return provider;
    }
  } catch {}
  return null;
}

export function sanitizeProviderUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || !providerIdForUrl(url.href)) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function chooseProviderTab(tabs, currentTabId = null) {
  const candidates = (Array.isArray(tabs) ? tabs : []).filter((tab) => tab && tab.ready !== false);
  const current = candidates.find((tab) => Number(tab.tabId ?? tab.id) === Number(currentTabId));
  if (current) return current;
  return candidates.toSorted((left, right) => {
    const score = (tab) => Number(tab.authenticated === true) * 4
      + Number(tab.ready === true) * 2
      + Number(tab.active === true);
    return score(right) - score(left) || Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0)
      || Number(left.tabId ?? left.id) - Number(right.tabId ?? right.id);
  })[0] || null;
}

export function sanitizeDetectedStatus(status, tab) {
  const urlProvider = providerIdForUrl(tab?.url);
  const reportedProvider = typeof status?.provider === "string" ? status.provider : urlProvider;
  const providerMatches = Boolean(urlProvider && reportedProvider === urlProvider);
  const rawReason = typeof status?.reason === "string" ? status.reason : "adapter_not_ready";
  return {
    tabId: Number.isInteger(tab?.id) ? tab.id : null,
    provider: urlProvider,
    url: sanitizeProviderUrl(tab?.url),
    authenticated: providerMatches && status?.authenticated === true,
    ready: providerMatches && status?.ready === true,
    verificationRequired: status?.verificationRequired === true,
    reason: providerMatches && SAFE_REASONS.has(rawReason) ? rawReason : "provider_url_mismatch",
  };
}

export async function runProviderAuthProbe(requestedProvider) {
  const provider = ["chatgpt", "deepseek", "doubao"].includes(requestedProvider)
    ? requestedProvider
    : "unknown";
  const result = (authenticated, reason, verificationRequired = false) => ({
    provider,
    authenticated,
    reason,
    verificationRequired,
  });
  const challengeSelector = [
    "iframe[src*='captcha']", "iframe[src*='challenge']", "[class*='captcha']",
    "[id*='captcha']", "[data-testid*='captcha']",
  ].join(",");
  const bodyText = String(document.body?.innerText || "").slice(0, 4_000).toLowerCase();
  if (document.querySelector(challengeSelector)
      || /captcha|verify you are human|人机验证|安全验证/.test(bodyText)) {
    return result(false, "human_verification_required", true);
  }

  try {
    if (provider === "chatgpt") {
      const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
      if (!response.ok) return result(false, [401, 403].includes(response.status) ? "login_required" : "probe_failed");
      const payload = await response.json().catch(() => null);
      return result(Boolean(payload?.user), payload?.user ? "authenticated" : "login_required");
    }

    if (provider === "deepseek") {
      const raw = localStorage.getItem("userToken");
      let token = "";
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          token = typeof parsed === "string" ? parsed
            : typeof parsed?.value === "string" ? parsed.value : "";
        } catch {
          token = raw;
        }
      }
      if (!token) return result(false, "token_missing");
      const response = await fetch("/api/v0/users/current", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return result(false, [401, 403].includes(response.status) ? "login_required" : "probe_failed");
      const payload = await response.json().catch(() => null);
      const authenticated = payload?.code === 0 && Boolean(payload.data);
      return result(authenticated, authenticated ? "authenticated" : "login_required");
    }

    if (provider === "doubao") {
      const accountResponse = await fetch("/passport/account/info/v2/", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (accountResponse.ok) {
        const account = await accountResponse.json().catch(() => null);
        if (account?.data?.user_id_str) return result(true, "authenticated");
      }
      const profileResponse = await fetch("/alice/profile/self", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          "agw-js-conv": "str",
        },
        body: JSON.stringify({ visit_id: "", avatar_format: "png" }),
      });
      if (!profileResponse.ok) {
        const unauthorized = [accountResponse.status, profileResponse.status]
          .some((status) => status === 401 || status === 403);
        return result(false, unauthorized ? "login_required" : "probe_failed");
      }
      const profile = await profileResponse.json().catch(() => null);
      const authenticated = profile?.code === 0 && Boolean(profile.data?.profile_brief?.id);
      return result(authenticated, authenticated ? "authenticated" : "login_required");
    }
    return result(false, "unsupported_provider");
  } catch {
    return result(false, "probe_failed");
  }
}
```

Tests must assert that these helpers never return response bodies, user objects, tokens, cookies, account fields, query strings, or hashes.

- [ ] **Step 4: Implement the Chrome router**

`roundtable-background.js` must register a separate listener that ignores old plugin messages and handles only the protocol allowlist. Route exact `tabId` commands with `chrome.tabs.sendMessage`; use `chrome.scripting.executeScript({ world: "MAIN" })` for auth probes.

The router response contract is:

```js
{ ok: true, type: request.type, data }
// or
{ ok: false, type: request.type, error: sanitizedMessage }
```

Do not store command payloads in `chrome.storage`.

- [ ] **Step 5: Import the sidecar without modifying the legacy bundle body**

Add exactly one first-line import to `background.js`:

```js
import "./roundtable-background.js";
```

No other generated legacy background lines may change.

- [ ] **Step 6: Run background and source-integrity tests**

Add a test that removes the first import line and compares the remaining `background.js` bytes to the pre-task baseline hash recorded in the test fixture. Run:

```powershell
node --test scripts/web-agent-roundtable-background.test.mjs scripts/web-agent-background-permission.test.mjs
```

Expected: PASS; old permission handlers remain present.

- [ ] **Step 7: Commit the background router**

```powershell
git add extensions/mcp-superassistant-local-fixed/background.js extensions/mcp-superassistant-local-fixed/roundtable-background.js extensions/mcp-superassistant-local-fixed/roundtable/background-core.js scripts/web-agent-roundtable-background.test.mjs
git commit -m "feat: route roundtable commands through legacy extension"
```

---

### Task 5: Legacy Manifest Integration

**Files:**
- Modify: `extensions/mcp-superassistant-local-fixed/manifest.json`
- Create: `scripts/web-agent-roundtable-manifest.test.mjs`
- Modify: `extensions/mcp-superassistant-local-fixed/README.md`

- [ ] **Step 1: Write failing manifest assertions**

Assert:

```js
assert.equal(manifest.version, "0.6.8");
assert.ok(manifest.permissions.includes("tabs"));
assert.ok(manifest.permissions.includes("scripting"));
assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
assert.ok(manifest.host_permissions.includes("http://localhost/*"));
assert.equal(localBridge.js.join(","), "content/roundtable-protocol.js,content/roundtable-page-bridge.js");
assert.equal(providerBridge.js.at(-1), "content/roundtable-content-bridge.js");
```

Also assert no manifest entry loads files from `extensions/web-agents-extension`.

- [ ] **Step 2: Run the manifest test and verify failure**

Run: `node --test scripts/web-agent-roundtable-manifest.test.mjs`

Expected: FAIL on missing permissions, bridge scripts, and version.

- [ ] **Step 3: Update the manifest**

Make these exact changes:

```json
{
  "version": "0.6.8",
  "permissions": ["storage", "clipboardWrite", "tabs", "scripting"],
  "host_permissions": [
    "http://127.0.0.1/*",
    "http://localhost/*"
  ]
}
```

Append a localhost content script entry for protocol + page bridge. Append a provider content script entry for ChatGPT, DeepSeek, and Doubao with protocol + content bridge, placed after the existing `index.iife.js` entries.

- [ ] **Step 4: Update the legacy README**

Document:

```text
唯一扩展加载路径：F:\web_agents\extensions\mcp-superassistant-local-fixed
圆桌地址：http://127.0.0.1:3020
不要同时启用 extensions\web-agents-extension\dist
旧侧栏和手动 MCP 模式保持可独立使用
```

- [ ] **Step 5: Run manifest and legacy regression tests**

Run:

```powershell
node --test scripts/web-agent-roundtable-manifest.test.mjs scripts/web-agent-insert-fallback.test.mjs scripts/web-agent-result-enhancer.test.mjs scripts/web-agent-background-permission.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit manifest integration**

```powershell
git add extensions/mcp-superassistant-local-fixed/manifest.json extensions/mcp-superassistant-local-fixed/README.md scripts/web-agent-roundtable-manifest.test.mjs
git commit -m "feat: package roundtable sidecars in legacy extension"
```

---

### Task 6: Bridge Revision Through the Server Relay

**Files:**
- Modify: `apps/roundtable-web/automation/extension-relay.mjs`
- Modify: `apps/roundtable-web/automation/extension-relay.test.mjs`
- Modify: `apps/roundtable-web/server.mjs`
- Modify: `apps/roundtable-web/server-runtime.test.mjs`
- Modify: `apps/roundtable-web/public/app.js`

- [ ] **Step 1: Write failing relay metadata tests**

```js
relay.register("legacy-client-123", {
  available: true,
  extensionVersion: "0.6.8",
  bridgeRevision: "legacy-sidecar-v1",
});
const [client] = relay.status().clients;
assert.equal(client.extensionVersion, "0.6.8");
assert.equal(client.bridgeRevision, "legacy-sidecar-v1");
assert.equal(Object.hasOwn(client, "token"), false);
assert.equal(Object.hasOwn(client, "cookie"), false);
```

- [ ] **Step 2: Run relay tests and verify failure**

Run: `node --test apps/roundtable-web/automation/extension-relay.test.mjs`

Expected: FAIL because `bridgeRevision` is discarded.

- [ ] **Step 3: Store bounded revision metadata**

Add `bridgeRevision` to register, heartbeat, and `clientStatus`, bounded to 80 characters:

```js
bridgeRevision: bridgeRevision ? String(bridgeRevision).slice(0, 80) : null,
```

Do not use revision values to authorize requests; they are diagnostics only.

- [ ] **Step 4: Pass revision through HTTP register and heartbeat**

In `server.mjs`, add `bridgeRevision: payload.bridgeRevision` to both relay calls. In `public/app.js`, add `revision` state, consume it from `bridge:ready`/`bridge:ping`, and include it in register/heartbeat bodies.

- [ ] **Step 5: Run relay and runtime tests**

Run:

```powershell
node --test apps/roundtable-web/automation/extension-relay.test.mjs apps/roundtable-web/server-runtime.test.mjs
```

Expected: PASS; `/api/health` reports `0.6.8` and `legacy-sidecar-v1` without secrets.

- [ ] **Step 6: Commit revision metadata**

```powershell
git add apps/roundtable-web/automation/extension-relay.mjs apps/roundtable-web/automation/extension-relay.test.mjs apps/roundtable-web/server.mjs apps/roundtable-web/server-runtime.test.mjs apps/roundtable-web/public/app.js
git commit -m "feat: expose legacy roundtable bridge revision"
```

---

### Task 7: Non-Executable Prompt Header

**Files:**
- Modify: `apps/roundtable-web/orchestrator/prompt-header.mjs`
- Modify: `apps/roundtable-web/orchestrator/prompt-header.test.mjs`

- [ ] **Step 1: Replace the old positive JSONL assertion with a failing safety assertion**

The test must prove the user prompt does not contain a complete executable call:

```js
test("fixed prompt header describes JSONL without embedding an executable call", () => {
  const header = buildWebAgentPromptHeader({ provider: "deepseek", providerLabel: "DeepSeek" });
  assert.match(header, /function_call_start/);
  assert.match(header, /parameter.*key.*value/);
  assert.match(header, /function_call_end/);
  assert.doesNotMatch(header, /\{"type":"function_call_start"/);
  assert.doesNotMatch(header, /```jsonl[\s\S]*function_call_end[\s\S]*```/);
  assert.match(header, /list_allowed_directories/);
  assert.match(header, /fixed-io-encoding/);
});
```

- [ ] **Step 2: Run the prompt tests and verify failure**

Run: `node --test apps/roundtable-web/orchestrator/prompt-header.test.mjs`

Expected: FAIL because the current header embeds a valid JSONL call.

- [ ] **Step 3: Replace the executable example with field instructions**

Use this text, without JSON braces or a completed call sequence:

```text
工具调用由多行 JSONL 事件组成，事件顺序为：
1. function_call_start：包含工具 name 和唯一 call_id。
2. 可选 description：说明本次操作。
3. parameter：每个参数分别提供 key 和 value。
4. function_call_end：使用同一个 call_id 结束。
```

Keep the tool-name list, reverse-engineering constraints, and UTF-8 skill unchanged.

- [ ] **Step 4: Run prompt and context tests**

Run:

```powershell
node --test apps/roundtable-web/orchestrator/prompt-header.test.mjs apps/roundtable-web/orchestrator/orchestrator.test.mjs
```

Expected: PASS; fixed header still precedes task and untrusted history.

- [ ] **Step 5: Commit prompt hardening**

```powershell
git add apps/roundtable-web/orchestrator/prompt-header.mjs apps/roundtable-web/orchestrator/prompt-header.test.mjs
git commit -m "fix: remove executable tool call from roundtable prompts"
```

---

### Task 8: UI Labels and Single-Runtime Documentation

**Files:**
- Modify: `apps/roundtable-web/public/index.html`
- Modify: `apps/roundtable-web/public/app.js`
- Modify: `docs/web-agents-development-plan.md`
- Modify: `docs/product-unification-roadmap.md`

- [ ] **Step 1: Add a failing static UI assertion**

Extend `apps/roundtable-web/server.test.mjs` or create a focused static test asserting:

```js
assert.match(indexHtml, /原 Chrome \+ web_Agent/);
assert.doesNotMatch(indexHtml, /原 Chrome \+ 插件/);
assert.match(appJs, /legacy-sidecar-v1/);
```

- [ ] **Step 2: Run the static test and verify failure**

Run: `node --test apps/roundtable-web/server.test.mjs`

Expected: FAIL on the old execution-mode label.

- [ ] **Step 3: Update visible runtime labels**

Use these user-facing labels:

```text
模式：原 Chrome + web_Agent
连接：web_Agent 0.6.8 · 桥接 legacy-sidecar-v1
未连接：未检测到旧插件圆桌桥
```

Do not add tutorial copy to the main workspace.

- [ ] **Step 4: Update architecture documentation**

Mark `extensions/mcp-superassistant-local-fixed` as the MVP runtime and `extensions/web-agents-extension` as an inactive rewrite experiment. Remove instructions telling users to load `web-agents-extension/dist` for the MVP.

- [ ] **Step 5: Run UI static and server tests**

Run: `node --test apps/roundtable-web/server.test.mjs apps/roundtable-web/server-runtime.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit UI and docs**

```powershell
git add apps/roundtable-web/public/index.html apps/roundtable-web/public/app.js apps/roundtable-web/server.test.mjs docs/web-agents-development-plan.md docs/product-unification-roadmap.md
git commit -m "docs: make legacy web agent the roundtable runtime"
```

---

### Task 9: Verification Command Integration

**Files:**
- Modify: `package.json`
- Modify: `.adworkflow/verification_commands.md`

- [ ] **Step 1: Add the legacy test script**

Add:

```json
"test:legacy-roundtable-extension": "node --test scripts/web-agent-roundtable-protocol.test.mjs scripts/web-agent-roundtable-page-bridge.test.mjs scripts/web-agent-roundtable-content-bridge.test.mjs scripts/web-agent-roundtable-background.test.mjs scripts/web-agent-roundtable-manifest.test.mjs scripts/web-agent-insert-fallback.test.mjs scripts/web-agent-result-enhancer.test.mjs scripts/web-agent-background-permission.test.mjs"
```

Insert `npm run test:legacy-roundtable-extension` into `test:local-runtime` before the rewrite extension test.

- [ ] **Step 2: Run the new script**

Run: `npm run test:legacy-roundtable-extension`

Expected: all legacy bridge and old-plugin regression tests PASS.

- [ ] **Step 3: Update ADworkflo verification commands**

Record the exact automated command and the manual constraint:

```text
Live provider testing defaults to fresh DeepSeek and Doubao conversations.
Do not operate ChatGPT unless the user explicitly authorizes that exact test.
```

- [ ] **Step 4: Run the full local suite**

Run: `npm run test:local-runtime`

Expected: all config, legacy extension, rewrite extension, roundtable, browser, council, and launcher tests PASS.

- [ ] **Step 5: Commit verification integration**

```powershell
git add package.json .adworkflow/verification_commands.md
git commit -m "test: add legacy roundtable bridge verification"
```

---

### Task 10: Automated Roundtable Relay Acceptance

**Files:**
- Modify: `apps/roundtable-web/server-runtime.test.mjs`
- Modify: `apps/roundtable-web/automation/extension-worker.test.mjs`

- [ ] **Step 1: Add a legacy-runtime scheduler fixture**

Register a fake client as:

```js
{
  clientId: "legacy-roundtable-e2e",
  available: true,
  extensionVersion: "0.6.8",
  bridgeRevision: "legacy-sidecar-v1",
}
```

Return `speaker: "assistant"` for capture and verify a real scheduler turn reaches `completed` and writes one reply event.

- [ ] **Step 2: Add a fail-closed unknown-speaker fixture**

Return a stable `speaker: "unknown"` capture containing the entire prompt plus UI suffix. Assert `PROVIDER_RESPONSE_TIMEOUT` rather than completion.

- [ ] **Step 3: Run relay acceptance tests**

Run:

```powershell
node --test apps/roundtable-web/server-runtime.test.mjs apps/roundtable-web/automation/extension-worker.test.mjs
```

Expected: legacy assistant fixture completes; unknown/user fixtures never persist as replies.

- [ ] **Step 4: Commit relay acceptance coverage**

```powershell
git add apps/roundtable-web/server-runtime.test.mjs apps/roundtable-web/automation/extension-worker.test.mjs
git commit -m "test: verify legacy extension scheduler relay"
```

---

### Task 11: Real Chrome Acceptance and ADworkflo Finalization

**Files:**
- Modify: `.adworkflow/worker_state.json`
- Modify: `.adworkflow/verification_result.json`
- Modify: `.adworkflow/review_findings.json`
- Modify: `.adworkflow/impact_report.json`

- [ ] **Step 1: Start the verified local service**

Run:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-web-agents-roundtable.ps1 -Restart -NoOpen -BrowserMode extension
```

Expected: `http://127.0.0.1:3020/api/health` reports the verified roundtable service.

- [ ] **Step 2: Ask the user to load only the legacy extension**

Required path:

```text
F:\web_agents\extensions\mcp-superassistant-local-fixed
```

The user manually disables the rewrite extension, reloads the legacy extension, and refreshes only the local roundtable, DeepSeek, and Doubao tabs.

- [ ] **Step 3: Verify sanitized health state**

Expected values:

```json
{
  "extensionBridgeConnected": true,
  "extensionVersion": "0.6.8",
  "bridgeRevision": "legacy-sidecar-v1",
  "bindings": ["deepseek", "doubao"]
}
```

Do not inspect cookies, tokens, localStorage, account identity, or auth response bodies.

- [ ] **Step 4: Run a harmless DeepSeek direct turn**

Use a fresh dedicated conversation and a short arithmetic prompt. Expected: auto-send succeeds, the persisted reply is `speaker: assistant`, and no fixed-header text appears as the reply.

- [ ] **Step 5: Run a harmless Doubao direct turn**

Use a fresh dedicated conversation. Expected: same assistant-only capture and local persistence guarantees.

- [ ] **Step 6: Run one-round discussion and relay checks**

Use only DeepSeek and Doubao. Confirm discussion participants share the same pre-round snapshot. Switch to relay mode, set one provider as host, and confirm the route returns to the host for final summary.

- [ ] **Step 7: Verify the legacy MCP path**

Run one read-only tool call. Then use a temporary file under `F:\web_agents\generated\roundtable-data\acceptance` for permission/write/rollback. Confirm only the legacy tool card and permission UI execute the operation.

- [ ] **Step 8: Verify manual mode regression**

Close or disconnect the roundtable page. Confirm the legacy sidebar, instruction insertion, manual tool execution, result card, and permission controls still work independently.

- [ ] **Step 9: Inspect UI and console health**

Use the Chrome Browser tooling on desktop `1280x720` and mobile `390x844` for the local roundtable only. Verify no framework overlay, no relevant console errors, no overflow, and no overlapping controls.

- [ ] **Step 10: Update ADworkflo evidence**

Record exact commands, test counts, extension version/revision, provider checks, local persistence path, and residual risks. Do not claim ChatGPT live coverage.

- [ ] **Step 11: Commit final evidence**

```powershell
git add .adworkflow/worker_state.json .adworkflow/verification_result.json .adworkflow/review_findings.json .adworkflow/impact_report.json
git commit -m "chore: record legacy roundtable acceptance"
```

---

## Final Verification

- [ ] Run `git diff --check`.
- [ ] Run `npm run test:legacy-roundtable-extension`.
- [ ] Run `npm run test:local-runtime`.
- [ ] Confirm `git status --short` contains no accidentally staged unrelated files.
- [ ] Confirm only `mcp-superassistant-local-fixed` is enabled for MVP live testing.
- [ ] Confirm no ChatGPT tab was operated during acceptance.
- [ ] Confirm `/api/health` exposes no secret-bearing fields or URLs.
- [ ] Confirm the legacy manual workflow remains usable with the roundtable page closed.
