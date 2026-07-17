import { BaseProviderAdapter } from "./base-adapter.mjs";

export class DeepSeekAdapter extends BaseProviderAdapter {
  constructor({ url = "https://chat.deepseek.com/" } = {}) {
    super({
      id: "deepseek",
      label: "DeepSeek",
      url,
      inputSelectors: [
        "textarea",
        "div[contenteditable='true'][role='textbox']",
        "div[contenteditable='true']",
      ],
      submitSelectors: [
        "button[type='submit']",
        "button[aria-label*='Send']",
        "button[aria-label*='发送']",
        "button[class*='send']",
        "button:has-text('发送')",
      ],
      responseSelectors: [
        ".ds-markdown",
        "[class*='ds-markdown']",
        "[class*='markdown']:not([contenteditable='true'])",
        "[data-role='assistant']",
      ],
      busySelectors: [
        "[data-testid='stop-button']",
        "button[aria-label*='Stop']",
        "button[aria-label*='停止']",
        "button[class*='stop']",
      ],
      loginSelectors: [
        "button:has-text('登录')",
        "button:has-text('Log in')",
        "a[href*='login']",
      ],
    });
  }
}
