import { describe, expect, it, vi } from "vitest";
import { executeWebAgentToolCall } from "./tool-call-executor";
import type { ExtensionConfig, WebAgentToolCall } from "../shared/types";

const config: ExtensionConfig = {
  locale: "zh-CN",
  mcp: {
    serverUri: "http://127.0.0.1:3006/sse",
    transport: "sse"
  },
  gateway: {
    baseUrl: "http://127.0.0.1:3007",
    enabled: true
  },
  permissions: {
    mode: "standard",
    allowedRoots: [],
    highPrivilege: {
      enabled: false,
      expiresAt: null
    },
    enforcement: "ui_only_contract"
  }
};

const call: WebAgentToolCall = {
  name: "list_directory",
  callId: "4",
  arguments: {
    path: "F:\\web_agents"
  },
  rawText: "{}"
};

describe("web_Agent tool-call executor", () => {
  it("executes a parsed tool call and formats the MCP text result", async () => {
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "[FILE] README.md" }]
    });

    const result = await executeWebAgentToolCall(config, call, execute);

    expect(execute).toHaveBeenCalledWith(config, "list_directory", {
      path: "F:\\web_agents"
    });
    expect(result.ok).toBe(true);
    expect(result.formattedResult).toBe(
      '<function_result call_id="4">\n[FILE] README.md\n</function_result>'
    );
  });

  it("returns an error function_result when MCP execution fails", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("denied"));

    const result = await executeWebAgentToolCall(config, call, execute);

    expect(result.ok).toBe(false);
    expect(result.resultText).toContain("denied");
    expect(result.formattedResult).toContain('status="error"');
  });
});
