const ACTIVE_PLAN_STATUSES = new Set(["planned", "running", "waiting_recovery", "awaiting_continuation", "completed"]);

function latestDiscussionPlan(session) {
  return [...(session?.plans || [])].reverse().find((plan) =>
    plan?.conversationMode === "discussion" && ACTIVE_PLAN_STATUSES.has(plan.status)
  ) || null;
}

function currentCycle(plan) {
  if (!plan) return null;
  return (plan.cycles || []).find((cycle) => cycle.number === plan.currentCycle)
    || (plan.cycles || []).at(-1)
    || null;
}

export function resolveDiscussionView(session) {
  const plan = latestDiscussionPlan(session);
  const cycle = currentCycle(plan);
  const cycleTurns = (cycle?.turnIds || [])
    .map((turnId) => plan?.turns?.find((turn) => turn.id === turnId))
    .filter(Boolean);
  const seats = {};
  for (const participant of session?.participants || []) {
    const turn = cycleTurns.find((candidate) => candidate.providerId === participant.id);
    const state = turn?.status === "passed"
      ? "listening"
      : turn?.status === "running"
        ? "speaking"
        : turn?.status === "completed"
          ? "responded"
          : turn?.status === "absent"
            ? "absent"
            : "waiting";
    seats[participant.id] = {
      providerId: participant.id,
      state,
      role: plan?.roleOverrides?.[participant.id] || session?.participantRoles?.[participant.id] || "",
    };
  }
  const replyRelations = (session?.events || []).flatMap((event) =>
    (event.metadata?.replyRelations || []).map((relation) => ({
      sourceEventId: event.id,
      providerId: relation.providerId,
      eventId: relation.eventId,
      extraction: relation.extraction || "explicit_name",
    }))
  );
  return {
    plan,
    cycle,
    progress: {
      current: Number(cycle?.number || 0),
      maximum: Number(plan?.maxCycles || plan?.rounds || 0),
      spoken: cycleTurns.filter((turn) => turn.status === "completed").length,
      passed: cycleTurns.filter((turn) => turn.status === "passed").length,
    },
    seats,
    pendingInterventions: (session?.pendingInterventions || [])
      .filter((item) => !plan || item.planId === plan.id)
      .map((item) => ({ ...item })),
    replyRelations,
  };
}
