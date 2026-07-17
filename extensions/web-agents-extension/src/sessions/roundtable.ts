import { getDefaultParticipants } from "../providers/catalog";
import type {
  ProviderId,
  RoundtableCreateInput,
  RoundtableMessage,
  RoundtableParticipant,
  RoundtableParticipantState,
  RoundtableSession
} from "../shared/types";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTitle(title: string): string {
  return title.trim().slice(0, 48) || "未命名圆桌会话";
}

function createParticipants(input: RoundtableCreateInput): RoundtableParticipant[] {
  const selected = new Set<ProviderId>([input.mainProvider, ...input.participantProviders]);
  return getDefaultParticipants()
    .filter((participant) => participant.provider !== "unknown")
    .map((participant) => {
      const isMain = participant.provider === input.mainProvider;
      const enabled = selected.has(participant.provider);

      return {
        provider: participant.provider,
        label: participant.label,
        role: isMain ? "main" : "participant",
        enabled,
        tabId: isMain ? input.mainTabId : undefined,
        state: enabled ? "ready" : "not_open"
      };
    });
}

export function createRoundtableSession(input: RoundtableCreateInput): RoundtableSession {
  const createdAt = nowIso();
  const firstParticipant = input.participantProviders[0] ?? input.mainProvider;

  return {
    id: createId("roundtable"),
    title: normalizeTitle(input.title),
    mainProvider: input.mainProvider,
    mainTabId: input.mainTabId,
    createdAt,
    updatedAt: createdAt,
    state: "ready",
    participants: createParticipants(input),
    plan: {
      objective: input.objective.trim(),
      maxRounds: input.maxRounds,
      currentRound: 1,
      nextProvider: firstParticipant,
      finalSummarizer: input.mainProvider,
      mode: "automatic"
    },
    messages: []
  };
}

export function appendRoundtableMessage(
  session: RoundtableSession,
  message: Omit<RoundtableMessage, "id" | "sessionId" | "createdAt">
): RoundtableSession {
  const createdAt = nowIso();

  return {
    ...session,
    updatedAt: createdAt,
    messages: [
      ...session.messages,
      {
        ...message,
        id: createId("rt-msg"),
        sessionId: session.id,
        createdAt
      }
    ]
  };
}

export function joinRoundtableParticipant(
  session: RoundtableSession,
  provider: ProviderId,
  tabId?: number
): RoundtableSession {
  const updatedAt = nowIso();

  return {
    ...session,
    updatedAt,
    participants: session.participants.map((participant) =>
      participant.provider === provider
        ? {
            ...participant,
            enabled: true,
            tabId: tabId ?? participant.tabId,
            state: "ready",
            error: undefined
          }
        : participant
    )
  };
}

export function markRoundtableParticipantState(
  session: RoundtableSession,
  provider: ProviderId,
  state: RoundtableParticipantState,
  patch: Partial<RoundtableParticipant> = {}
): RoundtableSession {
  const updatedAt = nowIso();

  return {
    ...session,
    updatedAt,
    participants: session.participants.map((participant) =>
      participant.provider === provider ? { ...participant, ...patch, state } : participant
    )
  };
}

export function getNextRoundtableProvider(session: RoundtableSession): ProviderId | undefined {
  return session.plan.nextProvider;
}
