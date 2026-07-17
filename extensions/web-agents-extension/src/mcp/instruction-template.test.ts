import { describe, expect, it } from "vitest";
import { buildWebAgentInstructionTemplate } from "./instruction-template";
import type { McpToolSummary } from "../shared/types";

describe("web_Agent instruction template", () => {
  it("builds an old-plugin-style initialization template with JSONL rules and tools", () => {
    const tools: McpToolSummary[] = [
      {
        name: "read_text_file",
        description: "Read a text file",
        risk: "low",
        schemaState: "valid",
        schemaNote: "schema ok",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            head: { type: "number" }
          },
          required: ["path"]
        }
      }
    ];

    const template = buildWebAgentInstructionTemplate({
      providerLabel: "Doubao",
      tools
    });

    expect(template).toContain("你正在网页中通过 web_Agent 使用本地 MCP 工具");
    expect(template).toContain("```jsonl");
    expect(template).toContain('"type":"function_call_start"');
    expect(template).toContain("read_text_file");
    expect(template).toContain('"path"');
    expect(template).toContain("输出工具调用后停止");
  });

  it("falls back to common local file tools when MCP tools are not available", () => {
    const template = buildWebAgentInstructionTemplate({
      providerLabel: "Unknown",
      tools: []
    });

    expect(template).toContain("list_allowed_directories");
    expect(template).toContain("write_file");
  });
});
