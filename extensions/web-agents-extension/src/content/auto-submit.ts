import type { ProviderCatalogEntry } from "../providers/catalog";
import { GLOBAL_FALLBACK_INPUT_SELECTORS } from "../providers/catalog";
import {
  findInput,
  insertIntoElement,
  isWritableElement,
  type InputCandidate,
  type WritableElement
} from "../adapters/dom";

export type AutoSubmitState = "sent" | "no_input" | "input_busy" | "no_submit";

export type AutoSubmitResult = {
  state: AutoSubmitState;
  message: string;
};

const COMPOSER_CONTAINER_SELECTOR = [
  "form",
  "[role='form']",
  "[data-testid*='composer' i]",
  "[class*='composer' i]",
  "[class*='chat-input' i]",
  "[class*='input-area' i]",
  "[class*='input-wrapper' i]"
].join(",");

const SUBMIT_BUTTON_SELECTOR = [
  "button[type='submit']",
  "button[data-testid*='send' i]",
  "button[aria-label*='Send' i]",
  "button[aria-label*='发送' i]",
  "button[title*='Send' i]",
  "button[title*='发送' i]"
].join(",");

const SUBMIT_BUTTON_RETRY_COUNT = 8;
const SUBMIT_BUTTON_RETRY_MS = 50;

function getWritableText(element: WritableElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  return element.innerText || element.textContent || "";
}

function findComposerContainer(inputElement: HTMLElement): HTMLElement | null {
  let current = inputElement.parentElement;
  let depth = 0;

  while (current && depth < 8) {
    if (current.matches(COMPOSER_CONTAINER_SELECTOR)) return current;
    current = current.parentElement;
    depth += 1;
  }

  return inputElement.parentElement;
}

function isUsableSubmitButton(button: HTMLButtonElement): boolean {
  const style = window.getComputedStyle(button);
  return !button.disabled && style.display !== "none" && style.visibility !== "hidden";
}

function findUsableSubmitButton(inputElement: HTMLElement): HTMLButtonElement | null {
  const container = findComposerContainer(inputElement);
  if (!container) return null;

  return Array.from(container.querySelectorAll<HTMLButtonElement>(SUBMIT_BUTTON_SELECTOR)).find(isUsableSubmitButton) ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForUsableSubmitButton(inputElement: HTMLElement): Promise<HTMLButtonElement | null> {
  for (let attempt = 0; attempt <= SUBMIT_BUTTON_RETRY_COUNT; attempt += 1) {
    const button = findUsableSubmitButton(inputElement);
    if (button) return button;

    if (attempt < SUBMIT_BUTTON_RETRY_COUNT) {
      await wait(SUBMIT_BUTTON_RETRY_MS);
    }
  }

  return null;
}

function findComposerInput(documentRef: Document, provider: ProviderCatalogEntry | undefined): InputCandidate | null {
  const providerInput = findInput(documentRef, provider);
  if (providerInput) return providerInput;

  for (const selector of GLOBAL_FALLBACK_INPUT_SELECTORS) {
    const element = Array.from(documentRef.querySelectorAll(selector)).find(isWritableElement);
    if (element) return { element, selector };
  }

  return null;
}

export async function sendTextIfComposerIdle(
  documentRef: Document,
  provider: ProviderCatalogEntry | undefined,
  text: string
): Promise<AutoSubmitResult> {
  const input = findComposerInput(documentRef, provider);
  if (!input || !(input.element instanceof HTMLElement)) {
    return { state: "no_input", message: "没有找到可续发结果的输入框。" };
  }

  const currentText = getWritableText(input.element).trim();
  if (currentText) {
    return { state: "input_busy", message: "输入框已有内容，已暂停自动续发，避免覆盖用户输入。" };
  }

  if (!insertIntoElement(input.element, text)) {
    return { state: "no_input", message: "输入框类型暂不支持自动续发。" };
  }

  const submitButton = await waitForUsableSubmitButton(input.element);
  if (!submitButton) {
    if (getWritableText(input.element).trim() === text.trim()) {
      insertIntoElement(input.element, "");
    }

    return { state: "no_submit", message: "结果已执行，但页面暂时不可发送；没有占用输入框。" };
  }

  submitButton.click();
  return { state: "sent", message: "已把工具结果自动续发给当前网页模型。" };
}
