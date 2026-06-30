import type { ProviderId, ResponseSnapshot } from "../shared/types";
import type { ProviderCatalogEntry } from "../providers/catalog";
import { mergeInputSelectors, mergeResponseSelectors } from "../providers/catalog";

export type WritableElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;
export type InputCandidate = {
  element: WritableElement;
  selector: string;
};

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const styleWidth = Number.parseFloat(style.width || "0");
  const styleHeight = Number.parseFloat(style.height || "0");
  const hasLayoutBox = rect.width > 40 && rect.height > 16;
  const hasStyleBox = styleWidth > 40 && styleHeight > 16;
  return (hasLayoutBox || hasStyleBox) && style.visibility !== "hidden" && style.display !== "none";
}

export function isWritableElement(element: Element): element is WritableElement {
  if (!isVisible(element)) return false;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLInputElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLElement) {
    return (
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "true" ||
      element.getAttribute("role") === "textbox"
    );
  }

  return false;
}

export function findActiveInput(documentRef: Document): InputCandidate | null {
  const active = documentRef.activeElement;
  if (active && isWritableElement(active)) {
    return { element: active, selector: "document.activeElement" };
  }

  return null;
}

export function findInput(documentRef: Document, provider?: ProviderCatalogEntry): InputCandidate | null {
  const activeInput = findActiveInput(documentRef);
  if (activeInput) return activeInput;

  const selectors = provider ? mergeInputSelectors(provider) : [];
  for (const selector of selectors) {
    const candidates = Array.from(documentRef.querySelectorAll(selector));
    const element = candidates.find(isWritableElement);
    if (element) return { element, selector };
  }

  return null;
}

export function setNativeTextValue(input: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function replaceContentEditableText(element: HTMLElement, text: string): void {
  element.focus();

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand?.("insertText", false, text);
  if (!inserted) element.textContent = text;

  const inputEvent =
    typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      : new Event("input", { bubbles: true });
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function insertIntoElement(element: WritableElement, text: string): boolean {
  element.focus();

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    setNativeTextValue(element, text);
    return true;
  }

  if (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element.getAttribute("contenteditable") === "true" ||
      element.getAttribute("role") === "textbox")
  ) {
    replaceContentEditableText(element, text);
    return true;
  }

  return false;
}

export function captureLatestResponse(
  documentRef: Document,
  provider: ProviderId,
  providerDefinition?: ProviderCatalogEntry
): ResponseSnapshot | null {
  const candidates = mergeResponseSelectors(providerDefinition)
    .flatMap((selector) => Array.from(documentRef.querySelectorAll<HTMLElement>(selector)))
    .filter(isVisible)
    .map((element) => ({ element, text: cleanText(element.innerText || element.textContent || "") }))
    .filter((item) => item.text.length > 20);

  const latest = candidates.at(-1);
  if (!latest) return null;

  return {
    provider,
    text: latest.text,
    capturedAt: new Date().toISOString(),
    source: latest.element.tagName.toLowerCase()
  };
}
