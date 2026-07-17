import { DEFAULT_SETTINGS } from "../core/providers.mjs";

function clampIndex(value, total, fallback = -1) {
  const numeric = Number.parseInt(String(value), 10);
  const maximum = Math.max(-1, total - 1);
  if (!Number.isInteger(numeric)) return Math.min(maximum, Math.max(-1, fallback));
  return Math.min(maximum, Math.max(-1, numeric));
}

function numericValue(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return 0;
}

function eventIsPublic(event) {
  return event?.metadata?.visibility !== "private" && event?.visibility !== "private";
}

function seatThread(session, providerId) {
  return session?.threads?.[providerId] || null;
}

export function getSeatEventIndex(session, providerId) {
  const total = session?.events?.length || 0;
  const thread = seatThread(session, providerId);
  const contextCursor = session?.context?.seatCursors?.[providerId];
  const value = thread?.lastDeliveredEventIndex
    ?? thread?.lastDeliveredEventCursor
    ?? (typeof contextCursor === "object" ? contextCursor.index ?? contextCursor.cursor : contextCursor)
    ?? -1;
  return clampIndex(value, total);
}

export function getSeatSyncStatus(session, providerId) {
  const total = session?.events?.length || 0;
  const currentIndex = getSeatEventIndex(session, providerId);
  const current = currentIndex + 1;
  return {
    exact: true,
    current,
    total,
    pending: Math.max(0, total - current),
  };
}

export function estimateSeatCapacity(session, providerId, options = {}) {
  const thread = seatThread(session, providerId) || {};
  const usage = thread.usage || {};
  const sentChars = numericValue(thread.deliveredChars, usage.sentChars, usage.promptChars, thread.sentChars);
  const capturedChars = numericValue(thread.capturedChars, usage.capturedChars, usage.replyChars);
  const projectedChars = numericValue(options.projectedPromptChars) + numericValue(options.projectedReplyChars);
  const usedChars = Math.round(sentChars + capturedChars + projectedChars);
  const capacityChars = Math.max(1, Math.round(numericValue(
    thread.estimatedCapacityChars,
    thread.capacityEstimateChars,
    session?.settings?.estimatedThreadCapacityChars,
    DEFAULT_SETTINGS.estimatedThreadCapacityChars,
  )));
  const percent = Math.min(100, Math.round((usedChars / capacityChars) * 100));
  const warning = numericValue(
    session?.settings?.handoffWarningPercent,
    session?.settings?.handoffThreshold,
    DEFAULT_SETTINGS.handoffWarningPercent,
  );
  const urgent = numericValue(
    session?.settings?.handoffUrgentPercent,
    session?.settings?.urgentHandoffThreshold,
    DEFAULT_SETTINGS.handoffUrgentPercent,
  );
  const advice = percent >= urgent ? "handoff_soon" : percent >= warning ? "consider_handoff" : "continue";
  return {
    estimated: true,
    unit: "characters",
    usedChars,
    capacityChars,
    remainingChars: Math.max(0, capacityChars - usedChars),
    percent,
    advice,
  };
}

function publicStateFrom(session) {
  const context = session?.context || {};
  return {
    requirements: Array.isArray(context.requirements) ? [...context.requirements] : [],
    consensus: Array.isArray(context.consensus) ? [...context.consensus] : [],
    disagreements: Array.isArray(context.disagreements) ? [...context.disagreements] : [],
    evidence: Array.isArray(context.evidence) ? [...context.evidence] : [],
    decisions: Array.isArray(context.decisions) ? [...context.decisions] : [],
    summaries: Array.isArray(context.summaries) ? structuredClone(context.summaries) : [],
  };
}

export function projectContextForSeat(session, providerId, options = {}) {
  const allEvents = Array.isArray(session?.events) ? session.events : [];
  const total = allEvents.length;
  const currentIndex = getSeatEventIndex(session, providerId);
  const requestedThroughIndex = options.throughEventIndex !== undefined
    ? options.throughEventIndex
    : options.throughCursor !== undefined ? Number(options.throughCursor) - 1 : undefined;
  const projectedIndex = clampIndex(
    requestedThroughIndex,
    total,
    total - 1,
  );
  const boundedProjectedIndex = Math.max(currentIndex, projectedIndex);
  const recentLimit = Math.max(0, Number.parseInt(
    String(options.recentRawEventLimit ?? session?.settings?.recentRawEvents ?? DEFAULT_SETTINGS.recentRawEvents),
    10,
  ) || 0);
  const events = allEvents
    .slice(currentIndex + 1, boundedProjectedIndex + 1)
    .filter(eventIsPublic)
    .map((event) => structuredClone(event));
  const recentEvents = recentLimit
    ? allEvents
      .slice(Math.max(0, boundedProjectedIndex - recentLimit + 1), boundedProjectedIndex + 1)
      .filter(eventIsPublic)
      .map((event) => structuredClone(event))
    : [];
  const promptStartIndex = Math.min(
    currentIndex + 1,
    Math.max(0, boundedProjectedIndex - recentLimit + 1),
  );
  const promptEvents = allEvents
    .slice(promptStartIndex, boundedProjectedIndex + 1)
    .filter(eventIsPublic)
    .map((event) => structuredClone(event));
  const projectedText = promptEvents.reduce((totalChars, event) =>
    totalChars + String(event?.content || "").length, 0);

  return {
    providerId,
    fromEventIndex: currentIndex,
    throughEventIndex: boundedProjectedIndex,
    events,
    deltaEvents: events,
    recentEvents,
    promptEvents,
    publicState: publicStateFrom(session),
    sync: {
      exact: true,
      current: currentIndex + 1,
      projected: boundedProjectedIndex + 1,
      total,
      pending: Math.max(0, total - (currentIndex + 1)),
      remainingAfterProjection: Math.max(0, total - (boundedProjectedIndex + 1)),
    },
    capacity: estimateSeatCapacity(session, providerId, { projectedPromptChars: projectedText }),
  };
}

export const projectSeatContext = projectContextForSeat;

function ensureSeatContainers(session) {
  session.context = session.context && typeof session.context === "object" ? session.context : {};
  session.context.seatCursors = session.context.seatCursors && typeof session.context.seatCursors === "object"
    ? session.context.seatCursors
    : {};
  session.threads = session.threads && typeof session.threads === "object" ? session.threads : {};
}

export function initializeSeatContext(session, providerId, options = {}) {
  ensureSeatContainers(session);
  const joinPolicy = options.joinPolicy === "from_now" ? "from_now" : "full_history";
  const initialIndex = joinPolicy === "from_now" ? (session.events?.length || 0) - 1 : -1;
  const existing = session.threads[providerId] || {};
  const hasExistingIndex = existing.lastDeliveredEventIndex !== undefined
    || existing.lastDeliveredEventCursor !== undefined
    || session.context.seatCursors[providerId] !== undefined;
  const lastDeliveredEventIndex = hasExistingIndex ? getSeatEventIndex(session, providerId) : initialIndex;
  const deliveredChars = numericValue(existing.deliveredChars, existing.usage?.sentChars, existing.usage?.promptChars);
  const capturedChars = numericValue(existing.capturedChars, existing.usage?.capturedChars, existing.usage?.replyChars);
  const interactionCount = numericValue(existing.interactionCount, existing.usage?.interactions);
  session.context.seatCursors[providerId] = lastDeliveredEventIndex;
  session.threads[providerId] = {
    ...existing,
    id: options.threadId ?? existing.id ?? null,
    threadKey: options.threadKey ?? existing.threadKey ?? null,
    providerId,
    status: options.status ?? existing.status ?? "not_open",
    joinPolicy,
    lastDeliveredEventIndex,
    deliveredChars,
    capturedChars,
    interactionCount,
    usage: {
      sentChars: deliveredChars,
      capturedChars,
      interactions: interactionCount,
    },
  };
  return session.threads[providerId];
}

export function applySeatProjection(session, projection, usageDelta = {}) {
  if (!projection?.providerId) throw new Error("PROJECTION_PROVIDER_REQUIRED");
  ensureSeatContainers(session);
  const providerId = projection.providerId;
  if (!session.threads[providerId]) initializeSeatContext(session, providerId, { joinPolicy: "full_history" });
  const thread = session.threads[providerId];
  const projectedFromSync = projection.sync?.projected === undefined
    ? undefined
    : Number(projection.sync.projected) - 1;
  const nextIndex = clampIndex(
    projection.throughEventIndex ?? projectedFromSync,
    session.events?.length || projection.sync?.total || 0,
    getSeatEventIndex(session, providerId),
  );
  const usage = thread.usage || {};
  const deliveredChars = numericValue(thread.deliveredChars, usage.sentChars, usage.promptChars)
    + numericValue(usageDelta.promptChars);
  const capturedChars = numericValue(thread.capturedChars, usage.capturedChars, usage.replyChars)
    + numericValue(usageDelta.replyChars);
  const interactionCount = numericValue(thread.interactionCount, usage.interactions)
    + (usageDelta.recordInteraction === false ? 0 : 1);
  thread.lastDeliveredEventIndex = nextIndex;
  thread.deliveredChars = deliveredChars;
  thread.capturedChars = capturedChars;
  thread.interactionCount = interactionCount;
  thread.usage = {
    sentChars: deliveredChars,
    capturedChars,
    interactions: interactionCount,
  };
  thread.capacity = estimateSeatCapacity(session, providerId);
  session.context.seatCursors[providerId] = nextIndex;
  return thread;
}

export function advanceSeatCursor(session, providerId, eventIndex, usageDelta = {}) {
  return applySeatProjection(session, {
    providerId,
    throughEventIndex: eventIndex,
    sync: { projected: eventIndex, total: session?.events?.length || 0 },
  }, usageDelta);
}
