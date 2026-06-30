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
      position: relative;
      z-index: 2147483645;
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
      vertical-align: middle;
    }

    .web-agents-trigger,
    .web-agents-menu-button {
      all: initial;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      cursor: pointer;
      font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      letter-spacing: 0;
      user-select: none;
    }

    .web-agents-trigger {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      border: 1px solid rgba(100, 116, 139, 0.28);
      background: rgba(255, 255, 255, 0.92);
      color: #17202a;
      font: 800 11px/1 Inter, "Segoe UI", system-ui, sans-serif;
    }

    .web-agents-trigger:hover,
    .web-agents-trigger[aria-expanded="true"] {
      border-color: rgba(37, 99, 235, 0.45);
      background: #eff6ff;
      color: #1d4ed8;
    }

    .web-agents-trigger:focus-visible,
    .web-agents-menu-button:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.28);
      outline-offset: 3px;
    }

    .web-agents-menu {
      position: absolute;
      right: 0;
      bottom: 38px;
      display: grid;
      gap: 4px;
      min-width: 124px;
      padding: 8px;
      border: 1px solid rgba(100, 116, 139, 0.22);
      border-radius: 8px;
      background: #17202a;
      color: #f8fafc;
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.24);
    }

    .web-agents-menu[hidden] {
      display: none;
    }

    .web-agents-menu-button {
      min-height: 34px;
      justify-content: flex-start;
      width: 100%;
      padding: 0 10px;
      border-radius: 6px;
      color: #f8fafc;
      background: rgba(148, 163, 184, 0.17);
      font: 700 12px/1 "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
      white-space: nowrap;
    }

    .web-agents-menu-button:hover {
      background: rgba(96, 165, 250, 0.28);
      color: #ffffff;
    }

    .web-agents-menu-button.primary {
      background: #2563eb;
    }
  `;
  return style;
}

function createMenuButton(documentRef: Document, action: string, label: string): HTMLButtonElement {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = action === "insert" ? "web-agents-menu-button primary" : "web-agents-menu-button";
  button.dataset.action = action;
  button.textContent = label;
  return button;
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
  const menu = documentRef.createElement("div");
  const insertButton = createMenuButton(documentRef, "insert", "插入说明");
  const panelButton = createMenuButton(documentRef, "panel", "打开面板");
  const configureButton = createMenuButton(documentRef, "configure", "配置");

  function setMenuOpen(isOpen: boolean): void {
    menu.hidden = !isOpen;
    button.setAttribute("aria-expanded", String(isOpen));
  }

  function openMenu(): void {
    setMenuOpen(true);
  }

  function closeMenu(): void {
    setMenuOpen(false);
  }

  button.type = "button";
  button.className = "web-agents-trigger";
  button.textContent = "WA";
  button.setAttribute("aria-label", "Web Agents actions");
  button.setAttribute("aria-haspopup", "menu");
  button.title = "WA: 打开工具菜单";

  menu.className = "web-agents-menu";
  menu.setAttribute("role", "menu");
  menu.append(insertButton, panelButton, configureButton);
  setMenuOpen(false);

  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && onOpenPanel) {
      closeMenu();
      onOpenPanel();
      return;
    }

    setMenuOpen(menu.hidden);
  });
  button.addEventListener("mouseenter", openMenu);
  host.addEventListener("mouseenter", openMenu);
  host.addEventListener("mouseleave", closeMenu);
  host.addEventListener("focusin", openMenu);
  host.addEventListener("focusout", (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && host.contains(nextTarget)) return;
    closeMenu();
  });

  insertButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    void onInsertInstructions();
  });
  panelButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    onOpenPanel?.();
  });
  configureButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    onOpenPanel?.();
  });

  shadow.append(createInlineEntryStyles(documentRef), button, menu);
  container.append(host);
  return true;
}
