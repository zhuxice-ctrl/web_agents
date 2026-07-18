import assert from "node:assert/strict";
import test from "node:test";

import {
  applySeatProjection,
  estimateSeatCapacity,
  getSeatSyncStatus,
  initializeSeatContext,
  projectContextForSeat,
} from "./context-projector.mjs";

function createSession() {
  return {
    participants: [
      { id: "deepseek", label: "DeepSeek" },
      { id: "doubao", label: "豆包" },
    ],
    settings: { estimatedThreadCapacityChars: 1000, recentRawEvents: 2 },
    events: [
      { id: "event-1", type: "command", content: "原始任务" },
      { id: "event-2", type: "reply", providerId: "deepseek", content: "第一条" },
      { id: "event-3", type: "reply", providerId: "doubao", content: "第二条" },
      { id: "event-4", type: "guidance", content: "补充约束" },
    ],
    context: {
      seatCursors: { deepseek: 0 },
      consensus: ["保留原始记录"],
      disagreements: ["是否压缩"],
      evidence: ["event-2"],
      summaries: [],
    },
    threads: {
      deepseek: {
        id: "thread-deepseek",
        threadKey: "seat-thread-deepseek",
        providerId: "deepseek",
        lastDeliveredEventIndex: 0,
        estimatedCapacityChars: 1000,
        usage: { sentChars: 100, capturedChars: 50, interactions: 1 },
      },
    },
  };
}

test("seat projection returns only cursor delta with exact sync progress", () => {
  const session = createSession();
  const projection = projectContextForSeat(session, "deepseek", {
    throughCursor: 3,
    recentRawEventLimit: 2,
  });

  assert.deepEqual(projection.events.map((event) => event.id), ["event-2", "event-3"]);
  assert.deepEqual(projection.recentEvents.map((event) => event.id), ["event-2", "event-3"]);
  assert.deepEqual(projection.sync, {
    exact: true,
    current: 1,
    projected: 3,
    total: 4,
    pending: 3,
    remainingAfterProjection: 1,
  });
  assert.deepEqual(projection.publicState.consensus, ["保留原始记录"]);
});

test("applying a delivered projection advances both seat cursor records and usage", () => {
  const session = createSession();
  const projection = projectContextForSeat(session, "deepseek", { throughCursor: 3 });

  applySeatProjection(session, projection, { promptChars: 200, replyChars: 100 });

  assert.equal(session.context.seatCursors.deepseek, 2);
  assert.equal(session.threads.deepseek.lastDeliveredEventIndex, 2);
  assert.equal(session.threads.deepseek.deliveredChars, 300);
  assert.equal(session.threads.deepseek.capturedChars, 150);
  assert.equal(session.threads.deepseek.interactionCount, 2);
  assert.deepEqual(session.threads.deepseek.usage, {
    sentChars: 300,
    capturedChars: 150,
    interactions: 2,
  });
  assert.deepEqual(getSeatSyncStatus(session, "deepseek"), {
    exact: true,
    current: 3,
    total: 4,
    pending: 1,
  });

  const capacity = estimateSeatCapacity(session, "deepseek");
  assert.equal(capacity.estimated, true);
  assert.equal(capacity.usedChars, 450);
  assert.equal(capacity.capacityChars, 1000);
  assert.equal(capacity.percent, 45);
});

test("join policy initializes a new seat from history or from the current event", () => {
  const fromNow = createSession();
  initializeSeatContext(fromNow, "doubao", { joinPolicy: "from_now", threadId: "thread-now" });
  assert.equal(fromNow.context.seatCursors.doubao, 3);
  assert.equal(fromNow.threads.doubao.lastDeliveredEventIndex, 3);

  const withHistory = createSession();
  initializeSeatContext(withHistory, "doubao", { joinPolicy: "full_history", threadId: "thread-history" });
  assert.equal(withHistory.context.seatCursors.doubao, -1);
  assert.equal(withHistory.threads.doubao.lastDeliveredEventIndex, -1);
});

test("active compression replaces covered prompt history without changing exact seat delta", () => {
  const session = createSession();
  const active = {
    id: "compression-1",
    revision: 1,
    coveredFromEventIndex: 0,
    coveredThroughEventIndex: 1,
    consensus: [{ id: "c1", text: "保留原始记录", sourceEventIds: ["event-1"] }],
    disagreements: [],
    evidence: [],
    decisions: [],
    unclassified: [],
    estimate: { beforeTokens: 110000, afterTokens: 24000, windowTokens: 131072 },
  };
  session.context.compression = {
    schema: "web-agents-roundtable-compression.v1",
    activeRevision: 1,
    active,
    revisions: [structuredClone(active)],
  };

  const projection = projectContextForSeat(session, "deepseek", { throughEventIndex: 3 });

  assert.deepEqual(projection.events.map((event) => event.id), ["event-2", "event-3", "event-4"]);
  assert.deepEqual(projection.promptEvents.map((event) => event.id), ["event-3", "event-4"]);
  assert.equal(projection.compression.revision, 1);
  assert.equal(projection.compression.coveredThroughEventIndex, 1);
});
