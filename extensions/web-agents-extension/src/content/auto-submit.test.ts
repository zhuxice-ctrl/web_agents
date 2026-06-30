import { describe, expect, it, vi } from "vitest";
import { sendTextIfComposerIdle } from "./auto-submit";

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
});
