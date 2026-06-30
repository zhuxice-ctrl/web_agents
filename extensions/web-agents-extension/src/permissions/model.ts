import type {
  PermissionDecision,
  PermissionMode,
  PermissionOperationKind,
  PermissionSnapshot
} from "../shared/types";

export const MUTATION_TOOL_PATTERN = /(write|edit|delete|remove|move|rename|create|mkdir|patch|replace)/i;
const READ_TOOL_PATTERN = /(read|get|cat|view|fetch|open)/i;
const SEARCH_TOOL_PATTERN = /(search|find|grep|rg|glob|list|ls|tree|directory|dir)/i;
const DELETE_TOOL_PATTERN = /(delete|remove|rm|rmdir)/i;
const MOVE_TOOL_PATTERN = /(move|mv)/i;
const RENAME_TOOL_PATTERN = /(rename)/i;
const CREATE_TOOL_PATTERN = /(create|mkdir|new)/i;

export function isMutationTool(toolName: string): boolean {
  return MUTATION_TOOL_PATTERN.test(toolName);
}

export function classifyPermissionOperation(toolName: string): PermissionOperationKind {
  if (DELETE_TOOL_PATTERN.test(toolName)) return "delete";
  if (MOVE_TOOL_PATTERN.test(toolName)) return "move";
  if (RENAME_TOOL_PATTERN.test(toolName)) return "rename";
  if (CREATE_TOOL_PATTERN.test(toolName)) return "create";
  if (MUTATION_TOOL_PATTERN.test(toolName)) return "write";
  if (SEARCH_TOOL_PATTERN.test(toolName)) return "browse";
  if (READ_TOOL_PATTERN.test(toolName)) return "read";
  return "read";
}

export function getPermissionModeLabel(mode: PermissionMode): string {
  const labels: Record<PermissionMode, string> = {
    strict: "严格模式",
    standard: "标准模式",
    privacy: "隐私模式",
    high_privilege: "最高权限"
  };

  return labels[mode];
}

export function summarizePermission(snapshot: PermissionSnapshot): string {
  if (snapshot.mode === "standard") {
    return "路径外可浏览/读取；变更操作需要确认。";
  }

  if (snapshot.mode === "high_privilege") {
    return "最高权限已开启，请持续确认风险状态。";
  }

  if (snapshot.mode === "privacy") {
    return "路径外内容读取和变更都需要确认。";
  }

  return "仅允许访问配置路径。";
}

export function normalizePathForCompare(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/g, "").toLowerCase();
}

export function isPathInsideAllowedRoots(path: string | undefined, allowedRoots: string[]): boolean {
  if (!path) return false;
  const normalizedPath = normalizePathForCompare(path);
  return allowedRoots.some((root) => {
    const normalizedRoot = normalizePathForCompare(root);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  });
}

export function evaluatePermission(
  snapshot: PermissionSnapshot,
  toolName: string,
  path?: string
): PermissionDecision {
  const operation = classifyPermissionOperation(toolName);
  const mutation = isMutationTool(toolName);
  const insideAllowedRoot = isPathInsideAllowedRoots(path, snapshot.allowedRoots);

  if (snapshot.mode === "high_privilege" || snapshot.highPrivilege.enabled) {
    return {
      toolName,
      operation,
      path,
      risk: mutation ? "high" : "low",
      insideAllowedRoot,
      requiresConfirmation: false,
      reason: "最高权限模式已开启，本地网关应持续显示高风险状态并记录操作。"
    };
  }

  if (snapshot.mode === "strict" && !insideAllowedRoot) {
    return {
      toolName,
      operation,
      path,
      risk: mutation ? "high" : "low",
      insideAllowedRoot,
      requiresConfirmation: true,
      reason: "严格模式下，允许目录外的读取和变更都需要确认或拒绝。"
    };
  }

  if (snapshot.mode === "privacy" && !insideAllowedRoot) {
    return {
      toolName,
      operation,
      path,
      risk: mutation ? "high" : "low",
      insideAllowedRoot,
      requiresConfirmation: true,
      reason: "隐私模式下，允许目录外的内容读取和变更都需要确认。"
    };
  }

  const requiresConfirmation = mutation && !insideAllowedRoot;
  return {
    toolName,
    operation,
    path,
    risk: mutation ? "high" : "low",
    insideAllowedRoot,
    requiresConfirmation,
    reason: requiresConfirmation
      ? "标准模式下，允许目录外的写入、删除、覆盖、移动、重命名或新建目录必须确认。"
      : "当前操作符合标准模式权限合同。"
  };
}
