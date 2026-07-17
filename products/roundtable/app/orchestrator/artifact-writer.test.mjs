import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalWorkspaceStore } from "../storage/local-workspace-store.mjs";
import { TransactionManager } from "@web-agents/local-core/transactions";
import { ArtifactWriter } from "./artifact-writer.mjs";

async function createFixture() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-artifacts-"));
  const store = new LocalWorkspaceStore({ repoRoot, dataRoot: path.join(repoRoot, "data") });
  await store.initialize();
  const now = new Date().toISOString();
  const session = await store.createSession({
    id: "20260715-140000-artifact",
    title: "产物回撤",
    objective: "验证",
    createdAt: now,
    updatedAt: now,
    participants: [],
    hostId: null,
    layout: {},
    settings: {},
    plans: [],
    summary: null,
    runtime: {},
    artifacts: [],
    events: [],
  });
  const transactionManager = new TransactionManager({
    workspaceRoot: repoRoot,
    transactionRoot: path.join(repoRoot, "data", "transactions"),
    executeTool: async (name, args) => {
      if (name !== "write_file") throw new Error(`Unexpected tool ${name}`);
      await fs.mkdir(path.dirname(args.path), { recursive: true });
      await fs.writeFile(args.path, args.content, "utf8");
      return { content: [{ type: "text", text: `wrote ${args.path}` }] };
    },
  });
  await transactionManager.initialize();
  return {
    repoRoot,
    store,
    session,
    transactionManager,
    writer: new ArtifactWriter({ store, repoRoot, transactionManager }),
  };
}

test("artifact writer uses the filesystem tool contract and restores an overwritten file", async () => {
  const { repoRoot, store, session, writer } = await createFixture();
  const target = path.join(repoRoot, "outside-data", "result.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "before\n", "utf8");
  store.saveSession = async () => {
    throw new Error("ARTIFACT_WRITER_USED_STALE_SESSION_SAVE");
  };

  const written = await writer.write(session.id, { path: target, content: "after\n", label: "圆桌总结" });
  assert.equal(await fs.readFile(target, "utf8"), "after\n");
  assert.equal(written.artifact.existedBefore, true);
  assert.ok(written.artifact.backupPath);
  assert.ok(written.artifact.transactionId);
  assert.equal((await writer.list(session.id)).length, 1);

  const rolledBack = await writer.rollback(session.id, written.artifact.id);
  assert.equal(await fs.readFile(target, "utf8"), "before\n");
  assert.equal(rolledBack.artifact.status, "rolled_back");
  assert.equal((await store.readSession(session.id)).artifacts[0].status, "rolled_back");
});

test("artifact rollback removes a file that did not exist before the write", async () => {
  const { repoRoot, session, writer } = await createFixture();
  const target = path.join(repoRoot, "new-output.md");
  const written = await writer.write(session.id, { path: target, content: "created by roundtable" });
  assert.equal(written.artifact.existedBefore, false);
  await writer.rollback(session.id, written.artifact.id);
  await assert.rejects(fs.access(target), /ENOENT/);
});

test("artifact rollback refuses to overwrite edits made after the audited write", async () => {
  const { repoRoot, session, writer } = await createFixture();
  const target = path.join(repoRoot, "changed-after-write.md");
  const written = await writer.write(session.id, { path: target, content: "roundtable output" });
  await fs.writeFile(target, "user changed this", "utf8");
  await assert.rejects(
    () => writer.rollback(session.id, written.artifact.id),
    /ROLLBACK_TARGET_CHANGED/
  );
  assert.equal(await fs.readFile(target, "utf8"), "user changed this");
});

test("artifact rollback restores non-UTF-8 bytes without transcoding", async () => {
  const { repoRoot, session, writer } = await createFixture();
  const target = path.join(repoRoot, "binary-before.bin");
  const before = Buffer.from([0x00, 0xff, 0x80, 0x41, 0x42, 0x0a]);
  await fs.writeFile(target, before);

  const written = await writer.write(session.id, { path: target, content: "temporary text" });
  await writer.rollback(session.id, written.artifact.id);
  assert.deepEqual(await fs.readFile(target), before);
});

test("artifact API layer rejects workspace-external writes before a transaction starts", async () => {
  const { repoRoot, session, transactionManager, writer } = await createFixture();
  const target = path.join(path.dirname(repoRoot), `external-${path.basename(repoRoot)}.txt`);
  await assert.rejects(
    () => writer.write(session.id, { path: target, content: "must not write" }),
    (error) => error.code === "ARTIFACT_EXTERNAL_WRITE_REQUIRES_TOOL_LOOP",
  );
  await assert.rejects(fs.access(target), /ENOENT/);
  assert.equal(transactionManager.listTransactions().length, 0);
});
