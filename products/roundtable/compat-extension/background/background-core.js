const PROVIDER_HOSTS = Object.freeze({
  chatgpt: ["chatgpt.com", "chat.openai.com"],
  deepseek: ["chat.deepseek.com"],
  doubao: ["doubao.com"],
});

const SAFE_REASONS = new Set([
  "authenticated",
  "login_required",
  "token_missing",
  "probe_failed",
  "unsupported_provider",
  "human_verification_required",
  "adapter_not_ready",
  "adapter_activation_failed",
  "adapter_activation_timeout",
  "composer_not_found",
  "content_bridge_missing",
  "content_bridge_timeout",
  "probe_timeout",
  "provider_url_mismatch",
]);

export function providerIdForUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
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
  const normalizedCurrentTabId = Number(currentTabId);
  const current = currentTabId === null || currentTabId === undefined || !Number.isInteger(normalizedCurrentTabId)
    ? null
    : candidates.find((tab) => Number(tab.tabId ?? tab.id) === normalizedCurrentTabId);
  if (current) return current;
  return [...candidates].sort((left, right) => {
    const score = (tab) => Number(tab.authenticated === true) * 4
      + Number(tab.ready === true) * 2
      + Number(tab.active === true);
    return score(right) - score(left)
      || Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0)
      || Number(left.tabId ?? left.id) - Number(right.tabId ?? right.id);
  })[0] || null;
}

export function sanitizeDetectedStatus(status, tab) {
  const url = sanitizeProviderUrl(tab?.url);
  const urlProvider = url ? providerIdForUrl(url) : null;
  const reportedProvider = typeof status?.provider === "string" ? status.provider : urlProvider;
  const providerMatches = Boolean(urlProvider && reportedProvider === urlProvider);
  const rawReason = typeof status?.reason === "string" ? status.reason : "adapter_not_ready";
  return {
    tabId: Number.isInteger(tab?.id) ? tab.id : null,
    provider: urlProvider,
    url,
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
    "iframe[src*='captcha']",
    "iframe[src*='challenge']",
    "iframe[src*='turnstile']",
    "[class*='captcha']",
    "[id*='captcha']",
    "[data-testid*='captcha']",
    "[class*='geetest']",
    "[id*='geetest']",
    "[class*='verify-dialog']",
    "[class*='sec-check']",
  ].join(",");
  const composerSelectors = {
    chatgpt: [
      "#prompt-textarea",
      '[role="textbox"][contenteditable="true"]',
    ],
    deepseek: [
      'textarea[spellcheck="false"]',
      'textarea[data-gramm="false"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Message DeepSeek"]',
      'textarea[placeholder*="发送"]',
      "textarea.chat-input",
      '.ds-scroll-area textarea:not([readonly]):not([disabled])',
      'div[role="textbox"][contenteditable="true"]',
    ],
    doubao: [
      'textarea[data-testid*="chat"]',
      'textarea[placeholder*="发消息"]',
      'textarea[placeholder*="发送"]',
      '[data-placeholder*="发消息"][contenteditable="true"]',
      '[aria-label*="发消息"][contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
    ],
  };
  const loginSelectors = {
    chatgpt: [
      'a[href*="/auth/login"]',
      'button[data-testid*="login"]',
      '[aria-label*="Log in"]',
      '[aria-label*="登录"]',
    ],
    deepseek: [
      'a[href*="login"]',
      'button[data-testid*="login"]',
      '[aria-label*="Log in"]',
      '[aria-label*="登录"]',
    ],
    doubao: [
      'a[href*="login"]',
      'button[data-testid*="login"]',
      '[aria-label*="登录"]',
      '[class*="login"] button',
    ],
  };

  const isVisiblePageControl = (candidate) => {
    if (!candidate || candidate.hidden === true || candidate.disabled === true || candidate.readOnly === true) {
      return false;
    }
    if (String(candidate.getAttribute?.("aria-hidden") || "").toLowerCase() === "true") return false;
    if (String(candidate.getAttribute?.("aria-disabled") || "").toLowerCase() === "true") return false;
    try {
      if (candidate.closest?.("#mcp-popover-container, #mcp-sidebar-container, [id^='mcp-'], [class*='mcp-sidebar'], [class*='mcp-super-assistant']")) {
        return false;
      }
    } catch {
      return false;
    }
    if (typeof candidate.getBoundingClientRect === "function") {
      const rect = candidate.getBoundingClientRect();
      if (rect && rect.width === 0 && rect.height === 0) return false;
    }
    return true;
  };
  const hasVisibleControl = (selectors) => (selectors || []).some((selector) => {
    try {
      return isVisiblePageControl(document.querySelector(selector));
    } catch {
      return false;
    }
  });

  try {
    const title = String(document.title || "").trim();
    if (document.querySelector(challengeSelector)
        || /^(?:just a moment|security verification|human verification)\b/i.test(title)
        || /^(?:安全验证|人机验证|验证码)/.test(title)) {
      return result(false, "human_verification_required", true);
    }
    if (provider === "unknown") return result(false, "unsupported_provider");
    if (hasVisibleControl(composerSelectors[provider])) return result(true, "authenticated");
    if (hasVisibleControl(loginSelectors[provider])) return result(false, "login_required");
    return result(false, "probe_failed");
  } catch {
    return result(false, "probe_failed");
  }
}

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDER_HOSTS));
export const SAFE_AUTH_REASONS = Object.freeze([...SAFE_REASONS]);
