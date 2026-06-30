import type { McpStatus } from "../../shared/types";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";

type McpPanelProps = {
  status: McpStatus;
  t(key: string): string;
  onRefresh(): void;
};

const toneByState = {
  unknown: "neutral",
  checking: "neutral",
  connected: "success",
  disconnected: "warning",
  error: "danger"
} as const;

export function McpPanel({ status, t, onRefresh }: McpPanelProps) {
  const visibleTools = status.tools.slice(0, 6);

  return (
    <Section
      title={t("mcp.title")}
      action={
        <button className="ghost-button" onClick={onRefresh}>
          {t("mcp.refresh")}
        </button>
      }
    >
      <div className="fact-row">
        <span>{t("mcp.status")}</span>
        <StatusBadge tone={toneByState[status.state]}>{t(`mcp.state.${status.state}`)}</StatusBadge>
      </div>
      <div className="server-uri">{status.serverUri}</div>
      <div className="fact-row">
        <span>{t("mcp.tools")}</span>
        <strong>{status.tools.length}</strong>
      </div>
      <p className="muted-text">{status.message ?? t("mcp.noTools")}</p>
      {visibleTools.length ? (
        <div className="tool-list">
          {visibleTools.map((tool) => (
            <div className="tool-row" key={tool.name}>
              <div>
                <strong>{tool.name}</strong>
                <span>{tool.description || t("mcp.noDescription")}</span>
                <em>{tool.schemaNote}</em>
              </div>
              <StatusBadge tone={tool.risk === "high" ? "danger" : "success"}>
                {tool.risk === "high" ? t("mcp.highRisk") : t("mcp.lowRisk")}
              </StatusBadge>
            </div>
          ))}
          {status.tools.length > visibleTools.length ? (
            <p className="muted-text">{t("mcp.moreTools").replace("{count}", String(status.tools.length - visibleTools.length))}</p>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
