import type { PermissionSnapshot } from "../../shared/types";
import { getPermissionModeLabel, summarizePermission } from "../../permissions/model";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";

type PermissionPanelProps = {
  snapshot: PermissionSnapshot;
  t(key: string): string;
};

export function PermissionPanel({ snapshot, t }: PermissionPanelProps) {
  return (
    <Section title={t("permission.title")}>
      <div className="fact-row">
        <span>{t("permission.mode")}</span>
        <StatusBadge tone={snapshot.mode === "high_privilege" ? "danger" : "success"}>
          {getPermissionModeLabel(snapshot.mode)}
        </StatusBadge>
      </div>
      <div className="fact-row">
        <span>{t("permission.enforcement")}</span>
        <StatusBadge tone={snapshot.enforcement === "gateway" ? "success" : "warning"}>
          {snapshot.enforcement === "gateway" ? t("permission.gateway") : t("permission.uiOnly")}
        </StatusBadge>
      </div>
      <p className="muted-text">{summarizePermission(snapshot)}</p>
      <div className="allowed-roots">
        {snapshot.allowedRoots.length ? (
          snapshot.allowedRoots.map((root) => <code key={root}>{root}</code>)
        ) : (
          <span>{t("common.notImplemented")}: allowedRoots</span>
        )}
      </div>
      <p className="warning-text">
        {snapshot.highPrivilege.enabled ? "最高权限已开启" : t("permission.highOff")}
      </p>
      <p className="muted-text">{snapshot.message ?? t("permission.enforcementNotice")}</p>
      {snapshot.gatewayUrl ? <div className="server-uri">{snapshot.gatewayUrl}</div> : null}
    </Section>
  );
}
