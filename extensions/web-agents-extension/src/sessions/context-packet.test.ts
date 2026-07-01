import { describe, expect, it } from "vitest";
import { appendRoundtableMessage, createRoundtableSession } from "./roundtable";
import { buildFinalSummaryPacket, buildParticipantContextPacket } from "./context-packet";

function sessionWithMessages() {
  let session = createRoundtableSession({
    title: "项目路线讨论",
    objective: "讨论五轮并形成方案",
    mainProvider: "chatgpt",
    participantProviders: ["deepseek"],
    maxRounds: 5
  });
  session = appendRoundtableMessage(session, {
    speaker: "user",
    text: "如何确定一个项目真实的开发路线，从设计到落地？",
    source: "main_window_import"
  });
  session = appendRoundtableMessage(session, {
    speaker: "chatgpt",
    provider: "chatgpt",
    text: "先建立需求、架构、里程碑和验收标准。",
    source: "provider_capture",
    round: 1
  });
  return appendRoundtableMessage(session, {
    speaker: "deepseek",
    provider: "deepseek",
    text: "我建议补充风险验证和最小可交付闭环。",
    source: "provider_capture",
    round: 1
  });
}

describe("roundtable context packet builder", () => {
  it("builds a mediated prompt for DeepSeek with shared ledger context", () => {
    const packet = buildParticipantContextPacket(sessionWithMessages(), {
      targetProvider: "deepseek",
      turnInstruction: "请回应 GPT 的上一轮观点。",
      maxCharacters: 4000
    });

    expect(packet).toContain("你正在参与一个由 Web Agents 编排的多模型圆桌讨论");
    expect(packet).toContain("讨论五轮并形成方案");
    expect(packet).toContain("你的身份：DeepSeek");
    expect(packet).toContain("GPT");
    expect(packet).toContain("DeepSeek");
    expect(packet).toContain("请回应 GPT 的上一轮观点");
  });

  it("marks late join context for Gemini", () => {
    const packet = buildParticipantContextPacket(sessionWithMessages(), {
      targetProvider: "gemini",
      turnInstruction: "你是中途加入，请重点审查落地风险。",
      isLateJoin: true,
      maxCharacters: 4000
    });

    expect(packet).toContain("你是中途加入");
    expect(packet).toContain("落地风险");
  });

  it("builds final GPT summary packet", () => {
    const packet = buildFinalSummaryPacket(sessionWithMessages(), { maxCharacters: 4000 });

    expect(packet).toContain("主窗口汇总者");
    expect(packet).toContain("可执行方案");
    expect(packet).toContain("开发路线");
    expect(packet).toContain("风险和验证方式");
  });

  it("keeps the newest guidance when trimming", () => {
    let session = sessionWithMessages();
    for (let index = 0; index < 20; index += 1) {
      session = appendRoundtableMessage(session, {
        speaker: "user",
        text: `历史消息 ${index} ` + "x".repeat(80),
        source: "web_agents_user"
      });
    }
    session = appendRoundtableMessage(session, {
      speaker: "user",
      text: "最新指导：让 Gemini 审查风险。",
      source: "web_agents_user"
    });

    const packet = buildParticipantContextPacket(session, {
      targetProvider: "gemini",
      turnInstruction: "请加入讨论。",
      maxCharacters: 900
    });

    expect(packet.length).toBeLessThanOrEqual(1100);
    expect(packet).toContain("最新指导：让 Gemini 审查风险。");
  });
});
