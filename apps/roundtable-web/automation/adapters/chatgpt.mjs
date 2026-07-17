import { BaseProviderAdapter } from "./base-adapter.mjs";

export class ChatGptAdapter extends BaseProviderAdapter {
  constructor({ url = "https://chatgpt.com/" } = {}) {
    super({
      id: "chatgpt",
      label: "ChatGPT",
      url,
      inputSelectors: [
        "#prompt-textarea",
        "textarea[name='prompt-textarea']",
        "[data-testid='composer'] [contenteditable='true']",
        "main form [contenteditable='true']",
      ],
      submitSelectors: [
        "[data-testid='send-button']",
        "button[data-testid='composer-send-button']",
        "button[aria-label*='Send']",
        "button[aria-label*='发送']",
        "main form button[type='submit']",
      ],
      responseSelectors: [
        "[data-message-author-role='assistant']",
        "article[data-testid^='conversation-turn-']:has([data-message-author-role='assistant'])",
      ],
      busySelectors: [
        "[data-testid='stop-button']",
        "button[aria-label*='Stop']",
        "button[aria-label*='停止']",
      ],
      loginSelectors: [
        "a[href*='auth/login']",
        "button:has-text('Log in')",
        "button:has-text('登录')",
      ],
      loginUrlPatterns: [
        /^https:\/\/auth\.openai\.com\//i,
        /\/(?:auth\/)?(?:login|sign[_-]?in)(?:[/?#]|$)/i,
      ],
    });
  }
}
