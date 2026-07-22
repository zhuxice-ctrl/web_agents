const INTERNAL_REPLY_TYPES = new Set([
  "reply.raw_captured",
  "reply.validated",
  "reply.rejected",
]);

const DANGEROUS_FLAGS = new Set([
  "prompt_echo",
  "truncated",
  "mojibake",
  "duplicate_content",
  "possible_off_topic",
  "self_promotion",
]);

export function isCommittedReplyEvent(event) {
  return event?.type === "reply"
    && event?.metadata?.commitStatus !== "rejected"
    && event?.metadata?.lifecycle !== "rejected";
}

export function isContextEvent(event) {
  if (INTERNAL_REPLY_TYPES.has(event?.type)) return false;
  if (event?.type === "reply") return isCommittedReplyEvent(event);
  return true;
}

export function normalizeReplyIdentity({ providerId, content, capture = {}, capturedAt = null } = {}) {
  const providerMessageId = capture.providerMessageId
    || capture.messageId
    || capture.messageKey
    || null;
  const domIdentity = capture.domIdentity
    || capture.identity
    || (capture.selector || capture.index !== undefined ? `${capture.selector || "candidate"}:${capture.index ?? ""}` : null);
  const role = capture.role || capture.speaker || "assistant";
  const status = capture.status || (capture.complete === false ? "streaming" : "complete");
  return {
    providerMessageId: providerMessageId ? String(providerMessageId) : null,
    role: String(role || "unknown"),
    text: String(content || ""),
    status: String(status),
    replyToUserMessageId: capture.replyToUserMessageId || capture.userMessageId || null,
    conversationId: capture.conversationId || capture.threadId || null,
    domIdentity: domIdentity ? String(domIdentity) : null,
    capturedAt: capturedAt || capture.capturedAt || capture.settledAt || new Date().toISOString(),
  };
}

export function decideReplyCommit({ strict = false, structureStatus = "unknown", quality = null, identity = null, recovery = null } = {}) {
  if (!strict) return { status: "committed", reason: "compatibility_mode" };
  if (recovery) return { status: "committed", reason: "manual_recovery" };
  if (identity?.role && identity.role !== "assistant") return { status: "rejected", reason: "ROLE_UNVERIFIED" };
  const codes = new Set((quality?.flags || []).map((flag) => typeof flag === "string" ? flag : flag?.code));
  const dangerous = [...codes].find((code) => DANGEROUS_FLAGS.has(code));
  if (dangerous) return { status: "rejected", reason: dangerous.toUpperCase() };
  return { status: "committed", reason: "validated" };
}

export function lifecycleEventType(status) {
  if (status === "committed") return "reply";
  return "reply.rejected";
}

export { DANGEROUS_FLAGS, INTERNAL_REPLY_TYPES };
