import { getProviderById } from "../providers/catalog";
import type { ProviderId, RoundtableMessage, RoundtableSession } from "../shared/types";

type BuildParticipantPacketOptions = {
  targetProvider: ProviderId;
  turnInstruction: string;
  isLateJoin?: boolean;
  maxCharacters: number;
};

type BuildSummaryPacketOptions = {
  maxCharacters: number;
};

function speakerLabel(message: RoundtableMessage): string {
  if (message.speaker === "user") return "用户";
  if (message.speaker === "system") return "系统";
  return getProviderById(message.speaker)?.label ?? message.speaker;
}

function providerLabel(provider: ProviderId): string {
  return getProviderById(provider)?.label ?? provider;
}

function formatLedgerMessage(message: RoundtableMessage): string {
  const round = message.round ? `第 ${message.round} 轮 ` : "";
  return `【${round}${speakerLabel(message)}】\n${message.text.trim()}`;
}

function buildRecentLedger(session: RoundtableSession, maxCharacters: number): string {
  const formatted = session.messages.map(formatLedgerMessage);
  const selected: string[] = [];
  let total = 0;

  for (let index = formatted.length - 1; index >= 0; index -= 1) {
    const item = formatted[index];
    const nextTotal = total + item.length + 2;
    if (selected.length > 0 && nextTotal > maxCharacters) break;
    selected.unshift(item);
    total = nextTotal;
  }

  return selected.join("\n\n");
}

export function buildParticipantContextPacket(
  session: RoundtableSession,
  options: BuildParticipantPacketOptions
): string {
  const ledgerBudget = Math.max(600, options.maxCharacters - 900);
  const lateJoin = options.isLateJoin ? "\n你是中途加入本次讨论，请先理解已有上下文再发表观点。\n" : "";

  return [
    "你正在参与一个由 Web Agents 编排的多模型圆桌讨论。",
    "",
    `本轮目标：\n${session.plan.objective}`,
    "",
    `你的身份：${providerLabel(options.targetProvider)}`,
    lateJoin.trim(),
    "",
    "共享讨论上下文：",
    buildRecentLedger(session, ledgerBudget),
    "",
    "本轮请你完成：",
    options.turnInstruction,
    "",
    "请直接给出你的观点，不要假装你能看到其他网页。你看到的是 Web Agents 提供的共享上下文。"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildFinalSummaryPacket(session: RoundtableSession, options: BuildSummaryPacketOptions): string {
  const ledgerBudget = Math.max(600, options.maxCharacters - 700);

  return [
    "你是本次 Web Agents 圆桌讨论的主窗口汇总者。",
    "",
    "请基于以下共享讨论记录，输出一个可执行方案：",
    buildRecentLedger(session, ledgerBudget),
    "",
    "要求：",
    "- 先给结论。",
    "- 再给开发路线。",
    "- 再给风险和验证方式。",
    "- 最后给下一步行动清单。"
  ].join("\n");
}
