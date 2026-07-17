import type { McpToolCallResult } from "./client";
import type { WebAgentToolCall } from "../shared/types";

type ProtocolEventType = "function_call_start" | "description" | "parameter" | "function_call_end";

type ProtocolEvent = {
  type: ProtocolEventType;
  name?: unknown;
  call_id?: unknown;
  text?: unknown;
  key?: unknown;
  value?: unknown;
};

type ProtocolEventRecord = {
  event: ProtocolEvent;
  raw: string;
};

const PROTOCOL_TYPES = new Set<ProtocolEventType>([
  "function_call_start",
  "description",
  "parameter",
  "function_call_end"
]);

const JSON_OBJECT_PATTERN =
  /\{(?:[^{}"]|"(?:\\.|[^"\\])*")*?"type"\s*:\s*"(?:function_call_start|function_call_end|description|parameter)"(?:[^{}"]|"(?:\\.|[^"\\])*")*?\}/g;

function isProtocolEvent(value: unknown): value is ProtocolEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as { type?: unknown };
  return typeof event.type === "string" && PROTOCOL_TYPES.has(event.type as ProtocolEventType);
}

function parseEvent(raw: string): ProtocolEventRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isProtocolEvent(parsed)) return null;
    return { event: parsed, raw };
  } catch {
    return null;
  }
}

function parseLineEvents(text: string): ProtocolEventRecord[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}") && line.includes('"type"'))
    .map(parseEvent)
    .filter((record): record is ProtocolEventRecord => Boolean(record));
}

function parseInlineEvents(text: string): ProtocolEventRecord[] {
  return Array.from(text.matchAll(JSON_OBJECT_PATTERN), (match) => parseEvent(match[0])).filter(
    (record): record is ProtocolEventRecord => Boolean(record)
  );
}

function normalizeCallId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeToolName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractEvents(text: string): ProtocolEventRecord[] {
  const lineEvents = parseLineEvents(text);
  if (lineEvents.some((record) => record.event.type === "function_call_start")) {
    return lineEvents;
  }

  return parseInlineEvents(text);
}

export function parseToolCalls(text: string): WebAgentToolCall[] {
  const calls: WebAgentToolCall[] = [];
  const events = extractEvents(text);
  let current:
    | {
        name: string;
        callId: string;
        description?: string;
        args: Record<string, unknown>;
        rawEvents: string[];
      }
    | null = null;

  for (const record of events) {
    const { event, raw } = record;

    if (event.type === "function_call_start") {
      const name = normalizeToolName(event.name);
      const callId = normalizeCallId(event.call_id);
      current = name && callId ? { name, callId, args: {}, rawEvents: [raw] } : null;
      continue;
    }

    if (!current) continue;
    current.rawEvents.push(raw);

    if (event.type === "description") {
      if (typeof event.text === "string" && event.text.trim()) {
        current.description = event.text.trim();
      }
      continue;
    }

    if (event.type === "parameter") {
      if (typeof event.key === "string" && event.key.trim() && Object.hasOwn(event, "value")) {
        current.args[event.key.trim()] = event.value;
      }
      continue;
    }

    if (event.type === "function_call_end") {
      if (normalizeCallId(event.call_id) === current.callId) {
        calls.push({
          name: current.name,
          callId: current.callId,
          description: current.description,
          arguments: current.args,
          rawText: current.rawEvents.join("\n")
        });
      }
      current = null;
    }
  }

  return calls;
}

export function mcpToolResultToText(result: McpToolCallResult | unknown): string {
  const maybeResult = result as McpToolCallResult;
  const textBlocks = maybeResult.content
    ?.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean);

  if (textBlocks?.length) {
    return textBlocks.join("\n");
  }

  const structuredContent = maybeResult.structuredContent?.content;
  if (typeof structuredContent === "string") {
    return structuredContent;
  }

  return JSON.stringify(maybeResult.structuredContent ?? result, null, 2);
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatFunctionResult(callId: string, resultText: string, status: "ok" | "error" = "ok"): string {
  const statusAttribute = status === "error" ? ' status="error"' : "";
  return `<function_result call_id="${escapeXmlAttribute(callId)}"${statusAttribute}>\n${resultText}\n</function_result>`;
}

export function toolCallFingerprint(call: Pick<WebAgentToolCall, "callId" | "name" | "arguments">): string {
  return `${call.callId}:${call.name}:${JSON.stringify(call.arguments)}`;
}
