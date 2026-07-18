import { Section } from "../components/Section";

type TaskPanelProps = {
  taskText: string;
  workspaceRoot: string;
  feedback: string;
  isBusy: boolean;
  t(key: string): string;
  onTaskTextChange(value: string): void;
  onWorkspaceRootChange(value: string): void;
  onInsert(): void;
};

export function TaskPanel({
  taskText,
  workspaceRoot,
  feedback,
  isBusy,
  t,
  onTaskTextChange,
  onWorkspaceRootChange,
  onInsert
}: TaskPanelProps) {
  return (
    <Section title={t("task.title")}>
      <textarea
        className="task-input"
        value={taskText}
        placeholder={t("task.placeholder")}
        onChange={(event) => onTaskTextChange(event.target.value)}
      />
      <label className="workspace-field">
        <span>{t("task.workspace")}</span>
        <input
          value={workspaceRoot}
          placeholder={t("task.workspacePlaceholder")}
          onChange={(event) => onWorkspaceRootChange(event.target.value)}
        />
      </label>
      <div className="task-actions">
        <button className="primary-button" disabled={isBusy} onClick={onInsert}>
          {isBusy ? t("common.loading") : t("task.insertCurrent")}
        </button>
        <p>{t("task.manualSend")}</p>
      </div>
      {feedback ? <div className="feedback-line">{feedback}</div> : null}
    </Section>
  );
}
