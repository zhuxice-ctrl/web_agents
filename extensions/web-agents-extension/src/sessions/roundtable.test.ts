import { describe, expect, it } from "vitest";
import {
  appendRoundtableMessage,
  createRoundtableSession,
  getNextRoundtableProvider,
  joinRoundtableParticipant,
  markRoundtableParticipantState
} from "./roundtable";

describe("roundtable session model", () => {
  it("creates a GPT-led session with DeepSeek as the first active participant", () => {
    const session = createRoundtableSession({
      title: "项目路线讨论",
      objective: "和 GPT 讨论五轮，最后给方案",
      mainProvider: "chatgpt",
      mainTabId: 11,
      participantProviders: ["deepseek"],
      maxRounds: 5
    });

    expect(session.mainProvider).toBe("chatgpt");
    expect(session.mainTabId).toBe(11);
    expect(session.plan.maxRounds).toBe(5);
    expect(session.plan.currentRound).toBe(1);
    expect(session.plan.nextProvider).toBe("deepseek");
    expect(session.participants.find((item) => item.provider === "chatgpt")?.role).toBe("main");
    expect(session.participants.find((item) => item.provider === "deepseek")?.enabled).toBe(true);
    expect(session.participants.find((item) => item.provider === "gemini")?.enabled).toBe(false);
  });

  it("appends messages in order and tracks the latest update time", () => {
    const session = createRoundtableSession({
      title: "项目路线讨论",
      objective: "讨论五轮",
      mainProvider: "chatgpt",
      participantProviders: ["deepseek"],
      maxRounds: 5
    });

    const withUser = appendRoundtableMessage(session, {
      speaker: "user",
      text: "如何确定真实开发路线？",
      source: "web_agents_user"
    });
    const withGpt = appendRoundtableMessage(withUser, {
      speaker: "chatgpt",
      provider: "chatgpt",
      text: "先拆阶段，再验证。",
      source: "provider_capture",
      round: 1
    });

    expect(withGpt.messages).toHaveLength(2);
    expect(withGpt.messages[0].speaker).toBe("user");
    expect(withGpt.messages[1].provider).toBe("chatgpt");
    expect(Date.parse(withGpt.updatedAt)).toBeGreaterThanOrEqual(Date.parse(session.updatedAt));
  });

  it("joins Gemini late without losing existing discussion context", () => {
    const session = createRoundtableSession({
      title: "项目路线讨论",
      objective: "讨论五轮",
      mainProvider: "chatgpt",
      participantProviders: ["deepseek"],
      maxRounds: 5
    });

    const next = joinRoundtableParticipant(session, "gemini", 42);

    const gemini = next.participants.find((item) => item.provider === "gemini");
    expect(gemini?.enabled).toBe(true);
    expect(gemini?.tabId).toBe(42);
    expect(gemini?.state).toBe("ready");
  });

  it("routes GPT and DeepSeek turns and advances rounds after GPT responds", () => {
    const session = createRoundtableSession({
      title: "项目路线讨论",
      objective: "讨论五轮",
      mainProvider: "chatgpt",
      participantProviders: ["deepseek"],
      maxRounds: 5
    });

    expect(getNextRoundtableProvider(session)).toBe("deepseek");

    const afterDeepSeek = {
      ...session,
      plan: { ...session.plan, nextProvider: "chatgpt" as const }
    };
    expect(getNextRoundtableProvider(afterDeepSeek)).toBe("chatgpt");

    const afterGpt = {
      ...session,
      plan: { ...session.plan, currentRound: 2, nextProvider: "deepseek" as const }
    };
    expect(getNextRoundtableProvider(afterGpt)).toBe("deepseek");
  });

  it("updates participant state immutably", () => {
    const session = createRoundtableSession({
      title: "项目路线讨论",
      objective: "讨论五轮",
      mainProvider: "chatgpt",
      participantProviders: ["deepseek"],
      maxRounds: 5
    });

    const next = markRoundtableParticipantState(session, "deepseek", "waiting_response");

    expect(next).not.toBe(session);
    expect(next.participants.find((item) => item.provider === "deepseek")?.state).toBe("waiting_response");
    expect(session.participants.find((item) => item.provider === "deepseek")?.state).toBe("ready");
  });
});
