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
      <div data-message-author-role="assistant" style="width:200px;height:40px">short</div>
      <div data-message-author-role="assistant" style="width:200px;height:40px">This is the latest assistant response with enough text.</div>
    `;
    const provider = getProviderById("chatgpt");
    const snapshot = captureLatestResponse(document, "chatgpt", provider);
    expect(snapshot?.provider).toBe("chatgpt");
    expect(snapshot?.text).toContain("latest assistant response");
  });

  it("does not capture a submitted user message as the latest response", () => {
    document.body.innerHTML = `
      <article data-message-author-role="assistant" style="width:200px;height:40px">This is the latest assistant response with enough text.</article>
      <article data-message-author-role="user" style="width:200px;height:40px">This is the newly submitted user prompt with enough text.</article>
    `;
    const snapshot = captureLatestResponse(document, "chatgpt", getProviderById("chatgpt"));

    expect(snapshot?.speaker).toBe("assistant");
    expect(snapshot?.text).toContain("assistant response");
    expect(snapshot?.text).not.toContain("user prompt");
  });

  it("inherits the role from a message ancestor before accepting nested markdown", () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant" style="width:300px;height:60px">
        <div class="markdown" style="width:280px;height:40px">Verified assistant response with enough text.</div>
      </div>
      <div class="group/turn-messages" style="width:300px;height:80px">
        <div data-message-author-role="user" style="width:280px;height:60px">
          [WEB_AGENT_FIXED_INSTRUCTION_BEGIN] user prompt example function_call
        </div>
      </div>
    `;

    const snapshot = captureLatestResponse(document, "chatgpt", getProviderById("chatgpt"));

    expect(snapshot?.speaker).toBe("assistant");
    expect(snapshot?.text).toContain("Verified assistant response");
    expect(snapshot?.text).not.toContain("WEB_AGENT_FIXED_INSTRUCTION_BEGIN");
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
