import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
const requestsFileName = "requests.json";
const auditFileName = "audit.jsonl";
const defaultTtlMs = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizePath(value) {
  return path.resolve(String(value || ""));
}

function stripInternalPermissionFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const clone = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "_webAgentPermission" || key === "__webAgentPermission") {
      continue;
    }
    clone[key] = item && typeof item === "object" ? stripInternalPermissionFields(item) : item;
  }
  return clone;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function calculateArgsHash(args) {
  return crypto.createHash("sha256").update(stableStringify(stripInternalPermissionFields(args || {}))).digest("hex");
}

function requireStoreDir(storeDir) {
  if (typeof storeDir !== "string" || !storeDir.trim()) throw new Error("PERMISSION_STORE_DIR_REQUIRED");
  return path.resolve(storeDir);
}

function requestPath(storeDir) {
  return path.join(requireStoreDir(storeDir), requestsFileName);
}

function auditPath(storeDir) {
  return path.join(requireStoreDir(storeDir), auditFileName);
}

async function ensureStore(storeDir) {
  await fs.mkdir(requireStoreDir(storeDir), { recursive: true });
}

async function readRequests(storeDir) {
  await ensureStore(storeDir);
  try {
    const raw = await fs.readFile(requestPath(storeDir), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeRequests(storeDir, requests) {
  await ensureStore(storeDir);
  await fs.writeFile(requestPath(storeDir), `${JSON.stringify(requests, null, 2)}\n`, "utf8");
}

async function appendAudit(storeDir, event) {
  await ensureStore(storeDir);
  await fs.appendFile(auditPath(storeDir), `${JSON.stringify({ at: nowIso(), ...event })}\n`, "utf8");
}

function normalizeRequestDetails({ operation, targetPaths, directoriesToApprove, args, ttlMs }) {
  const normalizedTargets = [...new Set((targetPaths || []).map(normalizePath))];
  const normalizedDirectories = [...new Set((directoriesToApprove || []).map(normalizePath))];
  return {
    operation: String(operation || ""),
    toolName: String(operation || ""),
    targetPaths: normalizedTargets,
    directoriesToApprove: normalizedDirectories,
    suggestedApprovalRoot: normalizedDirectories[0] || "",
    argsHash: calculateArgsHash(args),
    expiresAt: new Date(Date.now() + (Number.isFinite(ttlMs) ? ttlMs : defaultTtlMs)).toISOString(),
  };
}

export async function createPermissionRequest({
  storeDir,
  operation,
  targetPaths,
  directoriesToApprove,
  args,
  ttlMs = defaultTtlMs,
} = {}) {
  const requests = await readRequests(storeDir);
  const request = {
    version: 1,
    kind: "web_agent_permission_request",
    requestId: randomId("wapr"),
    status: "pending",
    createdAt: nowIso(),
    ...normalizeRequestDetails({ operation, targetPaths, directoriesToApprove, args, ttlMs }),
  };
  requests[request.requestId] = request;
  await writeRequests(storeDir, requests);
  await appendAudit(storeDir, {
    event: "request",
    requestId: request.requestId,
    operation: request.operation,
    targetPaths: request.targetPaths,
    directoriesToApprove: request.directoriesToApprove,
    argsHash: request.argsHash,
  });
  return request;
}

function getRequestOrThrow(requests, requestId) {
  const request = requests[String(requestId || "")];
  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }
  return request;
}

function assertPending(request) {
  if (request.status !== "pending") {
    throw new Error("REQUEST_NOT_PENDING");
  }
  if (Date.parse(request.expiresAt) <= Date.now()) {
    throw new Error("REQUEST_EXPIRED");
  }
}

export async function approvePermissionRequest({
  storeDir,
  requestId,
  argsHash,
  mode = "once",
} = {}) {
  const requests = await readRequests(storeDir);
  const request = getRequestOrThrow(requests, requestId);
  assertPending(request);
  if (argsHash && argsHash !== request.argsHash) {
    throw new Error("ARGS_HASH_MISMATCH");
  }
  if (mode !== "once" && mode !== "directory") {
    throw new Error("UNSUPPORTED_APPROVAL_MODE");
  }
  const token = randomId("wapt");
  Object.assign(request, {
    status: "approved",
    approvedAt: nowIso(),
    approvalMode: mode,
    token,
    tokenUsed: false,
  });
  await writeRequests(storeDir, requests);
  await appendAudit(storeDir, { event: "approve", requestId: request.requestId, mode });
  return { ...request };
}

export async function rejectPermissionRequest({ storeDir, requestId } = {}) {
  const requests = await readRequests(storeDir);
  const request = getRequestOrThrow(requests, requestId);
  assertPending(request);
  Object.assign(request, {
    status: "rejected",
    rejectedAt: nowIso(),
  });
  await writeRequests(storeDir, requests);
  await appendAudit(storeDir, { event: "reject", requestId: request.requestId });
  return { ...request };
}

function sameTargets(left, right) {
  const normalize = (values) => (values || []).map(normalizePath).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export async function consumePermissionToken({
  storeDir,
  requestId,
  token,
  operation,
  targetPaths,
  argsHash,
} = {}) {
  const requests = await readRequests(storeDir);
  const request = requests[String(requestId || "")];
  if (!request) {
    return { allowed: false, reason: "REQUEST_NOT_FOUND" };
  }
  if (request.status !== "approved") {
    return { allowed: false, reason: "REQUEST_NOT_APPROVED" };
  }
  if (request.tokenUsed) {
    return { allowed: false, reason: "TOKEN_ALREADY_USED" };
  }
  if (request.token !== token) {
    return { allowed: false, reason: "TOKEN_MISMATCH" };
  }
  if (request.operation !== operation) {
    return { allowed: false, reason: "OPERATION_MISMATCH" };
  }
  if (!sameTargets(request.targetPaths, targetPaths)) {
    return { allowed: false, reason: "TARGET_PATH_MISMATCH" };
  }
  if (request.argsHash !== argsHash) {
    return { allowed: false, reason: "ARGS_HASH_MISMATCH" };
  }
  request.tokenUsed = true;
  request.consumedAt = nowIso();
  await writeRequests(storeDir, requests);
  await appendAudit(storeDir, { event: "consume", requestId: request.requestId, operation });
  return { allowed: true, request: { ...request } };
}
