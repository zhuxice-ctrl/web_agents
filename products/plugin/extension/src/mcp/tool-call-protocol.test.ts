import { describe, expect, it } from "vitest";
import {
  formatFunctionResult,
  mcpToolResultToText,
  parseToolCalls,
  toolCallFingerprint
} from "./tool-call-protocol";

describe("web_Agent JSONL tool-call protocol", () => {
  it("parses one old-plugin-style JSONL function call from a fenced block", () => {
    const calls = parseToolCalls(`
\`\`\`jsonl
{"type":"function_call_start","name":"write_file","call_id":1}
{"type":"description","text":"写入本地文件"}
{"type":"parameter","key":"path","value":"F:\\\\web_agents\\\\hello.md"}
{"type":"parameter","key":"content","value":"你好，来自 web_Agent"}
{"type":"function_call_end","call_id":1}
\`\`\`
`);

    expect(calls).toEqual([
      {
        name: "write_file",
        callId: "1",
        description: "写入本地文件",
        arguments: {
          path: "F:\\web_agents\\hello.md",
          content: "你好，来自 web_Agent"
        },
        rawText:
          '{"type":"function_call_start","name":"write_file","call_id":1}\n' +
          '{"type":"description","text":"写入本地文件"}\n' +
          '{"type":"parameter","key":"path","value":"F:\\\\web_agents\\\\hello.md"}\n' +
          '{"type":"parameter","key":"content","value":"你好，来自 web_Agent"}\n' +
          '{"type":"function_call_end","call_id":1}'
      }
    ]);
  });

  it("keeps non-string parameter values intact", () => {
    const calls = parseToolCalls(`
{"type":"function_call_start","name":"read_text_file","call_id":"read-2"}
{"type":"parameter","key":"path","value":"F:\\\\web_agents\\\\README.md"}
{"type":"parameter","key":"head","value":120}
{"type":"function_call_end","call_id":"read-2"}
`);

    expect(calls[0]?.arguments).toEqual({
      path: "F:\\web_agents\\README.md",
      head: 120
    });
  });

  it("ignores incomplete or mismatched function calls", () => {
    expect(
      parseToolCalls(`
{"type":"function_call_start","name":"write_file","call_id":1}
{"type":"parameter","key":"path","value":"F:\\\\web_agents\\\\x.md"}
`)
    ).toEqual([]);

    expect(
      parseToolCalls(`
{"type":"function_call_start","name":"write_file","call_id":1}
{"type":"function_call_end","call_id":2}
`)
    ).toEqual([]);
  });

  it("extracts text from MCP tool results and wraps it as a function_result", () => {
    const resultText = mcpToolResultToText({
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" }
      ]
    });

    expect(resultText).toBe("line one\nline two");
    expect(formatFunctionResult("1", resultText)).toBe(
      '<function_result call_id="1">\nline one\nline two\n</function_result>'
    );
    expect(formatFunctionResult("2", "boom", "error")).toContain('status="error"');
  });

  it("builds a stable fingerprint for duplicate execution protection", () => {
    const [call] = parseToolCalls(`
{"type":"function_call_start","name":"list_directory","call_id":3}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":3}
`);

    expect(toolCallFingerprint(call!)).toBe(
      '3:list_directory:{"path":"F:\\\\web_agents"}'
    );
  });
});
