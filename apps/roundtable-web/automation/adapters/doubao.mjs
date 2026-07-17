import { BaseProviderAdapter } from "./base-adapter.mjs";

export class DoubaoAdapter extends BaseProviderAdapter {
  constructor({ url = "https://www.doubao.com/chat/" } = {}) {
    super({
      id: "doubao",
      label: "豆包",
      url,
      inputSelectors: [
        "textarea",
        ".semi-input-textarea[contenteditable='true']",
        "div[contenteditable='true'][role='textbox']",
        "div[contenteditable='true']",
      ],
      submitSelectors: [
        "button[class*='g-send-msg-btn']",
        "button[aria-label*='Send']",
        "button[aria-label*='发送']",
        "button[class*='send']",
        "button:has-text('发送')",
      ],
      responseSelectors: [
        "[data-copy-telemetry='right_click_copy'] [data-message-id]",
        "[data-testid='message-assistant']",
        "[data-testid*='message'][data-testid*='assistant']",
        ".flow-markdown-body",
        "[class*='markdown']:not([contenteditable='true'])",
        "[class*='answer-content']",
      ],
      busySelectors: [
        "[data-testid='stop-button']",
        "button[aria-label*='Stop']",
        "button[aria-label*='停止']",
        "button[class*='stop']",
      ],
      loginSelectors: [
        "button:has-text('登录')",
        "button:has-text('立即登录')",
        "a[href*='login']",
      ],
    });
  }
}
