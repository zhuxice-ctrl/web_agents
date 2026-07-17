import { randomUUID } from "node:crypto";

import { AutomationError } from "../automation/errors.mjs";
import {
  coerceSettings,
  getProvider,
  getProviderLabel,
  isProviderHealthy,
} from "../core/providers.mjs";
import { parseRoundtableCommand } from "./command-parser.mjs";
import { buildPrompt, DISCUSSION_STAGES, getDiscussionStage } from "./context-builder.mjs";
import { applySeatProjection, projectContextForSeat } from "./context-projector.mjs";
import {
  analyzeReplyQuality,
  isTechnicalFailure,
  technicalFailureForResult,
} from "./quality-analyzer.mjs";

function createTurn(commandId, providerId, session, overrides = {}) {
  return {
    id: randomUUID(),
    commandId,
    round: null,
    sequence: null,
    providerId,
    providerLabel: getProviderLabel(providerId, session.participants),
    role: "discussion",
    stage: null,
    countsTowardRounds: true,
    status: "planned",
    prompt: null,
    attempts: 0,
    providerAttempts: {},
    ...overrides,
  };
}

function participantFor(session, providerId) {
  return session?.participants?.find((participant) => participant.id === providerId) || null;
}

function isClosureTurn(turn) {
  return turn?.role === "closure" || turn?.role === "host_summary" || turn?.stage === DISCUSSION_STAGES.closure.id;
}

function writeExecutorForTurn(plan, turn) {
  if (isClosureTurn(turn)) return plan.writeExecutorId || turn.providerId;
  if (plan.mode === "direct") return turn.providerId;
  // A missing executor defaults to the caller in ControllerToolWorker, so proposal turns need an explicit read-only principal.
  return `roundtable-read-only:${plan.id}:${turn.id}`;
}

const TERMINAL_TURN_STATUSES = new Set(["completed", "absent", "skipped", "cancelled"]);
const REPLAY_BLOCKING_PHASES = new Set(["submitting", "submitted", "captured", "completed"]);

function requiresExplicitRecovery(error) {
  return error?.code === "PERMISSION_REQUIRED";
}

function errorFromPersistedTurn(turn) {
  if (!turn || TERMINAL_TURN_STATUSES.has(turn.status)) return null;
  if (turn.status === "waiting_recovery" || turn.status === "failed") {
    return new AutomationError(
      turn.error?.code || "RUN_INTERRUPTED",
      turn.error?.message || "The interrupted turn requires an explicit recovery decision.",
      turn.error?.diagnostics || {},
    );
  }
  if (turn.status === "running" && REPLAY_BLOCKING_PHASES.has(turn.executionPhase)) {
    return new AutomationError(
      "EXECUTION_REPLAY_BLOCKED",
      `${turn.providerLabel} already submitted execution ${turn.executionId}; choose retry, skip, or provide a manual reply.`,
      { turnId: turn.id, executionId: turn.executionId, phase: turn.executionPhase },
    );
  }
  return null;
}

function firstHealthyProvider(session, providerIds, excluded = new Set()) {
  for (const providerId of providerIds) {
    if (!providerId || excluded.has(providerId)) continue;
    if (isProviderHealthy(participantFor(session, providerId), session?.threads?.[providerId])) return providerId;
  }
  return null;
}

export function selectHealthyClosureProvider(session, plan, excludedProviderId = null) {
  const excluded = new Set(excludedProviderId ? [excludedProviderId] : []);
  const completed = new Set(
    (plan?.turns || [])
      .filter((turn) => !isClosureTurn(turn) && turn.status === "completed")
      .map((turn) => turn.providerId),
  );
  const targetIds = (plan?.targets || []).filter((providerId) => completed.has(providerId));
  return firstHealthyProvider(session, targetIds, excluded)
    || firstHealthyProvider(session, plan?.targets || [], excluded)
    || firstHealthyProvider(session, (session?.participants || []).map((participant) => participant.id), excluded);
}

function initialClosureProvider(session, parsed) {
  const hostId = parsed.hostId || session?.hostId || null;
  if (hostId && isProviderHealthy(participantFor(session, hostId), session?.threads?.[hostId])) {
    return { providerId: hostId, fallbackFromProviderId: null, fallbackReason: null };
  }
  const fallback = firstHealthyProvider(session, parsed.targets || [], new Set(hostId ? [hostId] : []));
  return {
    providerId: fallback || hostId || parsed.targets?.[0] || null,
    fallbackFromProviderId: hostId && fallback ? hostId : null,
    fallbackReason: hostId && fallback ? "HOST_UNHEALTHY_AT_PLAN_CREATION" : null,
  };
}

export function createTurnPlan(session, commandInput, settings = session?.settings) {
  const parsed = parseRoundtableCommand(commandInput, session, settings);
  const requestedWriteExecutorId = typeof commandInput === "object" && commandInput !== null
    ? commandInput.writeExecutorId ?? commandInput.permissions?.writeExecutorId ?? null
    : null;
  const commandId = randomUUID();
  const turns = [];
  const closure = initialClosureProvider(session, parsed);

  if (parsed.conversationMode === "relay") {
    const relayProviders = parsed.route.filter((providerId) => providerId !== parsed.hostId);
    relayProviders.forEach((providerId, index) => {
      turns.push(createTurn(commandId, providerId, session, {
        round: 1,
        sequence: index + 1,
        role: "relay",
        stage: "relay",
      }));
    });
    if (closure.providerId) {
      turns.push(createTurn(commandId, closure.providerId, session, {
        round: null,
        sequence: parsed.route.length,
        role: "host_summary",
        stage: DISCUSSION_STAGES.closure.id,
        countsTowardRounds: false,
        fallbackFromProviderId: closure.fallbackFromProviderId,
        fallbackReason: closure.fallbackReason,
      }));
    }
  } else {
    for (let round = 1; round <= parsed.rounds; round += 1) {
      const stage = getDiscussionStage(round, parsed.rounds);
      for (const providerId of parsed.targets) {
        turns.push(createTurn(commandId, providerId, session, {
          round,
          role: "discussion",
          stage: stage.id,
        }));
      }
    }
    if (parsed.mode === "discussion" && closure.providerId) {
      turns.push(createTurn(commandId, closure.providerId, session, {
        round: null,
        role: "closure",
        stage: DISCUSSION_STAGES.closure.id,
        countsTowardRounds: false,
        fallbackFromProviderId: closure.fallbackFromProviderId,
        fallbackReason: closure.fallbackReason,
      }));
    }
  }

  const closureTurn = turns.find(isClosureTurn) || null;
  return {
    id: commandId,
    commandText: parsed.commandText,
    instruction: parsed.instruction,
    originalTask: parsed.originalTask || parsed.instruction,
    references: parsed.references || [],
    mentionTokens: parsed.mentionTokens || [],
    routingSource: parsed.routingSource,
    structuredRouting: Boolean(parsed.structuredRouting),
    targets: parsed.targets,
    selectedTargets: parsed.selectedTargets || parsed.targets,
    rounds: parsed.rounds,
    mode: parsed.mode,
    conversationMode: parsed.conversationMode,
    route: parsed.route || [],
    hostId: parsed.hostId || session.hostId || null,
    closureHostId: parsed.hostId || session.hostId || null,
    writeExecutorId: requestedWriteExecutorId ? String(requestedWriteExecutorId) : null,
    effectiveClosureProviderId: closureTurn?.providerId || null,
    closureTurnId: closureTurn?.id || null,
    status: "planned",
    createdAt: new Date().toISOString(),
    completedAt: null,
    turns,
  };
}

function commandEvent(plan, settings) {
  return {
    id: randomUUID(),
    type: "command",
    providerId: null,
    content: plan.commandText,
    commandId: plan.id,
    round: null,
    metadata: {
      targets: plan.targets,
      selectedTargets: plan.selectedTargets,
      references: plan.references,
      rounds: plan.rounds,
      mode: plan.mode,
      conversationMode: plan.conversationMode,
      route: plan.route,
      hostId: plan.hostId,
      closureTurnId: plan.closureTurnId,
      writeExecutorId: plan.writeExecutorId,
      routingSource: plan.routingSource,
      executionMode: settings.mode,
    },
    createdAt: new Date().toISOString(),
  };
}

function latestSuccessfulBaton(session, plan) {
  return [...(session.events || [])].reverse().find((event) =>
    event.commandId === plan.id
      && event.type === "reply"
      && event.metadata?.role !== "closure"
      && event.metadata?.role !== "host_summary"
  ) || null;
}

function planAbsences(session, plan) {
  return (session.events || []).filter((event) => event.commandId === plan.id && event.type === "absence");
}

function buildMockReply(session, plan, turn) {
  const label = getProvider(turn.providerId, session.participants)?.label || turn.providerLabel;
  const previous = latestSuccessfulBaton(session, plan);
  if (isClosureTurn(turn)) {
    return [
      `[Mock ${label} · ${plan.conversationMode === "relay" ? "东家总结" : "自动收束"}]`,
      `我已回到原始任务“${plan.originalTask}”。`,
      previous ? `最后成功观点是：${previous.content.split("\n").at(-1)}` : "此前没有成功观点。",
      "最终汇报：先建立评价标准，再进行高质量样本对比、主动复盘和跨模型交叉审查。",
    ].join("\n");
  }
  if (plan.conversationMode === "relay") {
    return [
      `[Mock ${label} · 传递第 ${turn.sequence} 棒]`,
      `我保留原始任务：“${plan.originalTask}”。`,
      previous ? "我已看到最后成功接力棒，并在此基础上补充可执行步骤。" : "我是本次传递的第一位有效回答者。",
      "新增观点：训练审美需要持续输入优质样本、建立比较维度，并记录每次选择背后的理由。",
    ].join("\n");
  }
  return [
    `[Mock ${label} · 第 ${turn.round} 轮]`,
    `当前阶段：${turn.stage}。`,
    `我收到的原始任务是：“${plan.originalTask}”。`,
    "当前可执行建议：先明确判断标准，再拆分证据链，最后把争议点交给下一轮模型交叉检查。",
  ].join("\n");
}

function serializeError(error) {
  return {
    code: error?.code || "PROVIDER_EXECUTION_FAILED",
    message: error?.message || String(error),
    stack: error?.stack || null,
    diagnostics: error?.diagnostics || null,
  };
}

function projectionSummary(projection) {
  return {
    providerId: projection.providerId,
    fromEventIndex: projection.fromEventIndex,
    throughEventIndex: projection.throughEventIndex,
    sync: projection.sync,
    capacity: projection.capacity,
  };
}

function cloneCheckpointMetadata(metadata) {
  try {
    return structuredClone(metadata && typeof metadata === "object" ? metadata : {});
  } catch {
    return { serializationError: true };
  }
}

export class RoundtableScheduler {
  constructor({ store, worker = null, eventBus = null, runRegistry = null } = {}) {
    if (!store) throw new Error("STORE_REQUIRED");
    this.store = store;
    this.worker = worker;
    this.eventBus = eventBus;
    this.runRegistry = runRegistry;
    this.prepareLocks = new Map();
    this.executionCheckpointLocks = new Map();
  }

  emit(type, detail) {
    this.eventBus?.emit({ type, at: new Date().toISOString(), ...detail });
  }

  async prepareCommand(sessionId, payload = {}, options = {}) {
    const previous = this.prepareLocks.get(sessionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.prepareLocks.set(sessionId, current);
    await previous;
    try {
      return await this.prepareCommandUnlocked(sessionId, payload, options);
    } finally {
      release();
      if (this.prepareLocks.get(sessionId) === current) this.prepareLocks.delete(sessionId);
    }
  }

  async prepareCommandUnlocked(sessionId, payload = {}, options = {}) {
    let plan;
    let session = await this.store.updateSession(sessionId, (current) => {
      const activePlan = current.plans?.find((candidate) => candidate.id === current.runtime?.activePlanId);
      if (activePlan && ["planned", "running", "waiting_recovery"].includes(activePlan.status)) {
        throw new Error("SESSION_RUN_ACTIVE");
      }
      const settingsPatch = typeof payload === "object" && payload !== null ? payload.settings || {} : {};
      current.settings = coerceSettings({ ...(current.settings || {}), ...settingsPatch });
      plan = createTurnPlan(current, payload, current.settings);
      plan.runId = options.runId || null;
      plan.status = "running";
      plan.startedAt = new Date().toISOString();
      current.plans = [...(current.plans || []), plan];
      current.runtime = {
        ...(current.runtime || {}),
        status: "running",
        activePlanId: plan.id,
        activeRunId: options.runId || null,
        error: null,
      };
      current.updatedAt = plan.startedAt;
      return current;
    });
    session = await this.store.appendEvents(sessionId, [commandEvent(plan, session.settings)]);
    this.emit("plan.started", { sessionId, planId: plan.id, runId: options.runId || null, plan });
    return { session, plan };
  }

  async executeCommand(sessionId, payload = {}, options = {}) {
    const prepared = await this.prepareCommand(sessionId, payload, options);
    return this.executePreparedPlan(sessionId, prepared.plan.id, options);
  }

  async executePreparedPlan(sessionId, planId, options = {}) {
    let session = await this.store.readSession(sessionId);
    const plan = session.plans.find((candidate) => candidate.id === planId);
    if (!plan) throw new Error("PLAN_NOT_FOUND");
    if (plan.status !== "running") throw new Error("PLAN_NOT_RUNNING");
    const replayBlockedTurn = !options.resumePersisted && plan.turns.find((turn) => {
      if (turn.status !== "running") return false;
      const checkpoints = (session.checkpoints || []).filter((candidate) => candidate.turnId === turn.id);
      return checkpoints.some((checkpoint) => REPLAY_BLOCKING_PHASES.has(checkpoint.phase))
        || REPLAY_BLOCKING_PHASES.has(turn.executionPhase);
    });
    if (replayBlockedTurn) {
      throw new AutomationError(
        "EXECUTION_REPLAY_BLOCKED",
        `${replayBlockedTurn.providerLabel} already submitted execution ${replayBlockedTurn.executionId}; manual recovery is required.`,
        { turnId: replayBlockedTurn.id, executionId: replayBlockedTurn.executionId },
      );
    }
    try {
      session = plan.conversationMode === "relay"
        ? await this.executeRelay(session, plan, options)
        : await this.executeDiscussion(session, plan, options);
      session = await this.store.updateSession(sessionId, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === plan.id);
        if (!currentPlan) throw new Error("PLAN_NOT_FOUND");
        currentPlan.status = "completed";
        currentPlan.completedAt = new Date().toISOString();
        currentPlan.error = null;
        if (current.runtime?.activePlanId === plan.id) {
          current.runtime = {
            ...(current.runtime || {}),
            status: "idle",
            activePlanId: null,
            activeRunId: null,
            failedTurnId: null,
            error: null,
          };
        }
        current.updatedAt = currentPlan.completedAt;
        return current;
      });
      const savedPlan = session.plans.find((candidate) => candidate.id === plan.id);
      this.emit("plan.completed", { sessionId, planId: plan.id, runId: options.runId || null, plan: savedPlan });
      return { session, plan: savedPlan };
    } catch (error) {
      const cancelled = Boolean(options.signal?.aborted) || error?.code === "RUN_CANCELLED";
      const serialized = serializeError(error);
      session = await this.store.updateSession(sessionId, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === plan.id);
        const failedAt = new Date().toISOString();
        if (currentPlan) {
          currentPlan.status = cancelled ? "cancelled" : "failed";
          currentPlan.failedAt = failedAt;
          currentPlan.error = serialized;
        }
        if (current.runtime?.activePlanId === plan.id) {
          current.runtime = {
            ...(current.runtime || {}),
            status: cancelled ? "cancelled" : "failed",
            activePlanId: null,
            activeRunId: null,
            failedTurnId: null,
            error: serialized,
          };
        }
        current.updatedAt = failedAt;
        return current;
      });
      this.emit("plan.failed", {
        sessionId,
        planId: plan.id,
        runId: options.runId || null,
        cancelled,
        error: serialized,
      });
      throw error;
    }
  }

  async checkpoint(options) {
    if (options.signal?.aborted) throw options.signal.reason || Object.assign(new Error("RUN_CANCELLED"), { code: "RUN_CANCELLED" });
    if (options.runId && this.runRegistry) await this.runRegistry.waitIfPaused(options.runId);
    if (options.signal?.aborted) throw options.signal.reason || Object.assign(new Error("RUN_CANCELLED"), { code: "RUN_CANCELLED" });
  }

  prepareTurnPrompt(session, plan, turn, eventsSnapshot = session.events) {
    const snapshotSession = { ...session, events: eventsSnapshot };
    const projection = projectContextForSeat(snapshotSession, turn.providerId, {
      throughEventIndex: eventsSnapshot.length - 1,
    });
    const baton = latestSuccessfulBaton(snapshotSession, plan);
    const absences = planAbsences(snapshotSession, plan);
    turn.contextProjection = projectionSummary(projection);
    turn.prompt = buildPrompt(snapshotSession, turn.providerId, {
      commandText: plan.commandText,
      originalTask: plan.originalTask,
      conversationMode: plan.conversationMode,
      round: turn.round,
      totalRounds: plan.rounds,
      stage: turn.stage,
      role: turn.role,
      route: plan.route,
      sequence: turn.sequence,
      isClosure: isClosureTurn(turn),
      isHostSummary: isClosureTurn(turn),
      targets: plan.targets,
      projection,
      lastSuccessfulBaton: baton,
      absences,
      fallbackFromProviderId: turn.fallbackFromProviderId || null,
      fallbackReason: turn.fallbackReason || null,
    });
    return turn;
  }

  async resumeDiscussionRound(session, planId, round, options) {
    session = await this.store.readSession(session.id);
    let plan = session.plans.find((candidate) => candidate.id === planId);
    const turnIds = plan.turns
      .filter((turn) => turn.countsTowardRounds && turn.round === round)
      .map((turn) => turn.id);
    const contextSnapshot = session.events
      .filter((event) => event.commandId !== planId || event.round === null || Number(event.round) < round)
      .map((event) => structuredClone(event));
    const multiModel = new Set(plan.targets).size > 1;

    for (const turnId of turnIds) {
      await this.checkpoint(options);
      session = await this.store.readSession(session.id);
      plan = session.plans.find((candidate) => candidate.id === planId);
      const turn = plan.turns.find((candidate) => candidate.id === turnId);
      if (TERMINAL_TURN_STATUSES.has(turn.status)) continue;

      const recoveryError = errorFromPersistedTurn(turn);
      if (recoveryError) {
        session = await this.recoverTurn(session.id, planId, turnId, recoveryError, options);
        continue;
      }

      session = await this.store.updateSession(session.id, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === planId);
        const currentTurn = currentPlan?.turns.find((candidate) => candidate.id === turnId);
        if (!currentPlan || !currentTurn) throw new Error("TURN_NOT_FOUND");
        this.prepareTurnPrompt(current, currentPlan, currentTurn, contextSnapshot);
        this.markTurnRunning(currentTurn);
        current.updatedAt = new Date().toISOString();
        return current;
      });
      plan = session.plans.find((candidate) => candidate.id === planId);
      const startedTurn = plan.turns.find((candidate) => candidate.id === turnId);
      this.emit("turn.started", { sessionId: session.id, planId, runId: options.runId || null, turn: startedTurn, recovery: "restart" });
      try {
        const result = await this.executeWithAutomaticRetry(session, plan, startedTurn, options);
        session = await this.persistTurnSuccess(session, plan, startedTurn, result, options, "restart");
      } catch (error) {
        if (multiModel && !requiresExplicitRecovery(error)) {
          session = await this.persistTurnAbsence(session, plan, startedTurn, error, options);
          continue;
        }
        session = await this.persistTurnFailure(session, plan, startedTurn, error, options);
        session = await this.recoverTurn(session.id, planId, turnId, error, options);
      }
    }
    return session;
  }

  async executeDiscussion(session, plan, options) {
    for (let round = 1; round <= plan.rounds; round += 1) {
      await this.checkpoint(options);
      session = await this.store.readSession(session.id);
      if (options.resumePersisted) {
        session = await this.resumeDiscussionRound(session, plan.id, round, options);
        this.emit("round.completed", {
          sessionId: session.id,
          planId: plan.id,
          runId: options.runId || null,
          round,
          stage: getDiscussionStage(round, plan.rounds).id,
          recovery: "restart",
        });
        continue;
      }
      let startedTurnIds = [];
      session = await this.store.updateSession(session.id, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === plan.id);
        const currentTurns = currentPlan.turns.filter((turn) => turn.countsTowardRounds && turn.round === round);
        const contextSnapshot = current.events.map((event) => structuredClone(event));
        for (const turn of currentTurns) {
          this.prepareTurnPrompt(current, currentPlan, turn, contextSnapshot);
          this.markTurnRunning(turn);
        }
        startedTurnIds = currentTurns.map((turn) => turn.id);
        current.updatedAt = new Date().toISOString();
        return current;
      });
      const savedPlan = session.plans.find((candidate) => candidate.id === plan.id);
      const turns = startedTurnIds.map((turnId) => savedPlan.turns.find((turn) => turn.id === turnId));
      for (const turn of turns) {
        this.emit("turn.started", { sessionId: session.id, planId: plan.id, runId: options.runId || null, turn });
      }

      const results = await Promise.allSettled(
        turns.map((turn) => this.executeWithAutomaticRetry(session, savedPlan, turn, options)),
      );
      const multiModel = new Set(savedPlan.targets).size > 1;
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        const result = results[index];
        if (result.status === "fulfilled") {
          session = await this.persistTurnSuccess(session, savedPlan, turn, result.value, options);
          continue;
        }
        if (multiModel && !requiresExplicitRecovery(result.reason)) {
          session = await this.persistTurnAbsence(session, savedPlan, turn, result.reason, options);
          continue;
        }
        session = await this.persistTurnFailure(session, savedPlan, turn, result.reason, options);
        session = await this.recoverTurn(session.id, plan.id, turn.id, result.reason, options);
      }
      this.emit("round.completed", {
        sessionId: session.id,
        planId: plan.id,
        runId: options.runId || null,
        round,
        stage: getDiscussionStage(round, plan.rounds).id,
      });
    }
    return this.executeClosure(session, plan.id, options);
  }

  async executeRelay(session, plan, options) {
    const relayTurnIds = plan.turns.filter((turn) => turn.role === "relay").map((turn) => turn.id);
    for (const turnId of relayTurnIds) {
      await this.checkpoint(options);
      session = await this.store.readSession(session.id);
      let savedPlan = session.plans.find((candidate) => candidate.id === plan.id);
      let turn = savedPlan.turns.find((candidate) => candidate.id === turnId);
      if (TERMINAL_TURN_STATUSES.has(turn.status)) continue;
      if (options.resumePersisted) {
        const recoveryError = errorFromPersistedTurn(turn);
        if (recoveryError) {
          session = await this.recoverTurn(session.id, plan.id, turn.id, recoveryError, options);
          continue;
        }
      }
      session = await this.store.updateSession(session.id, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === plan.id);
        const currentTurn = currentPlan.turns.find((candidate) => candidate.id === turnId);
        const contextSnapshot = current.events.map((event) => structuredClone(event));
        this.prepareTurnPrompt(current, currentPlan, currentTurn, contextSnapshot);
        this.markTurnRunning(currentTurn);
        current.updatedAt = new Date().toISOString();
        return current;
      });
      savedPlan = session.plans.find((candidate) => candidate.id === plan.id);
      turn = savedPlan.turns.find((candidate) => candidate.id === turnId);
      this.emit("turn.started", { sessionId: session.id, planId: plan.id, runId: options.runId || null, turn });
      try {
        const result = await this.executeWithAutomaticRetry(session, savedPlan, turn, options);
        session = await this.persistTurnSuccess(session, savedPlan, turn, result, options);
      } catch (error) {
        if (requiresExplicitRecovery(error)) {
          session = await this.persistTurnFailure(session, savedPlan, turn, error, options);
          session = await this.recoverTurn(session.id, plan.id, turn.id, error, options);
        } else {
          session = await this.persistTurnAbsence(session, savedPlan, turn, error, options);
        }
      }
    }
    return this.executeClosure(session, plan.id, options);
  }

  async executeClosure(session, planId, options) {
    session = await this.store.readSession(session.id);
    let plan = session.plans.find((candidate) => candidate.id === planId);
    let turn = plan.turns.find(isClosureTurn);
    if (!turn) return session;
    if (TERMINAL_TURN_STATUSES.has(turn.status)) return session;
    await this.checkpoint(options);
    if (options.resumePersisted) {
      const recoveryError = errorFromPersistedTurn(turn);
      if (recoveryError) {
        return this.recoverTurn(session.id, planId, turn.id, recoveryError, options);
      }
    }
    session = await this.store.updateSession(session.id, (current) => {
      const currentPlan = current.plans.find((candidate) => candidate.id === planId);
      const currentTurn = currentPlan.turns.find(isClosureTurn);
      this.prepareTurnPrompt(current, currentPlan, currentTurn, current.events.map((event) => structuredClone(event)));
      this.markTurnRunning(currentTurn);
      current.updatedAt = new Date().toISOString();
      return current;
    });
    plan = session.plans.find((candidate) => candidate.id === planId);
    turn = plan.turns.find(isClosureTurn);
    this.emit("turn.started", { sessionId: session.id, planId, runId: options.runId || null, turn });
    try {
      const result = await this.executeWithAutomaticRetry(session, plan, turn, options);
      return this.persistTurnSuccess(session, plan, turn, result, options);
    } catch (hostError) {
      if (requiresExplicitRecovery(hostError)) {
        session = await this.persistTurnFailure(session, plan, turn, hostError, options);
        return this.recoverTurn(session.id, planId, turn.id, hostError, options);
      }
      session = await this.mergeLatestTurnState(session.id, plan, turn);
      plan = session.plans.find((candidate) => candidate.id === planId);
      turn = plan.turns.find(isClosureTurn);
      const failedProviderId = turn.providerId;
      turn.providerFailures = [
        ...(turn.providerFailures || []),
        { providerId: failedProviderId, error: serializeError(hostError), attempts: turn.providerAttempts?.[failedProviderId] || 0 },
      ];
      this.emit("closure.provider_failed", {
        sessionId: session.id,
        planId,
        runId: options.runId || null,
        providerId: failedProviderId,
        error: serializeError(hostError),
      });
      const fallbackId = selectHealthyClosureProvider(session, plan, failedProviderId);
      if (!fallbackId) return this.persistTurnAbsence(session, plan, turn, hostError, options);

      session = await this.store.updateSession(session.id, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === planId);
        const currentTurn = currentPlan.turns.find(isClosureTurn);
        currentTurn.fallbackFromProviderId = failedProviderId;
        currentTurn.fallbackReason = `${hostError.code || "PROVIDER_EXECUTION_FAILED"}: ${hostError.message || String(hostError)}`;
        currentTurn.providerId = fallbackId;
        currentTurn.providerLabel = getProviderLabel(fallbackId, current.participants);
        currentTurn.status = "planned";
        currentPlan.effectiveClosureProviderId = fallbackId;
        currentPlan.closureFallback = {
          fromProviderId: failedProviderId,
          toProviderId: fallbackId,
          reason: currentTurn.fallbackReason,
        };
        this.prepareTurnPrompt(current, currentPlan, currentTurn, current.events.map((event) => structuredClone(event)));
        this.markTurnRunning(currentTurn);
        current.updatedAt = new Date().toISOString();
        return current;
      });
      plan = session.plans.find((candidate) => candidate.id === planId);
      turn = plan.turns.find(isClosureTurn);
      this.emit("closure.fallback_started", {
        sessionId: session.id,
        planId,
        runId: options.runId || null,
        turn,
      });
      try {
        const result = await this.executeWithAutomaticRetry(session, plan, turn, options);
        return this.persistTurnSuccess(session, plan, turn, result, options, "host_fallback");
      } catch (fallbackError) {
        if (requiresExplicitRecovery(fallbackError)) {
          session = await this.persistTurnFailure(session, plan, turn, fallbackError, options);
          return this.recoverTurn(session.id, planId, turn.id, fallbackError, options);
        }
        return this.persistTurnAbsence(session, plan, turn, fallbackError, options);
      }
    }
  }

  markTurnRunning(turn, { reuseExecutionId = false } = {}) {
    turn.status = "running";
    turn.startedAt = turn.startedAt || new Date().toISOString();
    turn.failedAt = null;
    turn.error = null;
    if (reuseExecutionId && turn.executionId) {
      turn.resumingExecution = true;
      turn.executionResumeAttempts = (turn.executionResumeAttempts || 0) + 1;
      return;
    }
    turn.resumingExecution = false;
    turn.attempts = (turn.attempts || 0) + 1;
    turn.providerAttempts = turn.providerAttempts || {};
    turn.providerAttempts[turn.providerId] = (turn.providerAttempts[turn.providerId] || 0) + 1;
    turn.executionId = `${turn.id}:${turn.providerId}:${turn.providerAttempts[turn.providerId]}`;
  }

  async executeWithAutomaticRetry(session, plan, turn, options) {
    let error = null;
    for (let automaticAttempt = 0; automaticAttempt <= 1; automaticAttempt += 1) {
      try {
        const result = await this.executeProvider(session, plan, turn, options);
        const resultFailure = technicalFailureForResult(result);
        if (resultFailure) throw resultFailure;
        return result;
      } catch (caught) {
        error = technicalFailureForResult(null, caught);
        turn.attemptErrors = [
          ...(turn.attemptErrors || []),
          { providerId: turn.providerId, automaticAttempt: automaticAttempt + 1, error: serializeError(error) },
        ];
        if (automaticAttempt >= 1 || !isTechnicalFailure(error) || REPLAY_BLOCKING_PHASES.has(turn.executionPhase)) {
          throw error;
        }
        await this.checkpoint(options);
        this.emit("turn.retrying", {
          sessionId: session.id,
          planId: plan.id,
          runId: options.runId || null,
          turn,
          error: serializeError(error),
        });
        this.markTurnRunning(turn);
      }
    }
    throw error;
  }

  async persistTurnSuccess(session, plan, turn, result, options, recovery = null) {
    const content = String(result.text);
    const latestBeforeWrite = await this.store.readSession(session.id);
    const previousReplies = (latestBeforeWrite.events || []).filter((event) => event.type === "reply");
    const quality = analyzeReplyQuality(content, {
      capture: result.capture,
      previousReplies,
      originalTask: plan.originalTask,
    });
    const replyPath = await this.store.writeReply(session.id, {
      planId: plan.id,
      turnId: turn.id,
      providerId: turn.providerId,
      round: turn.round,
      content,
    });
    session = await this.store.updateSession(session.id, (current) => {
      const savedPlan = current.plans.find((candidate) => candidate.id === plan.id);
      const savedTurn = savedPlan?.turns.find((candidate) => candidate.id === turn.id);
      if (!savedPlan || !savedTurn) throw new Error("TURN_NOT_FOUND");
      Object.assign(savedTurn, turn, {
        status: "completed",
        completedAt: new Date().toISOString(),
        replyPath,
        capture: result.capture || null,
        quality: {
          flags: quality.flags,
          confidence: quality.confidence,
          lowConfidence: quality.lowConfidence,
          sideEffectsAllowed: quality.sideEffectsAllowed,
        },
        error: null,
      });
      if (recovery) savedTurn.recovery = recovery;
      for (const key of ["effectiveClosureProviderId", "closureFallback", "writeExecutorId"]) {
        if (plan[key] !== undefined) savedPlan[key] = plan[key];
      }
      applySeatProjection(current, {
        providerId: savedTurn.providerId,
        throughEventIndex: savedTurn.contextProjection?.throughEventIndex ?? current.events.length - 1,
        sync: savedTurn.contextProjection?.sync,
      }, {
        promptChars: String(savedTurn.prompt || "").length,
        replyChars: content.length,
      });
      current.updatedAt = savedTurn.completedAt;
      return current;
    });
    const savedPlan = session.plans.find((candidate) => candidate.id === plan.id);
    const savedTurn = savedPlan.turns.find((candidate) => candidate.id === turn.id);
    const event = this.createReplyEvent(session, savedPlan, savedTurn, content, recovery, quality);
    session = await this.store.appendEvents(session.id, [event]);
    if (savedTurn.executionId) {
      session = await this.upsertExecutionCheckpoint({
        sessionId: session.id,
        planId: savedPlan.id,
        turnId: savedTurn.id,
        executionId: savedTurn.executionId,
        providerId: savedTurn.providerId,
        phase: "completed",
        metadata: {
          eventId: event.id,
          replyPath,
          recovery,
        },
      });
    }
    const completedPlan = session.plans.find((candidate) => candidate.id === savedPlan.id);
    const completedTurn = completedPlan?.turns.find((candidate) => candidate.id === savedTurn.id) || savedTurn;
    this.emit("turn.completed", {
      sessionId: session.id,
      planId: savedPlan.id,
      runId: options.runId || null,
      turn: completedTurn,
      recovery,
      qualityFlags: quality.flags,
    });
    return session;
  }

  async persistTurnFailure(session, plan, turn, error, options) {
    session = await this.store.updateSession(session.id, (current) => {
      const savedPlan = current.plans.find((candidate) => candidate.id === plan.id);
      const savedTurn = savedPlan?.turns.find((candidate) => candidate.id === turn.id);
      if (!savedPlan || !savedTurn) throw new Error("TURN_NOT_FOUND");
      Object.assign(savedTurn, turn, {
        status: "failed",
        failedAt: new Date().toISOString(),
        error: serializeError(error),
      });
      current.updatedAt = savedTurn.failedAt;
      return current;
    });
    const savedPlan = session.plans.find((candidate) => candidate.id === plan.id);
    const savedTurn = savedPlan.turns.find((candidate) => candidate.id === turn.id);
    this.emit("turn.failed", {
      sessionId: session.id,
      planId: plan.id,
      runId: options.runId || null,
      turn: savedTurn,
      error: savedTurn.error,
    });
    return this.store.readSession(session.id);
  }

  async persistTurnAbsence(session, plan, turn, error, options) {
    session = await this.store.updateSession(session.id, (current) => {
      const savedPlan = current.plans.find((candidate) => candidate.id === plan.id);
      const savedTurn = savedPlan?.turns.find((candidate) => candidate.id === turn.id);
      if (!savedPlan || !savedTurn) throw new Error("TURN_NOT_FOUND");
      Object.assign(savedTurn, turn, {
        status: "absent",
        failedAt: new Date().toISOString(),
        error: serializeError(error),
      });
      current.updatedAt = savedTurn.failedAt;
      return current;
    });
    const savedPlan = session.plans.find((candidate) => candidate.id === plan.id);
    const savedTurn = savedPlan.turns.find((candidate) => candidate.id === turn.id);
    const label = getProviderLabel(savedTurn.providerId, session.participants);
    const event = {
      id: randomUUID(),
      type: "absence",
      providerId: savedTurn.providerId,
      content: `${label} 本轮缺席：${savedTurn.error.code} - ${savedTurn.error.message}`,
      commandId: savedPlan.id,
      round: savedTurn.round,
      metadata: {
        placeholder: true,
        technicalFailure: isTechnicalFailure(error),
        error: savedTurn.error,
        turnId: savedTurn.id,
        sequence: savedTurn.sequence || null,
        role: savedTurn.role,
        stage: savedTurn.stage,
        sideEffectsAllowed: false,
      },
      createdAt: new Date().toISOString(),
    };
    session = await this.store.appendEvents(session.id, [event]);
    this.emit("turn.absent", {
      sessionId: session.id,
      planId: savedPlan.id,
      runId: options.runId || null,
      turn: savedTurn,
      error: savedTurn.error,
    });
    return session;
  }

  async recoverTurn(sessionId, planId, turnId, initialError, options) {
    if (!options.runId || !this.runRegistry) throw initialError;
    let error = initialError;
    while (true) {
      const serialized = serializeError(error);
      const recoveryPromise = this.runRegistry.waitForRecovery(options.runId, { id: turnId }, error);
      let session = await this.store.updateSession(sessionId, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === planId);
        const currentTurn = currentPlan?.turns.find((candidate) => candidate.id === turnId);
        if (!currentPlan || !currentTurn) throw new Error("TURN_NOT_FOUND");
        const waitingAt = new Date().toISOString();
        currentTurn.status = "waiting_recovery";
        currentTurn.error = serialized;
        currentPlan.status = "waiting_recovery";
        current.runtime = {
          ...(current.runtime || {}),
          status: "waiting_recovery",
          activePlanId: planId,
          activeRunId: options.runId,
          failedTurnId: turnId,
          error: serialized,
        };
        current.updatedAt = waitingAt;
        return current;
      });
      const waitingPlan = session.plans.find((candidate) => candidate.id === planId);
      const waitingTurn = waitingPlan.turns.find((candidate) => candidate.id === turnId);
      this.emit("turn.waiting_recovery", {
        sessionId,
        planId,
        runId: options.runId,
        turn: waitingTurn,
        error: waitingTurn.error,
      });
      const recovery = await recoveryPromise;
      await this.checkpoint(options);
      let exhausted = null;
      session = await this.store.updateSession(sessionId, (current) => {
        const currentPlan = current.plans.find((candidate) => candidate.id === planId);
        const currentTurn = currentPlan?.turns.find((candidate) => candidate.id === turnId);
        if (!currentPlan || !currentTurn) throw new Error("TURN_NOT_FOUND");
        const resumedAt = new Date().toISOString();
        currentPlan.status = "running";
        current.runtime = {
          ...(current.runtime || {}),
          status: "running",
          activePlanId: planId,
          activeRunId: options.runId,
          failedTurnId: null,
          error: null,
        };
        if (recovery.action === "skip") {
          currentTurn.status = "skipped";
          currentTurn.skippedAt = resumedAt;
          currentTurn.recovery = "skip";
          currentTurn.error = null;
        } else if (recovery.action === "manual") {
          currentTurn.status = "running";
          currentTurn.recovery = "manual";
          currentTurn.error = null;
        } else {
          const recoveryRetryLimit = Math.max(3, Number(current.settings.retryLimit) || 0);
          currentTurn.recoveryAttempts = currentTurn.recoveryAttempts || 0;
          if (currentTurn.recoveryAttempts >= recoveryRetryLimit) {
            exhausted = new AutomationError(
              "RECOVERY_EXHAUSTED",
              `${currentTurn.providerLabel} exhausted ${recoveryRetryLimit} recovery retries.`,
              { providerId: currentTurn.providerId, recoveryRetryLimit },
            );
            currentTurn.status = "failed";
            currentTurn.failedAt = resumedAt;
            currentTurn.error = serializeError(exhausted);
          } else {
            currentTurn.recoveryAttempts += 1;
            this.markTurnRunning(currentTurn, { reuseExecutionId: Boolean(recovery.reuseExecutionId) });
            currentTurn.recovery = "retry";
          }
        }
        current.updatedAt = resumedAt;
        return current;
      });
      const refreshedPlan = session.plans.find((candidate) => candidate.id === planId);
      const refreshedTurn = refreshedPlan.turns.find((candidate) => candidate.id === turnId);
      if (recovery.action === "skip") {
        this.emit("turn.skipped", { sessionId, planId, runId: options.runId, turn: refreshedTurn });
        return session;
      }
      if (recovery.action === "manual") {
        return this.persistTurnSuccess(
          session,
          refreshedPlan,
          refreshedTurn,
          { text: recovery.content, capture: { manual: true, capturedAt: new Date().toISOString() } },
          options,
          "manual",
        );
      }
      if (exhausted) {
        this.emit("turn.failed", {
          sessionId,
          planId,
          runId: options.runId,
          turn: refreshedTurn,
          error: refreshedTurn.error,
        });
        throw exhausted;
      }
      this.emit("turn.started", { sessionId, planId, runId: options.runId, turn: refreshedTurn, recovery: "retry" });
      try {
        const result = await this.executeProvider(session, refreshedPlan, refreshedTurn, options);
        const resultFailure = technicalFailureForResult(result);
        if (resultFailure) throw resultFailure;
        return this.persistTurnSuccess(session, refreshedPlan, refreshedTurn, result, options, "retry");
      } catch (retryError) {
        error = technicalFailureForResult(null, retryError);
        session = await this.store.updateSession(sessionId, (current) => {
          const currentPlan = current.plans.find((candidate) => candidate.id === planId);
          const currentTurn = currentPlan?.turns.find((candidate) => candidate.id === turnId);
          if (!currentPlan || !currentTurn) throw new Error("TURN_NOT_FOUND");
          const failedAt = new Date().toISOString();
          Object.assign(currentTurn, refreshedTurn, {
            status: "failed",
            failedAt,
            error: serializeError(error),
          });
          current.updatedAt = failedAt;
          return current;
        });
        const failedPlan = session.plans.find((candidate) => candidate.id === planId);
        const failedTurn = failedPlan.turns.find((candidate) => candidate.id === turnId);
        this.emit("turn.failed", {
          sessionId,
          planId,
          runId: options.runId,
          turn: failedTurn,
          error: failedTurn.error,
        });
      }
    }
  }

  async mergeLatestTurnState(sessionId, sourcePlan, sourceTurn) {
    return this.store.updateSession(sessionId, (latest) => {
      const latestPlan = latest.plans.find((candidate) => candidate.id === sourcePlan.id);
      const latestTurn = latestPlan?.turns.find((candidate) => candidate.id === sourceTurn.id);
      if (!latestPlan || !latestTurn) throw new Error("TURN_NOT_FOUND");
      Object.assign(latestTurn, sourceTurn);
      for (const key of ["effectiveClosureProviderId", "closureFallback", "writeExecutorId"]) {
        if (sourcePlan[key] !== undefined) latestPlan[key] = sourcePlan[key];
      }
      latest.updatedAt = new Date().toISOString();
      return latest;
    });
  }

  async withExecutionCheckpointLock(sessionId, operation) {
    const previous = this.executionCheckpointLocks.get(sessionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.executionCheckpointLocks.set(sessionId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.executionCheckpointLocks.get(sessionId) === current) {
        this.executionCheckpointLocks.delete(sessionId);
      }
    }
  }

  async upsertExecutionCheckpoint({
    sessionId,
    planId,
    turnId,
    executionId,
    providerId,
    phase,
    metadata = {},
  }) {
    if (!executionId) throw new Error("EXECUTION_ID_REQUIRED");
    const normalizedPhase = String(phase || "").trim().toLowerCase();
    if (!normalizedPhase) throw new Error("CHECKPOINT_PHASE_REQUIRED");
    return this.withExecutionCheckpointLock(sessionId, async () => {
      return this.store.updateSession(sessionId, (session) => {
        const plan = session.plans.find((candidate) => candidate.id === planId);
        const turn = plan?.turns.find((candidate) => candidate.id === turnId);
        if (!plan || !turn) throw new Error("TURN_NOT_FOUND");
        const now = new Date().toISOString();
        const safeMetadata = cloneCheckpointMetadata(metadata);
        const checkpoints = [...(session.checkpoints || [])];
        const index = checkpoints.findIndex((candidate) => candidate.executionId === executionId);
        const existing = index >= 0 ? checkpoints[index] : null;
        const history = [...(existing?.history || [])];
        const lastHistory = history.at(-1);
        if (lastHistory?.phase === normalizedPhase) {
          history[history.length - 1] = {
            ...lastHistory,
            metadata: { ...(lastHistory.metadata || {}), ...safeMetadata },
          };
        } else {
          history.push({ phase: normalizedPhase, at: now, metadata: safeMetadata });
        }
        const checkpoint = {
          ...(existing || {}),
          executionId,
          sessionId,
          planId,
          turnId,
          providerId,
          phase: normalizedPhase,
          metadata: { ...(existing?.metadata || {}), ...safeMetadata },
          history,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        const phaseTimestamp = `${normalizedPhase}At`;
        checkpoint[phaseTimestamp] = checkpoint[phaseTimestamp] || now;
        if (index >= 0) checkpoints[index] = checkpoint;
        else checkpoints.push(checkpoint);
        session.checkpoints = checkpoints;
        turn.executionId = executionId;
        turn.executionPhase = normalizedPhase;
        turn.executionCheckpointAt = now;
        session.updatedAt = now;
        return session;
      });
    });
  }

  async executeProvider(session, plan, turn, options) {
    const checkpointBase = {
      sessionId: session.id,
      planId: plan.id,
      turnId: turn.id,
      executionId: turn.executionId,
      providerId: turn.providerId,
    };
    const resumingExecution = Boolean(turn.resumingExecution && turn.executionId);
    turn.resumingExecution = false;
    if (!resumingExecution) {
      turn.executionPhase = "prepared";
      await this.upsertExecutionCheckpoint({
        ...checkpointBase,
        phase: "prepared",
        metadata: {
          role: turn.role,
          round: turn.round,
          stage: turn.stage,
          threadKey: session.threads?.[turn.providerId]?.threadKey || null,
        },
      });
    }
    if (session.settings.mode === "mock") return { text: buildMockReply(session, plan, turn) };
    if (!this.worker?.execute) throw new Error("BROWSER_WORKER_UNAVAILABLE");
    const paths = this.store.getSessionPaths(session.id);
    return this.worker.execute({
      sessionId: session.id,
      planId: plan.id,
      turnId: turn.id,
      executionId: turn.executionId,
      runId: options.runId || null,
      providerId: turn.providerId,
      writeExecutorId: writeExecutorForTurn(plan, turn),
      threadKey: session.threads?.[turn.providerId]?.threadKey || null,
      prompt: turn.prompt,
      round: turn.round,
      sequence: turn.sequence || null,
      role: turn.role,
      stage: turn.stage,
      attempt: turn.providerAttempts?.[turn.providerId] || 1,
      contextEventIndex: turn.contextProjection?.throughEventIndex ?? null,
      timeoutMs: session.settings.executionTimeoutMs,
      settleMs: session.settings.settleMs,
      autoSend: session.settings.autoSend,
      autoCapture: session.settings.autoCapture,
      diagnosticsDir: paths.diagnostics,
      signal: options.signal,
      checkpoint: async (phase, metadata = {}) => {
        turn.executionPhase = String(phase || "").trim().toLowerCase();
        const saved = await this.upsertExecutionCheckpoint({
          ...checkpointBase,
          phase,
          metadata,
        });
        turn.executionCheckpointAt = saved.plans
          .find((candidate) => candidate.id === plan.id)
          ?.turns.find((candidate) => candidate.id === turn.id)
          ?.executionCheckpointAt || null;
      },
    });
  }

  createReplyEvent(session, plan, turn, content, recovery = null, quality = null) {
    return {
      id: randomUUID(),
      type: "reply",
      providerId: turn.providerId,
      content,
      commandId: plan.id,
      round: turn.round,
      metadata: {
        executionMode: session.settings.mode,
        conversationMode: plan.conversationMode,
        turnId: turn.id,
        sequence: turn.sequence || null,
        role: turn.role,
        stage: turn.stage,
        visibleClosure: isClosureTurn(turn),
        countsTowardRounds: turn.countsTowardRounds,
        replyPath: turn.replyPath || null,
        recovery,
        qualityFlags: quality?.flags || [],
        confidence: quality?.confidence || "candidate",
        verified: false,
        sideEffectsAllowed: quality?.sideEffectsAllowed ?? true,
        contextEventIndex: turn.contextProjection?.throughEventIndex ?? null,
        fallbackFromProviderId: turn.fallbackFromProviderId || null,
        fallbackReason: turn.fallbackReason || null,
      },
      createdAt: new Date().toISOString(),
    };
  }
}

export { buildMockReply, serializeError };
