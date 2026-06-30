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
      position: absolute;
      right: 52px;
      bottom: 10px;
      z-index: 2147483645;
      width: 34px;
      height: 34px;
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
    }

    button {
      all: initial;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 999px;
      border: 1px solid rgba(37, 99, 235, 0.22);
      background: #17202a;
      color: #ffffff;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
      cursor: pointer;
      font: 800 11px/1 Inter, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0;
      user-select: none;
    }

    button:hover {
      background: #2563eb;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.24);
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
  onOpenPanel: () => void
): boolean {
  const existing = documentRef.getElementById(INLINE_ENTRY_HOST_ID);
  if (existing?.isConnected) return false;

  const target = findInlineEntryTarget(documentRef, provider);
  if (!target) return false;

  const { container } = target;
  const currentPosition = documentRef.defaultView?.getComputedStyle(container).position;
  if (!currentPosition || currentPosition === "static") {
    container.style.position = "relative";
  }

  const host = documentRef.createElement("div");
  host.id = INLINE_ENTRY_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const button = documentRef.createElement("button");

  button.type = "button";
  button.textContent = "WA";
  button.setAttribute("aria-label", "Open Web Agents");
  button.title = "Open Web Agents";
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenPanel();
  });

  shadow.append(createInlineEntryStyles(documentRef), button);
  container.append(host);
  return true;
}
