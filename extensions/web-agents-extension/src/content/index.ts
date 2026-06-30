import { createSiteAdapter } from "../adapters/runtime";
import { detectProviderByHostname } from "../providers/catalog";
import type { ProviderId } from "../shared/types";
import type { ExtensionResponse } from "../shared/messages";
import { buildWebAgentInstructionTemplate } from "../mcp/instruction-template";
import { formatFunctionResult } from "../mcp/tool-call-protocol";
import { mountInlineEntry } from "./inline-entry";
import { collectToolCallsFromDocument } from "./tool-call-scanner";

const OVERLAY_HOST_ID = "web-agents-overlay-root";
const PANEL_OPEN_STORAGE_KEY = "webAgentsOverlayOpen";
const INLINE_ENTRY_RETRY_MS = 600;
const TOOL_CALL_SCAN_RETRY_MS = 700;

type OverlayController = {
  setOpen(isOpen: boolean): void;
};

let overlayControllerPromise: Promise<OverlayController | null> | null = null;
let inlineEntryTimer: number | undefined;
let toolCallScanTimer: number | undefined;
const executedToolCallFingerprintsByElement = new WeakMap<HTMLElement, Set<string>>();

function createOverlayStyles(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: Inter, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    }

    .web-agents-toggle {
      position: fixed;
      top: 50%;
      right: 12px;
      z-index: 2147483647;
      width: 44px;
      height: 44px;
      border: 1px solid rgba(37, 99, 235, 0.22);
      border-radius: 999px;
      background: #17202a;
      color: #ffffff;
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.2);
      cursor: pointer;
      font: 800 13px/1 Inter, "Segoe UI", sans-serif;
      letter-spacing: 0;
      transform: translateY(-50%);
      transition:
        right 160ms ease,
        background-color 160ms ease,
        box-shadow 160ms ease,
        transform 160ms ease;
    }

    .web-agents-toggle:hover {
      background: #2563eb;
      box-shadow: 0 16px 36px rgba(37, 99, 235, 0.25);
    }

    .web-agents-toggle:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.28);
      outline-offset: 3px;
    }

    .web-agents-toggle.open {
      top: 72px;
      right: 448px;
      transform: none;
    }

    .web-agents-panel {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 2147483646;
      width: 440px;
      max-width: calc(100vw - 56px);
      height: 100vh;
      border-left: 1px solid rgba(203, 213, 225, 0.9);
      background: #f6f7f8;
      box-shadow: -8px 0 34px rgba(15, 23, 42, 0.18);
      opacity: 0;
      pointer-events: none;
      transform: translateX(100%);
      transition:
        opacity 160ms ease,
        transform 160ms ease;
      overflow: hidden;
    }

    .web-agents-panel.open {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }

    .web-agents-frame {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: #f6f7f8;
    }

    @media (max-width: 620px) {
      .web-agents-panel {
        width: 100vw;
        max-width: 100vw;
      }

      .web-agents-toggle.open {
        right: 16px;
        top: 16px;
        transform: none;
      }
    }
  `;
  return style;
}

async function readOverlayOpenState(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(PANEL_OPEN_STORAGE_KEY);
    return Boolean(stored[PANEL_OPEN_STORAGE_KEY]);
  } catch {
    return false;
  }
}

function writeOverlayOpenState(isOpen: boolean): void {
  void chrome.storage.local.set({ [PANEL_OPEN_STORAGE_KEY]: isOpen });
}

function setPanelOpen(button: HTMLButtonElement, panel: HTMLElement, isOpen: boolean): void {
  button.classList.toggle("open", isOpen);
  panel.classList.toggle("open", isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
  button.title = isOpen ? "收起 Web Agents" : "展开 Web Agents";
  writeOverlayOpenState(isOpen);
}

async function mountPersistentOverlay(): Promise<OverlayController | null> {
  if (document.getElementById(OVERLAY_HOST_ID)) return null;
  if (!document.documentElement || !document.body) return null;

  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const button = document.createElement("button");
  const panel = document.createElement("section");
  const frame = document.createElement("iframe");

  button.className = "web-agents-toggle";
  button.type = "button";
  button.textContent = "WA";
  button.setAttribute("aria-label", "Web Agents");
  button.setAttribute("aria-expanded", "false");
  button.title = "展开 Web Agents";

  panel.className = "web-agents-panel";
  panel.setAttribute("aria-label", "Web Agents persistent panel");

  frame.className = "web-agents-frame";
  frame.src = chrome.runtime.getURL("index.html?surface=overlay");
  frame.title = "Web Agents";
  frame.allow = "clipboard-read; clipboard-write";
  panel.append(frame);

  shadow.append(createOverlayStyles(), button, panel);
  document.body.append(host);

  const initialOpen = await readOverlayOpenState();
  setPanelOpen(button, panel, initialOpen);

  const controller: OverlayController = {
    setOpen(isOpen: boolean): void {
      setPanelOpen(button, panel, isOpen);
    }
  };

  button.addEventListener("click", () => {
    controller.setOpen(!panel.classList.contains("open"));
  });

  return controller;
}

function ensurePersistentOverlay(): Promise<OverlayController | null> {
  overlayControllerPromise ??= mountPersistentOverlay();
  return overlayControllerPromise;
}

function openPersistentPanel(): void {
  void ensurePersistentOverlay().then((controller) => {
    controller?.setOpen(true);
  });
}

async function requestInstructionTemplate(provider: ProviderId): Promise<string> {
  const providerEntry = detectProviderByHostname(window.location.hostname);

  try {
    const response = (await chrome.runtime.sendMessage({
      type: "mcp:get-instruction-template",
      provider
    })) as ExtensionResponse<"mcp:get-instruction-template">;

    if (response.ok) {
      return response.data.text;
    }

    console.warn("[web-agents] Failed to load MCP instruction template:", response.error);
  } catch (error) {
    console.warn("[web-agents] Failed to request MCP instruction template:", error);
  }

  return buildWebAgentInstructionTemplate({
    provider,
    providerLabel: providerEntry?.label,
    tools: []
  });
}

async function insertWebAgentInstructions(): Promise<void> {
  const provider = detectProviderByHostname(window.location.hostname);
  const providerId = provider?.id ?? "unknown";
  const text = await requestInstructionTemplate(providerId);
  const adapter = createSiteAdapter();
  const result = await adapter.insertText(text);

  if (!result.ok) {
    console.warn("[web-agents] Failed to insert instruction template:", result.message);
  }
}

function mountInlinePageEntry(): boolean {
  const provider = detectProviderByHostname(window.location.hostname);
  return mountInlineEntry(document, provider, insertWebAgentInstructions, openPersistentPanel);
}

function scheduleInlineEntryMount(): void {
  if (inlineEntryTimer !== undefined) return;

  inlineEntryTimer = window.setTimeout(() => {
    inlineEntryTimer = undefined;
    mountInlinePageEntry();
  }, INLINE_ENTRY_RETRY_MS);
}

async function executeToolCallFromPage(
  item: ReturnType<typeof collectToolCallsFromDocument>[number]
): Promise<void> {
  const elementFingerprints = executedToolCallFingerprintsByElement.get(item.element) ?? new Set<string>();
  elementFingerprints.add(item.fingerprint);
  executedToolCallFingerprintsByElement.set(item.element, elementFingerprints);

  let formattedResult: string;
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "mcp:execute-tool-call",
      call: item.call
    })) as ExtensionResponse<"mcp:execute-tool-call">;

    formattedResult = response.ok
      ? response.data.formattedResult
      : formatFunctionResult(item.call.callId, `[web_Agent tool execution failed]\n${response.error}`, "error");
  } catch (error) {
    formattedResult = formatFunctionResult(
      item.call.callId,
      `[web_Agent tool execution failed]\n${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
  }

  const result = await createSiteAdapter().insertText(formattedResult);
  if (!result.ok) {
    console.warn("[web-agents] Failed to insert function result:", result.message);
  }
}

function scanAndExecuteToolCalls(): void {
  const provider = detectProviderByHostname(window.location.hostname);
  const items = collectToolCallsFromDocument(document, provider, new Set());

  for (const item of items) {
    if (executedToolCallFingerprintsByElement.get(item.element)?.has(item.fingerprint)) continue;
    void executeToolCallFromPage(item);
  }
}

function scheduleToolCallScan(): void {
  if (toolCallScanTimer !== undefined) return;

  toolCallScanTimer = window.setTimeout(() => {
    toolCallScanTimer = undefined;
    scanAndExecuteToolCalls();
  }, TOOL_CALL_SCAN_RETRY_MS);
}

function startInlineEntryObserver(): void {
  if (!document.body) return;

  scheduleInlineEntryMount();
  scheduleToolCallScan();

  const observer = new MutationObserver(() => {
    scheduleInlineEntryMount();
    scheduleToolCallScan();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

void readOverlayOpenState().then((isOpen) => {
  if (isOpen) void ensurePersistentOverlay();
});
startInlineEntryObserver();

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
