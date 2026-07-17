import type { McpToolSummary, ProviderId } from "../shared/types";

type InstructionTemplateOptions = {
  provider?: ProviderId;
  providerLabel?: string;
  tools: McpToolSummary[];
};

const COMMON_LOCAL_TOOLS = [
  "list_allowed_directories",
  "read_text_file",
  "write_file",
  "list_directory",
  "create_directory",
  "edit_file",
  "move_file"
] as const;

function formatSchema(schema: unknown): string {
  if (!schema) return "";

  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return String(schema);
  }
}

function formatTool(tool: McpToolSummary): string {
  const lines = [`- ${tool.name}`];
  if (tool.description) lines.push(`  描述: ${tool.description}`);
  if (tool.inputSchema) lines.push(`  参数 schema: ${formatSchema(tool.inputSchema)}`);
  return lines.join("\n");
}

function formatFallbackTools(): string {
  return COMMON_LOCAL_TOOLS.map((tool) => `- ${tool}`).join("\n");
}

export function buildWebAgentInstructionTemplate({
  provider = "unknown",
  providerLabel,
  tools
}: InstructionTemplateOptions): string {
  const visibleTools = tools.length ? tools.map(formatTool).join("\n") : formatFallbackTools();
  const pageLabel = providerLabel ? `${providerLabel} (${provider})` : provider;

  return [
    "[web_Agent 使用说明]",
    `当前页面: ${pageLabel}`,
    "你正在网页中通过 web_Agent 使用本地 MCP 工具。web_Agent 会读取你输出的 JSONL 工具调用，连接本地 MCP 执行，并把结果以 <function_result> 形式返回给你。",
    "",
    "输出规则:",
    "1. 当用户要求读取、创建、修改、删除或浏览本地允许目录内的文件时，不要回答“我无法访问本地文件”。",
    "2. 如果参数明确，直接输出一个 JSONL 工具调用，然后停止，等待插件执行结果。",
    "3. 工具调用必须放在独立的 ```jsonl``` 代码块中。",
    "4. 每次回复只调用一个工具；不要编造工具结果；不要用 Python、PowerShell 或伪代码代替工具调用。",
    "5. parameter 行必须使用 key 和 value；必填参数必须提供，可选参数仅在需要时提供。",
    "6. 涉及写入、删除、移动等操作时，路径必须位于允许目录内；如果缺少必要参数，只追问缺少的参数。",
    "7. 输出工具调用后停止。",
    "",
    "示例:",
    "```jsonl",
    '{"type":"function_call_start","name":"write_file","call_id":1}',
    '{"type":"description","text":"写入本地文件"}',
    '{"type":"parameter","key":"path","value":"F:\\\\web_agents\\\\hello.md"}',
    '{"type":"parameter","key":"content","value":"你好，来自 web_Agent"}',
    '{"type":"function_call_end","call_id":1}',
    "```",
    "",
    "web_Agent 可用工具:",
    visibleTools,
    "",
    "用户任务从下一条消息开始。"
  ].join("\n");
}
