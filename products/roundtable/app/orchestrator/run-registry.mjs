import { AutomationError } from "../automation/errors.mjs";

function publicRun(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    planId: run.planId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    failedTurnId: run.failedTurnId || null,
    error: run.error || null,
    lastRecoveryDecision: run.lastRecoveryDecision || null,
  };
}

export class RunRegistry {
  constructor({ eventBus = null } = {}) {
    this.runs = new Map();
    this.eventBus = eventBus;
  }

  emit(type, run, detail = {}) {
    this.eventBus?.emit({
      type,
      sessionId: run.sessionId,
      planId: run.planId,
      runId: run.runId,
      run: publicRun(run),
      ...detail,
    });
  }

  create({ runId, sessionId, planId, controller = new AbortController() }) {
    if (!runId || this.runs.has(runId)) throw new Error("RUN_ID_ALREADY_EXISTS");
    const now = new Date().toISOString();
    const run = {
      runId,
      sessionId,
      planId,
      controller,
      status: "running",
      createdAt: now,
      updatedAt: now,
      pauseWaiters: [],
      recovery: null,
      failedTurnId: null,
      error: null,
      lastRecoveryDecision: null,
    };
    this.runs.set(runId, run);
    this.emit("run.started", run);
    return publicRun(run);
  }

  require(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    return run;
  }

  get(runId) {
    return publicRun(this.runs.get(runId));
  }

  getInternal(runId) {
    return this.require(runId);
  }

  list({ sessionId = null } = {}) {
    return [...this.runs.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .map(publicRun);
  }

  pause(runId) {
    const run = this.require(runId);
    if (run.status === "waiting_recovery") return publicRun(run);
    if (run.status !== "running") throw new Error("RUN_CANNOT_PAUSE");
    run.status = "paused";
    run.updatedAt = new Date().toISOString();
    this.emit("run.paused", run);
    return publicRun(run);
  }

  resume(runId) {
    const run = this.require(runId);
    if (run.status !== "paused") throw new Error("RUN_NOT_PAUSED");
    run.status = "running";
    run.updatedAt = new Date().toISOString();
    const waiters = run.pauseWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
    this.emit("run.resumed", run);
    return publicRun(run);
  }

  async waitIfPaused(runId) {
    const run = this.require(runId);
    while (run.status === "paused") {
      await new Promise((resolve, reject) => run.pauseWaiters.push({ resolve, reject }));
    }
    if (run.controller.signal.aborted) throw run.controller.signal.reason;
    if (run.status === "cancelled") throw new AutomationError("RUN_CANCELLED", "Roundtable run was cancelled.");
  }

  waitForRecovery(runId, turn, error) {
    const run = this.require(runId);
    if (run.recovery) throw new Error("RECOVERY_ALREADY_PENDING");
    if (run.controller.signal.aborted) return Promise.reject(run.controller.signal.reason);
    run.status = "waiting_recovery";
    run.failedTurnId = turn.id;
    run.error = {
      code: error?.code || "PROVIDER_EXECUTION_FAILED",
      message: error?.message || String(error),
      diagnostics: error?.diagnostics || null,
    };
    run.updatedAt = new Date().toISOString();
    const promise = new Promise((resolve, reject) => {
      run.recovery = { turnId: turn.id, resolve, reject };
    });
    this.emit("run.waiting_recovery", run, { turnId: turn.id, error: run.error });
    return promise;
  }

  resolveRecovery(runId, turnId, value, decisionKey = null) {
    const run = this.require(runId);
    if (!run.recovery) {
      if (decisionKey && run.lastRecoveryDecision?.decisionKey === decisionKey && run.lastRecoveryDecision.turnId === turnId) {
        return publicRun(run);
      }
      throw new Error("TURN_NOT_WAITING_RECOVERY");
    }
    if (run.recovery.turnId !== turnId) throw new Error("TURN_NOT_WAITING_RECOVERY");
    const recovery = run.recovery;
    run.recovery = null;
    run.failedTurnId = null;
    run.error = null;
    run.status = "running";
    run.updatedAt = new Date().toISOString();
    run.lastRecoveryDecision = {
      decisionKey,
      turnId,
      action: value.action,
      decidedAt: run.updatedAt,
    };
    recovery.resolve(value);
    this.emit("run.recovery_selected", run, { turnId, recovery: value.action });
    return publicRun(run);
  }

  retry(runId, turnId, { reuseExecutionId = false, decisionKey = null } = {}) {
    return this.resolveRecovery(runId, turnId, { action: "retry", reuseExecutionId }, decisionKey);
  }

  skip(runId, turnId, decisionKey = null) {
    return this.resolveRecovery(runId, turnId, { action: "skip" }, decisionKey);
  }

  manual(runId, turnId, content, decisionKey = null) {
    const normalized = String(content || "").trim();
    if (!normalized) throw new Error("EMPTY_MANUAL_REPLY");
    return this.resolveRecovery(runId, turnId, { action: "manual", content: normalized }, decisionKey);
  }

  cancel(runId, reason = "Roundtable run was cancelled.") {
    const run = this.require(runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) return publicRun(run);
    const error = new AutomationError("RUN_CANCELLED", String(reason));
    run.status = "cancelled";
    run.updatedAt = new Date().toISOString();
    run.error = { code: error.code, message: error.message };
    run.controller.abort(error);
    const waiters = run.pauseWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
    if (run.recovery) {
      run.recovery.reject(error);
      run.recovery = null;
    }
    this.emit("run.cancelled", run);
    return publicRun(run);
  }

  complete(runId) {
    const run = this.require(runId);
    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    run.failedTurnId = null;
    run.error = null;
    this.emit("run.completed", run);
    return publicRun(run);
  }

  fail(runId, error) {
    const run = this.require(runId);
    if (run.status === "cancelled") return publicRun(run);
    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    run.error = {
      code: error?.code || "RUN_FAILED",
      message: error?.message || String(error),
      diagnostics: error?.diagnostics || null,
    };
    this.emit("run.failed", run, { error: run.error });
    return publicRun(run);
  }
}
