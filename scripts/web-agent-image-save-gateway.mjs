import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "generated", "gpt-images");
const toolResultsDir = path.join(repoRoot, "generated", "tool-results");
const port = Number(process.env.WEB_AGENT_IMAGE_SAVE_PORT || 3017);
const host = process.env.WEB_AGENT_IMAGE_SAVE_HOST || "127.0.0.1";
const maxBytes = Number(process.env.WEB_AGENT_IMAGE_SAVE_MAX_BYTES || 50 * 1024 * 1024);
const maxToolResultBytes = Number(process.env.WEB_AGENT_TOOL_RESULT_MAX_BYTES || 5 * 1024 * 1024);
const allowedMimeTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
const imagePathExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  });
  response.end(JSON.stringify(body));
}

function sanitizeFileName(value, extension) {
  const fallback = `gpt-image-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")}${extension}`;
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const baseName = path.basename(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120);
  const parsed = path.parse(baseName);
  const safeName = parsed.name || path.parse(fallback).name;
  return `${safeName}${extension}`;
}

function sanitizeToolName(value) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "tool-result";
  return raw.replace(/[<>:"/\\|?*\u0000-\u001f\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "tool-result";
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function resolveOutputDir(payload) {
  const requested = String(
    payload?.targetDirectory || payload?.directoryPath || payload?.targetPath || ""
  ).trim();
  if (!requested) {
    return outputDir;
  }

  const requestedPath = path.resolve(requested);
  const requestedExtension = path.extname(requestedPath).toLowerCase();
  const targetDir = imagePathExtensions.has(requestedExtension)
    ? path.dirname(requestedPath)
    : requestedPath;
  const resolvedTargetDir = path.resolve(targetDir);
  const resolvedRepoRoot = path.resolve(repoRoot);

  if (resolvedTargetDir !== resolvedRepoRoot && !resolvedTargetDir.startsWith(resolvedRepoRoot + path.sep)) {
    const error = new Error("TARGET_DIRECTORY_OUTSIDE_REPO");
    error.statusCode = 400;
    throw error;
  }

  return resolvedTargetDir;
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes * 1.4) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function saveImage(payload) {
  const mimeType = String(payload?.mimeType || "").toLowerCase();
  const extension = allowedMimeTypes.get(mimeType);
  if (!extension) {
    const error = new Error("UNSUPPORTED_MIME_TYPE");
    error.statusCode = 415;
    throw error;
  }

  const base64 = String(payload?.base64 || "").replace(/^data:[^,]+,/, "");
  if (!base64) {
    const error = new Error("EMPTY_IMAGE_DATA");
    error.statusCode = 400;
    throw error;
  }

  const imageBuffer = Buffer.from(base64, "base64");
  if (!imageBuffer.length) {
    const error = new Error("EMPTY_IMAGE_DATA");
    error.statusCode = 400;
    throw error;
  }
  if (imageBuffer.length > maxBytes) {
    const error = new Error("IMAGE_TOO_LARGE");
    error.statusCode = 413;
    throw error;
  }

  const saveDir = resolveOutputDir(payload);
  await fs.mkdir(saveDir, { recursive: true });
  const fileName = sanitizeFileName(payload?.fileName, extension);
  const filePath = path.join(saveDir, fileName);
  const resolved = path.resolve(filePath);
  const resolvedOutput = path.resolve(saveDir);
  if (!resolved.startsWith(resolvedOutput + path.sep)) {
    const error = new Error("INVALID_FILE_PATH");
    error.statusCode = 400;
    throw error;
  }

  await fs.writeFile(resolved, imageBuffer);
  return { filePath: resolved, outputDir: resolvedOutput, bytes: imageBuffer.length, mimeType };
}

async function saveToolResult(payload) {
  const text = String(payload?.text || payload?.content || "");
  if (!text.trim()) {
    const error = new Error("EMPTY_TOOL_RESULT");
    error.statusCode = 400;
    throw error;
  }

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxToolResultBytes) {
    const error = new Error("TOOL_RESULT_TOO_LARGE");
    error.statusCode = 413;
    throw error;
  }

  await fs.mkdir(toolResultsDir, { recursive: true });
  const extension = String(payload?.extension || ".md").toLowerCase() === ".txt" ? ".txt" : ".md";
  const toolName = sanitizeToolName(payload?.toolName || payload?.name);
  const fileName = sanitizeFileName(payload?.fileName || `${toolName}-${makeTimestamp()}${extension}`, extension);
  const filePath = path.join(toolResultsDir, fileName);
  const resolved = path.resolve(filePath);
  const resolvedOutput = path.resolve(toolResultsDir);
  if (!resolved.startsWith(resolvedOutput + path.sep)) {
    const error = new Error("INVALID_TOOL_RESULT_PATH");
    error.statusCode = 400;
    throw error;
  }

  const header = [
    `# web_Agent 工具结果`,
    ``,
    `- Tool: ${toolName}`,
    `- Saved: ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
  ].join("\n");
  await fs.writeFile(resolved, extension === ".md" ? `${header}${text}` : text, "utf8");
  return { filePath: resolved, outputDir: resolvedOutput, bytes, toolName };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      return sendJson(response, 204, {});
    }
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, {
        ok: true,
        outputDir,
        toolResultsDir,
        features: { saveGptImage: true, saveToolResult: true },
      });
    }
    if (request.method === "POST" && request.url === "/save-gpt-image") {
      const payload = await readJson(request);
      const result = await saveImage(payload);
      return sendJson(response, 200, { ok: true, ...result });
    }
    if (request.method === "POST" && request.url === "/save-tool-result") {
      const payload = await readJson(request);
      const result = await saveToolResult(payload);
      return sendJson(response, 200, { ok: true, ...result });
    }
    return sendJson(response, 404, { ok: false, error: "NOT_FOUND" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = error?.statusCode || (message === "PAYLOAD_TOO_LARGE" ? 413 : 500);
    return sendJson(response, statusCode, { ok: false, error: message });
  }
});

if (path.resolve(process.argv[1] || "") === __filename) {
  server.listen(port, host, () => {
    console.log(`web_Agent image save gateway listening at http://${host}:${port}`);
    console.log(`Saving GPT images to ${outputDir}`);
    console.log(`Saving tool results to ${toolResultsDir}`);
  });
}

export {
  saveImage,
  saveToolResult,
  sanitizeToolName,
};
