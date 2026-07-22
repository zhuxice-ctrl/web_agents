const ACTIVE_PLAN_STATUSES = new Set(["running", "waiting_recovery", "paused"]);

export function resolveRoundtableCommand(session = {}) {
  const activePlan = [...(session.plans || [])]
    .reverse()
    .find((plan) => ACTIVE_PLAN_STATUSES.has(plan?.status) && String(plan.commandText || "").trim());
  if (activePlan) return String(activePlan.commandText).trim();

  const latestCommand = [...(session.events || [])]
    .reverse()
    .find((event) => event?.type === "command" && String(event.content || "").trim());
  if (latestCommand) return String(latestCommand.content).trim();

  return String(session.objective || "等待第一条指令").trim() || "等待第一条指令";
}
