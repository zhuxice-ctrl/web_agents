import { buildFinalSummaryPacket, buildParticipantContextPacket } from "../sessions/context-packet";
import { appendRoundtableMessage, markRoundtableParticipantState } from "../sessions/roundtable";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import type { ProviderId, RoundtableSession } from "../shared/types";

type SendToTab = <T extends ExtensionRequest["type"]>(
  request: ExtensionRequest,
  senderTabId?: number
) => Promise<ExtensionResponse<T>>;

type RoundtableOrchestratorDeps = {
  sendToTab: SendToTab;
};

type RoundtableOrchestrator = {
  importMainContext(session: RoundtableSession): Promise<RoundtableSession>;
  step(session: RoundtableSession): Promise<RoundtableSession>;
  capture(session: RoundtableSession, provider: ProviderId): Promise<RoundtableSession>;
  summarize(session: RoundtableSession): Promise<RoundtableSession>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function participantTabId(session: RoundtableSession, provider: ProviderId): number | undefined {
  if (provider === session.mainProvider) {
    return session.mainTabId ?? session.participants.find((participant) => participant.provider === provider)?.tabId;
  }

  return session.participants.find((participant) => participant.provider === provider)?.tabId;
}

function enabledParticipants(session: RoundtableSession): ProviderId[] {
  return session.participants
    .filter((participant) => participant.enabled && participant.role !== "main")
    .map((participant) => participant.provider);
}

function firstEnabledParticipant(session: RoundtableSession): ProviderId | undefined {
  return enabledParticipants(session)[0];
}

function pauseWithProviderError(
  session: RoundtableSession,
  provider: ProviderId,
  error: string
): RoundtableSession {
  return {
    ...markRoundtableParticipantState(session, provider, "error", { error }),
    state: "paused"
  };
}

function nextAfterCapture(session: RoundtableSession, provider: ProviderId): RoundtableSession["plan"] {
  if (provider !== session.mainProvider) {
    return {
      ...session.plan,
      nextProvider: session.mainProvider
    };
  }

  const nextRound = session.plan.currentRound + 1;
  if (nextRound > session.plan.maxRounds) {
    return {
      ...session.plan,
      currentRound: session.plan.maxRounds,
      nextProvider: undefined
    };
  }

  return {
    ...session.plan,
    currentRound: nextRound,
    nextProvider: firstEnabledParticipant(session)
  };
}

function instructionForTurn(session: RoundtableSession, provider: ProviderId): string {
  if (provider === session.mainProvider) {
    return "Please respond to the other model's latest view, correct weak points, and move the discussion toward an actionable plan.";
  }

  return `Please discuss round ${session.plan.currentRound} with ${session.mainProvider}, point out risks or missing assumptions, and give concrete suggestions.`;
}

function isLateJoin(session: RoundtableSession, provider: ProviderId): boolean {
  if (provider === session.mainProvider) return false;
  const firstParticipant = firstEnabledParticipant(session);
  if (provider === firstParticipant) return false;
  return session.messages.some((message) => message.provider && message.provider !== provider);
}

export function createRoundtableOrchestrator(deps: RoundtableOrchestratorDeps): RoundtableOrchestrator {
  async function importMainContext(session: RoundtableSession): Promise<RoundtableSession> {
    const response = await deps.sendToTab<"tab:capture-recent">({
      type: "tab:capture-recent",
      tabId: session.mainTabId,
      limit: 8
    });

    if (!response.ok) {
      return {
        ...session,
        state: "paused",
        updatedAt: nowIso()
      };
    }

    let nextSession = session;
    for (const message of response.data.messages) {
      const isAssistant = message.speaker === "assistant";
      nextSession = appendRoundtableMessage(nextSession, {
        speaker: isAssistant ? response.data.provider : message.speaker === "user" ? "user" : "system",
        provider: isAssistant ? response.data.provider : undefined,
        text: message.text,
        source: "main_window_import"
      });
    }

    return {
      ...nextSession,
      importedContextAt: response.data.capturedAt,
      state: "ready",
      updatedAt: nowIso()
    };
  }

  async function step(session: RoundtableSession): Promise<RoundtableSession> {
    const provider = session.plan.nextProvider;
    if (!provider || provider === "unknown") {
      return {
        ...session,
        state: "paused",
        updatedAt: nowIso()
      };
    }

    const sendingSession = {
      ...markRoundtableParticipantState(session, provider, "sending"),
      state: "running" as const
    };
    const packet = buildParticipantContextPacket(sendingSession, {
      targetProvider: provider,
      turnInstruction: instructionForTurn(sendingSession, provider),
      isLateJoin: isLateJoin(sendingSession, provider),
      maxCharacters: 6000
    });
    const response = await deps.sendToTab<"tab:auto-send-text">({
      type: "tab:auto-send-text",
      tabId: participantTabId(sendingSession, provider),
      text: packet
    });

    if (!response.ok) {
      return pauseWithProviderError(sendingSession, provider, response.error);
    }

    if (response.data.state !== "sent") {
      return pauseWithProviderError(sendingSession, provider, response.data.message);
    }

    return {
      ...markRoundtableParticipantState(sendingSession, provider, "waiting_response"),
      state: "running"
    };
  }

  async function capture(session: RoundtableSession, provider: ProviderId): Promise<RoundtableSession> {
    const response = await deps.sendToTab<"tab:capture-latest">({
      type: "tab:capture-latest",
      tabId: participantTabId(session, provider)
    });

    if (!response.ok) {
      return pauseWithProviderError(session, provider, response.error);
    }

    const withMessage = appendRoundtableMessage(session, {
      speaker: provider,
      provider,
      text: response.data.text,
      source: "provider_capture",
      round: session.plan.currentRound
    });
    const marked = markRoundtableParticipantState(withMessage, provider, "captured", {
      lastCapturedMessageId: withMessage.messages.at(-1)?.id
    });

    return {
      ...marked,
      state: marked.plan.nextProvider ? "running" : "ready",
      plan: nextAfterCapture(marked, provider)
    };
  }

  async function summarize(session: RoundtableSession): Promise<RoundtableSession> {
    const provider = session.plan.finalSummarizer;
    const sendingSession = {
      ...markRoundtableParticipantState(session, provider, "sending"),
      state: "summarizing" as const
    };
    const response = await deps.sendToTab<"tab:auto-send-text">({
      type: "tab:auto-send-text",
      tabId: participantTabId(sendingSession, provider),
      text: buildFinalSummaryPacket(sendingSession, { maxCharacters: 8000 })
    });

    if (!response.ok) {
      return pauseWithProviderError(sendingSession, provider, response.error);
    }

    if (response.data.state !== "sent") {
      return pauseWithProviderError(sendingSession, provider, response.data.message);
    }

    return {
      ...markRoundtableParticipantState(sendingSession, provider, "waiting_response"),
      state: "summarizing"
    };
  }

  return {
    importMainContext,
    step,
    capture,
    summarize
  };
}
