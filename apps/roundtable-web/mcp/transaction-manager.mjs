import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeWindowsPath, PathLockManager } from "@web-agents/local-core/paths";
import { atomicWriteJson } from "@web-agents/local-core/atomic-file";
import { calculateArgsHash } from "./permission-broker.mjs";
import { assertMutationPathIdentity, resolvePathIdentity } from "@web-agents/local-core/real-paths";
import { defaultToolRegistry, validateToolMetadata } from "./tool-registry.mjs";

const TRANSACTION_SCHEMA = "web-agents.transaction.v1";

export class TransactionError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "TransactionError";
    this.code = code;
    this.details = details;
  }
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashContent(content) {
  return hashBuffer(Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8"));
}

function safeJsonValue(value, seen = new Set(), depth = 0) {
  if (depth > 20) return "[max-depth]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (Buffer.isBuffer(value)) return { type: "Buffer", length: value.length, sha256: hashBuffer(value) };
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => safeJsonValue(item, seen, depth + 1));
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const safe = safeJsonValue(item, seen, depth + 1);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function publicClone(value) {
  return structuredClone(safeJsonValue(value));
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || "TOOL_EXECUTION_FAILED",
    message: error?.message || String(error),
    stack: typeof error?.stack === "string" ? error.stack : null,
    details: safeJsonValue(error?.details),
  };
}

async function pathState(targetPath) {
  let stat;
  try {
    stat = await fs.lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, type: "missing", hash: null, size: 0 };
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    const link = await fs.readlink(targetPath);
    return { exists: true, type: "symlink", hash: hashContent(`symlink\0${link}`), size: Buffer.byteLength(link), link };
  }
  if (stat.isFile()) {
    const content = await fs.readFile(targetPath);
    return { exists: true, type: "file", hash: hashBuffer(content), size: content.length };
  }
  if (!stat.isDirectory()) {
    return {
      exists: true,
      type: "other",
      hash: hashContent(`${stat.mode}:${stat.size}`),
      size: stat.size,
    };
  }

  const digest = createHash("sha256");
  let totalSize = 0;
  async function walk(currentPath, relativePath) {
    const current = await fs.lstat(currentPath);
    if (current.isSymbolicLink()) {
      const link = await fs.readlink(currentPath);
      digest.update(`L\0${relativePath}\0${link}\0`);
      totalSize += Buffer.byteLength(link);
      return;
    }
    if (current.isDirectory()) {
      digest.update(`D\0${relativePath}\0`);
      const names = await fs.readdir(currentPath);
      names.sort();
      for (const name of names) await walk(path.join(currentPath, name), path.join(relativePath, name));
      return;
    }
    if (current.isFile()) {
      const content = await fs.readFile(currentPath);
      digest.update(`F\0${relativePath}\0${hashBuffer(content)}\0`);
      totalSize += content.length;
      return;
    }
    digest.update(`O\0${relativePath}\0${current.mode}\0${current.size}\0`);
  }
  await walk(targetPath, ".");
  return { exists: true, type: "directory", hash: digest.digest("hex"), size: totalSize };
}

function statesEqual(left, right) {
  return Boolean(left && right)
    && left.exists === right.exists
    && left.type === right.type
    && left.hash === right.hash;
}

async function copyPath(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
  });
}

function normalizePathSpecs(input, output = []) {
  if (input === undefined || input === null) return output;
  if (typeof input === "string") {
    output.push({ path: input, subtree: false, role: "target" });
    return output;
  }
  if (Array.isArray(input)) {
    for (const item of input) normalizePathSpecs(item, output);
    return output;
  }
  if (typeof input !== "object") {
    throw new TransactionError("INVALID_TRANSACTION_PATHS", "Transaction paths must be strings or path specs.");
  }
  if (typeof input.path === "string") {
    output.push({
      path: input.path,
      subtree: Boolean(input.subtree),
      role: input.role || "target",
      argument: typeof input.argument === "string" ? input.argument : null,
    });
  }
  if (Array.isArray(input.paths)) normalizePathSpecs(input.paths, output);
  if (Array.isArray(input.subtreePaths)) {
    for (const subtreePath of input.subtreePaths) {
      output.push({ path: subtreePath, subtree: true, role: "subtree" });
    }
  }
  if (typeof input.source === "string") {
    output.push({ path: input.source, subtree: Boolean(input.sourceSubtree), role: "source" });
  }
  if (typeof input.destination === "string") {
    output.push({ path: input.destination, subtree: Boolean(input.destinationSubtree), role: "destination" });
  }
  return output;
}

function requireIdentifier(value, code, label) {
  if (typeof value !== "string" || !value.trim()) throw new TransactionError(code, `${label} is required.`);
  return value.trim();
}

function validateTransactionId(value) {
  const id = requireIdentifier(value, "TRANSACTION_ID_REQUIRED", "Transaction ID");
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new TransactionError("INVALID_TRANSACTION_ID", "Transaction ID contains unsafe path characters.");
  }
  return id;
}

export class TransactionManager {
  constructor({
    workspaceRoot,
    transactionRoot = null,
    registry = defaultToolRegistry,
    pathLockManager = null,
    executeTool = null,
    audit = null,
    now = () => new Date(),
    idFactory = () => `tx_${randomUUID()}`,
  } = {}) {
    if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
      throw new TransactionError("WORKSPACE_ROOT_REQUIRED", "TransactionManager requires a workspace root.");
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.transactionRoot = path.resolve(transactionRoot || path.join(this.workspaceRoot, ".web-agents", "transactions"));
    this.registry = registry;
    this.pathLockManager = pathLockManager || new PathLockManager({ cwd: this.workspaceRoot });
    this.executeTool = executeTool;
    this.auditSink = audit;
    this.now = now;
    this.idFactory = idFactory;
    this.transactions = new Map();
    this.taskExecutors = new Map();
    this.transactionByExecutionId = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this.listTransactions();
    await fs.mkdir(this.transactionRoot, { recursive: true });
    const entries = await fs.readdir(this.transactionRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.transactionRoot, entry.name);
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(directory, "transaction.json"), "utf8"));
        if (!manifest?.id || this.transactions.has(manifest.id)) continue;
        const transaction = {
          directory,
          backupsDirectory: path.join(directory, "backups"),
          recoveryDirectory: path.join(directory, "recovery"),
          queue: Promise.resolve(),
          executions: new Map(),
          manifest,
        };
        this.transactions.set(manifest.id, transaction);
        if (manifest.taskId && manifest.executorId) this.taskExecutors.set(manifest.taskId, manifest.executorId);
        if (manifest.executionId) {
          this.transactionByExecutionId.set(manifest.executionId, {
            transactionId: manifest.id,
            fingerprint: manifest.executionFingerprint,
          });
        }
      } catch {
        // Invalid transaction directories remain untouched for diagnostics and manual repair.
      }
    }
    this.initialized = true;
    return this.listTransactions();
  }

  #nowIso() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) throw new TransactionError("INVALID_CLOCK", "Transaction clock returned an invalid date.");
    return date.toISOString();
  }

  async #audit(event) {
    const record = { at: this.#nowIso(), ...event };
    if (typeof this.auditSink === "function") await this.auditSink(record);
    else if (this.auditSink && typeof this.auditSink.appendAudit === "function") {
      await this.auditSink.appendAudit(record);
    }
  }

  #get(transactionId) {
    const transaction = this.transactions.get(String(transactionId || ""));
    if (!transaction) throw new TransactionError("TRANSACTION_NOT_FOUND", "Transaction was not found.", { transactionId });
    return transaction;
  }

  async #persist(transaction) {
    transaction.manifest.updatedAt = this.#nowIso();
    await atomicWriteJson(path.join(transaction.directory, "transaction.json"), transaction.manifest);
  }

  claimWriteExecutor(taskId, executorId) {
    const normalizedTask = requireIdentifier(taskId, "TASK_ID_REQUIRED", "Task ID");
    const normalizedExecutor = requireIdentifier(executorId, "EXECUTOR_ID_REQUIRED", "Executor ID");
    const current = this.taskExecutors.get(normalizedTask);
    if (current && current !== normalizedExecutor) {
      throw new TransactionError(
        "WRITE_EXECUTOR_MISMATCH",
        `Task ${normalizedTask} is already owned by write executor ${current}.`,
        { taskId: normalizedTask, expectedExecutorId: current, actualExecutorId: normalizedExecutor }
      );
    }
    this.taskExecutors.set(normalizedTask, normalizedExecutor);
    return normalizedExecutor;
  }

  async begin(input = {}) {
    await this.initialize();
    const taskId = requireIdentifier(input.taskId, "TASK_ID_REQUIRED", "Task ID");
    const sessionId = typeof input.sessionId === "string" && input.sessionId.trim()
      ? requireIdentifier(input.sessionId, "SESSION_ID_REQUIRED", "Session ID")
      : null;
    const executorId = this.claimWriteExecutor(taskId, input.executorId);
    const executionId = typeof input.executionId === "string" && input.executionId.trim()
      ? input.executionId.trim()
      : null;
    const fingerprintInput = {
      taskId,
      executorId,
      originalInstruction: String(input.originalInstruction ?? input.instruction ?? ""),
      requestedTransactionId: input.transactionId || null,
    };
    const legacyFingerprint = calculateArgsHash(fingerprintInput);
    const beginFingerprint = calculateArgsHash(sessionId ? { ...fingerprintInput, sessionId } : fingerprintInput);
    if (executionId && this.transactionByExecutionId.has(executionId)) {
      const reference = this.transactionByExecutionId.get(executionId);
      const existing = this.#get(reference.transactionId);
      if (existing.manifest.sessionId && existing.manifest.sessionId !== sessionId) {
        throw new TransactionError(
          "TRANSACTION_SESSION_MISMATCH",
          `Transaction ${existing.manifest.id} belongs to another roundtable session.`,
          { transactionId: existing.manifest.id, expectedSessionId: existing.manifest.sessionId, actualSessionId: sessionId },
        );
      }
      const canBindLegacyOwner = sessionId
        && !existing.manifest.sessionId
        && reference.fingerprint === legacyFingerprint;
      if (reference.fingerprint !== beginFingerprint && !canBindLegacyOwner) {
        throw new TransactionError("EXECUTION_ID_MISMATCH", "Transaction executionId was reused with different input.");
      }
      if (canBindLegacyOwner) {
        existing.manifest.sessionId = sessionId;
        existing.manifest.executionFingerprint = beginFingerprint;
        reference.fingerprint = beginFingerprint;
        await this.#persist(existing);
      }
      return publicClone(existing.manifest);
    }

    const id = validateTransactionId(input.transactionId || String(this.idFactory()));
    if (this.transactions.has(id)) throw new TransactionError("TRANSACTION_ALREADY_EXISTS", `Transaction ${id} already exists.`);
    const directory = path.join(this.transactionRoot, id);
    const transaction = {
      directory,
      backupsDirectory: path.join(directory, "backups"),
      recoveryDirectory: path.join(directory, "recovery"),
      queue: Promise.resolve(),
      executions: new Map(),
      manifest: {
        schema: TRANSACTION_SCHEMA,
        id,
        taskId,
        sessionId,
        executionId,
        executionFingerprint: beginFingerprint,
        executorId,
        originalInstruction: String(input.originalInstruction ?? input.instruction ?? ""),
        status: "active",
        createdAt: this.#nowIso(),
        updatedAt: this.#nowIso(),
        committedAt: null,
        calls: [],
        rollback: null,
      },
    };
    await Promise.all([
      fs.mkdir(transaction.backupsDirectory, { recursive: true }),
      fs.mkdir(transaction.recoveryDirectory, { recursive: true }),
    ]);
    this.transactions.set(id, transaction);
    if (executionId) {
      this.transactionByExecutionId.set(executionId, { transactionId: id, fingerprint: beginFingerprint });
    }
    await this.#persist(transaction);
    await this.#audit({ event: "transaction_started", transactionId: id, taskId, sessionId, executorId, executionId });
    return publicClone(transaction.manifest);
  }

  #metadataFor(tool) {
    const metadata = this.registry && typeof this.registry.get === "function"
      ? this.registry.get(tool)
      : this.registry?.[tool];
    if (!metadata) throw new TransactionError("UNKNOWN_TOOL", `Tool ${tool} is not registered.`);
    return validateToolMetadata(metadata, { toolName: tool });
  }

  #registryPathSpecs(tool, args) {
    if (this.registry && typeof this.registry.extractPathSpecs === "function") {
      return this.registry.extractPathSpecs(tool, args);
    }
    return [];
  }

  async #resolvePathSpecs(tool, args, supplied) {
    const raw = normalizePathSpecs(supplied === undefined ? this.#registryPathSpecs(tool, args) : supplied);
    const byKey = new Map();
    for (const item of raw) {
      let identity;
      try {
        identity = await resolvePathIdentity(item.path, {
          cwd: this.workspaceRoot,
          workspaceRoot: this.workspaceRoot,
        });
        assertMutationPathIdentity(identity);
      } catch (error) {
        throw new TransactionError(
          error?.code || "PATH_RESOLUTION_FAILED",
          error?.message || `Could not resolve transaction path ${item.path}.`,
          error?.details || { path: item.path },
        );
      }
      const key = identity.physicalKey;
      const existing = byKey.get(key);
      byKey.set(key, {
        path: identity.physicalPath,
        key,
        subtree: Boolean(item.subtree || existing?.subtree),
        role: item.role || existing?.role || "target",
        arguments: [...new Set([...(existing?.arguments || []), item.argument].filter(Boolean))],
      });
    }

    const specs = [...byKey.values()];
    if (tool === "move_file") {
      const source = specs.find((item) => item.role === "source");
      if (source) {
        try {
          if ((await fs.lstat(source.path)).isDirectory()) {
            for (const item of specs) item.subtree = true;
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
    specs.sort((left, right) => left.key.localeCompare(right.key));
    return specs;
  }

  #physicalExecutionArgs(args, specs) {
    const resolved = structuredClone(args);
    for (const spec of specs) {
      for (const argument of spec.arguments || []) {
        if (typeof resolved[argument] === "string") resolved[argument] = spec.path;
      }
    }
    return resolved;
  }

  async #captureBefore(transaction, sequence, specs) {
    const records = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const state = await pathState(spec.path);
      let backupPath = null;
      if (state.exists) {
        const pathHash = hashContent(canonicalizeWindowsPath(spec.path)).slice(0, 16);
        backupPath = path.join(transaction.backupsDirectory, `${String(sequence).padStart(4, "0")}-${index}-${pathHash}.before`);
        await copyPath(spec.path, backupPath);
      }
      records.push({
        path: spec.path,
        subtree: spec.subtree,
        role: spec.role,
        before: { ...state, backupPath },
        after: null,
      });
    }
    return records;
  }

  async #captureAfter(records) {
    for (const record of records) record.after = await pathState(record.path);
  }

  async #performExecute(transaction, call) {
    if (transaction.manifest.status !== "active") {
      throw new TransactionError(
        "TRANSACTION_NOT_ACTIVE",
        `Transaction ${transaction.manifest.id} is ${transaction.manifest.status}.`,
        { transactionId: transaction.manifest.id, status: transaction.manifest.status }
      );
    }
    if (call.executorId && call.executorId !== transaction.manifest.executorId) {
      throw new TransactionError("WRITE_EXECUTOR_MISMATCH", "Tool call executor does not own this transaction.");
    }
    const tool = requireIdentifier(call.tool || call.name, "TOOL_REQUIRED", "Tool");
    const metadata = this.#metadataFor(tool);
    if (!metadata.mutating) {
      throw new TransactionError("MUTATING_TOOL_REQUIRED", `Tool ${tool} does not belong in a write transaction.`);
    }
    if (!metadata.reversible) {
      throw new TransactionError("TOOL_NOT_REVERSIBLE", `Tool ${tool} cannot be transactionally rolled back.`);
    }
    const args = call.args ?? call.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new TransactionError("INVALID_TOOL_ARGS", "Transactional tool arguments must be an object.");
    }
    const specs = await this.#resolvePathSpecs(tool, args, call.pathSpecs ?? call.paths);
    if (specs.length === 0) {
      throw new TransactionError("TRANSACTION_PATHS_REQUIRED", `Mutating tool ${tool} did not declare target paths.`);
    }
    const authorizedPaths = call.context?.permission?.paths;
    if (Array.isArray(authorizedPaths)) {
      const expected = [...new Set(authorizedPaths.map((item) => canonicalizeWindowsPath(item, { cwd: this.workspaceRoot })))].sort();
      const actual = [...new Set(specs.map((item) => item.key))].sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw new TransactionError(
          "PERMISSION_PATHS_CHANGED",
          "The physical transaction paths no longer match the authorized path set.",
          { expected, actual },
        );
      }
    }
    const executor = call.executeTool || this.executeTool;
    if (typeof executor !== "function") {
      throw new TransactionError("TOOL_EXECUTOR_REQUIRED", "TransactionManager requires an injected tool executor.");
    }

    const sequence = transaction.manifest.calls.length + 1;
    const executionArgs = this.#physicalExecutionArgs(args, specs);
    const record = {
      sequence,
      executionId: call.executionId || null,
      tool,
      argsHash: createHash("sha256").update(JSON.stringify(safeJsonValue(args)), "utf8").digest("hex"),
      paths: specs.map((item) => item.path),
      status: "preparing",
      startedAt: this.#nowIso(),
      completedAt: null,
      pathRecords: [],
      result: null,
      error: null,
    };
    transaction.manifest.calls.push(record);
    await this.#persist(transaction);

    let result;
    try {
      result = await this.pathLockManager.withLocks(specs, async (lockKeys) => {
        const refreshedSpecs = await this.#resolvePathSpecs(tool, args, call.pathSpecs ?? call.paths);
        if (JSON.stringify(refreshedSpecs.map((item) => item.key)) !== JSON.stringify(specs.map((item) => item.key))) {
          throw new TransactionError(
            "PATH_IDENTITY_CHANGED",
            "A transaction path changed identity before execution.",
            { expected: specs.map((item) => item.key), actual: refreshedSpecs.map((item) => item.key) },
          );
        }
        record.lockKeys = [...lockKeys];
        record.pathRecords = await this.#captureBefore(transaction, sequence, specs);
        record.status = "executing";
        await this.#persist(transaction);
        try {
          result = await executor(tool, executionArgs, {
            ...(call.context || {}),
            transactionId: transaction.manifest.id,
            transactionSequence: sequence,
            executionId: call.executionId || null,
          });
        } catch (error) {
          try {
            await this.#captureAfter(record.pathRecords);
          } catch (captureError) {
            record.afterCaptureError = serializeError(captureError);
          }
          throw error;
        }
        await this.#captureAfter(record.pathRecords);
        return result;
      }, { signal: call.signal });
      record.status = "completed";
      record.completedAt = this.#nowIso();
      record.result = safeJsonValue(result);
      await this.#persist(transaction);
      await this.#audit({
        event: "transaction_call_completed",
        transactionId: transaction.manifest.id,
        sequence,
        tool,
        paths: record.paths,
      });
      return { result, call: publicClone(record), transaction: publicClone(transaction.manifest) };
    } catch (error) {
      record.status = "failed";
      record.completedAt = this.#nowIso();
      record.error = serializeError(error);
      transaction.manifest.status = "failed";
      await this.#persist(transaction);
      const rollback = await this.#rollbackInternal(transaction, { reason: "automatic_failure" });
      throw new TransactionError(
        "TRANSACTION_CALL_FAILED",
        `Transactional tool ${tool} failed: ${error?.message || String(error)}`,
        { transactionId: transaction.manifest.id, sequence, rollback },
        { cause: error }
      );
    }
  }

  execute(transactionIdOrInput, maybeCall = {}) {
    const transactionId = typeof transactionIdOrInput === "string"
      ? transactionIdOrInput
      : transactionIdOrInput?.transactionId;
    const call = typeof transactionIdOrInput === "string" ? maybeCall : transactionIdOrInput;
    const transaction = this.#get(transactionId);
    const executionId = typeof call.executionId === "string" && call.executionId.trim()
      ? call.executionId.trim()
      : null;
    const executionFingerprint = calculateArgsHash({
      tool: call.tool || call.name,
      args: call.args ?? call.arguments ?? {},
      paths: call.pathSpecs ?? call.paths ?? null,
      executorId: call.executorId || null,
    });
    const persistedCall = executionId
      ? transaction.manifest.calls.find((candidate) => candidate.executionId === executionId && candidate.status === "completed")
      : null;
    if (persistedCall) {
      const persistedArgsHash = createHash("sha256")
        .update(JSON.stringify(safeJsonValue(call.args ?? call.arguments ?? {})), "utf8")
        .digest("hex");
      if (persistedCall.tool !== (call.tool || call.name) || persistedCall.argsHash !== persistedArgsHash) {
        return Promise.reject(new TransactionError(
          "EXECUTION_ID_MISMATCH",
          `Transactional execution ID ${executionId} was reused for another tool.`
        ));
      }
      return Promise.resolve({
        result: publicClone(persistedCall.result),
        call: publicClone(persistedCall),
        transaction: publicClone(transaction.manifest),
        replayed: true,
      });
    }
    if (executionId && transaction.executions.has(executionId)) {
      const existing = transaction.executions.get(executionId);
      if (existing.fingerprint !== executionFingerprint) {
        return Promise.reject(new TransactionError(
          "EXECUTION_ID_MISMATCH",
          `Transactional execution ID ${executionId} was reused with different input.`
        ));
      }
      return existing.promise;
    }

    const promise = transaction.queue.then(() => this.#performExecute(transaction, call));
    transaction.queue = promise.catch(() => {});
    if (executionId) transaction.executions.set(executionId, { fingerprint: executionFingerprint, promise });
    return promise;
  }

  executeCall(transactionIdOrInput, maybeCall = {}) {
    return this.execute(transactionIdOrInput, maybeCall);
  }

  async #restoreBefore(record) {
    await fs.rm(record.path, { recursive: true, force: true });
    if (record.before.exists) {
      if (!record.before.backupPath) {
        throw new TransactionError("ROLLBACK_BACKUP_MISSING", `Rollback backup is missing for ${record.path}.`);
      }
      await copyPath(record.before.backupPath, record.path);
    }
    const restored = await pathState(record.path);
    if (!statesEqual(restored, record.before)) {
      throw new TransactionError(
        "ROLLBACK_RESTORE_HASH_MISMATCH",
        `Rollback verification failed for ${record.path}.`,
        { expected: record.before, actual: restored }
      );
    }
    return restored;
  }

  async #createRecoveryCopy(transaction, callRecord, pathRecord, current, reason) {
    const pathHash = hashContent(canonicalizeWindowsPath(pathRecord.path)).slice(0, 16);
    const prefix = `${String(callRecord.sequence).padStart(4, "0")}-${pathHash}-${randomUUID()}`;
    if (pathRecord.before.exists && pathRecord.before.backupPath) {
      const recoveryPath = path.join(transaction.recoveryDirectory, `${prefix}.before`);
      await copyPath(pathRecord.before.backupPath, recoveryPath);
      return recoveryPath;
    }
    const recoveryPath = path.join(transaction.recoveryDirectory, `${prefix}.json`);
    await atomicWriteJson(recoveryPath, {
      schema: "web-agents.recovery-note.v1",
      transactionId: transaction.manifest.id,
      sequence: callRecord.sequence,
      targetPath: pathRecord.path,
      reason,
      before: pathRecord.before,
      expectedAfter: pathRecord.after,
      current,
      note: "The target did not exist before this call; the conflicting target was left untouched.",
    });
    return recoveryPath;
  }

  async #rollbackInternal(transaction, { reason }) {
    if (["rolled_back", "rollback_conflicted"].includes(transaction.manifest.status)) {
      return publicClone(transaction.manifest.rollback);
    }
    transaction.manifest.status = "rolling_back";
    const rollback = {
      reason,
      startedAt: this.#nowIso(),
      completedAt: null,
      status: "running",
      restored: [],
      conflicts: [],
      errors: [],
    };
    transaction.manifest.rollback = rollback;
    await this.#persist(transaction);

    const calls = [...transaction.manifest.calls].reverse();
    const lockSpecs = calls.flatMap((callRecord) =>
      [...(callRecord.pathRecords || [])].map((record) => ({ path: record.path, subtree: record.subtree }))
    );
    await this.pathLockManager.withLocks(lockSpecs, async () => {
      for (const callRecord of calls) {
        const pathRecords = [...(callRecord.pathRecords || [])].reverse();
        for (const record of pathRecords) {
          if (!record.before) continue;
          try {
            const current = await pathState(record.path);
            const expectedAfter = record.after || {
              exists: record.before.exists,
              type: record.before.type,
              hash: record.before.hash,
            };
            if (!statesEqual(current, expectedAfter)) {
              const recoveryPath = await this.#createRecoveryCopy(
                transaction,
                callRecord,
                record,
                current,
                "hash_conflict"
              );
              rollback.conflicts.push({
                sequence: callRecord.sequence,
                path: record.path,
                expectedAfter,
                current,
                recoveryPath,
              });
              continue;
            }
            const restored = await this.#restoreBefore(record);
            rollback.restored.push({ sequence: callRecord.sequence, path: record.path, hash: restored.hash });
          } catch (error) {
            rollback.errors.push({
              sequence: callRecord.sequence,
              path: record.path,
              error: serializeError(error),
            });
          }
        }
      }
    });

    rollback.completedAt = this.#nowIso();
    rollback.status = rollback.conflicts.length || rollback.errors.length ? "conflicted" : "completed";
    transaction.manifest.status = rollback.status === "completed" ? "rolled_back" : "rollback_conflicted";
    await this.#persist(transaction);
    await this.#audit({
      event: "transaction_rolled_back",
      transactionId: transaction.manifest.id,
      reason,
      status: rollback.status,
      restoredCount: rollback.restored.length,
      conflictCount: rollback.conflicts.length,
      errorCount: rollback.errors.length,
    });
    return publicClone(rollback);
  }

  rollback(transactionId, {
    reason = "user_requested",
    sessionId = null,
    bindLegacySession = false,
  } = {}) {
    const transaction = this.#get(transactionId);
    const expectedSessionId = typeof sessionId === "string" && sessionId.trim()
      ? requireIdentifier(sessionId, "SESSION_ID_REQUIRED", "Session ID")
      : null;
    const promise = transaction.queue.then(async () => {
      const actualSessionId = transaction.manifest.sessionId || null;
      if (expectedSessionId && actualSessionId !== expectedSessionId) {
        if (!actualSessionId && bindLegacySession === true) {
          transaction.manifest.sessionId = expectedSessionId;
          await this.#persist(transaction);
          await this.#audit({
            event: "transaction_session_bound",
            transactionId: transaction.manifest.id,
            sessionId: expectedSessionId,
            source: "verified_legacy_reference",
          });
        } else {
          throw new TransactionError(
            "TRANSACTION_SESSION_MISMATCH",
            `Transaction ${transaction.manifest.id} belongs to another roundtable session.`,
            {
              transactionId: transaction.manifest.id,
              expectedSessionId: actualSessionId,
              actualSessionId: expectedSessionId,
            },
          );
        }
      }
      return this.#rollbackInternal(transaction, { reason });
    });
    transaction.queue = promise.catch(() => {});
    return promise;
  }

  commit(transactionId) {
    const transaction = this.#get(transactionId);
    const promise = transaction.queue.then(async () => {
      if (transaction.manifest.status === "committed") return publicClone(transaction.manifest);
      if (transaction.manifest.status !== "active") {
        throw new TransactionError(
          "TRANSACTION_NOT_ACTIVE",
          `Transaction ${transactionId} cannot commit from ${transaction.manifest.status}.`
        );
      }
      transaction.manifest.status = "committed";
      transaction.manifest.committedAt = this.#nowIso();
      await this.#persist(transaction);
      await this.#audit({
        event: "transaction_committed",
        transactionId,
        taskId: transaction.manifest.taskId,
        callCount: transaction.manifest.calls.length,
      });
      return publicClone(transaction.manifest);
    });
    transaction.queue = promise.catch(() => {});
    return promise;
  }

  getTransaction(transactionId) {
    return publicClone(this.#get(transactionId).manifest);
  }

  listTransactions({ taskId = null } = {}) {
    return [...this.transactions.values()]
      .map((transaction) => transaction.manifest)
      .filter((manifest) => !taskId || manifest.taskId === taskId)
      .map(publicClone);
  }

  async runTransaction(metadata, calls = []) {
    const transaction = await this.begin(metadata);
    const results = [];
    for (const call of calls) results.push(await this.execute(transaction.id, call));
    const committed = await this.commit(transaction.id);
    return { transaction: committed, results };
  }
}

export { pathState as readPathState, statesEqual as pathStatesEqual };

export function createTransactionManager(options) {
  return new TransactionManager(options);
}
