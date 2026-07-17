import path from "node:path";

const EXACT_PREFIX = "path:";
const SUBTREE_PREFIX = "subtree:";

export class PathLockError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PathLockError";
    this.code = code;
    this.details = details;
  }
}

function stripExtendedWindowsPrefix(value) {
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\\\${value.slice(8)}`;
  if (/^\\\\\?\\/.test(value)) return value.slice(4);
  return value;
}

function trimNonRootTrailingSeparators(value) {
  const root = path.win32.parse(value).root;
  let result = value;
  while (result.length > root.length && result.endsWith("\\")) result = result.slice(0, -1);
  return result;
}

export function canonicalizeWindowsPath(value, { cwd = process.cwd() } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PathLockError("INVALID_PATH", "Lock paths must be non-empty strings.");
  }
  const raw = stripExtendedWindowsPrefix(value.trim().replace(/\//g, "\\"));
  const base = stripExtendedWindowsPrefix(String(cwd || process.cwd()).replace(/\//g, "\\"));
  const resolved = path.win32.isAbsolute(raw)
    ? path.win32.normalize(raw)
    : path.win32.resolve(base, raw);
  return trimNonRootTrailingSeparators(resolved).toLowerCase();
}

export function exactPathLockKey(value, options) {
  return `${EXACT_PREFIX}${canonicalizeWindowsPath(value, options)}`;
}

export function subtreePathLockKey(value, options) {
  return `${SUBTREE_PREFIX}${canonicalizeWindowsPath(value, options)}`;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addInputSpecs(specs, input) {
  if (input === undefined || input === null) return;
  if (typeof input === "string") {
    specs.push({ path: input, subtree: false });
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) addInputSpecs(specs, item);
    return;
  }
  if (typeof input !== "object") {
    throw new PathLockError("INVALID_LOCK_SPEC", "Path lock specs must be paths, objects, or arrays.");
  }
  if (typeof input.key === "string" && (input.key.startsWith(EXACT_PREFIX) || input.key.startsWith(SUBTREE_PREFIX))) {
    specs.push({ key: input.key });
  }
  if (typeof input.path === "string") specs.push({ path: input.path, subtree: Boolean(input.subtree) });
  if (Array.isArray(input.paths)) addInputSpecs(specs, input.paths);
  if (Array.isArray(input.subtreePaths)) {
    for (const item of input.subtreePaths) specs.push({ path: item, subtree: true });
  }
  if (typeof input.source === "string") {
    specs.push({ path: input.source, subtree: Boolean(input.sourceSubtree || input.subtree) });
  }
  if (typeof input.destination === "string") {
    specs.push({ path: input.destination, subtree: Boolean(input.destinationSubtree || input.subtree) });
  }
}

export function buildPathLockKeys(input, options = {}) {
  const specs = [];
  addInputSpecs(specs, input);
  const keys = new Set();
  for (const spec of specs) {
    if (spec.key) {
      const prefix = spec.key.startsWith(SUBTREE_PREFIX) ? SUBTREE_PREFIX : EXACT_PREFIX;
      keys.add(`${prefix}${canonicalizeWindowsPath(spec.key.slice(prefix.length), options)}`);
    } else {
      keys.add(spec.subtree ? subtreePathLockKey(spec.path, options) : exactPathLockKey(spec.path, options));
    }
  }
  return [...keys].sort(compareStrings);
}

export function sourceTargetLockKeys(options = {}) {
  return buildPathLockKeys({
    source: options.source,
    destination: options.destination,
    sourceSubtree: options.sourceSubtree,
    destinationSubtree: options.destinationSubtree,
  }, options);
}

function parseLockKey(key) {
  if (key.startsWith(SUBTREE_PREFIX)) return { kind: "subtree", path: key.slice(SUBTREE_PREFIX.length) };
  if (key.startsWith(EXACT_PREFIX)) return { kind: "exact", path: key.slice(EXACT_PREFIX.length) };
  throw new PathLockError("INVALID_LOCK_KEY", `Invalid path lock key: ${key}`);
}

function insideOrEqual(candidate, root) {
  return candidate === root || candidate.startsWith(root.endsWith("\\") ? root : `${root}\\`);
}

export function pathLockKeysConflict(leftKey, rightKey) {
  const left = parseLockKey(leftKey);
  const right = parseLockKey(rightKey);
  if (left.kind === "exact" && right.kind === "exact") return left.path === right.path;
  if (left.kind === "subtree" && right.kind === "subtree") {
    return insideOrEqual(left.path, right.path) || insideOrEqual(right.path, left.path);
  }
  const subtree = left.kind === "subtree" ? left : right;
  const exact = left.kind === "exact" ? left : right;
  return insideOrEqual(exact.path, subtree.path);
}

function keySetsConflict(left, right) {
  return left.some((leftKey) => right.some((rightKey) => pathLockKeysConflict(leftKey, rightKey)));
}

class LockCoordinator {
  constructor() {
    this.active = new Map();
    this.queue = [];
    this.sequence = 0;
  }

  acquire(keys, { signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(new PathLockError("LOCK_ABORTED", "Path lock acquisition was aborted."));
    }
    if (keys.length === 0) {
      const release = () => {};
      release.keys = Object.freeze([]);
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const request = {
        id: ++this.sequence,
        keys,
        resolve,
        reject,
        signal,
        abortHandler: null,
      };
      if (signal) {
        request.abortHandler = () => {
          const index = this.queue.indexOf(request);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new PathLockError("LOCK_ABORTED", "Path lock acquisition was aborted."));
          this.drain();
        };
        signal.addEventListener("abort", request.abortHandler, { once: true });
      }
      this.queue.push(request);
      this.drain();
    });
  }

  canGrant(request, queueIndex) {
    for (const active of this.active.values()) {
      if (keySetsConflict(request.keys, active.keys)) return false;
    }
    for (let index = 0; index < queueIndex; index += 1) {
      if (keySetsConflict(request.keys, this.queue[index].keys)) return false;
    }
    return true;
  }

  drain() {
    let granted;
    do {
      granted = false;
      for (let index = 0; index < this.queue.length; index += 1) {
        const request = this.queue[index];
        if (!this.canGrant(request, index)) continue;
        this.queue.splice(index, 1);
        if (request.abortHandler) request.signal.removeEventListener("abort", request.abortHandler);
        this.active.set(request.id, request);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          this.active.delete(request.id);
          this.drain();
        };
        release.keys = Object.freeze([...request.keys]);
        request.resolve(release);
        granted = true;
        break;
      }
    } while (granted);
  }
}

const globalCoordinator = new LockCoordinator();

export class PathLockManager {
  constructor({ cwd = process.cwd(), coordinator = globalCoordinator, isolated = false } = {}) {
    this.cwd = cwd;
    this.coordinator = isolated ? new LockCoordinator() : coordinator;
  }

  keysFor(input) {
    return buildPathLockKeys(input, { cwd: this.cwd });
  }

  acquire(input, options = {}) {
    return this.coordinator.acquire(this.keysFor(input), options);
  }

  async withLocks(input, operation, options = {}) {
    if (typeof operation !== "function") {
      throw new PathLockError("LOCK_OPERATION_REQUIRED", "withLocks requires an operation function.");
    }
    const release = await this.acquire(input, options);
    try {
      return await operation(release.keys);
    } finally {
      release();
    }
  }

  runExclusive(input, operation, options = {}) {
    return this.withLocks(input, operation, options);
  }

  describe() {
    return {
      active: [...this.coordinator.active.values()].map((request) => [...request.keys]),
      pending: this.coordinator.queue.map((request) => [...request.keys]),
    };
  }
}

export function createPathLockManager(options) {
  return new PathLockManager(options);
}
