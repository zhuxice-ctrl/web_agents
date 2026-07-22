function itemKey(sessionId, turnId) {
  return `${sessionId}:${turnId}`;
}

function eventTurnId(event) {
  return String(event?.turnId || event?.turn?.id || "");
}

function compareItems(left, right) {
  return (Number(left.round) || 0) - (Number(right.round) || 0)
    || (Number(left.sequence) || 0) - (Number(right.sequence) || 0)
    || String(left.startedAt || "").localeCompare(String(right.startedAt || ""))
    || left.turnId.localeCompare(right.turnId);
}

export class TurnProgressStore {
  constructor() {
    this.activeSessionId = null;
    this.items = new Map();
  }

  setActiveSession(sessionId) {
    const nextId = sessionId ? String(sessionId) : null;
    if (nextId === this.activeSessionId) return;
    this.activeSessionId = nextId;
    this.items.clear();
  }

  handleStarted(event = {}) {
    const sessionId = String(event.sessionId || "");
    const turn = event.turn || {};
    const turnId = eventTurnId(event);
    if (!sessionId || !turnId || sessionId !== this.activeSessionId) return null;
    const entry = {
      sessionId,
      planId: String(event.planId || ""),
      turnId,
      executionId: String(turn.executionId || event.executionId || ""),
      providerId: String(turn.providerId || event.providerId || ""),
      providerLabel: String(turn.providerLabel || event.providerLabel || turn.providerId || event.providerId || "模型"),
      round: turn.round ?? event.round ?? null,
      stage: turn.stage || event.stage || null,
      sequence: turn.sequence ?? event.sequence ?? null,
      status: "running",
      partialText: "",
      startedAt: String(turn.startedAt || event.at || ""),
      updatedAt: String(event.at || turn.startedAt || ""),
    };
    this.items.set(itemKey(sessionId, turnId), entry);
    return entry;
  }

  handleProgress(event = {}) {
    const sessionId = String(event.sessionId || "");
    const turnId = eventTurnId(event);
    const key = itemKey(sessionId, turnId);
    const current = this.items.get(key);
    if (!current || sessionId !== this.activeSessionId) return null;
    if (String(event.executionId || "") !== current.executionId) return null;
    const updatedAt = String(event.at || "");
    if (updatedAt && current.updatedAt && updatedAt < current.updatedAt) return null;
    const text = String(event.text || "");
    if (!text || text === current.partialText) return current;
    const next = { ...current, partialText: text, status: "running", updatedAt: updatedAt || current.updatedAt };
    this.items.set(key, next);
    return next;
  }

  handleTerminal(event = {}) {
    const sessionId = String(event.sessionId || "");
    const turnId = eventTurnId(event);
    const key = itemKey(sessionId, turnId);
    const current = this.items.get(key);
    if (!current || sessionId !== this.activeSessionId) return null;
    const next = { ...current, status: "terminal", updatedAt: String(event.at || current.updatedAt) };
    this.items.set(key, next);
    return next;
  }

  syncSession(session) {
    if (!session?.id) {
      this.setActiveSession(null);
      return;
    }
    this.setActiveSession(session.id);
    const runningKeys = new Set();
    for (const plan of session.plans || []) {
      for (const turn of plan.turns || []) {
        if (turn.status !== "running") continue;
        const key = itemKey(session.id, turn.id);
        runningKeys.add(key);
        if (this.items.has(key)) continue;
        this.handleStarted({
          type: "turn.started",
          sessionId: session.id,
          planId: plan.id,
          at: turn.startedAt || session.updatedAt,
          turn,
        });
      }
    }
    for (const [key, item] of this.items) {
      if (item.sessionId === session.id && !runningKeys.has(key)) this.items.delete(key);
    }
  }

  list(sessionId = this.activeSessionId) {
    return [...this.items.values()]
      .filter((item) => item.sessionId === sessionId)
      .sort(compareItems)
      .map((item) => ({ ...item }));
  }
}
