import type { ExtensionConfig } from "../../shared/types";
import { Section } from "../components/Section";

type SettingsPanelProps = {
  config: ExtensionConfig;
  t(key: string): string;
};

export function SettingsPanel({ config, t }: SettingsPanelProps) {
  return (
    <Section title={t("settings.title")}>
      <div className="fact-row">
        <span>{t("settings.language")}</span>
        <strong>{config.locale}</strong>
      </div>
      <div className="fact-row">
        <span>{t("settings.transport")}</span>
        <strong>{config.mcp.transport.toUpperCase()}</strong>
      </div>
      <div className="fact-row">
        <span>{t("settings.gateway")}</span>
        <strong>{config.gateway.enabled ? t("common.enabled") : t("common.disabled")}</strong>
      </div>
      <div className="server-uri">{config.gateway.baseUrl}</div>
      <p className="muted-text">{t("settings.advancedNotice")}</p>
    </Section>
  );
}
