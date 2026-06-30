import type { ProviderId } from "../shared/types";
import type { ProviderDefinition } from "./types";

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    hostnames: ["chatgpt.com", "chat.openai.com"],
    defaultUrl: "https://chatgpt.com/",
    inputSelectors: [
      "#prompt-textarea",
      "[data-testid='composer'] [contenteditable='true']",
      "main form textarea",
      "main form [contenteditable='true']",
      "textarea"
    ]
  },
  {
    id: "gemini",
    label: "Gemini",
    hostnames: ["gemini.google.com"],
    defaultUrl: "https://gemini.google.com/app",
    inputSelectors: [
      "rich-textarea [contenteditable='true']",
      "[aria-label*='Enter a prompt']",
      "[aria-label*='输入提示']",
      "div[contenteditable='true']",
      "textarea"
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hostnames: ["chat.deepseek.com"],
    defaultUrl: "https://chat.deepseek.com/",
    inputSelectors: [
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']"
    ]
  },
  {
    id: "kimi",
    label: "Kimi",
    hostnames: ["kimi.com"],
    defaultUrl: "https://kimi.com/",
    inputSelectors: [
      "[contenteditable='true']",
      "textarea",
      "[role='textbox']"
    ]
  },
  {
    id: "qwen",
    label: "Qwen",
    hostnames: ["chat.qwen.ai"],
    defaultUrl: "https://chat.qwen.ai/",
    inputSelectors: [
      ".ql-editor",
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']"
    ]
  },
  {
    id: "glm",
    label: "GLM",
    hostnames: ["bigmodel.cn", "chat.z.ai"],
    defaultUrl: "https://chat.z.ai/",
    inputSelectors: [
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']"
    ]
  },
  {
    id: "doubao",
    label: "豆包",
    hostnames: ["doubao.com", "www.doubao.com"],
    defaultUrl: "https://www.doubao.com/chat/",
    inputSelectors: [
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']"
    ]
  }
];

export function detectProvider(hostname: string): { id: ProviderId; label: string } {
  const match = PROVIDERS.find((provider) =>
    provider.hostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  );

  return match ? { id: match.id, label: match.label } : { id: "unknown", label: "Unknown" };
}

export function getProviderDefinition(providerId: ProviderId): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === providerId);
}
