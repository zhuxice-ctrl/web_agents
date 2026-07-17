(function initRoundtableProtocol(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.__webAgentRoundtableProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createProtocol() {
  "use strict";

  const SOURCE = "web-agents-roundtable-bridge";
  const BRIDGE_REVISION = "legacy-sidecar-v1";
  const TRUSTED_ORIGINS = new Set([
    "http://127.0.0.1:3020",
    "http://localhost:3020",
  ]);
  const PROVIDER_IDS = new Set(["chatgpt", "deepseek", "doubao"]);
  const PROVIDERS = Object.freeze({
    chatgpt: Object.freeze({
      label: "ChatGPT",
      origins: Object.freeze(["https://chatgpt.com", "https://chat.openai.com"]),
      defaultUrl: "https://chatgpt.com/",
    }),
    deepseek: Object.freeze({
      label: "DeepSeek",
      origins: Object.freeze(["https://chat.deepseek.com"]),
      defaultUrl: "https://chat.deepseek.com/",
    }),
    doubao: Object.freeze({
      label: "豆包",
      origins: Object.freeze(["https://www.doubao.com", "https://doubao.com"]),
      defaultUrl: "https://www.doubao.com/chat/",
    }),
  });
  const ALLOWED_TYPES = new Set([
    "tabs:open-provider",
    "tabs:discover-providers",
    "tabs:probe-provider",
    "tabs:focus-provider",
    "tab:auth-probe",
    "tab:detect",
    "tab:insert-text",
    "tab:auto-send-text",
    "tab:capture-latest",
    "tab:capture-recent",
  ]);
  const SECRET_KEYS = new Set([
    "accesstoken",
    "account",
    "accountid",
    "apikey",
    "authorization",
    "authtoken",
    "clientsecret",
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "email",
    "idtoken",
    "localstorage",
    "passwd",
    "password",
    "proxyauthorization",
    "refreshtoken",
    "secret",
    "session",
    "sessionid",
    "token",
    "user",
    "userid",
    "username",
  ]);
  const MAX_TEXT_LENGTH = 1_000_000;

  function isTrustedRoundtableOrigin(value) {
    return typeof value === "string" && TRUSTED_ORIGINS.has(value);
  }

  function sanitizeUrl(value) {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      throw new Error("UNSAFE_URL");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("UNSAFE_URL");
    }
    return `${url.origin}${url.pathname}`;
  }

  function isSecretKey(key) {
    return SECRET_KEYS.has(String(key).replace(/[^a-z0-9]/gi, "").toLowerCase());
  }

  function sanitizeString(value) {
    return value.replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
      const trailing = match.match(/[\]),.;!?]+$/)?.[0] || "";
      const candidate = trailing ? match.slice(0, -trailing.length) : match;
      try {
        return `${sanitizeUrl(candidate)}${trailing}`;
      } catch {
        return `[redacted-url]${trailing}`;
      }
    });
  }

  function sanitizeBridgeValue(value) {
    if (Array.isArray(value)) return value.map((item) => sanitizeBridgeValue(item));
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        if (!isSecretKey(key)) result[key] = sanitizeBridgeValue(item);
      }
      return result;
    }
    return typeof value === "string" ? sanitizeString(value) : value;
  }

  function invalidRequest(code) {
    throw new Error(code);
  }

  function requireProvider(value) {
    if (typeof value !== "string" || !PROVIDER_IDS.has(value)) invalidRequest("INVALID_PROVIDER");
    return value;
  }

  function requireTabId(value) {
    if (!Number.isInteger(value) || value < 0) invalidRequest("INVALID_TAB_ID");
    return value;
  }

  function requireText(value) {
    if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT_LENGTH) {
      invalidRequest("INVALID_TEXT_PAYLOAD");
    }
    return value;
  }

  function validateRoundtableRequest(request) {
    if (!request || typeof request !== "object" || Array.isArray(request) || !ALLOWED_TYPES.has(request.type)) {
      invalidRequest("ROUND_TABLE_REQUEST_NOT_ALLOWED");
    }

    switch (request.type) {
      case "tabs:open-provider":
        return { type: request.type, provider: requireProvider(request.provider) };
      case "tabs:discover-providers": {
        if (request.providers === undefined) return { type: request.type };
        if (!Array.isArray(request.providers) || request.providers.length > PROVIDER_IDS.size) {
          invalidRequest("INVALID_PROVIDER_LIST");
        }
        const providers = request.providers.map(requireProvider);
        if (new Set(providers).size !== providers.length) invalidRequest("INVALID_PROVIDER_LIST");
        return { type: request.type, providers };
      }
      case "tabs:probe-provider":
        return {
          type: request.type,
          provider: requireProvider(request.provider),
          ...(request.tabId === undefined ? {} : { tabId: requireTabId(request.tabId) }),
        };
      case "tabs:focus-provider":
      case "tab:auth-probe":
      case "tab:detect":
      case "tab:capture-latest":
        return { type: request.type, tabId: requireTabId(request.tabId) };
      case "tab:capture-recent": {
        const result = { type: request.type, tabId: requireTabId(request.tabId) };
        if (request.limit === undefined) return result;
        if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 80) {
          invalidRequest("INVALID_CAPTURE_LIMIT");
        }
        result.limit = request.limit;
        return result;
      }
      case "tab:insert-text":
      case "tab:auto-send-text":
        return {
          type: request.type,
          tabId: requireTabId(request.tabId),
          text: requireText(request.text),
        };
      default:
        return invalidRequest("ROUND_TABLE_REQUEST_NOT_ALLOWED");
    }
  }

  return {
    SOURCE,
    BRIDGE_REVISION,
    PROVIDERS,
    isTrustedRoundtableOrigin,
    sanitizeUrl,
    sanitizeBridgeValue,
    validateRoundtableRequest,
  };
});
