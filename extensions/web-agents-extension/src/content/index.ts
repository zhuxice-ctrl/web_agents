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
