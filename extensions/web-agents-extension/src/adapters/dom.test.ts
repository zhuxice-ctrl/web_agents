import { describe, expect, it } from "vitest";
import { captureLatestResponse, findInput, insertIntoElement } from "./dom";
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
});
