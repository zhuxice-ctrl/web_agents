import { randomUUID } from "node:crypto";
import path from "node:path";

import { atomicWriteJson, safeSegment } from "../storage/local-workspace-store.mjs";

const DEFAULT_ESTIMATED_THREAD_CHARS = 120000;

export function estimateThreadCapacity(thread = {}, events = [], maxChars = DEFAULT_ESTIMATED_THREAD_CHARS) {
  const deliveredChars = Number(thread.deliveredChars || 0);
  const capturedChars = Number(thread.capturedChars || 0);
  const eventChars = events.reduce((total, event) => total + String(event.content || "").length, 0);
  const used = Math.max(deliveredChars + capturedChars, eventChars);
  const ratio = Math.max(0, Math.min(1, used / Math.max(1, maxChars)));
  return {
    estimated: true,
    usedChars: used,
    maxChars,
    percent: Math.round(ratio * 100),
    recommendation: ratio >= 0.9 ? "urgent_handoff" : ratio >= 0.72 ? "suggest_handoff" : "continue",
  };
}

export function buildHandoffPacket(session, providerId, cutoffIndex = session.events.length - 1) {
  const recent = session.events.slice(Math.max(0, cutoffIndex - 11), cutoffIndex + 1);
  const summaries = session.context?.summaries || [];
  return {
    schema: "web-agents-handoff-packet.v1",
    sessionId: session.id,
    sessionTitle: session.title,
    objective: session.objective || session.events.find((event) => event.type === "command")?.content || "",
    providerId,
    participants: session.participants.map((participant) => ({ id: participant.id, label: participant.label })),
    requirements: session.context?.requirements || [],
    consensus: session.context?.consensus || [],
    disagreements: session.context?.disagreements || [],
    evidence: session.context?.evidence || [],
    summaries,
    runtime: session.runtime || {},
    recentEvents: recent,
    nextTask: session.runtime?.nextTask || "等待圆桌下一轮指令",
    cutoffIndex,
    cutoffEventId: session.events[cutoffIndex]?.id || null,
    createdAt: new Date().toISOString(),
  };
}

function packetPrompt(packet, deltaEvents = []) {
  return [
    "[WEB_AGENTS_HANDOFF_BEGIN]",
    "这是同一圆桌的新网页线程交接包。请确认已理解，不要改变固定工作协议。",
    JSON.stringify({ ...packet, deltaEvents }, null, 2),
    "请只回复：交接完成，并简要列出你理解的当前任务、共识和未解决分歧。",
    "[WEB_AGENTS_HANDOFF_END]",
  ].join("\n");
}

export class HandoffManager {
  constructor({ store, browserManager, worker, eventBus = null } = {}) {
    if (!store) throw new Error("STORE_REQUIRED");
    if (!browserManager) throw new Error("BROWSER_MANAGER_REQUIRED");
    if (!worker) throw new Error("BROWSER_WORKER_REQUIRED");
    this.store = store;
    this.browserManager = browserManager;
    this.worker = worker;
    this.eventBus = eventBus;
  }

  async updateRecord(sessionId, handoffId, update) {
    let handoff;
    const session = await this.store.updateSession(sessionId, (current) => {
      const record = (current.handoffs || []).find((candidate) => candidate.id === handoffId);
      if (!record) throw new Error("HANDOFF_NOT_FOUND");
      update(record, current);
      current.updatedAt = new Date().toISOString();
      handoff = structuredClone(record);
      return current;
    });
    return { handoff, session };
  }

  checkpoint(sessionId, handoffId, executionKey) {
    return async (phase, metadata = {}) => {
      await this.updateRecord(sessionId, handoffId, (record) => {
        record.executionCheckpoints = {
          ...(record.executionCheckpoints || {}),
          [executionKey]: {
            ...(record.executionCheckpoints?.[executionKey] || {}),
            phase,
            metadata: { ...(record.executionCheckpoints?.[executionKey]?.metadata || {}), ...metadata },
            updatedAt: new Date().toISOString(),
          },
        };
      });
    };
  }

  async preview(sessionId, providerId) {
    const id = randomUUID();
    let record;
    await this.store.updateSession(sessionId, (session) => {
      if (!session.participants.some((participant) => participant.id === providerId)) throw new Error("PARTICIPANT_NOT_FOUND");
      const packet = buildHandoffPacket(session, providerId);
      record = {
        id,
        providerId,
        status: "preview",
        cutoffIndex: packet.cutoffIndex,
        cutoffEventId: packet.cutoffEventId,
        previousThread: session.threads?.[providerId] || null,
        packet,
        createdAt: new Date().toISOString(),
      };
      session.handoffs = [...(session.handoffs || []), record];
      session.updatedAt = record.createdAt;
      return session;
    });
    await atomicWriteJson(path.join(this.store.handoffsDir, `${safeSegment(id)}.json`), record);
    this.eventBus?.emit({ type: "handoff.previewed", sessionId, providerId, handoffId: id });
    return record;
  }

  async confirm(sessionId, handoffId, options = {}) {
    const threadId = randomUUID();
    const started = await this.updateRecord(sessionId, handoffId, (record) => {
      if (record.status !== "preview" && record.status !== "failed") throw new Error("HANDOFF_NOT_CONFIRMABLE");
      record.status = "creating_thread";
      record.attempts = (record.attempts || 0) + 1;
      record.startedAt = new Date().toISOString();
      record.error = null;
    });
    const record = started.handoff;
    const providerId = record.providerId;
    const threadKey = `${sessionId}:${providerId}:${threadId}`;

    try {
      const opened = await this.browserManager.createProviderThread(providerId, {
        threadKey,
        sessionId,
        seatId: providerId,
      });
      if (["waiting_login", "waiting_verification", "composer_missing"].includes(opened.status)) {
        const error = new Error(opened.status === "waiting_login" ? "LOGIN_REQUIRED" : opened.status === "waiting_verification" ? "HUMAN_VERIFICATION_REQUIRED" : "COMPOSER_NOT_FOUND");
        error.code = error.message;
        throw error;
      }
      await this.updateRecord(sessionId, handoffId, (current) => { current.status = "sending_snapshot"; });
      const snapshotExecutionKey = `snapshot-${threadId}`;
      const acknowledgement = await this.worker.execute({
        sessionId,
        planId: `handoff-${handoffId}`,
        turnId: snapshotExecutionKey,
        executionId: `${handoffId}:${snapshotExecutionKey}`,
        providerId,
        threadKey,
        prompt: packetPrompt(record.packet),
        autoSend: true,
        autoCapture: true,
        timeoutMs: options.timeoutMs || 180000,
        settleMs: options.settleMs || 3000,
        signal: options.signal,
        diagnosticsDir: this.store.getSessionPaths(sessionId).diagnostics,
        checkpoint: this.checkpoint(sessionId, handoffId, snapshotExecutionKey),
      });
      if (!String(acknowledgement.text || "").trim()) throw new Error("HANDOFF_ACK_EMPTY");

      let session = await this.store.readSession(sessionId);
      const deltaEvents = session.events.slice(record.cutoffIndex + 1);
      const deliveredEventIndex = deltaEvents.length ? session.events.length - 1 : record.cutoffIndex;
      if (deltaEvents.length) {
        await this.updateRecord(sessionId, handoffId, (current) => { current.status = "sending_delta"; });
        const deltaExecutionKey = `delta-${threadId}`;
        await this.worker.execute({
          sessionId,
          planId: `handoff-${handoffId}`,
          turnId: deltaExecutionKey,
          executionId: `${handoffId}:${deltaExecutionKey}`,
          providerId,
          threadKey,
          prompt: packetPrompt(record.packet, deltaEvents),
          autoSend: true,
          autoCapture: true,
          timeoutMs: options.timeoutMs || 180000,
          settleMs: options.settleMs || 3000,
          signal: options.signal,
          diagnosticsDir: this.store.getSessionPaths(sessionId).diagnostics,
          checkpoint: this.checkpoint(sessionId, handoffId, deltaExecutionKey),
        });
      }

      const snapshotPromptChars = packetPrompt(record.packet).length;
      const deltaPromptChars = deltaEvents.length ? packetPrompt(record.packet, deltaEvents).length : 0;
      const nextThread = {
        id: threadId,
        threadKey,
        providerId,
        url: opened.url,
        status: "ready",
        createdAt: record.startedAt,
        activatedAt: new Date().toISOString(),
        interactionCount: deltaEvents.length ? 2 : 1,
        lastDeliveredEventIndex: deliveredEventIndex,
        deliveredChars: snapshotPromptChars + deltaPromptChars,
      };
      const completed = await this.updateRecord(sessionId, handoffId, (current, latest) => {
        latest.threads = { ...(latest.threads || {}), [providerId]: nextThread };
        latest.context = {
          ...(latest.context || {}),
          seatCursors: { ...(latest.context?.seatCursors || {}), [providerId]: deliveredEventIndex },
        };
        current.status = "completed";
        current.newThread = nextThread;
        current.completedAt = nextThread.activatedAt;
        current.acknowledgement = acknowledgement.text;
        current.error = null;
      });
      await atomicWriteJson(path.join(this.store.handoffsDir, `${safeSegment(handoffId)}.json`), completed.handoff);
      this.eventBus?.emit({ type: "handoff.completed", sessionId, providerId, handoffId, thread: nextThread });
      return completed;
    } catch (cause) {
      const failed = await this.updateRecord(sessionId, handoffId, (current) => {
        current.status = "failed";
        current.failedAt = new Date().toISOString();
        current.error = { code: cause?.code || cause?.message || "HANDOFF_FAILED", message: cause?.message || String(cause) };
      });
      await atomicWriteJson(path.join(this.store.handoffsDir, `${safeSegment(handoffId)}.json`), failed.handoff);
      this.eventBus?.emit({ type: "handoff.failed", sessionId, providerId, handoffId, error: failed.handoff.error });
      throw cause;
    }
  }
}

export { packetPrompt };
