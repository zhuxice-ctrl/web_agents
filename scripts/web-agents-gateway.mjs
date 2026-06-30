import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.WEB_AGENTS_ROOT || path.resolve(scriptDir, "..");
const configPath = process.env.WEB_AGENTS_CONFIG || path.join(repoRoot, "config.local.json");
const host = process.env.WEB_AGENTS_GATEWAY_HOST || "127.0.0.1";
const port = Number(process.env.WEB_AGENTS_GATEWAY_PORT || "3007");

const mutationPattern = /(write|edit|delete|remove|move|rename|create|mkdir|patch|replace)/i;
const readPattern = /(read|get|cat|view|fetch|open)/i;
const searchPattern = /(search|find|grep|rg|glob|list|ls|tree|directory|dir)/i;

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(data, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function readLocalConfig() {
  const text = await readFile(configPath, "utf8");
  return JSON.parse(text);
}

function isAbsoluteLocalPath(value) {
  return typeof value === "string" && (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || path.isAbsolute(value));
}

function deriveAllowedRoots(config) {
  const roots = new Set();

  for (const root of config.allowedRoots || []) {
    if (typeof root === "string") roots.add(root);
  }

  for (const root of config.permissions?.allowedRoots || []) {
    if (typeof root === "string") roots.add(root);
  }

  for (const server of Object.values(config.mcpServers || {})) {
    for (const arg of server?.args || []) {
      if (isAbsoluteLocalPath(arg)) roots.add(arg);
    }
  }

  return Array.from(roots);
}

function buildMcpConfig(config) {
  const backend = config.geminiBackend || {};
  const hostName = backend.host || "127.0.0.1";
  const mcpPort = backend.port || 3006;
  const ssePath = backend.ssePath || "/sse";

  return {
    serverUri: `http://${hostName}:${mcpPort}${ssePath}`,
    transport: "sse"
  };
}

function normalizeForCompare(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function insideAllowedRoots(targetPath, allowedRoots) {
  if (!targetPath) return false;
  const normalizedPath = normalizeForCompare(targetPath);
  return allowedRoots.some((root) => {
    const normalizedRoot = normalizeForCompare(root);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  });
}

function classifyOperation(toolName) {
  if (/delete|remove|rm|rmdir/i.test(toolName)) return "delete";
  if (/move|mv/i.test(toolName)) return "move";
  if (/rename/i.test(toolName)) return "rename";
  if (/create|mkdir|new/i.test(toolName)) return "create";
  if (mutationPattern.test(toolName)) return "write";
  if (searchPattern.test(toolName)) return "browse";
  if (readPattern.test(toolName)) return "read";
  return "read";
}

function buildPermissionSnapshot(config) {
  const allowedRoots = deriveAllowedRoots(config);
  const mode = config.permissions?.mode || "standard";
  const highPrivilege = {
    enabled: Boolean(config.permissions?.highPrivilege?.enabled || mode === "high_privilege"),
    expiresAt: config.permissions?.highPrivilege?.expiresAt || null
  };

  return {
    mode: highPrivilege.enabled ? "high_privilege" : mode,
    allowedRoots,
    highPrivilege,
    enforcement: "gateway",
    gatewayUrl: `http://${host}:${port}`,
    lastSyncedAt: new Date().toISOString(),
    message: "本地权限网关已连接；真实工具执行仍应由本地 MCP/网关在执行前再次校验。"
  };
}

function evaluatePermission(permissions, toolName, targetPath) {
  const operation = classifyOperation(toolName);
  const mutation = mutationPattern.test(toolName);
  const insideAllowedRoot = insideAllowedRoots(targetPath, permissions.allowedRoots);

  if (permissions.mode === "high_privilege" || permissions.highPrivilege.enabled) {
    return {
      toolName,
      operation,
      risk: mutation ? "high" : "low",
      path: targetPath,
      insideAllowedRoot,
      requiresConfirmation: false,
      reason: "最高权限模式已开启。"
    };
  }

  const requiresConfirmation =
    !insideAllowedRoot && (mutation || permissions.mode === "privacy" || permissions.mode === "strict");

  return {
    toolName,
    operation,
    risk: mutation ? "high" : "low",
    path: targetPath,
    insideAllowedRoot,
    requiresConfirmation,
    reason: requiresConfirmation
      ? "允许目录外的变更操作需要用户确认。"
      : "当前操作符合本地权限合同。"
  };
}

async function handleRequest(request, response) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url || "/", `http://${host}:${port}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, repoRoot, configPath });
      return;
    }

    const config = await readLocalConfig();
    const permissions = buildPermissionSnapshot(config);

    if (request.method === "GET" && url.pathname === "/config") {
      sendJson(response, 200, {
        mcp: buildMcpConfig(config),
        permissions
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/permission/evaluate") {
      const body = await readJsonBody(request);
      sendJson(response, 200, evaluatePermission(permissions, String(body.toolName || ""), body.path));
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error), configPath });
  }
}

createServer((request, response) => {
  void handleRequest(request, response);
}).listen(port, host, () => {
  console.log(`Web Agents gateway listening on http://${host}:${port}`);
  console.log(`Config: ${configPath}`);
});
