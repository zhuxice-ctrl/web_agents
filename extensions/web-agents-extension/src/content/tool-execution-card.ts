import type { WebAgentToolCall } from "../shared/types";

export type ToolExecutionCardStatus = "running" | "executed" | "sent" | "failed" | "waiting";

export type ToolExecutionCardState = {
  call: WebAgentToolCall;
  status: ToolExecutionCardStatus;
  resultText?: string;
  note?: string;
};

const CARD_ATTRIBUTE = "data-web-agents-tool-card";

function statusText(status: ToolExecutionCardStatus): string {
  switch (status) {
    case "running":
      return "执行中";
    case "executed":
      return "已执行";
    case "sent":
      return "已续发";
    case "failed":
      return "执行失败";
    case "waiting":
      return "等待续发";
  }
}

function createStyles(documentRef: Document): HTMLStyleElement {
  const style = documentRef.createElement("style");
  style.textContent = `
    [${CARD_ATTRIBUTE}] {
      box-sizing: border-box;
      max-width: min(760px, calc(100vw - 40px));
      margin: 10px 0 14px;
      padding: 10px 12px;
      border: 1px solid rgba(37, 99, 235, 0.2);
      border-radius: 8px;
      background: #f8fbff;
      color: #17202a;
      font: 13px/1.45 Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      letter-spacing: 0;
      white-space: normal;
    }

    [${CARD_ATTRIBUTE}] .web-agents-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-weight: 700;
    }

    [${CARD_ATTRIBUTE}] .web-agents-card-badge {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 700;
    }

    [${CARD_ATTRIBUTE}] .web-agents-card-result {
      margin: 8px 0 0;
      max-height: 220px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
      color: #334155;
    }

    [${CARD_ATTRIBUTE}] .web-agents-card-note {
      margin-top: 6px;
      color: #64748b;
      font-size: 12px;
    }
  `;
  return style;
}

function ensureCard(documentRef: Document, responseElement: HTMLElement, fingerprint: string): HTMLElement {
  const existing = Array.from(documentRef.querySelectorAll<HTMLElement>(`[${CARD_ATTRIBUTE}]`)).find(
    (card) => card.dataset.fingerprint === fingerprint
  );
  if (existing) return existing;

  const card = documentRef.createElement("section");
  card.setAttribute(CARD_ATTRIBUTE, "true");
  card.dataset.fingerprint = fingerprint;

  responseElement.insertAdjacentElement("afterend", card);
  return card;
}

export function upsertToolExecutionCard(
  documentRef: Document,
  responseElement: HTMLElement,
  fingerprint: string,
  state: ToolExecutionCardState
): HTMLElement {
  if (!documentRef.getElementById("web-agents-tool-card-styles")) {
    const style = createStyles(documentRef);
    style.id = "web-agents-tool-card-styles";
    documentRef.head.append(style);
  }

  const card = ensureCard(documentRef, responseElement, fingerprint);
  const resultText = state.resultText ? state.resultText : "等待本地 MCP 返回结果...";

  card.replaceChildren();

  const header = documentRef.createElement("div");
  header.className = "web-agents-card-header";
  const badge = documentRef.createElement("span");
  badge.className = "web-agents-card-badge";
  badge.textContent = statusText(state.status);
  const title = documentRef.createElement("span");
  title.textContent = `Web Agents · ${state.call.name} · call_id=${state.call.callId}`;
  header.append(badge, title);
  card.append(header);

  const result = documentRef.createElement("pre");
  result.className = "web-agents-card-result";
  result.textContent = resultText;
  card.append(result);

  if (state.note) {
    const note = documentRef.createElement("div");
    note.className = "web-agents-card-note";
    note.textContent = state.note;
    card.append(note);
  }

  return card;
}
