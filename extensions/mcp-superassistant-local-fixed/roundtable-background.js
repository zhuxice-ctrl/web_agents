import {
  PROVIDER_IDS,
  SAFE_AUTH_REASONS,
  chooseProviderTab,
  providerIdForUrl,
  runProviderAuthProbe,
  sanitizeDetectedStatus,
  sanitizeProviderUrl,
} from "./roundtable/background-core.js";

const PROVIDER_DEFAULT_URLS = Object.freeze({
  chatgpt: "https://chatgpt.com/",
  deepseek: "https://chat.deepseek.com/",
  doubao: "https://www.doubao.com/chat/",
});

const PROVIDER_LABELS = Object.freeze({
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  doubao: "豆包",
});

const READINESS_STATES = new Set(["supported", "unsupported", "no_input", "unknown"]);
const ADAPTER_BRIDGE_STATES = new Set(["ready", "missing", "timed_out"]);
const ADAPTER_SOURCES = new Set(["plugin_registry", "current_adapter", "mcp_adapter", "none"]);
const ADAPTER_ACTIVATION_STATES = new Set([
  "not_needed",
  "unsupported",
  "succeeded",
  "ineffective",
  "failed",
  "timed_out",
]);
const ROUNDTABLE_CONTENT_SIDECARS = Object.freeze([
  "content/roundtable-protocol.js",
  "content/roundtable-content-bridge.js",
]);
const TRUSTED_ROUNDTABLE_ORIGINS = new Set([
  "http://127.0.0.1:3020",
  "http://localhost:3020",
]);

const ALLOWED_TYPES = new Set([
  "tabs:discover-providers",
  "tabs:open-provider",
  "tabs:probe-provider",
  "tabs:focus-provider",
  "tab:auth-probe",
  "tab:detect",
  "tab:insert-text",
  "tab:auto-send-text",
  "tab:capture-latest",
  "tab:capture-recent",
]);

const CONTENT_TYPES = new Set([
  "tab:detect",
  "tab:insert-text",
  "tab:auto-send-text",
  "tab:capture-latest",
  "tab:capture-recent",
]);

const SAFE_REASON_SET = new Set(SAFE_AUTH_REASONS);
const SECRET_KEY = /^(?:access_?token|refresh_?token|token|cookie|cookies|authorization|session|account|email|user)$/i;
const SECRET_ASSIGNMENT = /\b(access_?token|refresh_?token|token|cookie|authorization|session|account|email|user)\b\s*[:=]\s*[^\s,;]+/gi;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi;

class RoundtableRouterError extends Error {
  constructor(code) {
    super(code);
    this.name = "RoundtableRouterError";
    this.code = code;
  }
}

function requireProvider(value) {
  if (!PROVIDER_IDS.includes(value)) throw new RoundtableRouterError("UNSUPPORTED_PROVIDER");
  return value;
}

function requireTabId(value) {
  if (!Number.isInteger(value) || value < 0) throw new RoundtableRouterError("INVALID_TAB_ID");
  return value;
}

function sanitizeBridgeString(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
      const punctuation = match.match(/[),.;!?]+$/)?.[0] || "";
      const candidate = punctuation ? match.slice(0, -punctuation.length) : match;
      try {
        const url = new URL(candidate);
        if (url.username || url.password) return `[redacted-url]${punctuation}`;
        return `${url.origin}${url.pathname}${punctuation}`;
      } catch {
        return `[redacted-url]${punctuation}`;
      }
    });
}

function sanitizeErrorText(value) {
  return sanitizeBridgeString(value)
    .replace(BEARER_VALUE, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT, "$1=[redacted]")
    .slice(0, 500);
}

function sanitizeBridgeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeBridgeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, item]) => [key, sanitizeBridgeValue(item)]));
  }
  return typeof value === "string" ? sanitizeBridgeString(value) : value;
}

function normalizeRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || !ALLOWED_TYPES.has(request.type)) {
    throw new RoundtableRouterError("ROUND_TABLE_REQUEST_NOT_ALLOWED");
  }

  if (request.type === "tabs:discover-providers") {
    if (request.providers === undefined) return { type: request.type };
    if (!Array.isArray(request.providers) || request.providers.length === 0) {
      throw new RoundtableRouterError("INVALID_PROVIDERS");
    }
    const providers = request.providers.map(requireProvider);
    if (new Set(providers).size !== providers.length) throw new RoundtableRouterError("INVALID_PROVIDERS");
    return { type: request.type, providers };
  }

  if (request.type === "tabs:open-provider") {
    return { type: request.type, provider: requireProvider(request.provider) };
  }

  if (request.type === "tabs:probe-provider") {
    const normalized = { type: request.type, provider: requireProvider(request.provider) };
    if (request.tabId !== undefined) normalized.tabId = requireTabId(request.tabId);
    return normalized;
  }

  if (request.type === "tabs:focus-provider") {
    return { type: request.type, tabId: requireTabId(request.tabId) };
  }

  const normalized = { type: request.type, tabId: requireTabId(request.tabId) };
  if (request.type === "tab:insert-text" || request.type === "tab:auto-send-text") {
    if (typeof request.text !== "string" || !request.text.trim() || request.text.length > 1_000_000) {
      throw new RoundtableRouterError("INVALID_TEXT_PAYLOAD");
    }
    normalized.text = request.text;
  }
  if (request.type === "tab:capture-recent" && request.limit !== undefined) {
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 80) {
      throw new RoundtableRouterError("INVALID_CAPTURE_LIMIT");
    }
    normalized.limit = request.limit;
  }
  return normalized;
}

function normalizeAuthResult(value, provider) {
  const reportedProvider = typeof value?.provider === "string" ? value.provider : null;
  const providerMatches = reportedProvider === provider;
  const verificationRequired = value?.verificationRequired === true;
  let reason = typeof value?.reason === "string" && SAFE_REASON_SET.has(value.reason)
    ? value.reason
    : "probe_failed";
  if (reportedProvider && !providerMatches) reason = "provider_url_mismatch";
  if (verificationRequired) reason = "human_verification_required";
  return {
    provider,
    authenticated: providerMatches && !verificationRequired && value?.authenticated === true,
    reason,
    verificationRequired,
  };
}

function normalizeAdapterDiagnostics(value, fallback = {}) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {
    bridgeState: ADAPTER_BRIDGE_STATES.has(data.bridgeState)
      ? data.bridgeState
      : ADAPTER_BRIDGE_STATES.has(fallback.bridgeState) ? fallback.bridgeState : "missing",
    adapterSource: ADAPTER_SOURCES.has(data.adapterSource) ? data.adapterSource : "none",
    activationState: ADAPTER_ACTIVATION_STATES.has(data.activationState)
      ? data.activationState
      : "unsupported",
    sidecarInjected: fallback.sidecarInjected === true || data.sidecarInjected === true,
  };
  for (const field of [
    "composerFound",
    "adapterPresent",
    "hasInsertText",
    "hasInsertTextIntoInput",
    "hasSubmitForm",
  ]) {
    if (typeof data[field] === "boolean") result[field] = data[field];
  }
  return result;
}

function requireAssistantCapture(type, data) {
  if (type === "tab:capture-latest" && data?.speaker !== "assistant") {
    throw new RoundtableRouterError("INVALID_CAPTURE_SPEAKER");
  }
  if (type === "tab:capture-recent") {
    if (!Array.isArray(data?.messages) || data.messages.some((message) => message?.speaker !== "assistant")) {
      throw new RoundtableRouterError("INVALID_CAPTURE_SPEAKER");
    }
  }
}

function responseError(type, error) {
  const code = error instanceof RoundtableRouterError
    ? error.code
    : "ROUND_TABLE_BACKGROUND_FAILED";
  return { ok: false, type, error: sanitizeErrorText(code) || "ROUND_TABLE_BACKGROUND_FAILED" };
}

export function createRoundtableBackgroundRouter(chromeApi, {
  authProbeTimeoutMs = 2000,
  contentMessageTimeoutMs = 6500,
  sidecarInjectionTimeoutMs = 2000,
} = {}) {
  if (!chromeApi?.tabs || !chromeApi?.scripting) throw new Error("CHROME_API_REQUIRED");
  const bindings = new Map();

  function withTimeout(promise, timeoutMs, code) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RoundtableRouterError(code)), timeoutMs);
      timer?.unref?.();
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  }

  function forgetTab(tabId) {
    for (const [provider, boundTabId] of bindings) {
      if (boundTabId === tabId) bindings.delete(provider);
    }
  }

  function boundProviderForTab(tabId) {
    for (const [provider, boundTabId] of bindings) {
      if (boundTabId === tabId) return provider;
    }
    return null;
  }

  function rememberBinding(provider, tabId) {
    forgetTab(tabId);
    bindings.set(provider, tabId);
  }

  function requireExactBinding(provider, tabId) {
    if (bindings.get(provider) !== tabId) {
      throw new RoundtableRouterError("PROVIDER_PAGE_NOT_BOUND");
    }
  }

  async function getSupportedTab(tabId, expectedProvider = null) {
    let tab;
    try {
      tab = await chromeApi.tabs.get(tabId);
    } catch {
      forgetTab(tabId);
      throw new RoundtableRouterError("PROVIDER_TAB_NOT_FOUND");
    }
    const url = sanitizeProviderUrl(tab?.url);
    const provider = url ? providerIdForUrl(url) : null;
    const boundProvider = boundProviderForTab(tabId);
    if (!provider || (expectedProvider && provider !== expectedProvider) || (boundProvider && boundProvider !== provider)) {
      forgetTab(tabId);
      throw new RoundtableRouterError("PROVIDER_URL_MISMATCH");
    }
    return { provider, tab: { ...tab, url }, url };
  }

  async function executeAuthProbe(tabId, provider) {
    try {
      const injectionResults = await withTimeout(
        chromeApi.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: runProviderAuthProbe,
          args: [provider],
        }),
        authProbeTimeoutMs,
        "AUTH_PROBE_TIMEOUT",
      );
      return normalizeAuthResult(injectionResults?.[0]?.result, provider);
    } catch (error) {
      return normalizeAuthResult({
        provider,
        authenticated: false,
        reason: error?.code === "AUTH_PROBE_TIMEOUT" ? "probe_timeout" : "probe_failed",
        verificationRequired: false,
      }, provider);
    }
  }

  async function sendContentDetection(tabId) {
    const message = { type: "tab:detect", tabId };
    try {
      const response = await withTimeout(
        chromeApi.tabs.sendMessage(tabId, message),
        contentMessageTimeoutMs,
        "CONTENT_MESSAGE_TIMEOUT",
      );
      return { response, sidecarInjected: false, failureReason: null };
    } catch (error) {
      if (error?.code === "CONTENT_MESSAGE_TIMEOUT") {
        return { response: null, sidecarInjected: false, failureReason: "content_bridge_timeout" };
      }
    }

    try {
      await withTimeout(
        chromeApi.scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          files: [...ROUNDTABLE_CONTENT_SIDECARS],
        }),
        sidecarInjectionTimeoutMs,
        "SIDECAR_INJECTION_TIMEOUT",
      );
    } catch {
      return { response: null, sidecarInjected: false, failureReason: "content_bridge_missing" };
    }

    try {
      const response = await withTimeout(
        chromeApi.tabs.sendMessage(tabId, message),
        contentMessageTimeoutMs,
        "CONTENT_MESSAGE_TIMEOUT",
      );
      return { response, sidecarInjected: true, failureReason: null };
    } catch (error) {
      return {
        response: null,
        sidecarInjected: true,
        failureReason: error?.code === "CONTENT_MESSAGE_TIMEOUT"
          ? "content_bridge_timeout"
          : "content_bridge_missing",
      };
    }
  }

  async function detectContent(tabId, provider) {
    const detection = await sendContentDetection(tabId);
    try {
      const response = detection.response;
      const data = response?.ok === true && response?.data && typeof response.data === "object"
        ? response.data
        : null;
      if (!data) throw new Error("ADAPTER_NOT_READY");
      const reportedProvider = typeof data.provider === "string" ? data.provider : provider;
      const ready = data.ready === true || data.readiness === "supported";
      const readiness = READINESS_STATES.has(data.readiness)
        ? data.readiness
        : ready ? "supported" : "unknown";
      return {
        provider: reportedProvider,
        ready,
        readiness,
        canInsert: data.canInsert === true,
        verificationRequired: data.verificationRequired === true,
        reason: SAFE_REASON_SET.has(data.reason) ? data.reason : ready ? "authenticated" : "adapter_not_ready",
        adapterDiagnostics: normalizeAdapterDiagnostics(data.adapterDiagnostics, {
          bridgeState: "ready",
          sidecarInjected: detection.sidecarInjected,
        }),
      };
    } catch {
      const failureReason = detection.failureReason || "adapter_not_ready";
      return {
        provider,
        ready: false,
        readiness: "unknown",
        canInsert: false,
        verificationRequired: false,
        reason: failureReason,
        adapterDiagnostics: normalizeAdapterDiagnostics(null, {
          bridgeState: failureReason === "content_bridge_timeout" ? "timed_out" : "missing",
          sidecarInjected: detection.sidecarInjected,
        }),
      };
    }
  }

  async function probeTab(tabId, expectedProvider = null) {
    const before = await getSupportedTab(tabId, expectedProvider);
    const [auth, detected] = await Promise.all([
      executeAuthProbe(tabId, before.provider),
      detectContent(tabId, before.provider),
    ]);
    const after = await getSupportedTab(tabId, before.provider);
    const verificationRequired = auth.verificationRequired || detected.verificationRequired;
    const providerMatches = auth.provider === before.provider && detected.provider === before.provider;
    const reason = !providerMatches
      ? "provider_url_mismatch"
      : verificationRequired
        ? "human_verification_required"
        : !auth.authenticated
          ? auth.reason
          : !detected.ready
            ? detected.reason
            : "authenticated";
    const status = sanitizeDetectedStatus({
      provider: providerMatches ? before.provider : detected.provider,
      authenticated: auth.authenticated,
      ready: detected.ready,
      verificationRequired,
      reason,
    }, after.tab);
    return {
      ...status,
      label: PROVIDER_LABELS[before.provider],
      readiness: detected.readiness,
      canInsert: status.ready && detected.canInsert === true,
      adapterDiagnostics: detected.adapterDiagnostics,
    };
  }

  async function queryProviderTabs(providers = PROVIDER_IDS) {
    const requested = new Set(providers);
    const tabs = await chromeApi.tabs.query({});
    return (Array.isArray(tabs) ? tabs : []).filter((tab) => {
      const provider = providerIdForUrl(tab?.url);
      return Number.isInteger(tab?.id) && requested.has(provider) && sanitizeProviderUrl(tab.url);
    });
  }

  async function discoverProviders(providers = PROVIDER_IDS) {
    const tabs = await queryProviderTabs(providers);
    const statuses = await Promise.all(tabs.map(async (tab) => {
      try {
        const status = await probeTab(tab.id, providerIdForUrl(tab.url));
        return { ...status, active: tab.active === true, lastAccessed: Number(tab.lastAccessed || 0) };
      } catch {
        return null;
      }
    }));
    const safeStatuses = statuses.filter(Boolean);

    for (const provider of providers) {
      const candidates = safeStatuses.filter((status) => status.provider === provider);
      const selected = chooseProviderTab(candidates, bindings.get(provider));
      if (selected?.ready && selected.authenticated && selected.canInsert && !selected.verificationRequired) {
        rememberBinding(provider, selected.tabId);
      } else if (bindings.has(provider)) {
        bindings.delete(provider);
      }
    }

    return safeStatuses.map(({ active, lastAccessed, ...status }) => status);
  }

  async function probeProvider(request) {
    if (request.tabId !== undefined) {
      const status = await probeTab(request.tabId, request.provider);
      if (status.reason === "provider_url_mismatch") {
        forgetTab(request.tabId);
        throw new RoundtableRouterError("PROVIDER_URL_MISMATCH");
      }
      if (status.ready && status.authenticated && status.canInsert && !status.verificationRequired) {
        rememberBinding(request.provider, request.tabId);
      } else if (bindings.get(request.provider) === request.tabId) {
        bindings.delete(request.provider);
      }
      return status;
    }

    const tabs = await queryProviderTabs([request.provider]);
    const statuses = await Promise.all(tabs.map(async (tab) => {
      try {
        return { ...await probeTab(tab.id, request.provider), active: tab.active, lastAccessed: tab.lastAccessed };
      } catch {
        return null;
      }
    }));
    const selected = chooseProviderTab(statuses.filter(Boolean), bindings.get(request.provider));
    if (!selected) throw new RoundtableRouterError("PROVIDER_TAB_NOT_FOUND");
    const { active: _active, lastAccessed: _lastAccessed, ...status } = selected;
    if (status.authenticated && status.canInsert && !status.verificationRequired) {
      rememberBinding(request.provider, status.tabId);
    }
    return status;
  }

  async function focusTab(tabId) {
    const current = await getSupportedTab(tabId);
    const tab = await chromeApi.tabs.update(tabId, { active: true });
    if (Number.isInteger(tab?.windowId) && chromeApi.windows?.update) {
      await chromeApi.windows.update(tab.windowId, { focused: true });
    }
    return {
      provider: current.provider,
      label: PROVIDER_LABELS[current.provider],
      tabId,
      url: current.url,
      status: "ready",
      reused: true,
    };
  }

  async function openProvider(provider) {
    const boundTabId = bindings.get(provider);
    if (Number.isInteger(boundTabId)) {
      try {
        return await focusTab(boundTabId);
      } catch {
        bindings.delete(provider);
      }
    }

    const tabs = await queryProviderTabs([provider]);
    const selected = chooseProviderTab(tabs.map((tab) => ({ ...tab, tabId: tab.id, ready: true })));
    if (selected) return focusTab(selected.id);

    const created = await chromeApi.tabs.create({ url: PROVIDER_DEFAULT_URLS[provider], active: true });
    if (!Number.isInteger(created?.id)) throw new RoundtableRouterError("PROVIDER_TAB_OPEN_FAILED");
    const url = sanitizeProviderUrl(created.url || PROVIDER_DEFAULT_URLS[provider]);
    if (!url || providerIdForUrl(url) !== provider) throw new RoundtableRouterError("PROVIDER_URL_MISMATCH");
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      tabId: created.id,
      url,
      status: "ready",
      reused: false,
    };
  }

  async function routeContentCommand(request) {
    const before = await getSupportedTab(request.tabId);
    requireExactBinding(before.provider, request.tabId);
    let response;
    try {
      response = await chromeApi.tabs.sendMessage(request.tabId, request);
    } catch {
      throw new RoundtableRouterError("ADAPTER_NOT_READY");
    }
    await getSupportedTab(request.tabId, before.provider);
    if (!response || response.type !== request.type) throw new RoundtableRouterError("TAB_COMMAND_FAILED");
    if (response.ok !== true) {
      throw new RoundtableRouterError(sanitizeErrorText(response.error || "TAB_COMMAND_FAILED"));
    }
    if (!response.data || response.data.provider !== before.provider) {
      forgetTab(request.tabId);
      throw new RoundtableRouterError("PROVIDER_URL_MISMATCH");
    }
    requireAssistantCapture(request.type, response.data);
    rememberBinding(before.provider, request.tabId);
    return sanitizeBridgeValue(response.data);
  }

  async function handleRequest(rawRequest) {
    const responseType = typeof rawRequest?.type === "string" ? rawRequest.type : "unknown";
    try {
      const request = normalizeRequest(rawRequest);
      let data;
      switch (request.type) {
        case "tabs:discover-providers":
          data = { tabs: await discoverProviders(request.providers || PROVIDER_IDS) };
          break;
        case "tabs:open-provider":
          data = await openProvider(request.provider);
          break;
        case "tabs:probe-provider":
          data = await probeProvider(request);
          break;
        case "tabs:focus-provider":
          data = await focusTab(request.tabId);
          break;
        case "tab:auth-probe": {
          const tab = await getSupportedTab(request.tabId);
          requireExactBinding(tab.provider, request.tabId);
          data = await executeAuthProbe(request.tabId, tab.provider);
          await getSupportedTab(request.tabId, tab.provider);
          if (data.authenticated && !data.verificationRequired) {
            rememberBinding(tab.provider, request.tabId);
          } else {
            forgetTab(request.tabId);
          }
          break;
        }
        default:
          if (!CONTENT_TYPES.has(request.type)) throw new RoundtableRouterError("ROUND_TABLE_REQUEST_NOT_ALLOWED");
          data = await routeContentCommand(request);
      }
      return { ok: true, type: request.type, data };
    } catch (error) {
      return responseError(responseType, error);
    }
  }

  return {
    bindings,
    forgetTab,
    handleRequest,
  };
}

function isTrustedRoundtableSender(sender, chromeApi) {
  if (!sender || sender.id !== chromeApi.runtime.id || typeof sender.tab?.url !== "string") return false;
  try {
    return TRUSTED_ROUNDTABLE_ORIGINS.has(new URL(sender.tab.url).origin);
  } catch {
    return false;
  }
}

export function registerRoundtableBackground(chromeApi = globalThis.chrome) {
  const router = createRoundtableBackgroundRouter(chromeApi);
  chromeApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || !ALLOWED_TYPES.has(request.type)) return false;
    if (!isTrustedRoundtableSender(sender, chromeApi)) return false;
    void router.handleRequest(request).then(sendResponse);
    return true;
  });
  chromeApi.tabs.onRemoved?.addListener((tabId) => router.forgetTab(tabId));
  return router;
}

if (globalThis.chrome?.runtime?.onMessage?.addListener && globalThis.chrome?.tabs && globalThis.chrome?.scripting) {
  registerRoundtableBackground(globalThis.chrome);
}
