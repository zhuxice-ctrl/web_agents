import { findInput, type InputCandidate } from "../adapters/dom";
import type { ProviderCatalogEntry } from "../providers/catalog";

export const INLINE_ENTRY_HOST_ID = "web-agents-inline-entry-root";

type InlineEntryTarget = {
  input: InputCandidate;
  container: HTMLElement;
};

const COMPOSER_CONTAINER_SELECTOR = [
  "form",
  "[role='form']",
  "[data-testid*='composer' i]",
  "[class*='composer' i]",
  "[class*='chat-input' i]",
  "[class*='input-area' i]",
  "[class*='input-wrapper' i]",
  "[class*='editor' i]"
].join(",");

function findComposerContainer(inputElement: HTMLElement): HTMLElement | null {
  let current = inputElement.parentElement;
  let depth = 0;

  while (current && depth < 8) {
    if (current.matches(COMPOSER_CONTAINER_SELECTOR)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return inputElement.parentElement;
}

export function findInlineEntryTarget(
  documentRef: Document,
  provider?: ProviderCatalogEntry
): InlineEntryTarget | null {
  const input = findInput(documentRef, provider);
  if (!input || !(input.element instanceof HTMLElement)) return null;

  const container = findComposerContainer(input.element);
  if (!container) return null;

  return { input, container };
}

function createInlineEntryStyles(documentRef: Document): HTMLStyleElement {
  const style = documentRef.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 30px;
      height: 30px;
      margin: 0 4px;
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
      vertical-align: middle;
    }

    button {
      all: initial;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      border: 1px solid rgba(100, 116, 139, 0.28);
      background: rgba(255, 255, 255, 0.92);
      color: #17202a;
      cursor: pointer;
      font: 800 11px/1 Inter, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0;
      user-select: none;
    }

    button:hover {
      border-color: rgba(37, 99, 235, 0.45);
      background: #eff6ff;
      color: #1d4ed8;
    }

    button:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.28);
      outline-offset: 3px;
    }
  `;
  return style;
}

export function mountInlineEntry(
  documentRef: Document,
  provider: ProviderCatalogEntry | undefined,
  onInsertInstructions: () => void | Promise<void>,
  onOpenPanel?: () => void
): boolean {
  const existing = documentRef.getElementById(INLINE_ENTRY_HOST_ID);
  if (existing?.isConnected) return false;

  const target = findInlineEntryTarget(documentRef, provider);
  if (!target) return false;

  const { container } = target;

  const host = documentRef.createElement("div");
  host.id = INLINE_ENTRY_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const button = documentRef.createElement("button");

  button.type = "button";
  button.textContent = "WA";
  button.setAttribute("aria-label", "Insert Web Agents instructions");
  button.title = "WA: 插入工具说明；Shift+点击打开面板";
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && onOpenPanel) {
      onOpenPanel();
      return;
    }

    void onInsertInstructions();
  });

  shadow.append(createInlineEntryStyles(documentRef), button);
  container.append(host);
  return true;
}
