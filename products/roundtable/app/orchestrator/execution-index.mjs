const PENDING_STATES = new Set(["waiting_recovery", "SEND_UNKNOWN", "failed"]);

function clone(value) {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

export function executionRecordFromTurn(session, plan, turn, checkpoint = null) {
  const error = turn.error || checkpoint?.metadata?.error || null;
  return {
    executionId: turn.executionId || checkpoint?.executionId || null,
    attemptId: turn.attemptId || checkpoint?.attemptId || null,
    idempotencyKey: turn.idempotencyKey || checkpoint?.idempotencyKey || null,
    sessionId: session.id,
    planId: plan.id,
    turnId: turn.id,
    providerId: turn.providerId,
    providerLabel: turn.providerLabel || turn.providerId,
    round: turn.round ?? null,
    role: turn.role || "discussion",
    status: turn.status || "planned",
    executionPhase: turn.executionPhase || checkpoint?.phase || null,
    sendState: turn.sendState || checkpoint?.metadata?.sendState || "NOT_SENT",
    error: clone(error),
    recovery: turn.recovery || null,
    updatedAt: turn.executionCheckpointAt || turn.completedAt || turn.failedAt || session.updatedAt || null,
    createdAt: checkpoint?.createdAt || turn.startedAt || session.updatedAt || null,
  };
}

export function upsertExecutionIndex(session, record) {
  if (!record?.executionId) return session.executionIndex || [];
  const current = Array.isArray(session.executionIndex) ? [...session.executionIndex] : [];
  const index = current.findIndex((candidate) => candidate.executionId === record.executionId);
  if (index >= 0) current[index] = { ...current[index], ...clone(record) };
  else current.push(clone(record));
  session.executionIndex = current.slice(-5000);
  return session.executionIndex;
}

export function listExecutionIndex(session) {
  const indexed = Array.isArray(session?.executionIndex) ? session.executionIndex : [];
  if (indexed.length) return indexed.map(clone);
  const records = [];
  for (const plan of session?.plans || []) {
    for (const turn of plan.turns || []) {
      const checkpoint = [...(session.checkpoints || [])].reverse().find((candidate) => candidate.turnId === turn.id);
      const record = executionRecordFromTurn(session, plan, turn, checkpoint);
      if (record.executionId) records.push(record);
    }
  }
  return records;
}

export function listPendingExecutions(session) {
  return listExecutionIndex(session).filter((record) =>
    PENDING_STATES.has(record.status)
      || record.sendState === "SEND_UNKNOWN"
      || record.executionPhase === "send_unknown"
  );
}

export { PENDING_STATES };
