import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeWindowsPath } from "./path-lock-manager.mjs";

function isInsideOrEqual(candidate, root) {
  return candidate === root || candidate.startsWith(root.endsWith("\\") ? root : `${root}\\`);
}

async function resolveAllowMissing(targetPath) {
  let current = targetPath;
  const suffix = [];
  while (true) {
    try {
      const resolvedAncestor = await fs.realpath(current);
      return path.resolve(resolvedAncestor, ...suffix);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function resolvePathIdentity(value, { cwd = process.cwd(), workspaceRoot = cwd } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error("INVALID_PATH");
  const lexicalWorkspace = path.resolve(workspaceRoot);
  const lexicalPath = path.resolve(cwd, value);
  const [physicalWorkspace, physicalPath] = await Promise.all([
    fs.realpath(lexicalWorkspace),
    resolveAllowMissing(lexicalPath),
  ]);
  const lexicalWorkspaceKey = canonicalizeWindowsPath(lexicalWorkspace);
  const lexicalKey = canonicalizeWindowsPath(lexicalPath);
  const physicalWorkspaceKey = canonicalizeWindowsPath(physicalWorkspace);
  const physicalKey = canonicalizeWindowsPath(physicalPath);
  const lexicalInsideWorkspace = isInsideOrEqual(lexicalKey, lexicalWorkspaceKey);
  const expectedPhysicalPath = lexicalInsideWorkspace
    ? path.resolve(physicalWorkspace, path.relative(lexicalWorkspace, lexicalPath))
    : lexicalPath;
  const expectedPhysicalKey = canonicalizeWindowsPath(expectedPhysicalPath);
  return {
    lexicalPath,
    lexicalKey,
    physicalPath,
    physicalKey,
    workspacePath: physicalWorkspace,
    workspaceKey: physicalWorkspaceKey,
    lexicalInsideWorkspace,
    isInsideWorkspace: isInsideOrEqual(physicalKey, physicalWorkspaceKey),
    throughAlias: expectedPhysicalKey !== physicalKey,
  };
}

export function assertMutationPathIdentity(identity) {
  if (!identity?.throughAlias) return identity;
  const error = new Error("Mutating through a symbolic link or junction is not allowed; use the resolved path directly.");
  error.code = "REPARSE_PATH_WRITE_DENIED";
  error.details = {
    lexicalPath: identity.lexicalPath,
    resolvedPath: identity.physicalPath,
  };
  throw error;
}
