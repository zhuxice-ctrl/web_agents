import type { ExtensionConfig, WebAgentToolCall, WebAgentToolExecutionResult } from "../shared/types";
import { callMcpTool, type McpToolCallResult } from "./client";
import { formatFunctionResult, mcpToolResultToText } from "./tool-call-protocol";

type ToolExecutor = (
  config: ExtensionConfig,
  name: string,
  args: Record<string, unknown>
) => Promise<McpToolCallResult>;

export async function executeWebAgentToolCall(
  config: ExtensionConfig,
  call: WebAgentToolCall,
  execute: ToolExecutor = callMcpTool
): Promise<WebAgentToolExecutionResult> {
  const executedAt = new Date().toISOString();

  try {
    const result = await execute(config, call.name, call.arguments);
    const resultText = mcpToolResultToText(result);
    return {
      call,
      ok: true,
      resultText,
      formattedResult: formatFunctionResult(call.callId, resultText),
      executedAt
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const resultText = `[web_Agent tool execution failed]\n${errorMessage}`;
    return {
      call,
      ok: false,
      resultText,
      formattedResult: formatFunctionResult(call.callId, resultText, "error"),
      executedAt,
      error: errorMessage
    };
  }
}
