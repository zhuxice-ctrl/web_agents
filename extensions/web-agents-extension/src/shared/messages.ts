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
  ProviderId,
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
