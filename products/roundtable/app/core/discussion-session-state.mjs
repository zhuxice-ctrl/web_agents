function stateError(code) {
  return Object.assign(new Error(code), { code });
}

function participantIds(session) {
  return new Set((session?.participants || []).map((participant) => participant.id));
}

function cleanRole(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function cleanContent(value) {
  const content = String(value || "").trim();
  if (!content) throw stateError("EMPTY_INTERVENTION_CONTENT");
  if (content.length > 4000) throw stateError("INTERVENTION_TOO_LONG");
  return content;
}

export function setDefaultSeatRole(session, { providerId, role } = {}) {
  const id = String(providerId || "");
  if (!participantIds(session).has(id)) throw stateError("PARTICIPANT_NOT_FOUND");
  session.participantRoles = { ...(session.participantRoles || {}) };
  const normalized = cleanRole(role);
  if (normalized) session.participantRoles[id] = normalized;
  else delete session.participantRoles[id];
  return normalized;
}

export function normalizeRoleOverrides(session, overrides = {}, selectedProviderIds = null) {
  const seated = participantIds(session);
  const selected = selectedProviderIds ? new Set(selectedProviderIds) : seated;
  const normalized = {};
  for (const [providerId, role] of Object.entries(overrides || {})) {
    if (!seated.has(providerId) || !selected.has(providerId)) throw stateError("ROLE_OVERRIDE_PROVIDER_NOT_SELECTED");
    const value = cleanRole(role);
    if (value) normalized[providerId] = value;
  }
  return normalized;
}

export function resolveSeatRole(session, providerId, overrides = {}) {
  return cleanRole(overrides?.[providerId]) || cleanRole(session?.participantRoles?.[providerId]) || "";
}

export function queueIntervention(session, { id, planId, content, now = new Date().toISOString() } = {}) {
  const interventionId = String(id || "").trim();
  const targetPlanId = String(planId || "").trim();
  if (!interventionId) throw stateError("INTERVENTION_ID_REQUIRED");
  if (!targetPlanId) throw stateError("PLAN_ID_REQUIRED");
  session.pendingInterventions = [...(session.pendingInterventions || [])];
  if (session.pendingInterventions.some((item) => item.id === interventionId)) throw stateError("INTERVENTION_ALREADY_EXISTS");
  const item = {
    id: interventionId,
    planId: targetPlanId,
    content: cleanContent(content),
    status: "pending",
    createdAt: String(now),
    updatedAt: String(now),
  };
  session.pendingInterventions.push(item);
  return structuredClone(item);
}

export function updateIntervention(session, { id, content, now = new Date().toISOString() } = {}) {
  const item = (session.pendingInterventions || []).find((candidate) => candidate.id === String(id || ""));
  if (!item || item.status !== "pending") throw stateError("INTERVENTION_NOT_PENDING");
  item.content = cleanContent(content);
  item.updatedAt = String(now);
  return structuredClone(item);
}

export function removeIntervention(session, { id } = {}) {
  const interventionId = String(id || "");
  const index = (session.pendingInterventions || []).findIndex((candidate) => candidate.id === interventionId);
  if (index < 0 || session.pendingInterventions[index].status !== "pending") throw stateError("INTERVENTION_NOT_PENDING");
  const [removed] = session.pendingInterventions.splice(index, 1);
  return structuredClone(removed);
}

export function pendingInterventionsForPlan(session, planId) {
  return (session?.pendingInterventions || [])
    .filter((item) => item.planId === planId && item.status === "pending")
    .map((item) => structuredClone(item));
}

export function consumePendingInterventions(session, { planId } = {}) {
  const consumed = [];
  session.pendingInterventions = (session.pendingInterventions || []).filter((item) => {
    if (item.planId !== planId || item.status !== "pending") return true;
    consumed.push(structuredClone(item));
    return false;
  });
  return consumed;
}
