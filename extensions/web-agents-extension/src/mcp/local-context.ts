import type { ExtensionConfig, LocalContextAttachment, PreparedTask } from "../shared/types";
import { callMcpTool, type McpToolCallResult } from "./client";

const MAX_CONTEXT_CHARS = 12000;
const MAX_LOCAL_PATHS = 3;
const WINDOWS_PATH_PATTERN = /[a-zA-Z]:[\\/][^\s"'<>|?*\r\n，。；;、)）\u4e00-\u9fff]+/g;
const QUOTED_WINDOWS_PATH_PATTERN = /["'“”]([a-zA-Z]:[\\/][^"'“”\r\n]+)["'“”]/g;

function trimPath(value: string): string {
  return value.trim().replace(/[,.，。；;、)）]+$/g, "");
}

export function extractLocalPaths(text: string): string[] {
  const paths = new Set<string>();

  for (const match of text.matchAll(QUOTED_WINDOWS_PATH_PATTERN)) {
    const path = trimPath(match[1] ?? "");
    if (path) paths.add(path);
  }

  for (const match of text.matchAll(WINDOWS_PATH_PATTERN)) {
    const path = trimPath(match[0] ?? "");
    if (path) paths.add(path);
  }

  const uniquePaths = Array.from(paths);
  return uniquePaths
    .filter((path) => !uniquePaths.some((otherPath) => otherPath !== path && otherPath.startsWith(path)))
    .slice(0, MAX_LOCAL_PATHS);
}

function toolText(result: McpToolCallResult): string {
  const textBlocks = result.content
    ?.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean);

  if (textBlocks?.length) {
    return textBlocks.join("\n");
  }

  const structuredContent = result.structuredContent?.content;
  if (typeof structuredContent === "string") {
    return structuredContent;
  }

  return JSON.stringify(result.structuredContent ?? result, null, 2);
}

function truncateContent(content: string): Pick<LocalContextAttachment, "content" | "truncated"> {
  if (content.length <= MAX_CONTEXT_CHARS) {
    return { content, truncated: false };
  }

  return {
    content: `${content.slice(0, MAX_CONTEXT_CHARS)}\n\n[Web Agents: local context truncated after ${MAX_CONTEXT_CHARS} characters.]`,
    truncated: true
  };
}

function isDirectoryInfo(content: string): boolean {
  return /isDirectory:\s*true/i.test(content);
}

function isFileInfo(content: string): boolean {
  return /isFile:\s*true/i.test(content);
}

async function readPathContext(config: ExtensionConfig, path: string): Promise<LocalContextAttachment> {
  const infoResult = await callMcpTool(config, "get_file_info", { path });
  const infoText = toolText(infoResult);

  if (isDirectoryInfo(infoText)) {
    const listResult = await callMcpTool(config, "list_directory", { path });
    return {
      path,
      kind: "directory",
      toolName: "list_directory",
      ...truncateContent(toolText(listResult))
    };
  }

  if (isFileInfo(infoText)) {
    const readResult = await callMcpTool(config, "read_text_file", { path, head: 220 });
    return {
      path,
      kind: "file",
      toolName: "read_text_file",
      ...truncateContent(toolText(readResult))
    };
  }

  return {
    path,
    kind: "unknown",
    toolName: "get_file_info",
    ...truncateContent(infoText)
  };
}

export function buildPromptWithLocalContext(originalText: string, attachments: LocalContextAttachment[]): string {
  if (!attachments.length) return originalText;

  const context = attachments
    .map((attachment, index) => {
      const title = `Local context ${index + 1}: ${attachment.path} (${attachment.kind}, ${attachment.toolName})`;
      return `### ${title}\n${attachment.content}`;
    })
    .join("\n\n");

  return [
    "请基于下面已经由 Web Agents 插件从本地 MCP 读取到的真实上下文回答用户任务。",
    "不要再说你无法访问本地路径；如果这些上下文不足，请明确说明还需要继续读取哪些子路径或文件。",
    "",
    "## 用户任务",
    originalText,
    "",
    "## 本地 MCP 读取结果",
    context
  ].join("\n");
}

export async function prepareTaskWithLocalContext(config: ExtensionConfig, text: string): Promise<PreparedTask> {
  const paths = extractLocalPaths(text);

  if (!paths.length) {
    return {
      originalText: text,
      text,
      usedLocalContext: false,
      attachments: [],
      message: "No local path detected."
    };
  }

  const attachments: LocalContextAttachment[] = [];

  for (const path of paths) {
    attachments.push(await readPathContext(config, path));
  }

  return {
    originalText: text,
    text: buildPromptWithLocalContext(text, attachments),
    usedLocalContext: true,
    attachments,
    message: `已读取 ${attachments.length} 个本地路径，并把结果加入待插入任务。`
  };
}
