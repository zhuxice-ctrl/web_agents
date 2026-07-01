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
  title: string;
  prompt: string;
  createdAt: string;
  participants: ModelParticipant[];
};

export type RoundtableRole = "main" | "participant" | "summarizer";

export type RoundtableParticipantState =
  | "not_open"
  | "opening"
  | "ready"
  | "sending"
  | "waiting_response"
  | "captured"
  | "paused"
  | "error";

export type RoundtableMessageSource =
  | "main_window_import"
  | "web_agents_user"
  | "provider_capture"
  | "orchestrator";

export type RoundtableSpeaker = "user" | "system" | ProviderId;

export type RoundtableMessage = {
  id: string;
  sessionId: string;
  provider?: ProviderId;
  speaker: RoundtableSpeaker;
  text: string;
  source: RoundtableMessageSource;
  round?: number;
  createdAt: string;
};

export type RoundtableParticipant = {
  provider: ProviderId;
  label: string;
  role: RoundtableRole;
  enabled: boolean;
  tabId?: number;
  url?: string;
  state: RoundtableParticipantState;
  lastSentMessageId?: string;
  lastCapturedMessageId?: string;
  error?: string;
};

export type RoundtablePlan = {
  objective: string;
  maxRounds: number;
  currentRound: number;
  nextProvider?: ProviderId;
  finalSummarizer: ProviderId;
  mode: "automatic";
};

export type RoundtableSessionState = "draft" | "ready" | "running" | "paused" | "summarizing" | "complete" | "error";

export type RoundtableSession = {
  id: string;
  title: string;
  mainProvider: ProviderId;
  mainTabId?: number;
  createdAt: string;
  updatedAt: string;
  importedContextAt?: string;
  state: RoundtableSessionState;
  participants: RoundtableParticipant[];
  plan: RoundtablePlan;
  messages: RoundtableMessage[];
};

export type RoundtableCreateInput = {
  title: string;
  objective: string;
  mainProvider: ProviderId;
  mainTabId?: number;
  participantProviders: ProviderId[];
  maxRounds: number;
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
