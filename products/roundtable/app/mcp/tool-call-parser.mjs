const PROTOCOL_TYPES = new Set([
  "function_call_start",
  "description",
  "parameter",
  "function_call_end",
]);

const PROTOCOL_MARKER = /"type"\s*:\s*"(?:function_call_start|function_call_end|description|parameter)"/;

export class ToolCallParseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ToolCallParseError";
    this.code = code;
    this.details = details;
  }
}

function normalizeCallId(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeToolName(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseProtocolLines(text) {
  const records = [];
  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || /^(```+|~~~+)/.test(raw)) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (PROTOCOL_MARKER.test(raw) || /function_call_(?:start|end)/.test(raw)) {
        throw new ToolCallParseError(
          "INVALID_PROTOCOL_JSON",
          `Invalid tool protocol JSONL at line ${index + 1}.`,
          { line: index + 1, raw, cause: error.message }
        );
      }
      continue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if (!PROTOCOL_TYPES.has(parsed.type)) continue;
    records.push({ event: parsed, raw, line: index + 1 });
  }
  return records;
}

function invalidEvent(code, message, record, details = {}) {
  throw new ToolCallParseError(code, message, {
    line: record.line,
    raw: record.raw,
    ...details,
  });
}

export function parseToolCalls(text) {
  const records = parseProtocolLines(text);
  if (records.length === 0) return [];

  let current = null;
  let completed = null;

  for (const record of records) {
    const event = record.event;
    if (event.type === "function_call_start") {
      if (current) {
        invalidEvent(
          "DUPLICATE_FUNCTION_CALL_START",
          "A second function_call_start appeared before the current call ended.",
          record,
          { activeCallId: current.callId }
        );
      }
      if (completed) {
        invalidEvent(
          "MULTIPLE_TOOL_CALLS",
          "Only one tool call is allowed in each captured model response.",
          record,
          { completedCallId: completed.callId }
        );
      }
      const name = normalizeToolName(event.name);
      const callId = normalizeCallId(event.call_id);
      if (!name || !callId) {
        invalidEvent(
          "INVALID_FUNCTION_CALL_START",
          "function_call_start requires a non-empty name and call_id.",
          record
        );
      }
      current = {
        name,
        callId,
        description: undefined,
        arguments: {},
        rawEvents: [record.raw],
      };
      continue;
    }

    if (!current) {
      invalidEvent(
        event.type === "function_call_end" ? "UNEXPECTED_FUNCTION_CALL_END" : "PROTOCOL_EVENT_WITHOUT_START",
        `${event.type} appeared without an active function call.`,
        record
      );
    }
    current.rawEvents.push(record.raw);

    if (event.type === "description") {
      if (typeof event.text !== "string") {
        invalidEvent("INVALID_DESCRIPTION", "description.text must be a string.", record);
      }
      if (event.text.trim()) current.description = event.text.trim();
      continue;
    }

    if (event.type === "parameter") {
      if (typeof event.key !== "string" || !event.key.trim() || !Object.hasOwn(event, "value")) {
        invalidEvent("INVALID_PARAMETER", "parameter requires a non-empty key and a value.", record);
      }
      const key = event.key.trim();
      if (Object.hasOwn(current.arguments, key)) {
        invalidEvent(
          "DUPLICATE_PARAMETER",
          `Parameter ${key} was supplied more than once.`,
          record,
          { key }
        );
      }
      current.arguments[key] = event.value;
      continue;
    }

    const endCallId = normalizeCallId(event.call_id);
    if (!endCallId) {
      invalidEvent("INVALID_FUNCTION_CALL_END", "function_call_end requires call_id.", record);
    }
    if (endCallId !== current.callId) {
      invalidEvent(
        "CALL_ID_MISMATCH",
        `function_call_end call_id ${endCallId} does not match ${current.callId}.`,
        record,
        { expectedCallId: current.callId, actualCallId: endCallId }
      );
    }
    completed = {
      name: current.name,
      callId: current.callId,
      description: current.description,
      arguments: current.arguments,
      rawText: current.rawEvents.join("\n"),
    };
    current = null;
  }

  if (current) {
    throw new ToolCallParseError(
      "MISSING_FUNCTION_CALL_END",
      `Tool call ${current.callId} did not include function_call_end.`,
      { callId: current.callId }
    );
  }
  if (!completed) {
    throw new ToolCallParseError("INCOMPLETE_TOOL_CALL", "Tool protocol events did not form a complete call.");
  }
  return [completed];
}

export function parseToolCall(text) {
  return parseToolCalls(text)[0] || null;
}

function escapeXmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatFunctionResult(callId, resultText, status = "ok") {
  const statusAttribute = status === "error" ? ' status="error"' : "";
  return `<function_result call_id="${escapeXmlAttribute(callId)}"${statusAttribute}>\n${String(resultText ?? "")}\n</function_result>`;
}

export function mcpToolResultToText(result) {
  const textBlocks = Array.isArray(result?.content)
    ? result.content
      .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
    : [];
  if (textBlocks.length) return textBlocks.join("\n");
  if (typeof result?.structuredContent?.content === "string") return result.structuredContent.content;
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result?.structuredContent ?? result, null, 2);
  } catch {
    return String(result);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function toolCallFingerprint(call) {
  return `${call.callId}:${call.name}:${stableJson(call.arguments ?? {})}`;
}
