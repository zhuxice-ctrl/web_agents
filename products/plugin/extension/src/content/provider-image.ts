import { findInput, insertIntoElement } from "../adapters/dom";
import type { ProviderCatalogEntry } from "../providers/catalog";
import type { ProviderImageCapture } from "../shared/types";

type ImageReader = (image: HTMLImageElement) => Promise<ProviderImageCapture>;

type GenerateImageOptions = {
  timeoutMs?: number;
  readImage?: ImageReader;
};

function providerImageError(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.src || image.getAttribute("src") || "";
}

function collectImages(documentRef: Document, selectors: string[]): HTMLImageElement[] {
  const images = new Set<HTMLImageElement>();
  for (const selector of selectors) {
    for (const image of documentRef.querySelectorAll<HTMLImageElement>(selector)) images.add(image);
  }
  return [...images];
}

async function defaultReadImage(image: HTMLImageElement): Promise<ProviderImageCapture> {
  const source = imageSource(image);
  if (source.startsWith("data:image/")) {
    const mimeType = source.slice(5, source.indexOf(";")) || "image/png";
    return { dataUrl: source, mimeType };
  }
  const response = await fetch(source, { credentials: "include" });
  if (!response.ok) throw providerImageError("IMAGE_DOWNLOAD_FAILED");
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(providerImageError("IMAGE_DOWNLOAD_FAILED")), { once: true });
    reader.readAsDataURL(blob);
  });
  return { dataUrl, mimeType: blob.type || "image/png" };
}

export async function generateProviderImage(
  documentRef: Document,
  provider: ProviderCatalogEntry,
  prompt: string,
  { timeoutMs = 120_000, readImage = defaultReadImage }: GenerateImageOptions = {}
): Promise<ProviderImageCapture> {
  const imageConfig = provider.imageGeneration;
  if (!imageConfig) throw providerImageError("PROVIDER_IMAGE_UNSUPPORTED");
  const input = findInput(documentRef, provider);
  if (!input) throw providerImageError("PROVIDER_INPUT_NOT_FOUND");
  const submit = imageConfig.submitSelectors
    .flatMap((selector) => [...documentRef.querySelectorAll<HTMLElement>(selector)])
    .find((element) => !(element instanceof HTMLButtonElement) || !element.disabled);
  if (!submit) throw providerImageError("PROVIDER_SUBMIT_NOT_FOUND");

  const existingSources = new Set(
    collectImages(documentRef, imageConfig.imageSelectors).map(imageSource).filter(Boolean)
  );
  if (!insertIntoElement(input.element, prompt)) throw providerImageError("PROVIDER_INPUT_NOT_FOUND");

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    let settled = false;
    const finish = (candidate?: HTMLImageElement, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      observer.disconnect();
      if (candidate) resolve(candidate);
      else reject(error);
    };
    const findNewImage = () => collectImages(documentRef, imageConfig.imageSelectors)
      .find((candidate) => {
        const source = imageSource(candidate);
        return Boolean(source) && !existingSources.has(source);
      });
    const observer = new MutationObserver(() => {
      const candidate = findNewImage();
      if (candidate) finish(candidate);
    });
    observer.observe(documentRef.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    const timeout = setTimeout(() => finish(undefined, providerImageError("PROVIDER_GENERATION_TIMEOUT")), timeoutMs);
    submit.click();
    const immediate = findNewImage();
    if (immediate) finish(immediate);
  });

  return readImage(image);
}
