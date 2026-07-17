import type { AdapterStatus } from "../../shared/types";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";

type CurrentPagePanelProps = {
  status: AdapterStatus;
  t(key: string): string;
  onDetect(): void;
};

export function CurrentPagePanel({ status, t, onDetect }: CurrentPagePanelProps) {
  return (
    <Section
      title={t("current.title")}
      action={
        <button className="ghost-button" onClick={onDetect}>
          {t("current.detect")}
        </button>
      }
    >
      <div className="fact-row">
        <span>{t("current.provider")}</span>
        <strong>{status.label}</strong>
      </div>
      <div className="fact-row">
        <span>{t("current.input")}</span>
        <StatusBadge tone={status.canInsert ? "success" : "warning"}>
          {status.canInsert ? t("current.ready") : t("current.notReady")}
        </StatusBadge>
      </div>
      {status.matchedSelector ? (
        <div className="server-uri" title={status.matchedSelector}>
          {status.matchedSelector}
        </div>
      ) : null}
      {status.reason ? <p className="muted-text">{status.reason}</p> : null}
    </Section>
  );
}
