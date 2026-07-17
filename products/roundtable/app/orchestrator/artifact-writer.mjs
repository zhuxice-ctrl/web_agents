import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { assertMutationPathIdentity, resolvePathIdentity } from "@web-agents/local-core/real-paths";

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function readExistingFile(filePath) {
  try {
    const content = await fs.readFile(filePath);
    return { exists: true, content, hash: hashContent(content) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, content: null, hash: null };
    throw error;
  }
}

export class ArtifactWriter {
  constructor({ store, repoRoot, transactionManager } = {}) {
    if (!store) throw new Error("STORE_REQUIRED");
    if (!transactionManager) throw new Error("TRANSACTION_MANAGER_REQUIRED");
    this.store = store;
    this.repoRoot = path.resolve(repoRoot || store.repoRoot);
    this.workspaceRoot = path.resolve(store.workspaceRoot || this.repoRoot);
    this.transactionManager = transactionManager;
  }

  async list(sessionId) {
    const session = await this.store.readSession(sessionId);
    return session.artifacts || [];
  }

  async write(sessionId, payload = {}) {
    if (!path.isAbsolute(String(payload.path || ""))) throw new Error("ARTIFACT_PATH_MUST_BE_ABSOLUTE");
    const targetPath = path.resolve(payload.path);
    const content = typeof payload.content === "string" ? payload.content : String(payload.content ?? "");
    await this.store.readSession(sessionId);
    const identity = await resolvePathIdentity(targetPath, { workspaceRoot: this.workspaceRoot });
    assertMutationPathIdentity(identity);
    if (!identity.isInsideWorkspace) {
      const error = new Error("Workspace-external artifact writes must use the controller tool loop and permission confirmation.");
      error.code = "ARTIFACT_EXTERNAL_WRITE_REQUIRES_TOOL_LOOP";
      throw error;
    }
    const artifactId = randomUUID();
    const executorId = "roundtable-user";
    const transaction = await this.transactionManager.begin({
      taskId: `artifact:${sessionId}:${artifactId}`,
      sessionId,
      executorId,
      originalInstruction: `Write roundtable artifact ${String(payload.label || path.basename(targetPath))}`,
      executionId: `artifact:${artifactId}:transaction`,
    });
    const executed = await this.transactionManager.execute(transaction.id, {
      executionId: `artifact:${artifactId}:write`,
      executorId,
      tool: "write_file",
      args: { path: identity.physicalPath, content },
    });
    const committed = await this.transactionManager.commit(transaction.id);
    const pathRecord = executed.call.pathRecords?.[0];
    if (!pathRecord?.before || !pathRecord?.after) throw new Error("ARTIFACT_TRANSACTION_RECORD_MISSING");
    const after = await readExistingFile(targetPath);
    if (!after.exists) throw new Error("ARTIFACT_WRITE_DID_NOT_CREATE_TARGET");
    const now = new Date().toISOString();
    const artifact = {
      id: artifactId,
      label: String(payload.label || path.basename(targetPath)),
      targetPath: identity.physicalPath,
      status: "active",
      transactionId: committed.id,
      existedBefore: pathRecord.before.exists,
      backupPath: pathRecord.before.backupPath || null,
      beforeHash: pathRecord.before.hash,
      afterHash: pathRecord.after.hash,
      size: after.content.length,
      createdAt: now,
      rolledBackAt: null,
    };
    const savedSession = await this.store.updateSession(sessionId, (current) => {
      current.artifacts = [...(current.artifacts || []), artifact];
      current.updatedAt = now;
      return current;
    });
    const savedArtifact = savedSession.artifacts.find((candidate) => candidate.id === artifactId);
    await this.store.appendEvents(sessionId, [{
      id: randomUUID(),
      type: "artifact_write",
      providerId: null,
      content: `写入本地产物：${targetPath}`,
      commandId: payload.commandId || null,
      round: null,
      metadata: {
        artifactId,
        transactionId: committed.id,
        targetPath: identity.physicalPath,
        beforeHash: pathRecord.before.hash,
        afterHash: pathRecord.after.hash,
      },
      createdAt: now,
    }]);
    await this.store.appendAudit({
      kind: "artifact_write",
      sessionId,
      artifactId,
      path: identity.physicalPath,
      transactionId: committed.id,
      backupPath: pathRecord.before.backupPath || null,
      beforeHash: pathRecord.before.hash,
      afterHash: pathRecord.after.hash,
    });
    return { artifact: savedArtifact, tool: "write_file" };
  }

  async rollback(sessionId, artifactId) {
    const session = await this.store.readSession(sessionId);
    const artifact = (session.artifacts || []).find((candidate) => candidate.id === artifactId);
    if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
    if (artifact.status !== "active") throw new Error("ARTIFACT_NOT_ACTIVE");
    if (!artifact.transactionId) throw new Error("ARTIFACT_TRANSACTION_MISSING");
    const rollback = await this.transactionManager.rollback(artifact.transactionId, {
      reason: "artifact_user_requested",
      sessionId,
      bindLegacySession: true,
    });
    const restoredHash = rollback.restored?.find((item) => item.path === artifact.targetPath)?.hash || null;

    const now = new Date().toISOString();
    const savedSession = await this.store.updateSession(sessionId, (currentSession) => {
      const currentArtifact = (currentSession.artifacts || []).find((candidate) => candidate.id === artifactId);
      if (!currentArtifact) throw new Error("ARTIFACT_NOT_FOUND");
      if (currentArtifact.status !== "active") throw new Error("ARTIFACT_NOT_ACTIVE");
      currentArtifact.status = rollback.status === "completed" ? "rolled_back" : "rollback_conflicted";
      currentArtifact.rolledBackAt = now;
      currentArtifact.restoredHash = restoredHash;
      currentArtifact.rollback = rollback;
      currentSession.updatedAt = now;
      return currentSession;
    });
    const savedArtifact = savedSession.artifacts.find((candidate) => candidate.id === artifactId);
    await this.store.appendEvents(sessionId, [{
      id: randomUUID(),
      type: "artifact_rollback",
      providerId: null,
      content: `回撤本地产物：${savedArtifact.targetPath}`,
      commandId: null,
      round: null,
      metadata: { artifactId, targetPath: savedArtifact.targetPath, restoredHash },
      createdAt: now,
    }]);
    await this.store.appendAudit({
      kind: "artifact_rollback",
      sessionId,
      artifactId,
      path: savedArtifact.targetPath,
      restoredHash,
    });
    if (rollback.status !== "completed") {
      const error = new Error("ROLLBACK_TARGET_CHANGED");
      error.code = "ROLLBACK_TARGET_CHANGED";
      error.diagnostics = rollback;
      throw error;
    }
    return { artifact: savedArtifact, rollback };
  }
}

export { hashContent, readExistingFile };
