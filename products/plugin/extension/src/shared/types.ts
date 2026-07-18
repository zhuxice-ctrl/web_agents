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
  verificationRequired?: boolean;
};

export type ProviderAuthReason =
  | "authenticated"
  | "login_required"
  | "token_missing"
  | "probe_failed"
  | "unsupported_provider";

export type ProviderAuthProbeResult = {
  provider: ProviderId;
  authenticated: boolean;
  reason: ProviderAuthReason;
  verificationRequired?: boolean;
};

export type ProviderTabStatus = ProviderAuthProbeResult & {
  tabId: number;
  label: string;
  url: string;
  readiness: AdapterReadiness;
  canInsert: boolean;
  ready: boolean;
  verificationRequired: boolean;
  matchedSelector?: string;
  error?: string;
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
  speaker?: "user" | "assistant" | "unknown";
};

export type RecentConversationMessage = {
  speaker: "user" | "assistant" | "unknown";
  text: string;
  source: string;
};

export type RecentConversationCapture = {
  provider: ProviderId;
  capturedAt: string;
  messages: RecentConversationMessage[];
};

export type AutoSendState = "sent" | "no_input" | "input_busy" | "no_submit" | "verification_required";

export type AutoSendResult = {
  state: AutoSendState;
  message: string;
  provider?: ProviderId;
};

export type McpTransport = "sse" | "websocket" | "streamable-http";
export type McpConnectionState = "unknown" | "checking" | "connected" | "disconnected" | "error";

export type McpToolSummary = {
  name: string;
  description?: string;
  risk: "low" | "high" | "unknown";
  schemaState: "valid" | "missing" | "invalid";
  schemaNote?: string;
  inputSchema?: unknown;
};

export type McpStatus = {
  state: McpConnectionState;
  serverUri: string;
  transport: McpTransport;
  tools: McpToolSummary[];
  message?: string;
  checkedAt?: string;
};

export type LocalContextAttachment = {
  path: string;
  kind: "directory" | "file" | "unknown";
  toolName: string;
  content: string;
  truncated: boolean;
};

export type PreparedTask = {
  originalText: string;
  text: string;
  usedLocalContext: boolean;
  attachments: LocalContextAttachment[];
  message: string;
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

export type WebAgentToolCall = {
  name: string;
  callId: string;
  description?: string;
  arguments: Record<string, unknown>;
  rawText: string;
};

export type WebAgentToolExecutionResult = {
  call: WebAgentToolCall;
  ok: boolean;
  resultText: string;
  formattedResult: string;
  executedAt: string;
  error?: string;
};

export type WebAgentInstructionTemplate = {
  provider: ProviderId;
  text: string;
  tools: McpToolSummary[];
  mcpState: McpConnectionState;
  generatedAt: string;
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
  mcpSessionId: string;
  workspaceRoot: string;
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
  reused?: boolean;
};
