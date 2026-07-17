export const ROUND_TABLE_BRIDGE_SOURCE = "web-agents-roundtable-bridge";
export const ROUND_TABLE_BRIDGE_ORIGINS = new Set([
  "http://127.0.0.1:3020",
  "http://localhost:3020"
]);

export const LOCAL_BRIDGE_REQUEST_TYPES = new Set([
  "bridge:ping",
  "tabs:open-provider",
  "tabs:discover-providers",
  "tabs:probe-provider",
  "tabs:focus-provider",
  "tab:auth-probe",
  "tab:detect",
  "tab:insert-text",
  "tab:auto-send-text",
  "tab:capture-latest",
  "tab:capture-recent"
]);

export type LocalBridgeRequestEnvelope = {
  source: typeof ROUND_TABLE_BRIDGE_SOURCE;
  direction: "page-to-extension";
  requestId: string;
  request: { type: string; [key: string]: unknown };
};

export function isRoundtableBridgeOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ROUND_TABLE_BRIDGE_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

export function redactBridgeError(value: unknown): string {
  return String(value || "").replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
    const trailing = match.match(/[),.;!?]+$/)?.[0] || "";
    const candidate = trailing ? match.slice(0, -trailing.length) : match;
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}${trailing}`;
    } catch {
      return match;
    }
  });
}

export function sanitizeBridgeErrors(value: unknown, insideError = false): unknown {
  if (typeof value === "string") return insideError ? redactBridgeError(value) : value;
  if (Array.isArray(value)) return value.map((item) => sanitizeBridgeErrors(item, insideError));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    sanitizeBridgeErrors(entry, insideError || key.toLowerCase().includes("error"))
  ]));
}

export function isLocalBridgeRequestType(value: unknown): value is string {
  return typeof value === "string" && LOCAL_BRIDGE_REQUEST_TYPES.has(value);
}

export function isLocalBridgeRequestEnvelope(value: unknown): value is LocalBridgeRequestEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<LocalBridgeRequestEnvelope>;
  return (
    envelope.source === ROUND_TABLE_BRIDGE_SOURCE
    && envelope.direction === "page-to-extension"
    && typeof envelope.requestId === "string"
    && envelope.requestId.length > 0
    && Boolean(envelope.request && typeof envelope.request === "object")
    && isLocalBridgeRequestType(envelope.request?.type)
  );
}
