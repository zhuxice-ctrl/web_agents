import { randomUUID } from "node:crypto";

import { getProviderLabel } from "../core/providers.mjs";

const TERMINAL_PARTICIPATION = new Set(["completed", "passed", "absent", "skipped", "cancelled"]);

function addressedByPriorCycle(plan, session, providerId, cycleNumber) {
  if (cycleNumber <= 1) return [];
  return (session.events || [])
    .filter((event) =>
      event.commandId === plan.id
      && Number(event.round) === cycleNumber - 1
      && event.type === "reply"
      && (event.metadata?.replyRelations || []).some((relation) => relation.providerId === providerId)
    )
    .map((event) => event.id)
    .filter(Boolean);
}

export function createDiscussionTurn(plan, session, providerId, cycleNumber, { idFactory = randomUUID } = {}) {
  const id = idFactory();
  const addressedByEventIds = addressedByPriorCycle(plan, session, providerId, cycleNumber);
  return {
    id,
    commandId: plan.id,
    round: cycleNumber,
    cycleNumber,
    sequence: null,
    providerId,
    providerLabel: getProviderLabel(providerId, session.participants),
    role: "discussion",
    stage: cycleNumber === 1 ? "independent_position" : "cross_discussion",
    countsTowardRounds: true,
    mustRespond: addressedByEventIds.length > 0,
    addressedByEventIds,
    status: "planned",
    prompt: null,
    attempts: 0,
    providerAttempts: {},
    idempotencyKey: `roundtable-turn:${id}`,
    attemptId: null,
    sendState: "NOT_SENT",
  };
}

export function createDiscussionCycle(plan, session, {
  cycleNumber,
  snapshotThroughEventIndex = (session.events || []).length - 1,
  idFactory = randomUUID,
  now = new Date().toISOString(),
} = {}) {
  const number = Math.max(1, Number(cycleNumber || 1));
  const turns = (plan.targets || []).map((providerId) =>
    createDiscussionTurn(plan, session, providerId, number, { idFactory })
  );
  const addressedProviderIds = turns.filter((turn) => turn.mustRespond).map((turn) => turn.providerId);
  return {
    number,
    status: "planned",
    snapshotThroughEventIndex,
    turnIds: turns.map((turn) => turn.id),
    addressedProviderIds,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    spokenCount: 0,
    passedCount: 0,
    absentCount: 0,
    turns,
  };
}

export function appendDiscussionCycle(plan, session, options = {}) {
  const created = createDiscussionCycle(plan, session, options);
  const { turns, ...cycle } = created;
  plan.cycles = [...(plan.cycles || []), cycle];
  plan.turns = [...(plan.turns || []), ...turns];
  plan.currentCycle = cycle.number;
  return cycle;
}

export function summarizeDiscussionCycle(plan, cycle) {
  const turns = (cycle?.turnIds || []).map((turnId) => plan.turns.find((turn) => turn.id === turnId)).filter(Boolean);
  return {
    terminal: turns.length > 0 && turns.every((turn) => TERMINAL_PARTICIPATION.has(turn.status)),
    results: turns.map((turn) => turn.status === "completed" ? "spoken" : turn.status),
    spokenCount: turns.filter((turn) => turn.status === "completed").length,
    passedCount: turns.filter((turn) => turn.status === "passed").length,
    absentCount: turns.filter((turn) => turn.status === "absent").length,
  };
}

export function decideCycleContinuation({
  results = [],
  hasPendingInterventions = false,
  cycleNumber = 1,
  maxCycles = 5,
} = {}) {
  if (Number(cycleNumber) >= Number(maxCycles)) {
    return hasPendingInterventions ? "awaiting_capacity" : "close";
  }
  if (hasPendingInterventions) return "continue";
  const participating = results.filter((status) => status !== "absent" && status !== "skipped" && status !== "cancelled");
  if (participating.length > 0 && participating.every((status) => status === "passed")) return "close";
  return "continue";
}
