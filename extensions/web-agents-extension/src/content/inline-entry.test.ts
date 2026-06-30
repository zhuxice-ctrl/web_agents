import { describe, expect, it, vi } from "vitest";
import { getProviderById } from "../providers/catalog";
import { INLINE_ENTRY_HOST_ID, findInlineEntryTarget, mountInlineEntry } from "./inline-entry";

describe("inline page entry", () => {
  it("targets the composer container around a writable input", () => {
    document.body.innerHTML = `
      <form id="composer">
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;

    const target = findInlineEntryTarget(document, getProviderById("doubao"));

    expect(target?.container.id).toBe("composer");
    expect(target?.input.selector).toBe("textarea");
  });

  it("mounts a single WA button inside the composer and inserts instructions on click", () => {
    document.body.innerHTML = `
      <form id="composer">
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;
    const onInsert = vi.fn();
    const onOpen = vi.fn();
    const provider = getProviderById("doubao");

    expect(mountInlineEntry(document, provider, onInsert, onOpen)).toBe(true);
    expect(mountInlineEntry(document, provider, onInsert, onOpen)).toBe(false);

    const host = document.getElementById(INLINE_ENTRY_HOST_ID);
    const button = host?.shadowRoot?.querySelector("button");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelectorAll(`#${INLINE_ENTRY_HOST_ID}`)).toHaveLength(1);
    expect(host?.parentElement?.id).toBe("composer");
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the panel on shift click", () => {
    document.body.innerHTML = `
      <form id="composer">
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;
    const onInsert = vi.fn();
    const onOpen = vi.fn();

    mountInlineEntry(document, getProviderById("doubao"), onInsert, onOpen);

    const button = document.getElementById(INLINE_ENTRY_HOST_ID)?.shadowRoot?.querySelector("button");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));

    expect(onInsert).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("falls back to the input parent when no form-like ancestor exists", () => {
    document.body.innerHTML = `
      <section id="input-shell">
        <textarea style="width:240px;height:48px"></textarea>
      </section>
    `;

    expect(mountInlineEntry(document, getProviderById("doubao"), vi.fn())).toBe(true);
    expect(document.getElementById(INLINE_ENTRY_HOST_ID)?.parentElement?.id).toBe("input-shell");
  });
});
