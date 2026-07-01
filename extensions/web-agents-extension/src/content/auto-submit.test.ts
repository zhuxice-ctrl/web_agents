import { describe, expect, it, vi } from "vitest";
import { sendTextIfComposerIdle, shouldStopAutoSubmitRetry } from "./auto-submit";

describe("auto-submit helper", () => {
  it("inserts and submits function results when the composer is idle", async () => {
    document.body.innerHTML = `
      <form>
        <textarea style="width:240px;height:48px"></textarea>
        <button type="button" aria-label="Send">Send</button>
      </form>
    `;
    const button = document.querySelector("button")!;
    const click = vi.spyOn(button, "click");

    const result = await sendTextIfComposerIdle(document, undefined, "<function_result>ok</function_result>");

    expect(result.state).toBe("sent");
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("textarea")?.value).toContain("<function_result>ok</function_result>");
  });

  it("does not overwrite user text in the composer", async () => {
    document.body.innerHTML = `
      <form>
        <textarea style="width:240px;height:48px">user draft</textarea>
        <button type="button" aria-label="Send">Send</button>
      </form>
    `;

    const result = await sendTextIfComposerIdle(document, undefined, "<function_result>ok</function_result>");

    expect(result.state).toBe("input_busy");
    expect(document.querySelector("textarea")?.value).toBe("user draft");
  });

  it("supports send buttons that become enabled after inserting text", async () => {
    document.body.innerHTML = `
      <form>
        <textarea style="width:240px;height:48px"></textarea>
        <button type="button" aria-label="Send" disabled>Send</button>
      </form>
    `;
    const textarea = document.querySelector("textarea")!;
    const button = document.querySelector("button")!;
    const click = vi.spyOn(button, "click");
    textarea.addEventListener("input", () => {
      button.disabled = false;
    });

    const result = await sendTextIfComposerIdle(document, undefined, "<function_result>ok</function_result>");

    expect(result.state).toBe("sent");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("supports send buttons that appear only after inserting text", async () => {
    document.body.innerHTML = `
      <form>
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;
    const form = document.querySelector("form")!;
    const textarea = document.querySelector("textarea")!;
    textarea.addEventListener("input", () => {
      if (!form.querySelector("button")) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", "Send");
        button.textContent = "Send";
        form.append(button);
      }
    });

    const result = await sendTextIfComposerIdle(document, undefined, "<function_result>ok</function_result>");

    expect(result.state).toBe("sent");
    expect(form.querySelector("button")).not.toBeNull();
  });

  it("supports send buttons outside a narrow editor parent", async () => {
    document.body.innerHTML = `
      <main>
        <div class="editor-shell">
          <div role="textbox" contenteditable="true" style="width:240px;height:48px"></div>
        </div>
        <button type="button" data-testid="send-button">Send</button>
      </main>
    `;
    const button = document.querySelector("button")!;
    const click = vi.spyOn(button, "click");

    const result = await sendTextIfComposerIdle(document, undefined, "<function_result>ok</function_result>");

    expect(result.state).toBe("sent");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("does not leave function results in the composer when no send control is available", async () => {
    document.body.innerHTML = `
      <form>
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;

    const result = await sendTextIfComposerIdle(document, undefined, "<function_result>ok</function_result>");

    expect(result.state).toBe("no_submit");
    expect(document.querySelector("textarea")?.value).toBe("");
  });

  it("returns a stable no_submit result without leaving text behind", async () => {
    document.body.innerHTML = `
      <form>
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;

    const result = await sendTextIfComposerIdle(document, undefined, "<roundtable>next</roundtable>");

    expect(result.state).toBe("no_submit");
    expect(result.message).toContain("不可发送");
    expect(document.querySelector("textarea")?.value).toBe("");
  });

  it("stops retrying when the page has no usable send control", () => {
    expect(shouldStopAutoSubmitRetry("no_submit", 1, 20)).toBe(true);
    expect(shouldStopAutoSubmitRetry("input_busy", 1, 20)).toBe(true);
    expect(shouldStopAutoSubmitRetry("no_input", 1, 20)).toBe(false);
    expect(shouldStopAutoSubmitRetry("no_input", 20, 20)).toBe(true);
  });
});
