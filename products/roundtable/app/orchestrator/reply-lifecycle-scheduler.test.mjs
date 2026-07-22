import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSession } from "../server.mjs";
import { LocalWorkspaceStore } from "../storage/local-workspace-store.mjs";
import { projectContextForSeat } from "./context-projector.mjs";
import { RoundtableScheduler } from "./scheduler.mjs";

test("strict scheduler keeps rejected captures in audit but out of seat context", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-reply-lifecycle-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const store = new LocalWorkspaceStore({ repoRoot, dataRoot: path.join(repoRoot, "data") });
  await store.initialize();
  const session = await createSession({
    title: "reply lifecycle",
    objective: "validate reply commits",
    participants: ["deepseek"],
    settings: { mode: "playwright", defaultRounds: 1, executionTimeoutMs: 15000 },
  }, { store });
  const raw = "[ROUND_TABLE_TASK_BEGIN]\nignored prompt\n[ROUND_TABLE_TASK_END]";
  const scheduler = new RoundtableScheduler({
    store,
    strictReplyCommit: true,
    worker: { async execute() { return { text: raw, capture: { speaker: "assistant", identity: "dom-1" } }; } },
  });

  const result = await scheduler.executeCommand(session.id, { text: "@ds analyze" });
  const replies = result.session.events.filter((event) => event.type === "reply");
  assert.ok(replies.length >= 1);
  assert.ok(replies.every((event) => event.metadata.commitStatus === "rejected"));
  const projection = projectContextForSeat(result.session, "deepseek");
  assert.equal(projection.promptEvents.some((event) => event.type === "reply"), false);
  const audit = await store.listAudit({ sessionId: session.id, limit: 100 });
  assert.ok(audit.some((event) => event.kind === "reply.raw_captured"));
  assert.ok(audit.some((event) => event.kind === "reply.validated"));
});

test("strict scheduler commits a natural assistant reply without derived structure", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-reply-commit-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const store = new LocalWorkspaceStore({ repoRoot, dataRoot: path.join(repoRoot, "data") });
  await store.initialize();
  const session = await createSession({
    title: "reply commit",
    objective: "validate reply commit",
    participants: ["deepseek"],
    settings: { mode: "playwright", defaultRounds: 1 },
  }, { store });
  const naturalReply = "我倾向于先验证输入链路，因为这能最快暴露真正的风险。";
  const scheduler = new RoundtableScheduler({
    store,
    strictReplyCommit: true,
    worker: { async execute() { return { text: naturalReply, capture: { speaker: "assistant", providerMessageId: "msg-1" } }; } },
  });
  const result = await scheduler.executeCommand(session.id, { text: "@ds analyze" });
  const replies = result.session.events.filter((event) => event.type === "reply");
  assert.ok(replies.length >= 1);
  assert.ok(replies.every((event) => event.metadata.commitStatus === "committed"));
  assert.ok(replies.every((event) => event.metadata.replyIdentity.providerMessageId === "msg-1"));
  assert.equal(replies[0].content, naturalReply);
  assert.equal(replies[0].metadata.structureStatus, "invalid");
});
