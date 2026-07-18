import assert from "node:assert/strict";
import test from "node:test";

import {
  compressSessionContext,
  getActiveCompression,
  reviseSessionCompression,
} from "./context-compressor.mjs";

function createSession() {
  return {
    id: "session-compression",
    settings: {
      contextWindowTokens: 100,
      compressionTriggerPercent: 80,
      compressionTargetPercent: 20,
      recentRawTokenBudget: 10,
    },
    events: [
      { id: "e1", type: "reply", content: "共识：原始账本不可修改" },
      { id: "e2", type: "reply", content: "分歧：是否调用模型生成摘要" },
      { id: "e3", type: "reply", content: "证据：ledger.jsonl 的哈希保持一致" },
      { id: "e4", type: "reply", content: "决定：MVP 先使用本地规则" },
      { id: "e5", type: "reply", content: "普通观点不会被提升为共识" },
      { id: "e6", type: "command", content: "最近原文" },
    ],
    context: { seatCursors: {}, summaries: [] },
  };
}

const estimatePromptTokens = (prompt) => String(prompt).length;
const buildPrompt = (session) => session.context?.compression?.active
  ? "x".repeat(15)
  : "x".repeat(81);

test("compression triggers at 80 percent and classifies only explicit markers", () => {
  const session = createSession();
  const originalEvents = structuredClone(session.events);

  const result = compressSessionContext(session, {
    prompt: buildPrompt(session),
    buildPrompt,
    estimatePromptTokens,
    estimateEventTokens: () => 3,
    now: () => "2026-07-18T08:00:00.000Z",
    idFactory: () => "compression-1",
  });

  assert.equal(result.changed, true);
  assert.equal(result.compression.revision, 1);
  assert.equal(result.compression.coveredFromEventIndex, 0);
  assert.equal(result.compression.coveredThroughEventIndex, 2);
  assert.equal(result.compression.consensus[0].text, "原始账本不可修改");
  assert.deepEqual(result.compression.consensus[0].sourceEventIds, ["e1"]);
  assert.equal(result.compression.disagreements[0].text, "是否调用模型生成摘要");
  assert.equal(result.compression.evidence[0].text, "ledger.jsonl 的哈希保持一致");
  assert.equal(result.compression.decisions.length, 0);
  assert.equal(result.compression.unclassified.length, 0);
  assert.equal(result.compression.estimate.beforeTokens, 81);
  assert.equal(result.compression.estimate.afterTokens, 15);
  assert.equal(result.compression.estimate.targetMet, true);
  assert.deepEqual(session.events, originalEvents);
});

test("compression stays inactive below the trigger and is idempotent at one boundary", () => {
  const below = createSession();
  const untouched = compressSessionContext(below, {
    prompt: "x".repeat(79),
    estimatePromptTokens,
  });
  assert.equal(untouched.changed, false);
  assert.equal(getActiveCompression(below), null);

  const session = createSession();
  const options = {
    prompt: buildPrompt(session),
    buildPrompt,
    estimatePromptTokens,
    estimateEventTokens: () => 3,
    now: () => "2026-07-18T08:00:00.000Z",
    idFactory: () => "compression-1",
  };
  compressSessionContext(session, options);
  const second = compressSessionContext(session, { ...options, prompt: "x".repeat(81) });

  assert.equal(second.changed, false);
  assert.equal(session.context.compression.revisions.length, 1);
});

test("user revision preserves raw events and rejects stale or unknown sources", () => {
  const session = createSession();
  compressSessionContext(session, {
    prompt: buildPrompt(session),
    buildPrompt,
    estimatePromptTokens,
    estimateEventTokens: () => 3,
    now: () => "2026-07-18T08:00:00.000Z",
    idFactory: () => "compression-1",
  });
  const originalEvents = structuredClone(session.events);

  const revised = reviseSessionCompression(session, {
    baseRevision: 1,
    consensus: [{ id: "consensus-user", text: "账本保持只追加", sourceEventIds: ["e1"] }],
    disagreements: getActiveCompression(session).disagreements,
    evidence: getActiveCompression(session).evidence,
    decisions: [],
    unclassified: [],
  }, {
    now: () => "2026-07-18T08:05:00.000Z",
    idFactory: () => "compression-2",
  });

  assert.equal(revised.revision, 2);
  assert.equal(revised.reason, "user_revision");
  assert.equal(revised.consensus[0].text, "账本保持只追加");
  assert.equal(session.context.compression.revisions.length, 2);
  assert.deepEqual(session.events, originalEvents);

  assert.throws(
    () => reviseSessionCompression(session, { baseRevision: 1 }),
    (error) => error.code === "STALE_COMPRESSION_REVISION",
  );
  assert.throws(
    () => reviseSessionCompression(session, {
      baseRevision: 2,
      consensus: [{ id: "bad", text: "伪造来源", sourceEventIds: ["other-session-event"] }],
      disagreements: [],
      evidence: [],
      decisions: [],
      unclassified: [],
    }),
    (error) => error.code === "UNKNOWN_COMPRESSION_SOURCE_EVENT",
  );
});
