import { describe, expect, it } from "vitest";

import type { ProviderTabStatus } from "../shared/types";
import {
  chooseBestProviderTab,
  providerIdForTabUrl,
  sanitizeDetectedProviderStatus,
  sanitizeProviderTabUrl,
  tabUrlMatchesProvider
} from "./provider-tabs";

function tab(patch: Partial<ProviderTabStatus>): ProviderTabStatus {
  return {
    provider: "chatgpt",
    authenticated: false,
    reason: "login_required",
    tabId: 1,
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    readiness: "no_input",
    canInsert: false,
    ready: false,
    verificationRequired: false,
    ...patch
  };
}

describe("provider tab helpers", () => {
  it("redacts query and hash from returned provider URLs", () => {
    expect(sanitizeProviderTabUrl("https://chatgpt.com/c/abc?token=private#secret")).toBe("https://chatgpt.com/c/abc");
    expect(sanitizeProviderTabUrl("http://chatgpt.com/")).toBeNull();
  });

  it("never returns an unsanitized URL from tab detection", () => {
    const status = sanitizeDetectedProviderStatus({
      provider: "chatgpt",
      label: "ChatGPT",
      readiness: "supported",
      canInsert: true,
      url: "https://chatgpt.com/c/fallback?token=private#secret"
    }, 17, "https://chatgpt.com/c/current?token=private#secret");

    expect(status).toMatchObject({
      provider: "chatgpt",
      tabId: 17,
      url: "https://chatgpt.com/c/current"
    });
    expect(sanitizeDetectedProviderStatus({
      provider: "chatgpt",
      label: "ChatGPT",
      readiness: "supported",
      canInsert: true,
      url: "http://chatgpt.com/?token=private"
    }, 18)).not.toHaveProperty("url");
  });

  it("maps and validates provider hostnames", () => {
    expect(providerIdForTabUrl("https://chat.deepseek.com/a/chat/s/1")).toBe("deepseek");
    expect(tabUrlMatchesProvider("https://www.doubao.com/chat/", "doubao")).toBe(true);
    expect(tabUrlMatchesProvider("https://example.com/", "doubao")).toBe(false);
  });

  it("prefers a ready authenticated tab over newer incomplete tabs", () => {
    const selected = chooseBestProviderTab([
      tab({ tabId: 8, authenticated: true, reason: "authenticated", canInsert: false }),
      tab({ tabId: 3, authenticated: true, reason: "authenticated", canInsert: true, ready: true, readiness: "supported" }),
      tab({ tabId: 11 })
    ]);
    expect(selected?.tabId).toBe(3);
  });
});
