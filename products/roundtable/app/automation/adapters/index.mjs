import { ChatGptAdapter } from "./chatgpt.mjs";
import { DeepSeekAdapter } from "./deepseek.mjs";
import { DoubaoAdapter } from "./doubao.mjs";

export function createProviderAdapters({ urlOverrides = {} } = {}) {
  return new Map([
    ["chatgpt", new ChatGptAdapter({ url: urlOverrides.chatgpt })],
    ["deepseek", new DeepSeekAdapter({ url: urlOverrides.deepseek })],
    ["doubao", new DoubaoAdapter({ url: urlOverrides.doubao })],
  ]);
}

export { BaseProviderAdapter } from "./base-adapter.mjs";
export { ChatGptAdapter } from "./chatgpt.mjs";
export { DeepSeekAdapter } from "./deepseek.mjs";
export { DoubaoAdapter } from "./doubao.mjs";
