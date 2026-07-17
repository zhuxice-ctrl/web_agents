import type { ModelParticipant, ProviderId } from "../shared/types";

export type KnownProviderId = Exclude<ProviderId, "unknown">;
export type ProviderVerificationState = "known_working" | "needs_manual_verification" | "blocked";
export type ProviderCapability = "insert_text" | "capture_latest_response" | "open_tab";

export type ProviderCatalogEntry = {
  id: KnownProviderId;
  label: string;
  hostnames: string[];
  defaultUrl: string;
  contentMatches: string[];
  inputSelectors: string[];
  fallbackInputSelectors?: string[];
  responseSelectors?: string[];
  capabilities: ProviderCapability[];
  verification: ProviderVerificationState;
};

export const GLOBAL_FALLBACK_INPUT_SELECTORS = [
  "textarea",
  "input[type='text']",
  "div[contenteditable='true']",
  "[role='textbox']",
  "form textarea",
  "form [contenteditable='true']"
] as const;

export const GLOBAL_RESPONSE_SELECTORS = [
  "[data-message-author-role='assistant']",
  "[data-role='assistant']",
  "[data-testid='message-assistant']",
  "message-content",
  ".ds-markdown",
  ".flow-markdown-body",
  "[class*='assistant']",
  "[class*='answer-content']"
] as const;

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    hostnames: ["chatgpt.com", "chat.openai.com"],
    defaultUrl: "https://chatgpt.com/",
    contentMatches: ["*://chatgpt.com/*", "*://chat.openai.com/*"],
    inputSelectors: [
      "#prompt-textarea",
      "[data-testid='composer'] [contenteditable='true']",
      "main form textarea",
      "main form [contenteditable='true']"
    ],
    responseSelectors: [
      "[data-message-author-role='assistant']",
      "article[data-testid^='conversation-turn-']:has([data-message-author-role='assistant'])"
    ],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "known_working"
  },
  {
    id: "gemini",
    label: "Gemini",
    hostnames: ["gemini.google.com"],
    defaultUrl: "https://gemini.google.com/app",
    contentMatches: ["*://gemini.google.com/*"],
    inputSelectors: [
      "rich-textarea [contenteditable='true']",
      "[aria-label*='Enter a prompt']",
      "[aria-label*='输入提示']",
      "div[contenteditable='true']"
    ],
    responseSelectors: ["message-content", ".markdown"],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "known_working"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hostnames: ["chat.deepseek.com"],
    defaultUrl: "https://chat.deepseek.com/",
    contentMatches: ["*://chat.deepseek.com/*"],
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"],
    responseSelectors: [
      ".ds-markdown",
      "[class*='ds-markdown']",
      "[class*='markdown']:not([contenteditable='true'])",
      "[data-role='assistant']"
    ],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "known_working"
  },
  {
    id: "kimi",
    label: "Kimi",
    hostnames: ["kimi.com"],
    defaultUrl: "https://kimi.com/",
    contentMatches: ["*://kimi.com/*"],
    inputSelectors: ["[contenteditable='true']", "textarea", "[role='textbox']"],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "known_working"
  },
  {
    id: "qwen",
    label: "Qwen",
    hostnames: ["chat.qwen.ai"],
    defaultUrl: "https://chat.qwen.ai/",
    contentMatches: ["*://chat.qwen.ai/*"],
    inputSelectors: [".ql-editor", "textarea", "[contenteditable='true']", "[role='textbox']"],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "known_working"
  },
  {
    id: "glm",
    label: "GLM",
    hostnames: ["bigmodel.cn", "chat.z.ai"],
    defaultUrl: "https://chat.z.ai/",
    contentMatches: ["*://bigmodel.cn/*", "*://chat.z.ai/*"],
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "known_working"
  },
  {
    id: "doubao",
    label: "豆包",
    hostnames: ["doubao.com", "www.doubao.com"],
    defaultUrl: "https://www.doubao.com/chat/",
    contentMatches: ["*://doubao.com/*", "*://www.doubao.com/*"],
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"],
    responseSelectors: [
      "[data-copy-telemetry='right_click_copy'] [data-message-id]",
      "[data-testid='message-assistant']",
      "[data-testid*='message'][data-testid*='assistant']",
      ".flow-markdown-body",
      "[class*='markdown']:not([contenteditable='true'])",
      "[class*='answer-content']"
    ],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "needs_manual_verification"
  },
  {
    id: "grok",
    label: "Grok",
    hostnames: ["grok.com", "x.com", "twitter.com"],
    defaultUrl: "https://grok.com/",
    contentMatches: ["*://grok.com/*", "*://x.com/*", "*://twitter.com/*"],
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "needs_manual_verification"
  },
  {
    id: "google-ai-studio",
    label: "Google AI Studio",
    hostnames: ["aistudio.google.com"],
    defaultUrl: "https://aistudio.google.com/",
    contentMatches: ["*://aistudio.google.com/*"],
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"],
    capabilities: ["insert_text", "capture_latest_response", "open_tab"],
    verification: "needs_manual_verification"
  }
];

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function mergeInputSelectors(
  provider: Pick<ProviderCatalogEntry, "inputSelectors" | "fallbackInputSelectors">
): string[] {
  return unique([
    ...provider.inputSelectors,
    ...(provider.fallbackInputSelectors ?? []),
    ...GLOBAL_FALLBACK_INPUT_SELECTORS
  ]);
}

export function mergeResponseSelectors(provider?: Pick<ProviderCatalogEntry, "responseSelectors">): string[] {
  const providerSelectors = provider?.responseSelectors ?? [];
  return unique(providerSelectors.length > 0 ? providerSelectors : GLOBAL_RESPONSE_SELECTORS);
}

export function getProviderById(providerId: ProviderId): ProviderCatalogEntry | undefined {
  if (providerId === "unknown") return undefined;
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId);
}

export function detectProviderByHostname(hostname: string): ProviderCatalogEntry | undefined {
  const normalized = hostname.toLowerCase();
  return PROVIDER_CATALOG.find((provider) =>
    provider.hostnames.some((host) => normalized === host || normalized.endsWith(`.${host}`))
  );
}

export function detectProvider(hostname: string): { id: ProviderId; label: string } {
  const provider = detectProviderByHostname(hostname);
  return provider ? { id: provider.id, label: provider.label } : { id: "unknown", label: "Unknown" };
}

export function getProviderContentMatches(): string[] {
  return unique(PROVIDER_CATALOG.flatMap((provider) => provider.contentMatches));
}

export function getDefaultParticipants(): ModelParticipant[] {
  return PROVIDER_CATALOG.map((provider) => ({
    provider: provider.id,
    label: provider.label,
    enabled: false,
    status: "not_open"
  }));
}
