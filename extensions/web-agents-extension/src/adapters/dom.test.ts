import { describe, expect, it } from "vitest";
import { captureLatestResponse, captureRecentConversation, findInput, insertIntoElement } from "./dom";
import { getProviderById } from "../providers/catalog";

describe("DOM adapter helpers", () => {
  it("finds visible textarea by provider selector", () => {
    document.body.innerHTML = `<textarea style="width:200px;height:40px"></textarea>`;
    const provider = getProviderById("deepseek");
    const candidate = findInput(document, provider);
    expect(candidate?.selector).toBe("textarea");
  });

  it("writes native textarea values and dispatches input", () => {
    document.body.innerHTML = `<textarea style="width:200px;height:40px"></textarea>`;
    const textarea = document.querySelector("textarea")!;
    let inputEvents = 0;
    textarea.addEventListener("input", () => {
      inputEvents += 1;
    });
    expect(insertIntoElement(textarea, "hello")).toBe(true);
    expect(textarea.value).toBe("hello");
    expect(inputEvents).toBe(1);
  });

  it("writes contenteditable values", () => {
    document.body.innerHTML = `<div contenteditable="true" style="width:200px;height:40px"></div>`;
    const editor = document.querySelector("div")!;
    expect(insertIntoElement(editor, "hello editable")).toBe(true);
    expect(editor.textContent).toContain("hello editable");
  });

  it("captures the latest visible response candidate", () => {
    document.body.innerHTML = `
      <article style="width:200px;height:40px">short</article>
      <article style="width:200px;height:40px">This is the latest assistant response with enough text.</article>
    `;
    const provider = getProviderById("chatgpt");
    const snapshot = captureLatestResponse(document, "chatgpt", provider);
    expect(snapshot?.provider).toBe("chatgpt");
    expect(snapshot?.text).toContain("latest assistant response");
  });

  it("captures bounded recent visible conversation messages", () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="user" style="width:500px;height:40px">用户问题</article>
        <article data-message-author-role="assistant" style="width:500px;height:80px">GPT 初步回答内容足够长，用于模拟真实回复。</article>
        <article data-message-author-role="assistant" style="width:500px;height:80px">GPT 第二条回答内容足够长，用于模拟真实回复。</article>
      </main>
    `;

    const capture = captureRecentConversation(document, "chatgpt", getProviderById("chatgpt"), 2);

    expect(capture.provider).toBe("chatgpt");
    expect(capture.messages).toHaveLength(2);
    expect(capture.messages[0].text).toContain("GPT 初步回答");
    expect(capture.messages[1].text).toContain("GPT 第二条回答");
  });
});
