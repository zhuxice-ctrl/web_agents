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

  it("mounts a single WA button inside the composer and shows an action menu on hover", () => {
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
    const button = host?.shadowRoot?.querySelector<HTMLButtonElement>(".web-agents-trigger");
    const menu = host?.shadowRoot?.querySelector<HTMLElement>(".web-agents-menu");
    button?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(document.querySelectorAll(`#${INLINE_ENTRY_HOST_ID}`)).toHaveLength(1);
    expect(host?.parentElement?.id).toBe("composer");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.hidden).toBe(false);
    expect(menu?.textContent).toContain("插入说明");
    expect(menu?.textContent).toContain("打开面板");
    expect(onInsert).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("runs menu actions without using modifier clicks", () => {
    document.body.innerHTML = `
      <form id="composer">
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;
    const onInsert = vi.fn();
    const onOpen = vi.fn();

    mountInlineEntry(document, getProviderById("doubao"), onInsert, onOpen);

    const shadow = document.getElementById(INLINE_ENTRY_HOST_ID)?.shadowRoot;
    const button = shadow?.querySelector<HTMLButtonElement>(".web-agents-trigger");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const insertButton = shadow?.querySelector<HTMLButtonElement>("[data-action='insert']");
    const panelButton = shadow?.querySelector<HTMLButtonElement>("[data-action='panel']");

    insertButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    panelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("hides the menu when the pointer leaves the inline entry", () => {
    document.body.innerHTML = `
      <form id="composer">
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;

    mountInlineEntry(document, getProviderById("doubao"), vi.fn(), vi.fn());

    const host = document.getElementById(INLINE_ENTRY_HOST_ID);
    const trigger = host?.shadowRoot?.querySelector<HTMLButtonElement>(".web-agents-trigger");
    const menu = host?.shadowRoot?.querySelector<HTMLElement>(".web-agents-menu");
    trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    host?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(menu?.hidden).toBe(true);
  });

  it("still opens the panel on shift click as a shortcut", () => {
    document.body.innerHTML = `
      <form id="composer">
        <textarea style="width:240px;height:48px"></textarea>
      </form>
    `;
    const onInsert = vi.fn();
    const onOpen = vi.fn();

    mountInlineEntry(document, getProviderById("doubao"), onInsert, onOpen);

    const button = document.getElementById(INLINE_ENTRY_HOST_ID)?.shadowRoot?.querySelector<HTMLButtonElement>(".web-agents-trigger");
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
