import type { SiteAdapter } from "../adapters/types";
import type { AdapterStatus, InsertResult, ProviderId, ResponseSnapshot } from "../shared/types";

type WritableElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;
type InputCandidate = {
  element: WritableElement;
  selector: string;
};

type ContentProviderDefinition = {
  id: ProviderId;
  label: string;
  hostnames: string[];
  inputSelectors: string[];
};

const PROVIDERS: ContentProviderDefinition[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    hostnames: ["chatgpt.com", "chat.openai.com"],
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
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"]
  },
  {
    id: "kimi",
    label: "Kimi",
    hostnames: ["kimi.com"],
    inputSelectors: ["[contenteditable='true']", "textarea", "[role='textbox']"]
  },
  {
    id: "qwen",
    label: "Qwen",
    hostnames: ["chat.qwen.ai"],
    inputSelectors: [".ql-editor", "textarea", "[contenteditable='true']", "[role='textbox']"]
  },
  {
    id: "glm",
    label: "GLM",
    hostnames: ["bigmodel.cn", "chat.z.ai"],
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"]
  },
  {
    id: "doubao",
    label: "豆包",
    hostnames: ["doubao.com", "www.doubao.com"],
    inputSelectors: ["textarea", "[contenteditable='true']", "[role='textbox']"]
  }
];

const FALLBACK_INPUT_SELECTORS = [
  "textarea",
  "input[type='text']",
  "div[contenteditable='true']",
  "[role='textbox']",
  "form textarea",
  "form [contenteditable='true']"
];

const RESPONSE_SELECTORS = [
  "[data-message-author-role='assistant']",
  "message-content",
  ".markdown",
  "article",
  "[class*='assistant']",
  "[class*='response']",
  "[class*='message']"
];

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 40 && rect.height > 16 && style.visibility !== "hidden" && style.display !== "none";
}

function isWritableElement(element: Element): element is WritableElement {
  if (!isVisible(element)) return false;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLInputElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLElement) {
    return element.isContentEditable || element.getAttribute("role") === "textbox";
  }

  return false;
}

function detectProvider(hostname: string): { id: ProviderId; label: string } {
  const match = PROVIDERS.find((provider) =>
    provider.hostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  );

  return match ? { id: match.id, label: match.label } : { id: "unknown", label: "Unknown" };
}

function getCandidateSelectors(providerId: ProviderId): string[] {
  const provider = PROVIDERS.find((item) => item.id === providerId);
  return [...(provider?.inputSelectors ?? []), ...FALLBACK_INPUT_SELECTORS];
}

function findActiveInput(): InputCandidate | null {
  const active = document.activeElement;
  if (active && isWritableElement(active)) {
    return { element: active, selector: "document.activeElement" };
  }

  return null;
}

function findInput(providerId: ProviderId): InputCandidate | null {
  const activeInput = findActiveInput();
  if (activeInput) return activeInput;

  for (const selector of getCandidateSelectors(providerId)) {
    const candidates = Array.from(document.querySelectorAll(selector));
    const element = candidates.find(isWritableElement);
    if (element) return { element, selector };
  }

  return null;
}

function setNativeTextValue(input: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function replaceContentEditableText(element: HTMLElement, text: string): void {
  element.focus();

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    element.textContent = text;
  }

  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function insertIntoElement(element: WritableElement, text: string): boolean {
  element.focus();

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    setNativeTextValue(element, text);
    return true;
  }

  if (element instanceof HTMLElement && (element.isContentEditable || element.getAttribute("role") === "textbox")) {
    replaceContentEditableText(element, text);
    return true;
  }

  return false;
}

function getStatus(): AdapterStatus {
  return createSiteAdapter().detectSync();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function captureLatestResponse(provider: ProviderId): ResponseSnapshot | null {
  const candidates = RESPONSE_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .filter(isVisible)
    .map((element) => ({ element, text: cleanText(element.innerText || element.textContent || "") }))
    .filter((item) => item.text.length > 20);

  const latest = candidates.at(-1);
  if (!latest) return null;

  return {
    provider,
    text: latest.text,
    capturedAt: new Date().toISOString(),
    source: latest.element.tagName.toLowerCase()
  };
}

function createSiteAdapter(): SiteAdapter & { detectSync(): AdapterStatus } {
  const provider = detectProvider(window.location.hostname);

  return {
    provider: provider.id,
    detectSync(): AdapterStatus {
      const input = findInput(provider.id);

      if (provider.id === "unknown") {
        return {
          provider: provider.id,
          label: provider.label,
          readiness: "unsupported",
          canInsert: false,
          url: window.location.href,
          reason: "当前页面暂未配置站点适配器。"
        };
      }

      return {
        provider: provider.id,
        label: provider.label,
        readiness: input ? "supported" : "no_input",
        canInsert: Boolean(input),
        url: window.location.href,
        matchedSelector: input?.selector,
        reason: input ? undefined : "没有找到可写入的原生输入框，请先打开或聚焦网页对话输入栏。"
      };
    },
    async detect() {
      return this.detectSync();
    },
    async insertText(text: string): Promise<InsertResult> {
      const input = findInput(provider.id);

      if (!input) {
        return {
          ok: false,
          provider: provider.id,
          message: "没有找到可写入的原生输入框，请先打开或聚焦网页对话输入栏。"
        };
      }

      const ok = insertIntoElement(input.element, text);
      return {
        ok,
        provider: provider.id,
        message: ok ? "已插入当前网页输入框，请在网页中手动确认发送。" : "输入框类型暂不支持。"
      };
    }
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const adapter = createSiteAdapter();

  if (message.type === "tab:detect") {
    sendResponse({ ok: true, type: "tab:detect", data: getStatus() });
    return false;
  }

  if (message.type === "tab:insert-text") {
    const text = "text" in message && typeof message.text === "string" ? message.text : "";
    void adapter.insertText(text).then((result) => {
      sendResponse({ ok: true, type: "tab:insert-text", data: result });
    });
    return true;
  }

  if (message.type === "tab:capture-latest") {
    const snapshot = captureLatestResponse(adapter.provider);
    if (snapshot) {
      sendResponse({ ok: true, type: "tab:capture-latest", data: snapshot });
    } else {
      sendResponse({ ok: false, type: "tab:capture-latest", error: "暂未找到可捕获的最新回复快照。" });
    }
    return false;
  }

  return false;
});
