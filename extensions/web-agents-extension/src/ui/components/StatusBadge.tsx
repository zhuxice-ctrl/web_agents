type StatusTone = "neutral" | "success" | "warning" | "danger";

type StatusBadgeProps = {
  tone?: StatusTone;
  children: string;
};

export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
