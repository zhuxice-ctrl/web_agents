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

export function createJsonRpcResponseRouter({ timeoutMs = MCP_REQUEST_TIMEOUT_MS } = {}) {
  const pending = new Map<number, {
    method: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  return {
    wait<T>(id: number, method: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} 失败：等待 MCP 响应超时`));
        }, timeoutMs);
        pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timeout });
      });
    },
    handle(payload: JsonRpcResponse<unknown>): boolean {
      const request = pending.get(payload.id);
      if (!request) return false;
      pending.delete(payload.id);
      clearTimeout(request.timeout);
      if (payload.error) request.reject(new Error(`${request.method} 失败：${payload.error.message}`));
      else request.resolve(payload.result);
      return true;
    },
    rejectAll(error: Error): void {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      pending.clear();
    },
    get pendingCount(): number {
      return pending.size;
    }
  };
}

type ClosableSession = { close?(): Promise<void> };

export function createMcpSessionPool<TSession extends ClosableSession, TOptions = undefined>({
  openSession,
  initialize
}: {
  openSession(options?: TOptions): Promise<TSession>;
  initialize(session: TSession): Promise<void>;
}) {
  const entries = new Map<string, Promise<TSession>>();
  return {
    get(key: string, options?: TOptions): Promise<TSession> {
      const existing = entries.get(key);
      if (existing) return existing;
      const created = openSession(options).then(async (session) => {
        await initialize(session);
        return session;
      }).catch((error) => {
        entries.delete(key);
        throw error;
      });
      entries.set(key, created);
      return created;
    },
    async invalidate(key: string): Promise<void> {
      const entry = entries.get(key);
      entries.delete(key);
      const session = await entry?.catch(() => null);
      await session?.close?.();
    },
    get size(): number {
      return entries.size;
    }
  };
}

type McpSessionContext = {
  sessionId?: string;
  workspaceRoot?: string;
};

function sessionHeaders(context: McpSessionContext): Record<string, string> {
  if (!context.sessionId && !context.workspaceRoot) return {};
  if (!context.sessionId || !context.workspaceRoot) throw new Error("MCP_SESSION_CONTEXT_INCOMPLETE");
  return {
    "X-Web-Agents-Session": context.sessionId,
    "X-Web-Agents-Workspace": context.workspaceRoot
  };
}

async function openSseSession(serverUri: string, context: McpSessionContext = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(serverUri, {
      headers: { Accept: "text/event-stream", ...sessionHeaders(context) },
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
  const router = createJsonRpcResponseRouter();
  let endpointResolve!: (value: string) => void;
  let endpointReject!: (error: Error) => void;
  const endpointPromise = new Promise<string>((resolve, reject) => {
    endpointResolve = resolve;
    endpointReject = reject;
  });
  const endpointTimeout = setTimeout(() => endpointReject(new Error("等待 MCP endpoint 超时")), MCP_REQUEST_TIMEOUT_MS);

  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE 连接已关闭");
        pending += decoder.decode(value, { stream: true });
        const blocks = pending.split(/\r?\n\r?\n/);
        pending = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = parseSseEvent(block);
          if (!event) continue;
          if (event.event === "endpoint" && event.data.includes("/message")) {
            clearTimeout(endpointTimeout);
            endpointResolve(buildMessageUrl(serverUri, event.data));
          } else if (event.event === "message") {
            try {
              router.handle(JSON.parse(event.data) as JsonRpcResponse<unknown>);
            } catch {
              // Ignore malformed events without disturbing other in-flight requests.
            }
          }
        }
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      clearTimeout(endpointTimeout);
      endpointReject(failure);
      router.rejectAll(failure);
    }
  })();

  async function post(message: unknown): Promise<void> {
    const messageUrl = await endpointPromise;
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
    const result = router.wait<T>(id, method);
    await post({ jsonrpc: "2.0", id, method, params }).catch((error) => {
      router.rejectAll(error instanceof Error ? error : new Error(String(error)));
      throw error;
    });
    return result;
  }

  async function close(): Promise<void> {
    try {
      await reader.cancel();
    } catch {
      // The browser may already have closed the stream.
    }
    router.rejectAll(new Error("SSE 连接已关闭"));
  }

  return { post, request, close };
}

async function initializeSession(session: Awaited<ReturnType<typeof openSseSession>>): Promise<void> {
  await session.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "web-agents-extension", version: "0.1.1" }
  });
  await session.post({ jsonrpc: "2.0", method: "notifications/initialized" });
}

const mcpSessionPool = createMcpSessionPool({
  openSession: (options?: { serverUri: string; context: McpSessionContext }) => {
    if (!options) throw new Error("MCP_SESSION_OPTIONS_REQUIRED");
    return openSseSession(options.serverUri, options.context);
  },
  initialize: initializeSession
});

function sessionKey(serverUri: string, context: McpSessionContext): string {
  return `${serverUri}\u0000${context.sessionId ?? "default"}\u0000${context.workspaceRoot ?? "default"}`;
}

async function pooledSession(serverUri: string, context: McpSessionContext) {
  const key = sessionKey(serverUri, context);
  return {
    key,
    session: await mcpSessionPool.get(key, { serverUri, context })
  };
}

async function listToolsFromSse(serverUri: string, context: McpSessionContext = {}): Promise<McpToolSummary[]> {
  const { session } = await pooledSession(serverUri, context);
  const result = await session.request<ToolsListResult>("tools/list");
  return (result.tools ?? []).map(normalizeTool).filter((tool): tool is McpToolSummary => Boolean(tool));
}

export async function callMcpTool(
  config: ExtensionConfig,
  name: string,
  args: Record<string, unknown>,
  context: McpSessionContext = {}
): Promise<McpToolCallResult> {
  if (config.mcp.transport !== "sse") {
    throw new Error("Only SSE MCP transport is supported for local tool calls.");
  }

  const { key, session } = await pooledSession(config.mcp.serverUri, context);
  try {
    return await session.request<McpToolCallResult>("tools/call", { name, arguments: args });
  } catch (error) {
    await mcpSessionPool.invalidate(key);
    throw error;
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
