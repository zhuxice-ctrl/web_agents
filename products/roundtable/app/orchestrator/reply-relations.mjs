import { extractProviderReferences } from "./command-parser.mjs";
import { isCommittedReplyEvent } from "./reply-lifecycle.mjs";

export function extractReplyRelations({
  content,
  sourceProviderId,
  commandId,
  participants = [],
  events = [],
} = {}) {
  const providerIds = extractProviderReferences(content, { providers: participants })
    .filter((providerId) => providerId !== sourceProviderId);
  return providerIds.flatMap((providerId) => {
    const target = [...events].reverse().find((event) =>
      event.providerId === providerId
      && event.commandId === commandId
      && isCommittedReplyEvent(event)
    );
    return target ? [{ providerId, eventId: target.id, extraction: "explicit_name" }] : [];
  });
}
