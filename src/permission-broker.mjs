import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { canonicalizeWindowsPath } from "./path-lock-manager.mjs";
import { resolvePathIdentity } from "./real-path-policy.mjs";
import { defaultToolRegistry, validateToolMetadata } from "./tool-registry.mjs";

const INTERNAL_PERMISSION_FIELDS = new Set(["_webAgentPermission", "__webAgentPermission"]);
const DECISIONS = new Set(["reject", "allow_once", "allow_task"]);

export class PermissionBrokerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PermissionBrokerError";
    this.code = code;
    this.details = details;
  }
}

function canonicalJsonValue(value, seen = new Set(), { arrayItem = false } = {}) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return arrayItem ? null : undefined;
  }
  if (typeof value === "bigint") {
    throw new PermissionBrokerError("ARGS_NOT_JSON", "Tool arguments cannot contain bigint values.");
  }
  if (seen.has(value)) {
    throw new PermissionBrokerError("ARGS_NOT_JSON", "Tool arguments cannot contain circular references.");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalJsonValue(item, seen, { arrayItem: true }));
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (INTERNAL_PERMISSION_FIELDS.has(key)) continue;
      const item = canonicalJsonValue(value[key], seen);
      if (item !== undefined) result[key] = item;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function stableStringify(value) {
  return JSON.stringify(canonicalJsonValue(value));
}

export function calculateArgsHash(args = {}) {
  return createHash("sha256").update(stableStringify(args) ?? "null", "utf8").digest("hex");
}

function normalizeTaskId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeToolName(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function flattenPaths(value, output = []) {
  if (value === undefined || value === null) return output;
  if (typeof value === "string") {
    if (value.trim()) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenPaths(item, output);
    return output;
  }
  if (typeof value === "object" && typeof value.path === "string") {
    output.push(value.path);
    return output;
  }
  throw new PermissionBrokerError("INVALID_PERMISSION_PATHS", "Permission paths must be strings or path specs.");
}

function publicRequest(request) {
  if (!request) return null;
  const { tokenHash, fingerprint, ...safe } = request;
  return structuredClone(safe);
}

function tokenMatches(expectedHash, token) {
  if (typeof expectedHash !== "string" || typeof token !== "string" || !token) return false;
  const candidate = createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(expectedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export class PermissionBroker {
  constructor({
    workspaceRoot,
    registry = defaultToolRegistry,
    audit = null,
    now = () => new Date(),
    idFactory = () => `permission_${randomUUID()}`,
    tokenFactory = () => randomBytes(24).toString("hex"),
    ttlMs = 10 * 60 * 1000,
    requestKind = "local_permission_request",
  } = {}) {
    if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
      throw new PermissionBrokerError("WORKSPACE_ROOT_REQUIRED", "PermissionBroker requires a workspace root.");
    }
    this.workspaceRootPath = workspaceRoot;
    this.workspaceRoot = canonicalizeWindowsPath(workspaceRoot);
    this.registry = registry;
    this.auditSink = audit;
    this.now = now;
    this.idFactory = idFactory;
    this.tokenFactory = tokenFactory;
    this.ttlMs = ttlMs;
    this.requestKind = requestKind || "local_permission_request";
    this.requests = new Map();
    this.pendingByFingerprint = new Map();
    this.taskGrants = new Map();
    this.auditEvents = [];
  }

  #nowDate() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) throw new PermissionBrokerError("INVALID_CLOCK", "Permission clock returned an invalid date.");
    return date;
  }

  async #audit(event) {
    const record = { at: this.#nowDate().toISOString(), ...event };
    this.auditEvents.push(record);
    if (typeof this.auditSink === "function") await this.auditSink(record);
    else if (this.auditSink && typeof this.auditSink.appendAudit === "function") {
      await this.auditSink.appendAudit(record);
    }
    return record;
  }

  #metadataFor(tool) {
    const metadata = this.registry && typeof this.registry.get === "function"
      ? this.registry.get(tool)
      : this.registry?.[tool];
    if (!metadata) throw new PermissionBrokerError("UNKNOWN_TOOL", `Tool ${tool} is not registered.`);
    return validateToolMetadata(metadata, { toolName: tool });
  }

  #rawPathsFor(tool, args, suppliedPaths) {
    if (suppliedPaths !== undefined) return flattenPaths(suppliedPaths);
    if (this.registry && typeof this.registry.extractPaths === "function") {
      return this.registry.extractPaths(tool, args);
    }
    return [];
  }

  async #canonicalPaths(tool, args, suppliedPaths) {
    const identities = new Map();
    for (const rawPath of this.#rawPathsFor(tool, args, suppliedPaths)) {
      try {
        const identity = await resolvePathIdentity(rawPath, {
          cwd: this.workspaceRootPath,
          workspaceRoot: this.workspaceRootPath,
        });
        identities.set(identity.physicalKey, identity);
      } catch (error) {
        throw new PermissionBrokerError(
          error?.code || "PATH_RESOLUTION_FAILED",
          error?.message || `Could not resolve permission path ${rawPath}.`,
        );
      }
    }
    const ordered = [...identities.entries()].sort(([left], [right]) => left.localeCompare(right));
    return {
      paths: ordered.map(([key]) => key),
      pathIdentities: ordered.map(([, identity]) => identity),
    };
  }

  async #normalizeCall(input = {}) {
    const tool = normalizeToolName(input.tool || input.name);
    if (!tool) throw new PermissionBrokerError("TOOL_REQUIRED", "Permission checks require a tool name.");
    const args = input.args ?? input.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new PermissionBrokerError("INVALID_TOOL_ARGS", "Tool arguments must be an object.");
    }
    const metadata = this.#metadataFor(tool);
    const { paths, pathIdentities } = await this.#canonicalPaths(tool, args, input.paths);
    return {
      tool,
      args,
      argsHash: calculateArgsHash(args),
      metadata,
      paths,
      pathIdentities,
      taskId: normalizeTaskId(input.taskId),
    };
  }

  #grantKey(call) {
    return stableStringify({ taskId: call.taskId, tool: call.tool, paths: call.paths });
  }

  #fingerprint(call) {
    return stableStringify({
      taskId: call.taskId,
      tool: call.tool,
      paths: call.paths,
      argsHash: call.argsHash,
    });
  }

  #requestReasons(call) {
    const reasons = [];
    if (call.metadata.openWorld) reasons.push("open_world");
    if (!call.metadata.reversible) reasons.push("not_reversible");
    if (call.metadata.mutating && call.paths.length === 0) reasons.push("paths_unknown");
    if (call.metadata.mutating && call.pathIdentities.some((item) => !item.isInsideWorkspace)) {
      reasons.push("external_write");
    }
    return reasons;
  }

  async #deny(code, reason, details = {}) {
    await this.#audit({ event: "permission_denied", code, reason, ...details });
    return { status: "denied", allowed: false, code, reason };
  }

  async #createRequest(call, reasons) {
    const fingerprint = this.#fingerprint(call);
    const existingId = this.pendingByFingerprint.get(fingerprint);
    const existing = existingId ? this.requests.get(existingId) : null;
    if (existing?.status === "pending" && Date.parse(existing.expiresAt) > this.#nowDate().valueOf()) {
      return existing;
    }
    if (existingId) this.pendingByFingerprint.delete(fingerprint);

    const createdAt = this.#nowDate();
    const request = {
      version: 1,
      kind: this.requestKind,
      requestId: String(this.idFactory()),
      status: "pending",
      taskId: call.taskId,
      tool: call.tool,
      paths: [...call.paths],
      argsHash: call.argsHash,
      reasons: [...reasons],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.valueOf() + this.ttlMs).toISOString(),
      fingerprint,
    };
    if (!request.requestId) throw new PermissionBrokerError("INVALID_REQUEST_ID", "Permission request ID is empty.");
    if (this.requests.has(request.requestId)) {
      throw new PermissionBrokerError("DUPLICATE_REQUEST_ID", `Permission request ID ${request.requestId} already exists.`);
    }
    this.requests.set(request.requestId, request);
    this.pendingByFingerprint.set(fingerprint, request.requestId);
    await this.#audit({
      event: "permission_requested",
      requestId: request.requestId,
      taskId: request.taskId,
      tool: request.tool,
      paths: request.paths,
      argsHash: request.argsHash,
      reasons: request.reasons,
    });
    return request;
  }

  async authorize(input = {}) {
    let call;
    try {
      call = await this.#normalizeCall(input);
    } catch (error) {
      const code = error?.code || "TOOL_METADATA_REQUIRED";
      return this.#deny(code, error?.message || String(error), {
        tool: normalizeToolName(input.tool || input.name),
      });
    }

    if (call.metadata.mutating && call.pathIdentities.some((item) => item.throughAlias)) {
      return this.#deny(
        "REPARSE_PATH_WRITE_DENIED",
        "Mutating through a symbolic link or junction is not allowed; use the resolved path directly.",
        {
          tool: call.tool,
          paths: call.paths,
        },
      );
    }

    const embeddedPermission = call.args?._webAgentPermission || call.args?.__webAgentPermission;
    const permission = input.permission || embeddedPermission || (
      input.requestId || input.token ? { requestId: input.requestId, token: input.token } : null
    );
    if (permission) {
      return this.consumePermissionToken({
        ...call,
        requestId: permission.requestId,
        token: permission.token,
      });
    }

    if (call.metadata.readOnly && !call.metadata.openWorld) {
      const externalPaths = call.pathIdentities
        .filter((item) => !item.isInsideWorkspace)
        .map((item) => item.physicalKey);
      if (externalPaths.length) {
        await this.#audit({
          event: "external_read_allowed",
          taskId: call.taskId,
          tool: call.tool,
          paths: externalPaths,
          argsHash: call.argsHash,
        });
      }
      return {
        status: "allowed",
        allowed: true,
        authorization: externalPaths.length ? "audited_external_read" : "workspace_read",
        tool: call.tool,
        paths: call.paths,
        argsHash: call.argsHash,
        metadata: call.metadata,
      };
    }

    const reasons = this.#requestReasons(call);
    if (reasons.length === 0) {
      await this.#audit({
        event: "workspace_write_allowed",
        taskId: call.taskId,
        tool: call.tool,
        paths: call.paths,
        argsHash: call.argsHash,
      });
      return {
        status: "allowed",
        allowed: true,
        authorization: "workspace_write",
        tool: call.tool,
        paths: call.paths,
        argsHash: call.argsHash,
        metadata: call.metadata,
      };
    }

    const grant = call.taskId ? this.taskGrants.get(this.#grantKey(call)) : null;
    if (grant) {
      await this.#audit({
        event: "task_grant_used",
        requestId: grant.requestId,
        taskId: call.taskId,
        tool: call.tool,
        paths: call.paths,
        argsHash: call.argsHash,
      });
      return {
        status: "allowed",
        allowed: true,
        authorization: "task_grant",
        requestId: grant.requestId,
        tool: call.tool,
        paths: call.paths,
        argsHash: call.argsHash,
        metadata: call.metadata,
      };
    }

    const request = await this.#createRequest(call, reasons);
    return { status: "permission_required", allowed: false, request: publicRequest(request) };
  }

  evaluate(input = {}) {
    return this.authorize(input);
  }

  #requestOrThrow(requestId) {
    const request = this.requests.get(String(requestId || ""));
    if (!request) throw new PermissionBrokerError("REQUEST_NOT_FOUND", "Permission request was not found.");
    return request;
  }

  #assertPending(request) {
    if (request.status !== "pending") {
      throw new PermissionBrokerError("REQUEST_NOT_PENDING", "Permission request is no longer pending.");
    }
    if (Date.parse(request.expiresAt) <= this.#nowDate().valueOf()) {
      request.status = "expired";
      this.pendingByFingerprint.delete(request.fingerprint);
      throw new PermissionBrokerError("REQUEST_EXPIRED", "Permission request has expired.");
    }
  }

  async resolveRequest({ requestId, decision } = {}) {
    if (!DECISIONS.has(decision)) {
      throw new PermissionBrokerError(
        "INVALID_PERMISSION_DECISION",
        "Permission decision must be reject, allow_once, or allow_task."
      );
    }
    const request = this.#requestOrThrow(requestId);
    this.#assertPending(request);
    if (decision === "allow_task" && !request.taskId) {
      throw new PermissionBrokerError("TASK_ID_REQUIRED", "allow_task requires a taskId-bound request.");
    }
    this.pendingByFingerprint.delete(request.fingerprint);

    if (decision === "reject") {
      request.status = "rejected";
      request.decision = decision;
      request.decidedAt = this.#nowDate().toISOString();
      await this.#audit({ event: "permission_rejected", requestId: request.requestId });
      return { status: "rejected", decision, request: publicRequest(request) };
    }

    const token = String(this.tokenFactory());
    if (!token) throw new PermissionBrokerError("INVALID_PERMISSION_TOKEN", "Permission token is empty.");
    request.status = "approved";
    request.decision = decision;
    request.decidedAt = this.#nowDate().toISOString();
    request.tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    request.tokenUsed = false;
    await this.#audit({
      event: "permission_approved",
      requestId: request.requestId,
      taskId: request.taskId,
      decision,
    });
    return { status: "approved", decision, token, request: publicRequest(request) };
  }

  decide(input = {}) {
    return this.resolveRequest(input);
  }

  async consumePermissionToken(input = {}) {
    let call;
    try {
      call = input.metadata && input.argsHash && Array.isArray(input.paths)
        ? input
        : await this.#normalizeCall(input);
    } catch (error) {
      return this.#deny(error?.code || "INVALID_PERMISSION_CALL", error?.message || String(error));
    }

    const request = this.requests.get(String(input.requestId || ""));
    const mismatch = (code, reason) => this.#deny(code, reason, {
      requestId: input.requestId || null,
      taskId: call.taskId,
      tool: call.tool,
      paths: call.paths,
      argsHash: call.argsHash,
    });
    if (!request) return mismatch("REQUEST_NOT_FOUND", "Permission request was not found.");
    if (request.tokenUsed) return mismatch("TOKEN_ALREADY_USED", "Permission token has already been consumed.");
    if (request.status !== "approved") return mismatch("REQUEST_NOT_APPROVED", "Permission request is not approved.");
    if (Date.parse(request.expiresAt) <= this.#nowDate().valueOf()) {
      return mismatch("REQUEST_EXPIRED", "Permission request has expired.");
    }
    if (!tokenMatches(request.tokenHash, input.token)) return mismatch("TOKEN_MISMATCH", "Permission token does not match.");
    if (request.taskId !== call.taskId) return mismatch("TASK_ID_MISMATCH", "Permission taskId does not match.");
    if (request.tool !== call.tool) return mismatch("TOOL_MISMATCH", "Permission tool does not match.");
    if (stableStringify(request.paths) !== stableStringify(call.paths)) {
      return mismatch("PATHS_MISMATCH", "Permission paths do not match.");
    }
    if (request.argsHash !== call.argsHash) return mismatch("ARGS_HASH_MISMATCH", "Permission arguments do not match.");

    // Mark the token before the first await so concurrent consumers cannot both succeed.
    request.tokenUsed = true;
    request.status = "consumed";
    request.consumedAt = this.#nowDate().toISOString();
    if (request.decision === "allow_task") {
      this.taskGrants.set(this.#grantKey(call), {
        requestId: request.requestId,
        taskId: call.taskId,
        tool: call.tool,
        paths: [...call.paths],
        createdAt: request.consumedAt,
      });
    }
    await this.#audit({
      event: "permission_consumed",
      requestId: request.requestId,
      taskId: call.taskId,
      tool: call.tool,
      paths: call.paths,
      argsHash: call.argsHash,
      decision: request.decision,
    });
    return {
      status: "allowed",
      allowed: true,
      authorization: request.decision,
      requestId: request.requestId,
      tool: call.tool,
      paths: call.paths,
      argsHash: call.argsHash,
      metadata: call.metadata,
    };
  }

  consume(input = {}) {
    return this.consumePermissionToken(input);
  }

  getRequest(requestId) {
    return publicRequest(this.requests.get(String(requestId || "")));
  }

  listRequests() {
    return [...this.requests.values()].map(publicRequest);
  }

  listAudit() {
    return structuredClone(this.auditEvents);
  }

  clearTaskGrants(taskId) {
    const normalized = normalizeTaskId(taskId);
    for (const [key, grant] of this.taskGrants) {
      if (grant.taskId === normalized) this.taskGrants.delete(key);
    }
  }
}

export function createPermissionBroker(options) {
  return new PermissionBroker(options);
}
