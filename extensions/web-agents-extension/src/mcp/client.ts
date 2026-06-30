import type { ExtensionConfig, McpStatus, McpToolSummary } from "../shared/types";

const HIGH_RISK_TOOL_PATTERN = /(write|edit|delete|remove|move|rename|create|mkdir|patch|replace)/i;
const MCP_REQUEST_TIMEOUT_MS = 8000;

type SseEvent = {
  event: string;
  data: string;
};

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type McpTool = {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
};

type ToolsListResult = {
  tools?: McpTool[];
};

export type McpToolCallResult = {
  content?: Array<{
    type?: unknown;
    text?: unknown;
  }>;
  structuredContent?: {
    content?: unknown;
  };
};

export function classifyToolRisk(name: string): McpToolSummary["risk"] {
  if (!name) return "unknown";
  return HIGH_RISK_TOOL_PATTERN.test(name) ? "high" : "low";
}

function parseSseEvent(block: string): SseEvent | null {
  const data: string[] = [];
  let event = "message";

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    }

    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }

  return data.length ? { event, data: data.join("\n") } : null;
}

function buildMessageUrl(serverUri: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return new URL(endpoint, serverUri).toString();
}

function summarizeSchema(inputSchema: unknown): Pick<McpToolSummary, "schemaState" | "schemaNote"> {
  if (!inputSchema) {
    return { schemaState: "missing", schemaNote: "未声明输入 schema" };
  }

  if (typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return { schemaState: "invalid", schemaNote: "schema 不是对象" };
  }

  const maybeSchema = inputSchema as { type?: unknown };
  if (maybeSchema.type && maybeSchema.type !== "object") {
    return { schemaState: "invalid", schemaNote: `根类型为 ${String(maybeSchema.type)}，预期 object` };
  }

  return { schemaState: "valid", schemaNote: "schema 可解析" };
}

function normalizeTool(tool: McpTool): McpToolSummary | null {
  if (typeof tool.name !== "string" || !tool.name.trim()) return null;
  return {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : undefined,
    risk: classifyToolRisk(tool.name),
    inputSchema: tool.inputSchema,
    ...summarizeSchema(tool.inputSchema)
  };
}

async function openSseSession(serverUri: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(serverUri, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok || !response.body) {
    throw new Error(`本地 MCP 返回 HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let nextId = 1;

  async function readEvents(timeoutMs: number): Promise<SseEvent[]> {
    const read = reader.read();
    let readTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      readTimeoutId = setTimeout(() => reject(new Error("等待 MCP 响应超时")), timeoutMs);
    });
    const { value, done } = await Promise.race([read, timeout]).finally(() => {
      if (readTimeoutId) clearTimeout(readTimeoutId);
    });

    if (done) {
      throw new Error("SSE 连接已关闭");
    }

    pending += decoder.decode(value, { stream: true });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? "";
    return blocks.map(parseSseEvent).filter((event): event is SseEvent => Boolean(event));
  }

  async function waitForEvent(predicate: (event: SseEvent) => boolean): Promise<SseEvent> {
    const deadline = Date.now() + MCP_REQUEST_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const events = await readEvents(Math.max(1, deadline - Date.now()));
      const match = events.find(predicate);
      if (match) return match;
    }

    throw new Error("等待 MCP 事件超时");
  }

  const endpointEvent = await waitForEvent(
    (event) => event.event === "endpoint" && event.data.includes("/messages")
  );
  const messageUrl = buildMessageUrl(serverUri, endpointEvent.data);

  async function post(message: unknown): Promise<void> {
    const response = await fetch(messageUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`MCP 消息发送失败：HTTP ${response.status}`);
    }
  }

  async function request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = nextId;
    nextId += 1;
    await post({ jsonrpc: "2.0", id, method, params });

    const responseEvent = await waitForEvent((event) => {
      try {
        return (JSON.parse(event.data) as JsonRpcResponse<T>).id === id;
      } catch {
        return false;
      }
    });

    const payload = JSON.parse(responseEvent.data) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(`${method} 失败：${payload.error.message}`);
    }

    return payload.result as T;
  }

  async function close(): Promise<void> {
    try {
      await reader.cancel();
    } catch {
      // The browser may already have closed the stream.
    }
  }

  return { post, request, close };
}

async function listToolsFromSse(serverUri: string): Promise<McpToolSummary[]> {
  const session = await openSseSession(serverUri);

  try {
    await initializeSession(session);

    const result = await session.request<ToolsListResult>("tools/list");
    return (result.tools ?? []).map(normalizeTool).filter((tool): tool is McpToolSummary => Boolean(tool));
  } finally {
    await session.close();
  }
}

async function initializeSession(session: Awaited<ReturnType<typeof openSseSession>>): Promise<void> {
  await session.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "web-agents-extension", version: "0.1.0" }
  });
  await session.post({ jsonrpc: "2.0", method: "notifications/initialized" });
}

export async function callMcpTool(
  config: ExtensionConfig,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  if (config.mcp.transport !== "sse") {
    throw new Error("Only SSE MCP transport is supported for local tool calls.");
  }

  const session = await openSseSession(config.mcp.serverUri);

  try {
    await initializeSession(session);
    return await session.request<McpToolCallResult>("tools/call", { name, arguments: args });
  } finally {
    await session.close();
  }
}

export async function checkMcpStatus(config: ExtensionConfig): Promise<McpStatus> {
  const checkedAt = new Date().toISOString();

  if (config.mcp.transport !== "sse") {
    return {
      state: "unknown",
      serverUri: config.mcp.serverUri,
      transport: config.mcp.transport,
      tools: [],
      message: "当前 MVP 仅接入 SSE tools/list，其他传输会在后续扩展。",
      checkedAt
    };
  }

  try {
    const tools = await listToolsFromSse(config.mcp.serverUri);

    return {
      state: "connected",
      serverUri: config.mcp.serverUri,
      transport: config.mcp.transport,
      tools,
      message: tools.length ? `已连接本地 MCP，发现 ${tools.length} 个工具。` : "已连接本地 MCP，但 tools/list 返回为空。",
      checkedAt
    };
  } catch (error) {
    return {
      state: error instanceof Error && /fetch|closed|超时|Failed|Network/i.test(error.message) ? "disconnected" : "error",
      serverUri: config.mcp.serverUri,
      transport: config.mcp.transport,
      tools: [],
      message: `无法完成 MCP tools/list：${error instanceof Error ? error.message : String(error)}`,
      checkedAt
    };
  }
}
