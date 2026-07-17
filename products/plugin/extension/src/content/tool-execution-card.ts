import type { WebAgentToolCall } from "../shared/types";

export type ToolExecutionCardStatus = "running" | "executed" | "sent" | "failed" | "waiting";

export type ToolExecutionCardState = {
  call: WebAgentToolCall;
  status: ToolExecutionCardStatus;
  resultText?: string;
  note?: string;
};

export const TERMINAL_CARD_TTL_MS = 3600;

const CARD_ATTRIBUTE = "data-web-agents-tool-card";
const dismissTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

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

function shouldAutoDismiss(status: ToolExecutionCardStatus): boolean {
  return status !== "running";
}

function createStyles(documentRef: Document): HTMLStyleElement {
  const style = documentRef.createElement("style");
  style.textContent = `
    [${CARD_ATTRIBUTE}] {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: min(560px, calc(100vw - 40px));
      margin: 6px 0 8px;
      padding: 5px 8px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: 999px;
      background: rgba(248, 251, 255, 0.92);
      color: #17202a;
      font: 12px/1.35 Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      letter-spacing: 0;
      white-space: nowrap;
      transition:
        opacity 180ms ease,
        transform 180ms ease;
    }

    [${CARD_ATTRIBUTE}] .web-agents-card-badge {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      padding: 0 6px;
      border-radius: 999px;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 11px;
      font-weight: 700;
      flex: 0 0 auto;
    }

    [${CARD_ATTRIBUTE}] .web-agents-card-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 700;
    }

    [${CARD_ATTRIBUTE}] .web-agents-card-note {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #64748b;
    }

    [${CARD_ATTRIBUTE}][data-status="failed"] .web-agents-card-badge {
      background: #fee2e2;
      color: #b91c1c;
    }

    [${CARD_ATTRIBUTE}][data-status="sent"] .web-agents-card-badge {
      background: #dcfce7;
      color: #15803d;
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
  card.setAttribute("aria-live", "polite");

  responseElement.insertAdjacentElement("afterend", card);
  return card;
}

function clearDismissTimer(card: HTMLElement): void {
  const timer = dismissTimers.get(card);
  if (timer) clearTimeout(timer);
  dismissTimers.delete(card);
}

function scheduleDismiss(card: HTMLElement, status: ToolExecutionCardStatus): void {
  clearDismissTimer(card);
  if (!shouldAutoDismiss(status)) return;

  const timer = setTimeout(() => {
    if (!card.isConnected) return;
    card.remove();
    dismissTimers.delete(card);
  }, TERMINAL_CARD_TTL_MS);
  dismissTimers.set(card, timer);
}

export function removeAllToolExecutionCards(documentRef: Document): void {
  documentRef.querySelectorAll<HTMLElement>(`[${CARD_ATTRIBUTE}]`).forEach((card) => {
    clearDismissTimer(card);
    card.remove();
  });
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
  card.dataset.status = state.status;
  card.replaceChildren();

  const badge = documentRef.createElement("span");
  badge.className = "web-agents-card-badge";
  badge.textContent = statusText(state.status);

  const title = documentRef.createElement("span");
  title.className = "web-agents-card-title";
  title.textContent = `WA ${state.call.name} #${state.call.callId}`;
  card.append(badge, title);

  if (state.note) {
    const note = documentRef.createElement("span");
    note.className = "web-agents-card-note";
    note.textContent = state.note;
    card.append(note);
  }

  scheduleDismiss(card, state.status);
  return card;
}
