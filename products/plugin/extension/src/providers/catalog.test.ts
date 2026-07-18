import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  detectProvider,
  detectProviderByHostname,
  getDefaultParticipants,
  getProviderById,
  getProviderContentMatches,
  mergeInputSelectors,
  mergeResponseSelectors
} from "./catalog";

describe("provider catalog", () => {
  it("contains the first-phase providers", () => {
    expect(PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      "chatgpt",
      "gemini",
      "deepseek",
      "kimi",
      "qwen",
      "glm",
      "doubao",
      "grok",
      "google-ai-studio"
    ]);
  });

  it("matches hostnames and subdomains", () => {
    expect(detectProviderByHostname("chatgpt.com")?.id).toBe("chatgpt");
    expect(detectProviderByHostname("www.doubao.com")?.id).toBe("doubao");
    expect(detectProviderByHostname("aistudio.google.com")?.id).toBe("google-ai-studio");
    expect(detectProviderByHostname("grok.com")?.id).toBe("grok");
  });

  it("returns unknown compatibility shape for unknown domains", () => {
    expect(detectProvider("example.com")).toEqual({ id: "unknown", label: "Unknown" });
  });

  it("has content matches for every provider", () => {
    for (const provider of PROVIDER_CATALOG) {
      expect(provider.label.length).toBeGreaterThan(0);
      expect(provider.defaultUrl.startsWith("https://")).toBe(true);
      expect(provider.hostnames.length).toBeGreaterThan(0);
      expect(provider.contentMatches.length).toBeGreaterThan(0);
    }
  });

  it("deduplicates selectors while preserving provider-first order", () => {
    const provider = getProviderById("qwen");
    expect(provider).toBeDefined();
    const selectors = mergeInputSelectors(provider!);
    expect(selectors[0]).toBe(".ql-editor");
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it("uses declared assistant selectors without appending broad message fallbacks", () => {
    const chatgpt = getProviderById("chatgpt");
    const selectors = mergeResponseSelectors(chatgpt);

    expect(selectors).toContain("[data-message-author-role='assistant']");
    expect(selectors).not.toContain("article");
    expect(selectors).not.toContain("[class*='message']");
    expect(getProviderById("deepseek")?.responseSelectors?.length).toBeGreaterThan(0);
    expect(getProviderById("doubao")?.responseSelectors?.length).toBeGreaterThan(0);
  });

  it("derives content matches and participants from catalog", () => {
    expect(getProviderContentMatches()).toContain("*://chatgpt.com/*");
    expect(getProviderContentMatches()).toContain("*://aistudio.google.com/*");
    expect(getDefaultParticipants()).toContainEqual(
      expect.objectContaining({ provider: "google-ai-studio", label: "Google AI Studio", enabled: false })
    );
  });

  it("declares Grok image generation as a provider-specific capability", () => {
    const grok = getProviderById("grok");

    expect(grok).toBeDefined();
    expect(grok?.automationCapabilities).toContain("generate_image");
    expect(grok?.imageGeneration?.defaultUrl).toBe("https://grok.com/imagine");
    expect(grok?.imageGeneration?.submitSelectors.length).toBeGreaterThan(0);
    expect(grok?.imageGeneration?.imageSelectors.length).toBeGreaterThan(0);
    expect(grok?.responseSelectors?.length).toBeGreaterThan(0);
  });
});
