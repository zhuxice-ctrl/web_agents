export type Locale = "zh-CN" | "en";

export type ProviderId =
  | "chatgpt"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "qwen"
  | "glm"
  | "doubao"
  | "grok"
  | "google-ai-studio"
  | "unknown";

export type AdapterReadiness = "supported" | "unsupported" | "no_input" | "unknown";

export type AdapterStatus = {
  provider: ProviderId;
  label: string;
  readiness: AdapterReadiness;
  canInsert: boolean;
  tabId?: number;
  url?: string;
  reason?: string;
  matchedSelector?: string;
};

export type InsertResult = {
  ok: boolean;
  provider: ProviderId;
  message: string;
};

export type ResponseSnapshot = {
  provider: ProviderId;
  text: string;
  capturedAt: string;
  source?: string;
};

export type McpTransport = "sse" | "websocket" | "streamable-http";
export type McpConnectionState = "unknown" | "checking" | "connected" | "disconnected" | "error";

export type McpToolSummary = {
  name: string;
  description?: string;
  risk: "low" | "high" | "unknown";
  schemaState: "valid" | "missing" | "invalid";
  schemaNote?: string;
};

export type McpStatus = {
  state: McpConnectionState;
  serverUri: string;
  transport: McpTransport;
  tools: McpToolSummary[];
  message?: string;
  checkedAt?: string;
};

export type PermissionMode = "strict" | "standard" | "privacy" | "high_privilege";

export type PermissionSnapshot = {
  mode: PermissionMode;
  allowedRoots: string[];
  highPrivilege: {
    enabled: boolean;
    expiresAt: string | null;
  };
  enforcement: "gateway" | "ui_only_contract" | "unknown";
  gatewayUrl?: string;
  lastSyncedAt?: string;
  message?: string;
};

export type PermissionOperationKind = "browse" | "read" | "search" | "write" | "delete" | "move" | "rename" | "create";

export type PermissionDecision = {
  toolName: string;
  operation: PermissionOperationKind;
  risk: "low" | "high" | "unknown";
  path?: string;
  insideAllowedRoot: boolean;
  requiresConfirmation: boolean;
  reason: string;
};

export type ParticipantStatus =
  | "not_open"
  | "opening"
  | "ready"
  | "inserted"
  | "waiting_user_send"
  | "waiting_response"
  | "captured"
  | "error";

export type ModelParticipant = {
  provider: ProviderId;
  label: string;
  enabled: boolean;
  status: ParticipantStatus;
  tabId?: number;
  url?: string;
  insertedPrompt?: string;
  responseSummary?: string;
  responseSnapshot?: ResponseSnapshot;
  error?: string;
};

export type TaskSession = {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  participants: ModelParticipant[];
};

export type ExtensionConfig = {
  locale: Locale;
  mcp: {
    serverUri: string;
    transport: McpTransport;
  };
  gateway: {
    baseUrl: string;
    enabled: boolean;
  };
  permissions: PermissionSnapshot;
};

export type OpenProviderResult = {
  provider: ProviderId;
  label: string;
  tabId?: number;
  url: string;
  status: ParticipantStatus;
};
