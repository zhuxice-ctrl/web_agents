import type { ProviderId, RoundtableParticipantState, RoundtableSession } from "../../shared/types";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";

type RoundtableSessionPanelProps = {
  session?: RoundtableSession;
  currentProvider: ProviderId;
  objective: string;
  guidance: string;
  t(key: string): string;
  onObjectiveChange(value: string): void;
  onGuidanceChange(value: string): void;
  onCreate(): void;
  onImport(): void;
  onStart(): void;
  onPause(): void;
  onStep(): void;
  onCapture(provider: ProviderId): void;
  onAddParticipant(provider: ProviderId): void;
  onSummarize(): void;
  onAddGuidance(): void;
};

const toneByState: Record<RoundtableParticipantState, "neutral" | "success" | "warning" | "danger"> = {
  not_open: "neutral",
  opening: "warning",
  ready: "success",
  sending: "warning",
  waiting_response: "warning",
  captured: "success",
  paused: "warning",
  error: "danger"
};

const pinnedProviders = new Set<ProviderId>(["chatgpt", "deepseek", "gemini", "doubao"]);

export function RoundtableSessionPanel({
  session,
  currentProvider,
  objective,
  guidance,
  t,
  onObjectiveChange,
  onGuidanceChange,
  onCreate,
  onImport,
  onStart,
  onPause,
  onStep,
  onCapture,
  onAddParticipant,
  onSummarize,
  onAddGuidance
}: RoundtableSessionPanelProps) {
  const hasSession = Boolean(session);
  const currentRound = session?.plan.currentRound ?? 1;
  const maxRounds = session?.plan.maxRounds ?? 5;
  const nextProvider = session?.plan.nextProvider ?? "unknown";
  const visibleParticipants =
    session?.participants.filter((participant) => participant.enabled || pinnedProviders.has(participant.provider)) ?? [];

  return (
    <Section
      title={t("roundtable.title")}
      action={
        <button className="ghost-button" onClick={onCreate}>
          {t("roundtable.create")}
        </button>
      }
    >
      <p className="muted-text">{t("roundtable.subtitle")}</p>

      <div className="roundtable-shell">
        <aside className="roundtable-rail">
          <label className="roundtable-label" htmlFor="roundtable-objective">
            {t("roundtable.objective")}
          </label>
          <textarea
            id="roundtable-objective"
            className="roundtable-objective"
            placeholder={t("roundtable.objectivePlaceholder")}
            value={objective}
            onChange={(event) => onObjectiveChange(event.target.value)}
          />

          <div className="roundtable-fact">
            <span>{t("roundtable.mainWindow")}</span>
            <strong>{currentProvider === "unknown" ? t("common.unknown") : currentProvider}</strong>
          </div>
          <div className="roundtable-fact">
            <span>{t("roundtable.round")}</span>
            <strong>
              {currentRound} / {maxRounds}
            </strong>
          </div>
          <div className="roundtable-fact">
            <span>{t("roundtable.next")}</span>
            <strong>{nextProvider === "unknown" ? t("common.unknown") : nextProvider}</strong>
          </div>
          <div className="roundtable-fact">
            <span>{session?.importedContextAt ? t("roundtable.imported") : t("roundtable.notImported")}</span>
          </div>

          <div className="roundtable-actions">
            <button className="mini-button" disabled={!hasSession} onClick={onImport}>
              {t("roundtable.import")}
            </button>
            <button className="mini-button" disabled={!hasSession} onClick={onStart}>
              {t("roundtable.start")}
            </button>
            <button className="mini-button" disabled={!hasSession} onClick={onPause}>
              {t("roundtable.pause")}
            </button>
            <button className="mini-button" disabled={!hasSession} onClick={onStep}>
              {t("roundtable.step")}
            </button>
            <button className="mini-button" disabled={!hasSession} onClick={onSummarize}>
              {t("roundtable.summarize")}
            </button>
          </div>

          <h3>{t("roundtable.participants")}</h3>
          <div className="roundtable-participants">
            {visibleParticipants.map((participant) => {
              const canCapture =
                participant.enabled && (participant.provider === currentProvider || Boolean(participant.tabId));

              return (
                <div className="roundtable-participant" key={participant.provider}>
                  <span>{participant.label}</span>
                  <StatusBadge tone={toneByState[participant.state]}>
                    {t(`roundtable.status.${participant.state}`)}
                  </StatusBadge>
                  {participant.role !== "main" ? (
                    <button
                      className="mini-button"
                      disabled={!hasSession}
                      onClick={() => onAddParticipant(participant.provider)}
                    >
                      {t("roundtable.join")} {participant.label}
                    </button>
                  ) : null}
                  <button
                    className="mini-button"
                    disabled={!canCapture}
                    onClick={() => onCapture(participant.provider)}
                  >
                    {t("roundtable.capture")}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="roundtable-ledger">
          <h3>{t("roundtable.ledger")}</h3>
          {session?.messages.length ? (
            <div className="roundtable-messages">
              {session.messages.map((message) => (
                <article className="roundtable-message" data-speaker={message.speaker} key={message.id}>
                  <strong>{message.speaker}</strong>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-text">{t("roundtable.empty")}</p>
          )}

          <div className="roundtable-composer">
            <textarea
              placeholder={t("roundtable.guidancePlaceholder")}
              value={guidance}
              onChange={(event) => onGuidanceChange(event.target.value)}
            />
            <button className="primary-button" disabled={!hasSession || !guidance.trim()} onClick={onAddGuidance}>
              {t("roundtable.addGuidance")}
            </button>
          </div>
        </section>
      </div>
    </Section>
  );
}
