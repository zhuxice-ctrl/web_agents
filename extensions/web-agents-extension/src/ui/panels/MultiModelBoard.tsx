import type { ParticipantStatus, ProviderId, TaskSession } from "../../shared/types";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";

type MultiModelBoardProps = {
  session: TaskSession;
  currentProvider: ProviderId;
  t(key: string): string;
  onToggle(provider: ProviderId, enabled: boolean): void;
  onOpen(provider: ProviderId): void;
  onInsert(provider: ProviderId): void;
  onCapture(provider: ProviderId): void;
  onInsertSelected(): void;
};

const toneByStatus: Record<ParticipantStatus, "neutral" | "success" | "warning" | "danger"> = {
  not_open: "neutral",
  opening: "warning",
  ready: "success",
  inserted: "success",
  waiting_user_send: "warning",
  waiting_response: "warning",
  captured: "success",
  error: "danger"
};

export function MultiModelBoard({
  session,
  currentProvider,
  t,
  onToggle,
  onOpen,
  onInsert,
  onCapture,
  onInsertSelected
}: MultiModelBoardProps) {
  return (
    <Section
      title={t("board.title")}
      action={
        <button className="ghost-button" onClick={onInsertSelected}>
          {t("board.insertSelected")}
        </button>
      }
    >
      <p className="muted-text">{t("board.currentOnly")}</p>
      <div className="board-task">
        <strong>{session.title}</strong>
        <span>{session.prompt || t("task.placeholder")}</span>
      </div>
      <div className="participant-list">
        {session.participants.map((participant) => {
          const isCurrent = participant.provider === currentProvider && currentProvider !== "unknown";
          const canUseTab = isCurrent || Boolean(participant.tabId);

          return (
            <div className="participant-row" key={participant.provider}>
              <div className="participant-main">
                <label>
                  <input
                    checked={participant.enabled}
                    disabled={isCurrent}
                    type="checkbox"
                    onChange={(event) => onToggle(participant.provider, event.target.checked)}
                  />
                  <span>{participant.label}</span>
                  {isCurrent ? <em>{t("board.current")}</em> : null}
                </label>
                <StatusBadge tone={toneByStatus[participant.status]}>{t(`board.status.${participant.status}`)}</StatusBadge>
              </div>

              <div className="participant-actions">
                {!isCurrent ? (
                  <button className="mini-button" disabled={!participant.enabled} onClick={() => onOpen(participant.provider)}>
                    {participant.tabId ? t("board.reopen") : t("board.open")}
                  </button>
                ) : null}
                <button className="mini-button" disabled={!participant.enabled || !canUseTab} onClick={() => onInsert(participant.provider)}>
                  {t("board.insert")}
                </button>
                <button className="mini-button" disabled={!participant.enabled || !canUseTab} onClick={() => onCapture(participant.provider)}>
                  {t("board.capture")}
                </button>
              </div>

              {participant.insertedPrompt ? (
                <details>
                  <summary>{t("board.insertedPrompt")}</summary>
                  <p>{participant.insertedPrompt}</p>
                </details>
              ) : null}
              {participant.responseSnapshot ? (
                <details open>
                  <summary>{t("board.responseSnapshot")}</summary>
                  <p>{participant.responseSnapshot.text}</p>
                </details>
              ) : null}
              {participant.error ? <p className="warning-text">{participant.error}</p> : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
