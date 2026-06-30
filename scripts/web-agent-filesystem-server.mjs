import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, "..");
const defaultConfigFile = path.join(defaultRepoRoot, "config", "allowed-directories.local.txt");
const maxTextReadBytes = Number(process.env.WEB_AGENT_FS_MAX_TEXT_BYTES || 10 * 1024 * 1024);
const maxMediaReadBytes = Number(process.env.WEB_AGENT_FS_MAX_MEDIA_BYTES || 50 * 1024 * 1024);
const maxSearchResults = Number(process.env.WEB_AGENT_FS_MAX_SEARCH_RESULTS || 1000);
const maxTreeEntries = Number(process.env.WEB_AGENT_FS_MAX_TREE_ENTRIES || 2000);

const mimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".json", "application/json"],
  [".pdf", "application/pdf"],
  [".csv", "text/csv"],
  [".html", "text/html"],
  [".htm", "text/html"],
]);

const toolDefinitions = [
  {
    name: "read_text_file",
    description: "Read a local text file. Standard mode allows reading outside the writable whitelist.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        head: { type: "number", description: "Only return the first N lines." },
        tail: { type: "number", description: "Only return the last N lines." },
      },
      required: ["path"],
    },
  },
  {
    name: "read_media_file",
    description: "Read an image/media file as MCP content. Images are returned as image blocks.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "read_multiple_files",
    description: "Read multiple local text files.",
    inputSchema: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file. Writes outside the whitelist return a Chinese approval command.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Apply text replacements to a file. Requires writable whitelist permission.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
        oldText: { type: "string" },
        newText: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["path"],
    },
  },
  {
    name: "create_directory",
    description: "Create a directory recursively. Requires writable whitelist permission.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List directory entries. Standard mode allows browsing outside the writable whitelist.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory_with_sizes",
    description: "List directory entries with file sizes.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "directory_tree",
    description: "Return a JSON directory tree. Defaults to a bounded depth to avoid huge responses.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxDepth: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "move_file",
    description: "Move or rename a file/directory. Requires writable permission for both source and destination.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        destination: { type: "string" },
      },
      required: ["source", "destination"],
    },
  },
  {
    name: "search_files",
    description: "Search for files by name under a directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        pattern: { type: "string" },
        excludePatterns: { type: "array", items: { type: "string" } },
      },
      required: ["path", "pattern"],
    },
  },
  {
    name: "get_file_info",
    description: "Return metadata for a local file or directory.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_allowed_directories",
    description: "List directories where write/edit/create/move operations are allowed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

function textResult(text) {
  return { content: [{ type: "text", text: String(text) }] };
}

function errorTextResult(text) {
  return { isError: true, content: [{ type: "text", text: String(text) }] };
}

function normalizeForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInsideOrEqual(targetPath, directoryPath) {
  const target = normalizeForCompare(targetPath);
  let directory = normalizeForCompare(directoryPath);
  if (target === directory) {
    return true;
  }
  if (!directory.endsWith(path.sep)) {
    directory += path.sep;
  }
  return target.startsWith(directory);
}

function uniqueResolvedPaths(values) {
  const seen = new Set();
  const results = [];
  for (const value of values) {
    const resolved = path.resolve(value);
    const key = normalizeForCompare(resolved);
    if (!seen.has(key)) {
      seen.add(key);
      results.push(resolved);
    }
  }
  return results;
}

async function pathExists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

async function nearestExistingDirectory(value) {
  let current = path.resolve(value);
  while (true) {
    try {
      const stat = await fs.stat(current);
      if (stat.isDirectory()) {
        return current;
      }
      return path.dirname(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}

async function initializeAllowedDirectoriesFile({ repoRoot = defaultRepoRoot, configFile = defaultConfigFile } = {}) {
  const configDir = path.dirname(configFile);
  await fs.mkdir(configDir, { recursive: true });

  if (!(await pathExists(configFile))) {
    const content = [
      "# One writable directory per line. Blank lines and lines starting with # are ignored.",
      "# Changes take effect immediately; no MCP bridge restart is required.",
      path.resolve(repoRoot),
      "",
    ].join("\n");
    await fs.writeFile(configFile, content, "utf8");
  }
}

export async function getAllowedDirectories({ repoRoot = defaultRepoRoot, configFile = defaultConfigFile } = {}) {
  await initializeAllowedDirectoriesFile({ repoRoot, configFile });

  const candidates = [path.resolve(repoRoot)];
  const raw = await fs.readFile(configFile, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    candidates.push(path.resolve(expandEnvironmentVariables(trimmed)));
  }

  const existingDirectories = [];
  for (const candidate of uniqueResolvedPaths(candidates)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        existingDirectories.push(candidate);
      }
    } catch {
      // Ignore missing whitelist entries. The approval helper validates new entries.
    }
  }

  return existingDirectories;
}

function expandEnvironmentVariables(value) {
  return value.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
}

export async function getWritablePermissionCheck(targetPath, allowedDirectories) {
  const resolvedTarget = path.resolve(targetPath);
  const allowed = allowedDirectories.some((directory) => isInsideOrEqual(resolvedTarget, directory));
  if (allowed) {
    return { allowed: true, targetPath: resolvedTarget, directoriesToApprove: [] };
  }

  const approvalDirectory = await nearestExistingDirectory(path.dirname(resolvedTarget));
  return {
    allowed: false,
    targetPath: resolvedTarget,
    directoriesToApprove: [approvalDirectory],
  };
}

async function getWritablePermissionForTargets(targets, allowedDirectories) {
  const deniedDirectories = [];
  const normalizedTargets = [];

  for (const target of targets) {
    const resolvedTarget = path.resolve(target.path);
    normalizedTargets.push(resolvedTarget);
    if (allowedDirectories.some((directory) => isInsideOrEqual(resolvedTarget, directory))) {
      continue;
    }

    const approvalBase = target.kind === "directory" ? resolvedTarget : path.dirname(resolvedTarget);
    deniedDirectories.push(await nearestExistingDirectory(approvalBase));
  }

  return {
    allowed: deniedDirectories.length === 0,
    targetPaths: normalizedTargets,
    directoriesToApprove: uniqueResolvedPaths(deniedDirectories),
  };
}

function quotePowerShellPath(value) {
  return `"${String(value).replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

export function buildPermissionRequiredResult({ operation, targetPaths, directoriesToApprove }) {
  const directories = uniqueResolvedPaths(directoriesToApprove || []);
  const commands = directories.map(
    (directory) =>
      `powershell -ExecutionPolicy Bypass -File .\\scripts\\add-allowed-directory.local.ps1 ${quotePowerShellPath(directory)}`
  );

  const text = [
    "需要手动授权后才能执行本次本地文件写入/修改操作。",
    "",
    `工具: ${operation}`,
    "目标路径:",
    ...targetPaths.map((targetPath) => `  - ${path.resolve(targetPath)}`),
    "",
    "需要加入白名单的目录:",
    ...directories.map((directory) => `  - ${directory}`),
    "",
    "请在 F:\\web_agents 的 PowerShell 里运行:",
    ...commands.map((command) => `  ${command}`),
    "",
    "授权会永久写入 config\\allowed-directories.local.txt。",
    "当前 web_Agent 文件服务会动态读取白名单，不需要重启；授权后回到网页工具卡片点击“重新运行 / Run again”即可继续本次执行。",
  ].join("\n");

  return errorTextResult(text);
}

function requireString(args, key) {
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

function applyLineLimit(text, { head, tail } = {}) {
  const hasHead = Number.isFinite(head);
  const hasTail = Number.isFinite(tail);
  if (!hasHead && !hasTail) {
    return text;
  }
  if (hasHead && hasTail) {
    throw new Error("Use either head or tail, not both.");
  }

  const lines = text.split(/\r?\n/);
  if (hasHead) {
    return lines.slice(0, Math.max(0, Number(head))).join("\n");
  }
  return lines.slice(-Math.max(0, Number(tail))).join("\n");
}

async function ensureTextFileSize(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (stat.size > maxTextReadBytes) {
    throw new Error(`Text file is too large (${stat.size} bytes). Limit is ${maxTextReadBytes} bytes.`);
  }
}

async function readTextFile(args) {
  const filePath = path.resolve(requireString(args, "path"));
  await ensureTextFileSize(filePath);
  const text = await fs.readFile(filePath, "utf8");
  return textResult(applyLineLimit(text, args));
}

async function readMultipleFiles(args) {
  if (!Array.isArray(args?.paths)) {
    throw new Error("Missing required array argument: paths");
  }

  const sections = [];
  for (const item of args.paths) {
    if (typeof item !== "string" || !item.trim()) {
      sections.push("Invalid path entry.");
      continue;
    }
    const filePath = path.resolve(item);
    try {
      await ensureTextFileSize(filePath);
      const text = await fs.readFile(filePath, "utf8");
      sections.push(`--- ${filePath} ---\n${text}`);
    } catch (error) {
      sections.push(`--- ${filePath} ---\nERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return textResult(sections.join("\n\n"));
}

async function readMediaFile(args) {
  const filePath = path.resolve(requireString(args, "path"));
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (stat.size > maxMediaReadBytes) {
    throw new Error(`Media file is too large (${stat.size} bytes). Limit is ${maxMediaReadBytes} bytes.`);
  }

  const data = await fs.readFile(filePath);
  const mimeType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  const base64 = data.toString("base64");
  if (mimeType.startsWith("image/")) {
    return { content: [{ type: "image", data: base64, mimeType }] };
  }
  return textResult(JSON.stringify({ path: filePath, mimeType, data: base64 }, null, 2));
}

async function writeFile(args, allowedDirectories) {
  const filePath = requireString(args, "path");
  const content = typeof args?.content === "string" ? args.content : String(args?.content ?? "");
  const permission = await getWritablePermissionForTargets([{ path: filePath, kind: "file" }], allowedDirectories);
  if (!permission.allowed) {
    return buildPermissionRequiredResult({ operation: "write_file", ...permission });
  }

  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
  return textResult(`Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${resolved}`);
}

function normalizeEdits(args) {
  if (Array.isArray(args?.edits)) {
    return args.edits.map((edit, index) => {
      if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string") {
        throw new Error(`Invalid edit at index ${index}. Each edit needs oldText and newText.`);
      }
      return { oldText: edit.oldText, newText: edit.newText };
    });
  }

  if (typeof args?.oldText === "string" && typeof args?.newText === "string") {
    return [{ oldText: args.oldText, newText: args.newText }];
  }

  throw new Error("edit_file requires edits array or oldText/newText.");
}

async function editFile(args, allowedDirectories) {
  const filePath = requireString(args, "path");
  const permission = await getWritablePermissionForTargets([{ path: filePath, kind: "file" }], allowedDirectories);
  if (!permission.allowed) {
    return buildPermissionRequiredResult({ operation: "edit_file", ...permission });
  }

  const resolved = path.resolve(filePath);
  await ensureTextFileSize(resolved);
  const edits = normalizeEdits(args);
  const original = await fs.readFile(resolved, "utf8");
  let updated = original;
  let applied = 0;

  for (const edit of edits) {
    if (!updated.includes(edit.oldText)) {
      throw new Error(`Could not find oldText for edit ${applied + 1}.`);
    }
    updated = updated.replace(edit.oldText, edit.newText);
    applied += 1;
  }

  if (args?.dryRun) {
    return textResult(`Dry run: would apply ${applied} edit(s) to ${resolved}.`);
  }

  await fs.writeFile(resolved, updated, "utf8");
  return textResult(`Successfully applied ${applied} edit(s) to ${resolved}.`);
}

async function createDirectory(args, allowedDirectories) {
  const directoryPath = requireString(args, "path");
  const permission = await getWritablePermissionForTargets(
    [{ path: directoryPath, kind: "directory" }],
    allowedDirectories
  );
  if (!permission.allowed) {
    return buildPermissionRequiredResult({ operation: "create_directory", ...permission });
  }

  const resolved = path.resolve(directoryPath);
  await fs.mkdir(resolved, { recursive: true });
  return textResult(`Successfully created directory ${resolved}`);
}

async function listDirectory(args) {
  const directoryPath = path.resolve(requireString(args, "path"));
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
  return textResult(
    entries
      .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
      .join("\n")
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

async function listDirectoryWithSizes(args) {
  const directoryPath = path.resolve(requireString(args, "path"));
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const lines = [];
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    const stat = await fs.stat(fullPath);
    lines.push(
      `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}  ${entry.isDirectory() ? "-" : formatBytes(stat.size)}`
    );
  }
  return textResult(lines.join("\n"));
}

async function directoryTree(args) {
  const root = path.resolve(requireString(args, "path"));
  const maxDepth = Number.isFinite(args?.maxDepth) ? Math.max(0, Number(args.maxDepth)) : 5;
  let visited = 0;

  async function walk(currentPath, depth) {
    visited += 1;
    const stat = await fs.stat(currentPath);
    const node = {
      name: path.basename(currentPath) || currentPath,
      path: currentPath,
      type: stat.isDirectory() ? "directory" : "file",
    };

    if (!stat.isDirectory() || depth >= maxDepth || visited >= maxTreeEntries) {
      return node;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    node.children = [];
    for (const entry of entries) {
      if (visited >= maxTreeEntries) {
        node.truncated = true;
        break;
      }
      node.children.push(await walk(path.join(currentPath, entry.name), depth + 1));
    }
    return node;
  }

  return textResult(JSON.stringify(await walk(root, 0), null, 2));
}

async function moveFile(args, allowedDirectories) {
  const source = requireString(args, "source");
  const destination = requireString(args, "destination");
  const permission = await getWritablePermissionForTargets(
    [
      { path: source, kind: "file" },
      { path: destination, kind: "file" },
    ],
    allowedDirectories
  );
  if (!permission.allowed) {
    return buildPermissionRequiredResult({ operation: "move_file", ...permission });
  }

  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  await fs.mkdir(path.dirname(resolvedDestination), { recursive: true });
  await fs.rename(resolvedSource, resolvedDestination);
  return textResult(`Successfully moved ${resolvedSource} to ${resolvedDestination}`);
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(filePath, root, pattern) {
  const relative = path.relative(root, filePath);
  if (pattern.includes("*") || pattern.includes("?")) {
    return wildcardToRegExp(pattern).test(path.basename(filePath)) || wildcardToRegExp(pattern).test(relative);
  }
  const needle = pattern.toLowerCase();
  return path.basename(filePath).toLowerCase().includes(needle) || relative.toLowerCase().includes(needle);
}

function isExcluded(filePath, root, excludePatterns) {
  const relative = path.relative(root, filePath);
  return excludePatterns.some((pattern) => wildcardToRegExp(pattern).test(relative));
}

async function searchFiles(args) {
  const root = path.resolve(requireString(args, "path"));
  const pattern = requireString(args, "pattern");
  const excludePatterns = Array.isArray(args?.excludePatterns) ? args.excludePatterns.filter(Boolean).map(String) : [];
  const results = [];

  async function walk(currentPath) {
    if (results.length >= maxSearchResults) {
      return;
    }
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxSearchResults) {
        return;
      }
      const fullPath = path.join(currentPath, entry.name);
      if (isExcluded(fullPath, root, excludePatterns)) {
        continue;
      }
      if (matchesPattern(fullPath, root, pattern)) {
        results.push(fullPath);
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(root);
  return textResult(results.length ? results.join("\n") : "No matches found.");
}

async function getFileInfo(args) {
  const targetPath = path.resolve(requireString(args, "path"));
  const stat = await fs.stat(targetPath);
  return textResult(
    JSON.stringify(
      {
        path: targetPath,
        type: stat.isDirectory() ? "directory" : "file",
        size: stat.size,
        sizeHuman: stat.isDirectory() ? "-" : formatBytes(stat.size),
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        accessed: stat.atime.toISOString(),
        readonly: (stat.mode & 0o200) === 0,
      },
      null,
      2
    )
  );
}

function listAllowedDirectoriesResult(allowedDirectories) {
  return textResult(
    [
      "Writable allowed directories:",
      ...allowedDirectories.map((directory) => `  - ${directory}`),
      "",
      "Standard mode: browsing/reading can cross directories; write/edit/create/move requires a directory in this list.",
      "To add a directory permanently, run scripts\\add-allowed-directory.local.ps1. Changes take effect immediately.",
    ].join("\n")
  );
}

export async function callTool(name, args = {}, context = {}) {
  const repoRoot = context.repoRoot || defaultRepoRoot;
  const configFile = context.configFile || defaultConfigFile;
  const allowedDirectories = await getAllowedDirectories({ repoRoot, configFile });

  switch (name) {
    case "read_text_file":
      return readTextFile(args);
    case "read_media_file":
      return readMediaFile(args);
    case "read_multiple_files":
      return readMultipleFiles(args);
    case "write_file":
      return writeFile(args, allowedDirectories);
    case "edit_file":
      return editFile(args, allowedDirectories);
    case "create_directory":
      return createDirectory(args, allowedDirectories);
    case "list_directory":
      return listDirectory(args);
    case "list_directory_with_sizes":
      return listDirectoryWithSizes(args);
    case "directory_tree":
      return directoryTree(args);
    case "move_file":
      return moveFile(args, allowedDirectories);
    case "search_files":
      return searchFiles(args);
    case "get_file_info":
      return getFileInfo(args);
    case "list_allowed_directories":
      return listAllowedDirectoriesResult(allowedDirectories);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function sendMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  sendMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleJsonRpcMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  const { id, method, params } = message;
  if (!id && id !== 0) {
    return;
  }

  try {
    switch (method) {
      case "initialize":
        sendResult(id, {
          protocolVersion: params?.protocolVersion || "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "web-agent-dynamic-filesystem", version: "1.0.0" },
        });
        break;
      case "ping":
        sendResult(id, {});
        break;
      case "tools/list":
        sendResult(id, { tools: toolDefinitions });
        break;
      case "tools/call": {
        const result = await callTool(params?.name, params?.arguments || {});
        sendResult(id, result);
        break;
      }
      case "resources/list":
        sendResult(id, { resources: [] });
        break;
      case "prompts/list":
        sendResult(id, { prompts: [] });
        break;
      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    sendResult(id, errorTextResult(messageText));
  }
}

export function startStdioServer() {
  let buffer = "";
  let queue = Promise.resolve();

  function enqueueMessage(message) {
    queue = queue
      .then(() => handleJsonRpcMessage(message))
      .catch((error) => {
        process.stderr.write(
          `[web_Agent filesystem] Failed to handle JSON-RPC message: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      });
  }

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }

      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line);
        enqueueMessage(message);
      } catch (error) {
        process.stderr.write(
          `[web_Agent filesystem] Invalid JSON-RPC message: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      }
    }
  });

  process.stdin.on("end", () => {
    queue.finally(() => process.exit(0));
  });
}

if (path.resolve(process.argv[1] || "") === __filename) {
  startStdioServer();
}
