(() => {
  const GROK_HOST_RE = /(^|\.)grok\.com$/i;
  const CONTAINER_ID = "mcp-popover-container";
  const STYLE_ID = "mcp-grok-local-fixed-style";
  const LOG_PREFIX = "[web_Agent Grok]";

  if (!GROK_HOST_RE.test(window.location.hostname)) {
    return;
  }

  const log = (...args) => console.debug(LOG_PREFIX, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, ...args);

  const inputSelectors = [
    'textarea[placeholder*="\u5e2e\u52a9"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Grok"]',
    'textarea[aria-label*="Grok"]',
    'textarea[aria-label*="Ask"]',
    'textarea[spellcheck="false"]',
    'textarea[data-gramm="false"]',
    'textarea',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"]',
    '[role="textbox"]',
  ];

  const sendButtonSelectors = [
    'button[aria-label="Submit"]',
    'button[aria-label*="Submit"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="\u53d1\u9001"]',
    'button[data-testid*="send"]',
    'button[type="submit"]',
  ];

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function findInput() {
    for (const selector of inputSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const visible = candidates.find(isVisible);
      if (visible) return visible;
    }
    return null;
  }

  function findSendButton() {
    for (const selector of sendButtonSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const visible = candidates.find((button) => isVisible(button) && !button.disabled);
      if (visible) return visible;
    }

    const input = findInput();
    const composer =
      input &&
      (input.closest("form") ||
        input.closest('[class*="composer"]') ||
        input.closest('[class*="input"]') ||
        input.parentElement);
    if (!composer) return null;

    const buttons = Array.from(composer.querySelectorAll("button")).filter(
      (button) => isVisible(button) && !button.disabled,
    );
    return buttons.find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`;
      return /submit|send|\u53d1\u9001/i.test(label);
    });
  }

  function setText(input, text) {
    input.focus();

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const nextValue = input.value && input.value.trim() ? `${input.value}\n\n${text}` : text;
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, nextValue);
      } else {
        input.value = nextValue;
      }
      input.selectionStart = input.selectionEnd = input.value.length;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (input.isContentEditable || input.getAttribute("contenteditable") === "true") {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection && selection.removeAllRanges();
      selection && selection.addRange(range);
      if ((input.textContent || "").trim()) {
        document.execCommand("insertText", false, "\n\n");
      }
      document.execCommand("insertText", false, text);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }

    return false;
  }

  function pressEnter(input) {
    input.focus();
    const events = ["keydown", "keypress", "keyup"];
    for (const type of events) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }

  function patchAdapter(adapter) {
    if (!adapter || adapter.__webAgentGrokPatched || adapter.name !== "GrokAdapter") {
      return false;
    }

    adapter.hostnames = ["grok.com"];
    adapter.isSupported = function isSupported() {
      return GROK_HOST_RE.test(window.location.hostname);
    };

    adapter.insertText = async function insertText(text) {
      const input = findInput();
      if (!input) {
        this.emitExecutionFailed && this.emitExecutionFailed("insertText", "Grok input not found");
        return false;
      }

      try {
        const ok = setText(input, text);
        if (!ok) throw new Error("Unsupported Grok input element");
        this.emitExecutionCompleted &&
          this.emitExecutionCompleted(
            "insertText",
            { text },
            { success: true, method: "grok-local-fixed", elementType: input.tagName.toLowerCase() },
          );
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emitExecutionFailed && this.emitExecutionFailed("insertText", message);
        return false;
      }
    };

    adapter.submitForm = async function submitForm() {
      const button = findSendButton();
      if (button) {
        button.click();
        this.emitExecutionCompleted &&
          this.emitExecutionCompleted("submitForm", {}, { success: true, method: "grok-local-fixed-button" });
        return true;
      }

      const input = findInput();
      if (!input) {
        this.emitExecutionFailed && this.emitExecutionFailed("submitForm", "Grok input not found");
        return false;
      }

      pressEnter(input);
      this.emitExecutionCompleted &&
        this.emitExecutionCompleted("submitForm", {}, { success: true, method: "grok-local-fixed-enter" });
      return true;
    };

    adapter.__webAgentGrokPatched = true;
    log("adapter patched");
    return true;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTAINER_ID} {
        position: fixed;
        right: 148px;
        bottom: 94px;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        pointer-events: auto;
      }
      @media (max-width: 768px) {
        #${CONTAINER_ID} {
          right: 92px;
          bottom: 88px;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function positionContainer(container) {
    const input = findInput();
    if (!input) return;

    const rect = input.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 12) return;

    container.style.left = `${Math.max(12, Math.min(window.innerWidth - 150, rect.right - 190))}px`;
    container.style.top = `${Math.max(12, Math.min(window.innerHeight - 54, rect.top + Math.max(2, (rect.height - 38) / 2)))}px`;
    container.style.right = "auto";
    container.style.bottom = "auto";
  }

  function renderPopoverInto(container, adapter) {
    if (adapter && typeof adapter.renderMCPPopover === "function") {
      container.dataset.webAgentGrokRendering = "1";
      adapter.renderMCPPopover(container);
      window.setTimeout(() => {
        if (container.childElementCount === 0) {
          delete container.dataset.webAgentGrokRendering;
        }
      }, 2000);
      return true;
    }
    return false;
  }

  function ensurePopover() {
    const adapter = window.mcpAdapter;
    patchAdapter(adapter);

    injectStyle();

    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = CONTAINER_ID;
      document.body.appendChild(container);
    }

    positionContainer(container);
    if (container.childElementCount > 0) return true;
    if (container.dataset.webAgentGrokRendering === "1") return true;

    if (renderPopoverInto(container, adapter)) {
      log("fallback popover rendered");
      return true;
    }

    warn("adapter popover renderer not ready yet");
    return false;
  }

  function start() {
    let attempts = 0;
    const maxAttempts = 40;
    const timer = window.setInterval(() => {
      attempts += 1;
      const ok = ensurePopover();
      if (ok && window.mcpAdapter && window.mcpAdapter.__webAgentGrokPatched) {
        window.clearInterval(timer);
      } else if (attempts >= maxAttempts) {
        window.clearInterval(timer);
      }
    }, 500);

    const observer = new MutationObserver(() => {
      ensurePopover();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("resize", () => {
      const container = document.getElementById(CONTAINER_ID);
      if (container) positionContainer(container);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
