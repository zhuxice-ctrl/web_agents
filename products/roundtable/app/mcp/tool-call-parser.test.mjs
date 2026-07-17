import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFunctionResult,
  parseToolCall,
  parseToolCalls,
  ToolCallParseError,
} from "./tool-call-parser.mjs";

function fencedCall({ name = "write_file", callId = "call-1", path = "C:\\tmp\\result.txt" } = {}) {
  return [
    "I will use the local tool.",
    "```jsonl",
    JSON.stringify({ type: "function_call_start", name, call_id: callId }),
    JSON.stringify({ type: "description", text: "Write the requested result" }),
    JSON.stringify({ type: "parameter", key: "path", value: path }),
    JSON.stringify({ type: "parameter", key: "content", value: "hello" }),
    JSON.stringify({ type: "function_call_end", call_id: callId }),
    "```",
  ].join("\n");
}

function assertParseCode(text, code) {
  assert.throws(
    () => parseToolCall(text),
    (error) => error instanceof ToolCallParseError && error.code === code
  );
}

test("parser reads one legacy fenced JSONL call and ignores surrounding prose", () => {
  const call = parseToolCall(fencedCall());
  assert.deepEqual(call, {
    name: "write_file",
    callId: "call-1",
    description: "Write the requested result",
    arguments: { path: "C:\\tmp\\result.txt", content: "hello" },
    rawText: [
      JSON.stringify({ type: "function_call_start", name: "write_file", call_id: "call-1" }),
      JSON.stringify({ type: "description", text: "Write the requested result" }),
      JSON.stringify({ type: "parameter", key: "path", value: "C:\\tmp\\result.txt" }),
      JSON.stringify({ type: "parameter", key: "content", value: "hello" }),
      JSON.stringify({ type: "function_call_end", call_id: "call-1" }),
    ].join("\n"),
  });
  assert.equal(parseToolCall("A normal final answer."), null);
  assert.deepEqual(parseToolCalls("A normal final answer."), []);
});

test("parser rejects duplicate starts, mismatched IDs, multiple calls, and missing ends", () => {
  const start = JSON.stringify({ type: "function_call_start", name: "read_text_file", call_id: "one" });
  const secondStart = JSON.stringify({ type: "function_call_start", name: "get_file_info", call_id: "two" });
  assertParseCode(`${start}\n${secondStart}\n${JSON.stringify({ type: "function_call_end", call_id: "two" })}`, "DUPLICATE_FUNCTION_CALL_START");
  assertParseCode(`${start}\n${JSON.stringify({ type: "function_call_end", call_id: "other" })}`, "CALL_ID_MISMATCH");
  assertParseCode(start, "MISSING_FUNCTION_CALL_END");
  assertParseCode(`${fencedCall({ callId: "one" })}\n${fencedCall({ callId: "two" })}`, "MULTIPLE_TOOL_CALLS");
});

test("parser rejects malformed protocol JSON and ambiguous duplicate parameters", () => {
  assertParseCode(
    '```jsonl\n{"type":"function_call_start","name":"write_file","call_id":"broken"\n```',
    "INVALID_PROTOCOL_JSON"
  );
  const lines = [
    JSON.stringify({ type: "function_call_start", name: "write_file", call_id: 7 }),
    JSON.stringify({ type: "parameter", key: "path", value: "one" }),
    JSON.stringify({ type: "parameter", key: "path", value: "two" }),
    JSON.stringify({ type: "function_call_end", call_id: 7 }),
  ].join("\n");
  assertParseCode(lines, "DUPLICATE_PARAMETER");
});

test("function results escape call IDs and preserve the legacy envelope", () => {
  assert.equal(
    formatFunctionResult('call-"<&', "done"),
    '<function_result call_id="call-&quot;&lt;&amp;">\ndone\n</function_result>'
  );
  assert.match(formatFunctionResult("failed", "no", "error"), /status="error"/);
});
