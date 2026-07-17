(function initRoundtableContentBridge(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.__webAgentRoundtableContentBridge = api;
    api.installMessageListener(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createRoundtableContentBridge() {
  "use strict";

  const COMPOSER_SELECTOR = "#prompt-textarea, textarea:not([readonly]):not([disabled]), [role='textbox'][contenteditable='true']";
  const PROVIDER_COMPOSER_SELECTORS = Object.freeze({
    chatgpt: Object.freeze(["#prompt-textarea"]),
    deepseek: Object.freeze([
      'textarea[spellcheck="false"]',
      'textarea[data-gramm="false"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Message DeepSeek"]',
      'textarea[placeholder*="发送"]',
      "textarea.chat-input",
      'textarea[placeholder*="DeepSeek"]',
      '.ds-scroll-area textarea:not([readonly]):not([disabled])',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
    ]),
    doubao: Object.freeze([
      'textarea[data-testid*="chat"]',
      'textarea[placeholder*="发消息"]',
      'textarea[placeholder*="发送"]',
      '[data-placeholder*="发消息"][contenteditable="true"]',
      '[aria-label*="发消息"][contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
    ]),
  });
  const CONTENT_MESSAGE_TYPES = new Set([
    "tab:detect",
    "tab:insert-text",
    "tab:auto-send-text",
    "tab:capture-latest",
    "tab:capture-recent",
  ]);
  const PROVIDERS = Object.freeze({
    chatgpt: Object.freeze({
      label: "ChatGPT",
      hostnames: Object.freeze(["chatgpt.com", "chat.openai.com"]),
      assistantSelectors: Object.freeze([
        "[data-message-author-role='assistant']",
      ]),
    }),
    deepseek: Object.freeze({
      label: "DeepSeek",
      hostnames: Object.freeze(["chat.deepseek.com"]),
      assistantSelectors: Object.freeze([
        ".ds-markdown.ds-assistant-message-main-content",
      ]),
    }),
    doubao: Object.freeze({
      label: "豆包",
      hostnames: Object.freeze(["www.doubao.com", "doubao.com"]),
      assistantSelectors: Object.freeze([
        "[data-testid='message-assistant']",
        ".flow-markdown-body",
        "[class*='answer-content']",
      ]),
    }),
  });

  function unwrapLegacyAdapter(value) {
    return value?.instance || value?.plugin || value || null;
  }

  function resolveActiveLegacyAdapter(windowRef = globalThis) {
    const candidates = [];
    try {
      const registry = windowRef.pluginRegistry;
      if (typeof registry?.getActivePlugin === "function") {
        candidates.push({ source: "plugin_registry", adapter: unwrapLegacyAdapter(registry.getActivePlugin()) });
      }
    } catch {}

    try {
      if (typeof windowRef.getCurrentAdapter === "function") {
        candidates.push({ source: "current_adapter", adapter: unwrapLegacyAdapter(windowRef.getCurrentAdapter()) });
      }
    } catch {}
    candidates.push({ source: "mcp_adapter", adapter: unwrapLegacyAdapter(windowRef.mcpAdapter) });

    const available = candidates.filter(({ adapter }) => Boolean(adapter));
    return available.find(({ adapter }) => adapterCanInsert(adapter))
      || available[0]
      || { source: "none", adapter: null };
  }

  function getActiveLegacyAdapter(windowRef = globalThis) {
    return resolveActiveLegacyAdapter(windowRef).adapter;
  }

  function settleActivation(promise, timeoutMs, windowRef) {
    const schedule = windowRef?.setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
    const cancel = windowRef?.clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : null);
    if (!schedule) {
      return Promise.resolve(promise).then(() => "completed", () => "failed");
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (state, timer) => {
        if (settled) return;
        settled = true;
        if (timer !== null && cancel) cancel(timer);
        resolve(state);
      };
      const timer = schedule(() => finish("timed_out", null), timeoutMs);
      Promise.resolve(promise).then(
        () => finish("completed", timer),
        () => finish("failed", timer),
      );
    });
  }

  async function ensureActiveLegacyAdapter(windowRef = globalThis, { activationTimeoutMs = 5000 } = {}) {
    let resolved = resolveActiveLegacyAdapter(windowRef);
    if (adapterCanInsert(resolved.adapter)) {
      return { ...resolved, activationState: "not_needed" };
    }

    const registry = windowRef.pluginRegistry;
    if (typeof registry?.activatePluginForHostname !== "function") {
      return { ...resolved, activationState: "unsupported" };
    }

    let activation;
    try {
      activation = registry.activatePluginForHostname(String(windowRef.location?.hostname || ""));
    } catch {
      return { ...resolved, activationState: "failed" };
    }
    const settled = await settleActivation(activation, activationTimeoutMs, windowRef);
    resolved = resolveActiveLegacyAdapter(windowRef);
    if (adapterCanInsert(resolved.adapter)) {
      return { ...resolved, activationState: "succeeded" };
    }
    return {
      ...resolved,
      activationState: settled === "timed_out" ? "timed_out" : settled === "failed" ? "failed" : "ineffective",
    };
  }

  function detectProviderId(windowRef = globalThis) {
    const hostname = String(windowRef.location?.hostname || "").toLowerCase();
    for (const [providerId, provider] of Object.entries(PROVIDERS)) {
      if (provider.hostnames.includes(hostname)) return providerId;
    }
    return "unknown";
  }

  function isLegacyPluginUi(candidate) {
    try {
      return Boolean(candidate?.closest?.([
        "#mcp-popover-container",
        "#mcp-sidebar-container",
        "[id^='mcp-']",
        "[class*='mcp-sidebar']",
        "[class*='mcp-super-assistant']",
      ].join(",")));
    } catch {
      return true;
    }
  }

  function isUsableComposer(candidate) {
    if (!candidate || candidate.isConnected === false || candidate.hidden === true) return false;
    if (candidate.disabled === true || candidate.readOnly === true) return false;
    if (String(candidate.getAttribute?.("aria-hidden") || "").toLowerCase() === "true") return false;
    if (String(candidate.getAttribute?.("aria-disabled") || "").toLowerCase() === "true") return false;
    if (isLegacyPluginUi(candidate)) return false;
    if (typeof candidate.getBoundingClientRect === "function") {
      const rect = candidate.getBoundingClientRect();
      if (rect && rect.width === 0 && rect.height === 0) return false;
    }
    return true;
  }

  function queryComposerCandidates(documentRef, selector) {
    let candidates = [];
    try {
      candidates = [...(documentRef?.querySelectorAll?.(selector) || [])];
    } catch {
      candidates = [];
    }
    if (!candidates.length) {
      try {
        const candidate = documentRef?.querySelector?.(selector) || null;
        if (candidate) candidates.push(candidate);
      } catch {
        // Ignore provider DOM selector drift and continue through the safe fallback list.
      }
    }
    return candidates;
  }

  function adapterComposerSelectors(adapter) {
    const selectors = adapter?.selectors?.CHAT_INPUT;
    if (typeof selectors !== "string") return [];
    return selectors.split(",").map((selector) => selector.trim()).filter(Boolean);
  }

  function findComposer(documentRef, providerId = "unknown", adapter = null) {
    if (providerId === "doubao" && typeof adapter?.findDoubaoChatInput === "function") {
      try {
        const candidate = adapter.findDoubaoChatInput.call(adapter);
        if (isUsableComposer(candidate)) return candidate;
      } catch {
        // The legacy adapter finder is an optimization; fixed selectors remain the fallback.
      }
    }

    const selectors = [
      ...adapterComposerSelectors(adapter),
      ...(PROVIDER_COMPOSER_SELECTORS[providerId] || []),
      COMPOSER_SELECTOR,
    ];
    for (const selector of selectors) {
      const candidate = queryComposerCandidates(documentRef, selector).find(isUsableComposer);
      if (candidate) return candidate;
    }
    return null;
  }

  function composerText(candidate) {
    if (!candidate) return "";
    const value = "value" in candidate
      ? candidate.value
      : candidate.innerText || candidate.textContent || "";
    return String(value || "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
  }

  function readComposerDraft(documentRef, providerId = "unknown", adapter = null) {
    const candidate = findComposer(documentRef, providerId, adapter);
    return candidate
      ? { found: true, text: composerText(candidate) }
      : { found: false, text: "" };
  }

  function watchTrustedComposerInput(candidate) {
    let trustedInputObserved = false;
    const onInput = (event) => {
      if (event?.isTrusted === true) trustedInputObserved = true;
    };
    candidate?.addEventListener?.("beforeinput", onInput, true);
    candidate?.addEventListener?.("input", onInput, true);
    return {
      observed: () => trustedInputObserved,
      stop() {
        candidate?.removeEventListener?.("beforeinput", onInput, true);
        candidate?.removeEventListener?.("input", onInput, true);
      },
    };
  }

  function verifyComposerForSubmit({ documentRef, providerId, adapter, candidate, text, watcher }) {
    if (watcher?.observed()) {
      return { ok: false, state: "input_busy", message: "检测到用户同时编辑输入框，圆桌未提交。" };
    }
    if (!isUsableComposer(candidate) || findComposer(documentRef, providerId, adapter) !== candidate) {
      return { ok: false, state: "no_input", message: "输入框在插入过程中发生变化，圆桌未提交。" };
    }
    const expected = composerText({ value: text });
    const actual = composerText(candidate);
    if (actual !== expected) {
      return actual
        ? { ok: false, state: "input_busy", message: "输入框内容发生变化，圆桌未提交。" }
        : { ok: false, state: "no_input", message: "旧插件 adapter 未写入已确认的输入框。" };
    }
    return { ok: true, state: "inserted", message: "已通过旧插件 adapter 插入。" };
  }

  async function insertWithAdapter(adapter, text, targetElement = null) {
    const insert = adapter?.insertText || adapter?.insertTextIntoInput;
    if (typeof insert !== "function") return false;
    try {
      return (await insert.call(adapter, text, targetElement ? { targetElement } : undefined)) !== false;
    } catch {
      return false;
    }
  }

  async function guardedInsertText({ adapter, text, documentRef, providerId }) {
    const candidate = findComposer(documentRef, providerId, adapter);
    if (!candidate) return { ok: false, state: "no_input", message: "未找到可用输入框。" };
    if (composerText(candidate)) {
      return { ok: false, state: "input_busy", message: "输入框已有用户草稿，未执行圆桌插入。" };
    }
    const watcher = watchTrustedComposerInput(candidate);
    if (!(await insertWithAdapter(adapter, text, candidate))) {
      watcher.stop();
      return { ok: false, state: "no_input", message: "旧插件 adapter 插入失败。" };
    }
    const verification = verifyComposerForSubmit({
      documentRef,
      providerId,
      adapter,
      candidate,
      text,
      watcher,
    });
    if (!verification.ok) {
      watcher.stop();
      return verification;
    }
    return { ...verification, candidate, watcher };
  }

  async function autoSendText({ adapter, text, documentRef, providerId }) {
    const insertion = await guardedInsertText({ adapter, text, documentRef, providerId });
    if (!insertion.ok) return { state: insertion.state, message: insertion.message };
    if (typeof adapter?.submitForm !== "function") {
      insertion.watcher.stop();
      return { state: "no_submit", message: "旧插件 adapter 提交失败。" };
    }
    const preSubmit = verifyComposerForSubmit({
      documentRef,
      providerId,
      adapter,
      candidate: insertion.candidate,
      text,
      watcher: insertion.watcher,
    });
    if (!preSubmit.ok) {
      insertion.watcher.stop();
      return { state: preSubmit.state, message: preSubmit.message };
    }
    try {
      const submission = adapter.submitForm.call(adapter, { formElement: insertion.candidate });
      if ((await submission) === false) {
        insertion.watcher.stop();
        return { state: "no_submit", message: "旧插件 adapter 提交失败。" };
      }
    } catch {
      insertion.watcher.stop();
      return { state: "no_submit", message: "旧插件 adapter 提交失败。" };
    }
    insertion.watcher.stop();
    return { state: "sent", message: "已通过旧插件 adapter 发送。" };
  }

  function declaredSpeaker(node) {
    let current = node;
    while (current) {
      const role = String(
        current.getAttribute?.("data-message-author-role")
        || current.getAttribute?.("data-role")
        || "",
      ).toLowerCase();
      if (role) {
        if (role === "assistant" || role === "user") return role;
        return "unknown";
      }

      const testId = String(current.getAttribute?.("data-testid") || "").toLowerCase();
      if (testId.includes("assistant")) return "assistant";
      if (testId.includes("user")) return "user";

      const className = typeof current.className === "string" ? current.className.toLowerCase() : "";
      if (/(?:^|[\s_-])(?:message-user|user-message)(?:$|[\s_-])/.test(className)) return "user";
      if (/(?:^|[\s_-])(?:message-assistant|assistant-message)(?:$|[\s_-])/.test(className)) {
        return "assistant";
      }
      current = current.parentElement || null;
    }
    return null;
  }

  function nodeText(node) {
    const value = typeof node?.innerText === "string" ? node.innerText : node?.textContent || "";
    return String(value).replace(/\u00a0/g, " ").trim();
  }

  function isUsableAssistantNode(node) {
    if (!node || node.isConnected === false || node.hidden === true) return false;
    if (String(node.getAttribute?.("aria-hidden") || "").toLowerCase() === "true") return false;
    const speaker = declaredSpeaker(node);
    return speaker === "assistant" && Boolean(nodeText(node));
  }

  function sortInDocumentOrder(left, right) {
    if (left.node === right.node) return 0;
    if (typeof left.node?.compareDocumentPosition === "function") {
      const position = left.node.compareDocumentPosition(right.node);
      if (position & 4) return -1;
      if (position & 2) return 1;
    }
    return left.discoveryIndex - right.discoveryIndex;
  }

  function collectAssistantNodes(documentRef, providerId) {
    const provider = PROVIDERS[providerId];
    if (!provider || !documentRef?.querySelectorAll) return [];

    const candidates = new Map();
    let discoveryIndex = 0;
    for (const selector of provider.assistantSelectors) {
      let nodes = [];
      try {
        nodes = documentRef.querySelectorAll(selector);
      } catch {
        nodes = [];
      }
      for (const node of nodes) {
        if (!candidates.has(node)) {
          candidates.set(node, { node, selector, discoveryIndex });
          discoveryIndex += 1;
        }
      }
    }

    const usable = [...candidates.values()]
      .filter(({ node }) => isUsableAssistantNode(node));
    const innermost = usable.filter(({ node }) => !usable.some(({ node: other }) => (
      other !== node
      && typeof node.contains === "function"
      && node.contains(other)
    )));
    return innermost.sort(sortInDocumentOrder);
  }

  function captureSource(providerId) {
    return `legacy-sidecar:${providerId}`;
  }

  function captureLatest(documentRef, providerId) {
    const candidates = collectAssistantNodes(documentRef, providerId);
    const latest = candidates.at(-1);
    if (!latest) return null;
    return {
      provider: providerId,
      speaker: "assistant",
      text: nodeText(latest.node),
      capturedAt: new Date().toISOString(),
      source: captureSource(providerId),
    };
  }

  function captureRecent(documentRef, providerId, limit = 20) {
    const effectiveLimit = Number.isInteger(limit) && limit >= 1 && limit <= 80 ? limit : 20;
    const candidates = collectAssistantNodes(documentRef, providerId).slice(-effectiveLimit);
    return {
      provider: PROVIDERS[providerId] ? providerId : "unknown",
      capturedAt: new Date().toISOString(),
      messages: candidates.map(({ node }) => ({
        speaker: "assistant",
        text: nodeText(node),
        source: captureSource(providerId),
      })),
    };
  }

  function adapterCanInsert(adapter) {
    return typeof adapter?.insertText === "function" || typeof adapter?.insertTextIntoInput === "function";
  }

  async function detectContentStatus(windowRef, message, options = {}) {
    const providerId = detectProviderId(windowRef);
    const provider = PROVIDERS[providerId];
    const resolved = await ensureActiveLegacyAdapter(windowRef, options);
    const adapter = resolved.adapter;
    const composer = readComposerDraft(windowRef.document, providerId, adapter);
    const canInsert = Boolean(provider && composer.found && adapterCanInsert(adapter));
    const reason = !provider
      ? "unsupported_provider"
      : !composer.found
        ? "composer_not_found"
        : canInsert
          ? "authenticated"
          : resolved.activationState === "timed_out"
            ? "adapter_activation_timeout"
            : resolved.activationState === "failed"
              ? "adapter_activation_failed"
              : "adapter_not_ready";
    return {
      provider: providerId,
      label: provider?.label || "Unknown",
      readiness: !provider ? "unsupported" : !composer.found ? "no_input" : canInsert ? "supported" : "unknown",
      canInsert,
      reason,
      ...(Number.isInteger(message.tabId) && message.tabId >= 0 ? { tabId: message.tabId } : {}),
      adapterDiagnostics: {
        bridgeState: "ready",
        adapterSource: resolved.source,
        activationState: resolved.activationState,
        sidecarInjected: false,
        composerFound: composer.found,
        adapterPresent: Boolean(adapter),
        hasInsertText: typeof adapter?.insertText === "function",
        hasInsertTextIntoInput: typeof adapter?.insertTextIntoInput === "function",
        hasSubmitForm: typeof adapter?.submitForm === "function",
      },
    };
  }

  function installMessageListener(windowRef = globalThis) {
    const onMessage = windowRef.chrome?.runtime?.onMessage;
    if (
      !windowRef.document
      || typeof onMessage?.addListener !== "function"
      || windowRef.__webAgentRoundtableContentBridgeInstalled
    ) {
      return false;
    }
    windowRef.__webAgentRoundtableContentBridgeInstalled = true;

    onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object" || !CONTENT_MESSAGE_TYPES.has(message.type)) return false;
      const providerId = detectProviderId(windowRef);

      if (message.type === "tab:detect") {
        void detectContentStatus(windowRef, message)
          .then((data) => sendResponse({ ok: true, type: message.type, data }))
          .catch(() => sendResponse({ ok: false, type: message.type, error: "ADAPTER_NOT_READY" }));
        return true;
      }

      if (message.type === "tab:capture-latest") {
        const snapshot = captureLatest(windowRef.document, providerId);
        sendResponse(snapshot
          ? { ok: true, type: message.type, data: snapshot }
          : { ok: false, type: message.type, error: "暂未找到新的 assistant 回复。" });
        return false;
      }

      if (message.type === "tab:capture-recent") {
        sendResponse({
          ok: true,
          type: message.type,
          data: captureRecent(windowRef.document, providerId, message.limit),
        });
        return false;
      }

      if (!PROVIDERS[providerId]) {
        sendResponse({ ok: false, type: message.type, error: "UNSUPPORTED_PROVIDER" });
        return false;
      }
      if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 1_000_000) {
        sendResponse({ ok: false, type: message.type, error: "INVALID_TEXT_PAYLOAD" });
        return false;
      }
      void (async () => {
        const resolved = await ensureActiveLegacyAdapter(windowRef);
        const adapter = resolved.adapter;
        if (!adapterCanInsert(adapter)) {
          sendResponse({ ok: false, type: message.type, error: "ADAPTER_NOT_READY" });
          return;
        }

        if (message.type === "tab:insert-text") {
          const result = await guardedInsertText({
            adapter,
            text: message.text,
            documentRef: windowRef.document,
            providerId,
          });
          result.watcher?.stop?.();
          sendResponse({
            ok: true,
            type: message.type,
            data: { ok: result.ok, provider: providerId, state: result.state, message: result.message },
          });
          return;
        }

        const result = await autoSendText({
          adapter,
          text: message.text,
          documentRef: windowRef.document,
          providerId,
        });
        sendResponse({
          ok: true,
          type: message.type,
          data: { provider: providerId, ...result },
        });
      })().catch(() => {
        sendResponse({ ok: false, type: message.type, error: "ADAPTER_NOT_READY" });
      });
      return true;
    });
    return true;
  }

  return {
    getActiveLegacyAdapter,
    ensureActiveLegacyAdapter,
    detectProviderId,
    detectContentStatus,
    readComposerDraft,
    insertWithAdapter,
    autoSendText,
    captureLatest,
    captureRecent,
    installMessageListener,
  };
});
