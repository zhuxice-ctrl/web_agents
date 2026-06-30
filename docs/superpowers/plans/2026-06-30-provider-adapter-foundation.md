# Provider Adapter Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first source-based adapter foundation for `extensions/web-agents-extension` so provider definitions, page detection, text insertion, and response capture are centralized and testable.

**Architecture:** Add a single provider catalog and split content-script behavior into small adapter modules. Background, defaults, UI participants, and content runtime all consume the same provider source. Keep the first phase insert-only and preserve existing MCP and permission gateway behavior.

**Tech Stack:** Chrome Manifest V3, React 19, TypeScript, Vite, Vitest, jsdom.

---

## File Structure

- Create `extensions/web-agents-extension/src/providers/catalog.ts` for provider definitions and catalog helpers.
- Create `extensions/web-agents-extension/src/providers/catalog.test.ts` for provider matching and catalog integrity tests.
- Create `extensions/web-agents-extension/src/adapters/dom.ts` for DOM input/response helpers.
- Create `extensions/web-agents-extension/src/adapters/dom.test.ts` for jsdom DOM helper tests.
- Create `extensions/web-agents-extension/src/adapters/runtime.ts` for page-level site adapter behavior.
- Modify `extensions/web-agents-extension/src/adapters/types.ts` to hold the adapter contract.
- Modify `extensions/web-agents-extension/src/adapters/providers.ts` to become a compatibility re-export while callers migrate.
- Modify `extensions/web-agents-extension/src/content/index.ts` to only route extension messages to the runtime adapter.
- Modify `extensions/web-agents-extension/src/shared/types.ts` to add `grok` and `google-ai-studio` provider ids.
- Modify `extensions/web-agents-extension/src/shared/defaults.ts` to use catalog-derived participants.
- Modify `extensions/web-agents-extension/src/background/index.ts` to open providers from the catalog.
- Modify `extensions/web-agents-extension/public/manifest.json` to include Grok and Google AI Studio matches.
- Modify `extensions/web-agents-extension/package.json`, `package-lock.json`, and `vite.config.ts` to add Vitest/jsdom.
- Modify `extensions/web-agents-extension/README.md` and `docs/ARCH-web-agents-extension.md` to document the adapter foundation.

---

### Task 1: Add Test Runner Baseline

**Files:**
- Modify: `extensions/web-agents-extension/package.json`
- Modify: `extensions/web-agents-extension/package-lock.json`
- Modify: `extensions/web-agents-extension/vite.config.ts`

- [ ] **Step 1: Install Vitest and jsdom**

Run:

```powershell
npm install -D vitest jsdom
```

Expected: `package.json` and `package-lock.json` include `vitest` and `jsdom`.

- [ ] **Step 2: Add test script**

In `extensions/web-agents-extension/package.json`, update scripts to include:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "typecheck": "tsc -b --noEmit",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "preview": "vite preview --host 127.0.0.1"
  }
}
```

- [ ] **Step 3: Add Vitest config**

Replace the first import in `extensions/web-agents-extension/vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";
```

Add this top-level `test` block beside `plugins`, `publicDir`, and `build`:

```ts
test: {
  environment: "jsdom",
  include: ["src/**/*.test.ts"],
  globals: false
},
```

Expected: TypeScript accepts the `test` key because `defineConfig` comes from `vitest/config`.

- [ ] **Step 4: Run baseline commands**

Run:

```powershell
npm run typecheck
npm test
```

Expected:

- `npm run typecheck` passes.
- `npm test` exits successfully with no tests or discovered tests after later tasks.

- [ ] **Step 5: Commit**

```powershell
git add extensions/web-agents-extension/package.json extensions/web-agents-extension/package-lock.json extensions/web-agents-extension/vite.config.ts
git commit -m "Add test runner for web agents extension"
```

---

### Task 2: Create Provider Catalog and Tests

**Files:**
- Create: `extensions/web-agents-extension/src/providers/catalog.ts`
- Create: `extensions/web-agents-extension/src/providers/catalog.test.ts`
- Modify: `extensions/web-agents-extension/src/shared/types.ts`
- Modify: `extensions/web-agents-extension/src/adapters/providers.ts`

- [ ] **Step 1: Add provider ids**

In `extensions/web-agents-extension/src/shared/types.ts`, update `ProviderId` to:

```ts
export type ProviderId =
  | "chatgpt"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "qwen"
  | "glm"
  | "doubao"
  | "grok"
  | "google-ai-studio"
  | "unknown";
```

- [ ] **Step 2: Write catalog tests first**

Create `extensions/web-agents-extension/src/providers/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  detectProvider,
  detectProviderByHostname,
  getDefaultParticipants,
  getProviderById,
  getProviderContentMatches,
  mergeInputSelectors
} from "./catalog";

describe("provider catalog", () => {
  it("contains the first-phase providers", () => {
    expect(PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      "chatgpt",
      "gemini",
      "deepseek",
      "kimi",
      "qwen",
      "glm",
      "doubao",
      "grok",
      "google-ai-studio"
    ]);
  });

  it("matches hostnames and subdomains", () => {
    expect(detectProviderByHostname("chatgpt.com")?.id).toBe("chatgpt");
    expect(detectProviderByHostname("www.doubao.com")?.id).toBe("doubao");
    expect(detectProviderByHostname("aistudio.google.com")?.id).toBe("google-ai-studio");
    expect(detectProviderByHostname("grok.com")?.id).toBe("grok");
  });

  it("returns unknown compatibility shape for unknown domains", () => {
    expect(detectProvider("example.com")).toEqual({ id: "unknown", label: "Unknown" });
  });

  it("has content matches for every provider", () => {
    for (const provider of PROVIDER_CATALOG) {
      expect(provider.label.length).toBeGreaterThan(0);
      expect(provider.defaultUrl.startsWith("https://")).toBe(true);
      expect(provider.hostnames.length).toBeGreaterThan(0);
      expect(provider.contentMatches.length).toBeGreaterThan(0);
    }
  });

  it("deduplicates selectors while preserving provider-first order", () => {
    const provider = getProviderById("qwen");
    expect(provider).toBeDefined();
    const selectors = mergeInputSelectors(provider!);
    expect(selectors[0]).toBe(".ql-editor");
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it("derives content matches and participants from catalog", () => {
    expect(getProviderContentMatches()).toContain("*://chatgpt.com/*");
    expect(getProviderContentMatches()).toContain("*://aistudio.google.com/*");
    expect(getDefaultParticipants()).toContainEqual(
      expect.objectContaining({ provider: "google-ai-studio", label: "Google AI Studio", enabled: false })
    );
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
npm test -- src/providers/catalog.test.ts
```

Expected: FAIL because `src/providers/catalog.ts` does not exist.

- [ ] **Step 4: Implement catalog**

Create `extensions/web-agents-extension/src/providers/catalog.ts`:

```ts
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
  "message-content",
  ".markdown",
  "article",
  "[class*='assistant']",
  "[class*='response']",
  "[class*='message']"
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
    responseSelectors: ["[data-message-author-role='assistant']", "article"],
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

export function mergeInputSelectors(provider: Pick<ProviderCatalogEntry, "inputSelectors" | "fallbackInputSelectors">): string[] {
  return unique([...provider.inputSelectors, ...(provider.fallbackInputSelectors ?? []), ...GLOBAL_FALLBACK_INPUT_SELECTORS]);
}

export function mergeResponseSelectors(provider?: Pick<ProviderCatalogEntry, "responseSelectors">): string[] {
  return unique([...(provider?.responseSelectors ?? []), ...GLOBAL_RESPONSE_SELECTORS]);
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
```

- [ ] **Step 5: Keep compatibility exports**

Replace `extensions/web-agents-extension/src/adapters/providers.ts` with:

```ts
export {
  PROVIDER_CATALOG as PROVIDERS,
  detectProvider,
  detectProviderByHostname,
  getDefaultParticipants,
  getProviderById,
  getProviderById as getProviderDefinition,
  getProviderContentMatches,
  mergeInputSelectors,
  mergeResponseSelectors
} from "../providers/catalog";

export type {
  KnownProviderId,
  ProviderCapability,
  ProviderCatalogEntry,
  ProviderVerificationState
} from "../providers/catalog";
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- src/providers/catalog.test.ts
npm run typecheck
```

Expected: both pass.

- [ ] **Step 7: Commit**

```powershell
git add extensions/web-agents-extension/src/shared/types.ts extensions/web-agents-extension/src/providers/catalog.ts extensions/web-agents-extension/src/providers/catalog.test.ts extensions/web-agents-extension/src/adapters/providers.ts
git commit -m "Add provider catalog foundation"
```

---

### Task 3: Extract DOM Adapter Helpers

**Files:**
- Create: `extensions/web-agents-extension/src/adapters/dom.ts`
- Create: `extensions/web-agents-extension/src/adapters/dom.test.ts`
- Modify: `extensions/web-agents-extension/src/adapters/types.ts`

- [ ] **Step 1: Extend adapter types**

Update `extensions/web-agents-extension/src/adapters/types.ts` to:

```ts
import type { AdapterStatus, InsertResult, ProviderId, ResponseSnapshot } from "../shared/types";
import type { ProviderCatalogEntry } from "../providers/catalog";

export type ProviderDefinition = ProviderCatalogEntry;

export type SiteAdapter = {
  provider: ProviderId;
  detect(): Promise<AdapterStatus>;
  insertText(text: string): Promise<InsertResult>;
  captureLatestResponse?(): Promise<ResponseSnapshot | null>;
};

export type RuntimeSiteAdapter = SiteAdapter & {
  detectSync(): AdapterStatus;
  captureLatestResponseSync(): ResponseSnapshot | null;
};
```

- [ ] **Step 2: Write DOM tests first**

Create `extensions/web-agents-extension/src/adapters/dom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findInput, insertIntoElement, captureLatestResponse } from "./dom";
import { getProviderById } from "../providers/catalog";

describe("DOM adapter helpers", () => {
  it("finds visible textarea by provider selector", () => {
    document.body.innerHTML = `<textarea style="width:200px;height:40px"></textarea>`;
    const provider = getProviderById("deepseek");
    const candidate = findInput(document, provider);
    expect(candidate?.selector).toBe("textarea");
  });

  it("writes native textarea values and dispatches input", () => {
    document.body.innerHTML = `<textarea style="width:200px;height:40px"></textarea>`;
    const textarea = document.querySelector("textarea")!;
    let inputEvents = 0;
    textarea.addEventListener("input", () => inputEvents += 1);
    expect(insertIntoElement(textarea, "hello")).toBe(true);
    expect(textarea.value).toBe("hello");
    expect(inputEvents).toBe(1);
  });

  it("writes contenteditable values", () => {
    document.body.innerHTML = `<div contenteditable="true" style="width:200px;height:40px"></div>`;
    const editor = document.querySelector("div")!;
    expect(insertIntoElement(editor, "hello editable")).toBe(true);
    expect(editor.textContent).toContain("hello editable");
  });

  it("captures the latest visible response candidate", () => {
    document.body.innerHTML = `
      <article style="width:200px;height:40px">short</article>
      <article style="width:200px;height:40px">This is the latest assistant response with enough text.</article>
    `;
    const provider = getProviderById("chatgpt");
    const snapshot = captureLatestResponse(document, "chatgpt", provider);
    expect(snapshot?.provider).toBe("chatgpt");
    expect(snapshot?.text).toContain("latest assistant response");
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
npm test -- src/adapters/dom.test.ts
```

Expected: FAIL because `src/adapters/dom.ts` does not exist.

- [ ] **Step 4: Implement DOM helpers**

Create `extensions/web-agents-extension/src/adapters/dom.ts`:

```ts
import type { ProviderId, ResponseSnapshot } from "../shared/types";
import type { ProviderCatalogEntry } from "../providers/catalog";
import { mergeInputSelectors, mergeResponseSelectors } from "../providers/catalog";

export type WritableElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;
export type InputCandidate = {
  element: WritableElement;
  selector: string;
};

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const styleWidth = Number.parseFloat(style.width || "0");
  const styleHeight = Number.parseFloat(style.height || "0");
  const hasLayoutBox = rect.width > 40 && rect.height > 16;
  const hasStyleBox = styleWidth > 40 && styleHeight > 16;
  return (hasLayoutBox || hasStyleBox) && style.visibility !== "hidden" && style.display !== "none";
}

export function isWritableElement(element: Element): element is WritableElement {
  if (!isVisible(element)) return false;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLInputElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLElement) {
    return element.isContentEditable || element.getAttribute("contenteditable") === "true" || element.getAttribute("role") === "textbox";
  }
  return false;
}

export function findActiveInput(documentRef: Document): InputCandidate | null {
  const active = documentRef.activeElement;
  if (active && isWritableElement(active)) {
    return { element: active, selector: "document.activeElement" };
  }
  return null;
}

export function findInput(documentRef: Document, provider?: ProviderCatalogEntry): InputCandidate | null {
  const activeInput = findActiveInput(documentRef);
  if (activeInput) return activeInput;

  const selectors = provider ? mergeInputSelectors(provider) : [];
  for (const selector of selectors) {
    const candidates = Array.from(documentRef.querySelectorAll(selector));
    const element = candidates.find(isWritableElement);
    if (element) return { element, selector };
  }

  return null;
}

export function setNativeTextValue(input: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function replaceContentEditableText(element: HTMLElement, text: string): void {
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand?.("insertText", false, text);
  if (!inserted) element.textContent = text;

  const inputEvent =
    typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      : new Event("input", { bubbles: true });
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function insertIntoElement(element: WritableElement, text: string): boolean {
  element.focus();

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    setNativeTextValue(element, text);
    return true;
  }

  if (
    element instanceof HTMLElement &&
    (element.isContentEditable || element.getAttribute("contenteditable") === "true" || element.getAttribute("role") === "textbox")
  ) {
    replaceContentEditableText(element, text);
    return true;
  }

  return false;
}

export function captureLatestResponse(
  documentRef: Document,
  provider: ProviderId,
  providerDefinition?: ProviderCatalogEntry
): ResponseSnapshot | null {
  const candidates = mergeResponseSelectors(providerDefinition)
    .flatMap((selector) => Array.from(documentRef.querySelectorAll<HTMLElement>(selector)))
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
```

- [ ] **Step 5: Run DOM tests and typecheck**

Run:

```powershell
npm test -- src/adapters/dom.test.ts
npm run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git add extensions/web-agents-extension/src/adapters/types.ts extensions/web-agents-extension/src/adapters/dom.ts extensions/web-agents-extension/src/adapters/dom.test.ts
git commit -m "Extract DOM helpers for site adapters"
```

---

### Task 4: Add Runtime Adapter and Slim Content Script

**Files:**
- Create: `extensions/web-agents-extension/src/adapters/runtime.ts`
- Modify: `extensions/web-agents-extension/src/content/index.ts`

- [ ] **Step 1: Create runtime adapter**

Create `extensions/web-agents-extension/src/adapters/runtime.ts`:

```ts
import type { AdapterStatus, InsertResult, ResponseSnapshot } from "../shared/types";
import type { RuntimeSiteAdapter } from "./types";
import { detectProviderByHostname } from "../providers/catalog";
import { captureLatestResponse, findInput, insertIntoElement } from "./dom";

export function createSiteAdapter(windowRef: Window = window): RuntimeSiteAdapter {
  const providerDefinition = detectProviderByHostname(windowRef.location.hostname);
  const providerId = providerDefinition?.id ?? "unknown";
  const label = providerDefinition?.label ?? "Unknown";

  return {
    provider: providerId,
    detectSync(): AdapterStatus {
      const input = findInput(windowRef.document, providerDefinition);

      if (!providerDefinition) {
        return {
          provider: "unknown",
          label,
          readiness: "unsupported",
          canInsert: false,
          url: windowRef.location.href,
          reason: "当前页面暂未配置站点适配器。"
        };
      }

      return {
        provider: providerDefinition.id,
        label,
        readiness: input ? "supported" : "no_input",
        canInsert: Boolean(input),
        url: windowRef.location.href,
        matchedSelector: input?.selector,
        reason: input ? undefined : "没有找到可写入的原生输入框，请先打开或聚焦网页对话输入栏。"
      };
    },
    async detect() {
      return this.detectSync();
    },
    async insertText(text: string): Promise<InsertResult> {
      const input = findInput(windowRef.document, providerDefinition);

      if (!input) {
        return {
          ok: false,
          provider: providerId,
          message: "没有找到可写入的原生输入框，请先打开或聚焦网页对话输入栏。"
        };
      }

      const ok = insertIntoElement(input.element, text);
      return {
        ok,
        provider: providerId,
        message: ok ? "已插入当前网页输入框，请在网页中手动确认发送。" : "输入框类型暂不支持。"
      };
    },
    captureLatestResponseSync(): ResponseSnapshot | null {
      return captureLatestResponse(windowRef.document, providerId, providerDefinition);
    },
    async captureLatestResponse(): Promise<ResponseSnapshot | null> {
      return this.captureLatestResponseSync();
    }
  };
}
```

- [ ] **Step 2: Replace content script message routing**

Replace `extensions/web-agents-extension/src/content/index.ts` with:

```ts
import { createSiteAdapter } from "../adapters/runtime";

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const adapter = createSiteAdapter();

  if (message.type === "tab:detect") {
    sendResponse({ ok: true, type: "tab:detect", data: adapter.detectSync() });
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
    const snapshot = adapter.captureLatestResponseSync();
    if (snapshot) {
      sendResponse({ ok: true, type: "tab:capture-latest", data: snapshot });
    } else {
      sendResponse({ ok: false, type: "tab:capture-latest", error: "暂未找到可捕获的最新回复快照。" });
    }
    return false;
  }

  return false;
});
```

- [ ] **Step 3: Confirm content script has no provider list**

Run:

```powershell
rg "hostnames|inputSelectors|PROVIDERS|ContentProviderDefinition" src/content src/adapters
```

Expected: `src/content/index.ts` has no provider catalog declarations. Provider catalog declarations only appear under `src/providers/catalog.ts`.

- [ ] **Step 4: Run checks**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add extensions/web-agents-extension/src/adapters/runtime.ts extensions/web-agents-extension/src/content/index.ts
git commit -m "Route content script through runtime adapter"
```

---

### Task 5: Wire Catalog Into Background, Defaults, and Manifest

**Files:**
- Modify: `extensions/web-agents-extension/src/background/index.ts`
- Modify: `extensions/web-agents-extension/src/shared/defaults.ts`
- Modify: `extensions/web-agents-extension/public/manifest.json`

- [ ] **Step 1: Update background import and lookup**

In `extensions/web-agents-extension/src/background/index.ts`, replace:

```ts
import { getProviderDefinition } from "../adapters/providers";
```

with:

```ts
import { getProviderById } from "../providers/catalog";
```

Then in `openProvider`, replace:

```ts
const provider = getProviderDefinition(providerId);
```

with:

```ts
const provider = getProviderById(providerId);
```

- [ ] **Step 2: Update default participants**

In `extensions/web-agents-extension/src/shared/defaults.ts`, replace:

```ts
import type { ExtensionConfig, McpStatus, ModelParticipant } from "./types";
import { PROVIDERS } from "../adapters/providers";
```

with:

```ts
import type { ExtensionConfig, McpStatus, ModelParticipant } from "./types";
import { getDefaultParticipants } from "../providers/catalog";
```

Then replace `DEFAULT_PARTICIPANTS` with:

```ts
export const DEFAULT_PARTICIPANTS: ModelParticipant[] = getDefaultParticipants();
```

- [ ] **Step 3: Update manifest matches**

In `extensions/web-agents-extension/public/manifest.json`, add Grok and Google AI Studio to `host_permissions`:

```json
"*://grok.com/*",
"*://x.com/*",
"*://twitter.com/*",
"*://aistudio.google.com/*"
```

Add the same entries to the single content script `matches` array.

- [ ] **Step 4: Run checks**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add extensions/web-agents-extension/src/background/index.ts extensions/web-agents-extension/src/shared/defaults.ts extensions/web-agents-extension/public/manifest.json
git commit -m "Wire provider catalog into extension runtime"
```

---

### Task 6: Update Documentation

**Files:**
- Modify: `extensions/web-agents-extension/README.md`
- Modify: `docs/ARCH-web-agents-extension.md`

- [ ] **Step 1: Update extension README**

Add this section near the top of `extensions/web-agents-extension/README.md`:

```markdown
## 当前阶段：Provider Adapter Foundation

第一阶段先统一网页 AI 站点适配底座。Provider 信息集中在 `src/providers/catalog.ts`，background、content script、多模型看板和默认参与模型都从这里读取。

当前 provider 范围：

- ChatGPT
- Gemini
- DeepSeek
- Kimi
- GLM / Zhipu
- Qwen
- 豆包
- Grok
- Google AI Studio

默认行为仍是 insert-only：插件只把任务写入网页原生输入框，不自动发送。

验证命令：

```powershell
npm test
npm run typecheck
npm run build
```
```

- [ ] **Step 2: Update architecture doc**

In `docs/ARCH-web-agents-extension.md`, update the Phase 1 section so it includes:

```markdown
### Phase 1: Provider Adapter Foundation

- 建立唯一 provider catalog。
- 拆分 content script、DOM helper 和 runtime adapter。
- 支持 ChatGPT、Gemini、DeepSeek、Kimi、GLM、Qwen、豆包、Grok、Google AI Studio 的基础识别和插入规则。
- 保持默认 insert-only，不自动发送。
- 建立 Vitest/jsdom 测试基线。
```

- [ ] **Step 3: Run documentation grep**

Run:

```powershell
rg "Provider Adapter Foundation|src/providers/catalog.ts|Google AI Studio|Grok" extensions/web-agents-extension/README.md docs/ARCH-web-agents-extension.md
```

Expected: all four terms appear.

- [ ] **Step 4: Commit**

```powershell
git add extensions/web-agents-extension/README.md docs/ARCH-web-agents-extension.md
git commit -m "Document provider adapter foundation"
```

---

### Task 7: Final Verification and Branch Audit

**Files:**
- No code files expected unless a previous task revealed a defect.

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected:

- Vitest passes.
- TypeScript passes.
- Vite build emits `dist/` successfully.

- [ ] **Step 2: Check source boundaries**

Run:

```powershell
rg "ContentProviderDefinition|const PROVIDERS|hostnames:|inputSelectors:" src/content src/background src/shared src/ui
```

Expected:

- No provider catalog declarations in `src/content`, `src/background`, `src/shared`, or `src/ui`.
- Provider catalog declarations are only in `src/providers/catalog.ts`.

- [ ] **Step 3: Check manifest provider coverage**

Run:

```powershell
rg "grok.com|aistudio.google.com|chat.qwen.ai|doubao.com" public/manifest.json
```

Expected: all provider hosts are present.

- [ ] **Step 4: Check git status**

Run:

```powershell
git status --short --branch
```

Expected: clean working tree on `codex/new-plugin-rewrite`.

- [ ] **Step 5: Report**

Summarize:

- New catalog path.
- Content split paths.
- Added providers.
- Commands run and pass/fail status.
- Any providers marked as needing manual verification.
