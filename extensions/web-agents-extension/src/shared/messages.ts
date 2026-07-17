import type {
  AdapterStatus,
  AutoSendResult,
  ExtensionConfig,
  InsertResult,
  McpStatus,
  ModelParticipant,
  OpenProviderResult,
  PermissionDecision,
  PreparedTask,
  ProviderAuthProbeResult,
  ProviderId,
  ProviderTabStatus,
  RecentConversationCapture,
  ResponseSnapshot,
  RoundtableSession,
  WebAgentInstructionTemplate,
  WebAgentToolCall,
  WebAgentToolExecutionResult
} from "./types";

export type ExtensionRequest =
  | { type: "config:get" }
  | { type: "config:set-locale"; locale: ExtensionConfig["locale"] }
  | { type: "mcp:get-status" }
  | { type: "mcp:get-instruction-template"; provider?: ProviderId }
  | { type: "mcp:execute-tool-call"; call: WebAgentToolCall }
  | { type: "task:prepare-local-context"; text: string }
  | { type: "permission:evaluate"; toolName: string; path?: string }
  | { type: "tabs:open-provider"; provider: ProviderId }
  | { type: "tabs:discover-providers"; providers?: ProviderId[] }
  | { type: "tabs:probe-provider"; provider: ProviderId; tabId?: number }
  | { type: "tabs:focus-provider"; tabId: number }
  | { type: "tab:auth-probe"; tabId?: number }
  | { type: "tab:detect"; tabId?: number }
  | { type: "tab:insert-text"; text: string; tabId?: number }
  | { type: "tab:auto-send-text"; text: string; tabId?: number }
  | { type: "tab:capture-latest"; tabId?: number }
  | { type: "tab:capture-recent"; tabId?: number; limit?: number }
  | {
      type: "roundtable:create";
      title: string;
      objective: string;
      mainProvider: ProviderId;
      mainTabId?: number;
      participantProviders: ProviderId[];
      maxRounds: number;
    }
  | { type: "roundtable:import-main-context"; sessionId: string }
  | { type: "roundtable:start"; sessionId: string }
  | { type: "roundtable:pause"; sessionId: string }
  | { type: "roundtable:step"; sessionId: string }
  | { type: "roundtable:capture"; sessionId: string; provider: ProviderId }
  | { type: "roundtable:summarize"; sessionId: string }
  | { type: "roundtable:add-guidance"; sessionId: string; text: string }
  | { type: "roundtable:add-participant"; sessionId: string; provider: ProviderId; tabId?: number }
  | { type: "roundtable:get"; sessionId: string };

export type ExtensionResponseMap = {
  "config:get": ExtensionConfig;
  "config:set-locale": ExtensionConfig;
  "mcp:get-status": McpStatus;
  "mcp:get-instruction-template": WebAgentInstructionTemplate;
  "mcp:execute-tool-call": WebAgentToolExecutionResult;
  "task:prepare-local-context": PreparedTask;
  "permission:evaluate": PermissionDecision;
  "tabs:open-provider": OpenProviderResult;
  "tabs:discover-providers": { tabs: ProviderTabStatus[] };
  "tabs:probe-provider": ProviderTabStatus;
  "tabs:focus-provider": OpenProviderResult;
  "tab:auth-probe": ProviderAuthProbeResult;
  "tab:detect": AdapterStatus;
  "tab:insert-text": InsertResult;
  "tab:auto-send-text": AutoSendResult;
  "tab:capture-latest": ResponseSnapshot;
  "tab:capture-recent": RecentConversationCapture;
  "roundtable:create": RoundtableSession;
  "roundtable:import-main-context": RoundtableSession;
  "roundtable:start": RoundtableSession;
  "roundtable:pause": RoundtableSession;
  "roundtable:step": RoundtableSession;
  "roundtable:capture": RoundtableSession;
  "roundtable:summarize": RoundtableSession;
  "roundtable:add-guidance": RoundtableSession;
  "roundtable:add-participant": RoundtableSession;
  "roundtable:get": RoundtableSession;
};

export type ExtensionResponse<T extends ExtensionRequest["type"] = ExtensionRequest["type"]> =
  | {
      ok: true;
      type: T;
      data: T extends keyof ExtensionResponseMap ? ExtensionResponseMap[T] : never;
    }
  | {
      ok: false;
      type: T;
      error: string;
    };

export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  return Boolean(value && typeof value === "object" && "type" in value);
}
