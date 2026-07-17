import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { LocalWorkspaceStore, atomicWriteJson } from "./local-workspace-store.mjs";

const REGISTRY_SCHEMA = "web-agents-workspace-registry.v1";
const WORKSPACE_SCHEMA = "web-agents-workspace.v1";
const INTERNAL_DIRECTORY = ".web-agents";

function canonicalKey(value) {
  const resolved = path.resolve(value).replace(/[\\/]+$/g, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function workspaceId(root) {
  return createHash("sha256").update(canonicalKey(root)).digest("hex").slice(0, 20);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function validateWorkspacePath(value, { controllerProbe = null } = {}) {
  if (!path.isAbsolute(String(value || ""))) {
    const error = new Error("WORKSPACE_PATH_MUST_BE_ABSOLUTE");
    error.code = "WORKSPACE_PATH_MUST_BE_ABSOLUTE";
    throw error;
  }
  const root = path.resolve(String(value));
  let stat;
  try {
    stat = await fs.stat(root);
  } catch (cause) {
    const error = new Error("WORKSPACE_NOT_FOUND");
    error.code = "WORKSPACE_NOT_FOUND";
    error.cause = cause;
    throw error;
  }
  if (!stat.isDirectory()) {
    const error = new Error("WORKSPACE_NOT_DIRECTORY");
    error.code = "WORKSPACE_NOT_DIRECTORY";
    throw error;
  }
  await fs.access(root, fs.constants.R_OK);

  const dataRoot = path.join(root, INTERNAL_DIRECTORY);
  const directories = {
    dataRoot,
    sessions: path.join(dataRoot, "sessions"),
    handoffs: path.join(dataRoot, "handoffs"),
    artifacts: path.join(dataRoot, "artifacts"),
    audit: path.join(dataRoot, "audit"),
    backups: path.join(dataRoot, "backups"),
    indexes: path.join(dataRoot, "indexes"),
  };
  await Promise.all(Object.values(directories).map((directory) => fs.mkdir(directory, { recursive: true })));
  const probePath = path.join(dataRoot, `.write-probe-${process.pid}-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(probePath, "ok\n", "utf8");
    await fs.readFile(probePath, "utf8");
  } finally {
    await fs.rm(probePath, { force: true });
  }

  const controller = controllerProbe ? await controllerProbe({ root, dataRoot }) : { ok: true };
  if (!controller?.ok) {
    const error = new Error("LOCAL_CONTROLLER_UNAVAILABLE");
    error.code = "LOCAL_CONTROLLER_UNAVAILABLE";
    error.diagnostics = controller || null;
    throw error;
  }

  const descriptor = {
    schema: WORKSPACE_SCHEMA,
    id: workspaceId(root),
    name: path.basename(root) || root,
    root,
    dataRoot,
    directories,
    controller: { ok: true },
    validatedAt: new Date().toISOString(),
  };
  const workspaceFile = path.join(dataRoot, "workspace.json");
  const existing = await readJson(workspaceFile, null);
  await atomicWriteJson(workspaceFile, {
    schema: WORKSPACE_SCHEMA,
    id: descriptor.id,
    name: descriptor.name,
    root,
    dataRoot,
    createdAt: existing?.createdAt || descriptor.validatedAt,
    validatedAt: descriptor.validatedAt,
  });
  return descriptor;
}

export class WorkspaceRegistry {
  constructor({
    repoRoot = process.cwd(),
    configFile = null,
    controllerProbe = null,
    storeFactory = null,
  } = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.configFile = configFile || path.join(this.repoRoot, "config", "workspace.local.json");
    this.controllerProbe = controllerProbe;
    this.storeFactory = storeFactory || ((descriptor) => new LocalWorkspaceStore({
      repoRoot: this.repoRoot,
      workspaceRoot: descriptor.root,
      dataRoot: descriptor.dataRoot,
    }));
    this.entries = new Map();
    this.activeKey = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this.describe();
    const saved = await readJson(this.configFile, { schema: REGISTRY_SCHEMA, activeRoot: null, recentRoots: [] });
    for (const root of saved.recentRoots || []) {
      if (!path.isAbsolute(String(root || ""))) continue;
      try {
        await this.open(root, { persist: false, makeActive: canonicalKey(root) === canonicalKey(saved.activeRoot || "") });
      } catch {
        // Offline drives and removed directories remain absent until the user selects them again.
      }
    }
    this.initialized = true;
    return this.describe();
  }

  async open(value, { persist = true, makeActive = true } = {}) {
    const descriptor = await validateWorkspacePath(value, { controllerProbe: this.controllerProbe });
    const key = canonicalKey(descriptor.root);
    let entry = this.entries.get(key);
    if (!entry) {
      const store = this.storeFactory(descriptor);
      await store.initialize();
      entry = { descriptor, store };
      this.entries.set(key, entry);
    } else {
      entry.descriptor = descriptor;
    }
    if (makeActive) this.activeKey = key;
    if (persist) await this.persist();
    return entry;
  }

  async select(value) {
    await this.initialize();
    return this.open(value, { persist: true, makeActive: true });
  }

  get active() {
    return this.activeKey ? this.entries.get(this.activeKey) || null : null;
  }

  requireActive() {
    const entry = this.active;
    if (!entry) {
      const error = new Error("WORKSPACE_REQUIRED");
      error.code = "WORKSPACE_REQUIRED";
      throw error;
    }
    return entry;
  }

  getByRoot(root) {
    return this.entries.get(canonicalKey(root)) || null;
  }

  list() {
    return [...this.entries.values()].map(({ descriptor }) => ({
      ...descriptor,
      active: canonicalKey(descriptor.root) === this.activeKey,
    }));
  }

  describe() {
    return {
      schema: REGISTRY_SCHEMA,
      selected: this.active?.descriptor || null,
      workspaces: this.list(),
    };
  }

  async persist() {
    const roots = [...this.entries.values()].map(({ descriptor }) => descriptor.root);
    await atomicWriteJson(this.configFile, {
      schema: REGISTRY_SCHEMA,
      activeRoot: this.active?.descriptor.root || null,
      recentRoots: roots,
      updatedAt: new Date().toISOString(),
    });
  }
}

export { INTERNAL_DIRECTORY, canonicalKey, workspaceId };
