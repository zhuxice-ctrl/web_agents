import { describe, expect, it } from "vitest";

import {
  ROUND_TABLE_BRIDGE_SOURCE,
  isLocalBridgeRequestEnvelope,
  isLocalBridgeRequestType,
  isRoundtableBridgeOrigin,
  redactBridgeError,
  sanitizeBridgeErrors
} from "./protocol";

describe("localhost bridge protocol", () => {
  it("accepts only the fixed roundtable origins", () => {
    expect(isRoundtableBridgeOrigin("http://127.0.0.1:3020")).toBe(true);
    expect(isRoundtableBridgeOrigin("http://localhost:3020")).toBe(true);
    expect(isRoundtableBridgeOrigin("http://127.0.0.1:3021")).toBe(false);
    expect(isRoundtableBridgeOrigin("https://127.0.0.1:3020")).toBe(false);
    expect(isRoundtableBridgeOrigin("http://example.com:3020")).toBe(false);
    expect(isRoundtableBridgeOrigin("not-a-url")).toBe(false);
  });

  it("redacts credentials, query, and hash fragments from bridge errors", () => {
    const redacted = redactBridgeError(
      "Failed at https://user:password@chatgpt.com/c/abc?token=private#secret."
    );
    expect(redacted).toBe("Failed at https://chatgpt.com/c/abc.");
    expect(redacted).not.toContain("password");
    expect(redacted).not.toContain("token");
    expect(redacted).not.toContain("secret");
  });

  it("redacts nested successful-response errors without changing normal text", () => {
    expect(sanitizeBridgeErrors({
      ok: true,
      data: {
        error: "Target failed at https://chatgpt.com/c/abc?token=private#secret",
        text: "Keep https://example.com/?topic=public in model text"
      }
    })).toEqual({
      ok: true,
      data: {
        error: "Target failed at https://chatgpt.com/c/abc",
        text: "Keep https://example.com/?topic=public in model text"
      }
    });
  });

  it("preserves error context through nested arrays and objects", () => {
    expect(sanitizeBridgeErrors({
      errors: [
        "Failed at https://user:password@chatgpt.com/c/abc?token=private#secret",
        { message: "Retry https://chat.deepseek.com/a/chat?key=private#secret" }
      ]
    })).toEqual({
      errors: [
        "Failed at https://chatgpt.com/c/abc",
        { message: "Retry https://chat.deepseek.com/a/chat" }
      ]
    });
  });

  it("allows only provider tab and capture commands", () => {
    expect(isLocalBridgeRequestType("bridge:ping")).toBe(true);
    expect(isLocalBridgeRequestType("tabs:discover-providers")).toBe(true);
    expect(isLocalBridgeRequestType("tab:auto-send-text")).toBe(true);
    expect(isLocalBridgeRequestType("mcp:execute-tool-call")).toBe(false);
    expect(isLocalBridgeRequestType("permission:evaluate")).toBe(false);
    expect(isLocalBridgeRequestType("roundtable:create")).toBe(false);
  });

  it("validates a complete request envelope", () => {
    expect(isLocalBridgeRequestEnvelope({
      source: ROUND_TABLE_BRIDGE_SOURCE,
      direction: "page-to-extension",
      requestId: "request-1",
      request: { type: "tabs:probe-provider", provider: "chatgpt" }
    })).toBe(true);
    expect(isLocalBridgeRequestEnvelope({
      source: ROUND_TABLE_BRIDGE_SOURCE,
      direction: "page-to-extension",
      requestId: "request-2",
      request: { type: "mcp:execute-tool-call" }
    })).toBe(false);
  });
});
