import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createFilesystemTools } from "@web-agents/local-core/filesystem-tools";
import { defaultPermissionStoreDir } from "./web-agent-permission-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, "..");
const defaultConfigFile = path.join(defaultRepoRoot, "config", "allowed-directories.local.txt");
const defaultAuditFile = path.join(defaultRepoRoot, "generated", "audit", "writes.jsonl");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function parseHttpAuthority(value) {
  try {
    return new URL(`http://${String(value || "")}`);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || "").toLowerCase());
}

function isSerializedOrigin(url) {
  return (
    !url.username &&
    !url.password &&
    (!url.pathname || url.pathname === "/") &&
    !url.search &&
    !url.hash
  );
}

function isTrustedExtensionOrigin(url) {
  if (url.protocol === "chrome-extension:") {
    return /^[a-p]{32}$/.test(url.hostname);
  }
  if (url.protocol === "moz-extension:") {
    return /^[a-f0-9-]{32,36}$/i.test(url.hostname);
  }
  return false;
}

function authorizeLocalRequest(request, response, url) {
  const authority = parseHttpAuthority(request.headers.host);
  if (!authority || !isLoopbackHostname(authority.hostname)) {
    sendJson(response, 403, { ok: false, error: "LOCAL_HOST_REQUIRED" });
    return false;
  }

  const origin = request.headers.origin;
  if (origin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(String(origin));
    } catch {
      sendJson(response, 403, { ok: false, error: "LOCAL_ORIGIN_REQUIRED" });
      return false;
    }

    const sameLoopbackPort =
      parsedOrigin.protocol === "http:" &&
      isLoopbackHostname(parsedOrigin.hostname) &&
      (parsedOrigin.port || "80") === (authority.port || "80");
    if (!isSerializedOrigin(parsedOrigin) || (!sameLoopbackPort && !isTrustedExtensionOrigin(parsedOrigin))) {
      sendJson(response, 403, { ok: false, error: "LOCAL_ORIGIN_REQUIRED" });
      return false;
    }

    response.setHeader("Access-Control-Allow-Origin", String(origin));
    response.setHeader("Vary", "Origin");
  }

  if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/message")) {
    const contentType = String(request.headers["content-type"] || "");
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      sendJson(response, 415, { ok: false, error: "APPLICATION_JSON_REQUIRED" });
      return false;
    }
  }

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,accept,mcp-session-id,last-event-id"
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  return true;
}

async function handleRpc(message, { filesystemTools }) {
  const { id, method, params } = message || {};
  if (method === "notifications/initialized" || (id === undefined && id !== 0)) return null;
  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "web-agents-filesystem", version: "2.0.0" },
        },
      };
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: filesystemTools.definitions } };
    if (method === "tools/call") {
      const result = await filesystemTools.call(params?.name, params?.arguments || {});
      return { jsonrpc: "2.0", id, result };
    }
    if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: [] } };
    if (method === "prompts/list") return { jsonrpc: "2.0", id, result: { prompts: [] } };
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (error) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: error?.message || String(error) } };
  }
}

export function createFilesystemHttpServer({
  repoRoot = defaultRepoRoot,
  host = "127.0.0.1",
  port = 3006,
  configFile,
  permissionStoreDir = null,
  auditFile,
  filesystemTools = null,
} = {}) {
  const tools = filesystemTools || createFilesystemTools({
    repoRoot,
    configFile: configFile || defaultConfigFile,
    permissionStoreDir: permissionStoreDir || defaultPermissionStoreDir,
    auditFile: auditFile || defaultAuditFile,
  });
  const sessions = new Map();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${host}:${port}`);
      if (!authorizeLocalRequest(request, response, url)) return;
      if (request.method === "OPTIONS") return sendJson(response, 204, {});
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, {
          ok: true,
          service: "web-agents-filesystem-mcp",
          pid: process.pid,
          repoRoot: path.resolve(repoRoot),
          port: server.address()?.port || port,
          transports: ["sse", "streamable-http"],
          tools: tools.definitions.length,
        });
      }
      if (request.method === "GET" && url.pathname === "/sse") {
        const sessionId = randomUUID();
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        sessions.set(sessionId, response);
        response.write(`event: endpoint\ndata: /message?sessionId=${encodeURIComponent(sessionId)}\n\n`);
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
        heartbeat.unref?.();
        request.on("close", () => {
          clearInterval(heartbeat);
          sessions.delete(sessionId);
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/message") {
        const sessionId = url.searchParams.get("sessionId");
        const stream = sessions.get(sessionId);
        if (!stream) return sendJson(response, 404, { ok: false, error: "MCP_SESSION_NOT_FOUND" });
        const message = await readJson(request);
        const result = await handleRpc(message, { filesystemTools: tools });
        sendJson(response, 202, { ok: true });
        if (result) stream.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
        return;
      }
      if (request.method === "POST" && url.pathname === "/mcp") {
        const message = await readJson(request);
        const result = await handleRpc(message, { filesystemTools: tools });
        if (!result) return sendJson(response, 202, { ok: true });
        return sendJson(response, 200, result);
      }
      return sendJson(response, 404, { ok: false, error: "NOT_FOUND" });
    } catch (error) {
      const status = error?.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 500;
      return sendJson(response, status, { ok: false, error: error?.message || String(error) });
    }
  });
  server.serviceId = "web-agents-filesystem-mcp";
  server.closeAllSessions = () => {
    for (const stream of sessions.values()) stream.end();
    sessions.clear();
  };
  return server;
}

if (path.resolve(process.argv[1] || "") === __filename) {
  const host = process.env.WEB_AGENTS_FILESYSTEM_HOST || "127.0.0.1";
  const port = Number(process.env.WEB_AGENTS_FILESYSTEM_PORT || 3006);
  const server = createFilesystemHttpServer({ host, port });
  server.listen(port, host, () => console.log(`Web Agents filesystem MCP listening at http://${host}:${port}/sse`));
}

export { handleRpc };
