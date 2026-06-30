import type {
  AdapterStatus,
  ExtensionConfig,
  InsertResult,
  McpStatus,
  ModelParticipant,
  OpenProviderResult,
  PermissionDecision,
  PreparedTask,
  ProviderId,
  ResponseSnapshot,
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
  | { type: "tab:capture-latest"; tabId?: number };

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
  "tab:capture-latest": ResponseSnapshot;
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
