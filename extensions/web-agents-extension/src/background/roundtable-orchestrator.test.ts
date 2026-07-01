import { describe, expect, it, vi } from "vitest";
import { createRoundtableSession } from "../sessions/roundtable";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import { createRoundtableOrchestrator } from "./roundtable-orchestrator";

type MockSendToTab = <T extends ExtensionRequest["type"]>(
  request: ExtensionRequest,
  senderTabId?: number
) => Promise<ExtensionResponse<T>>;

describe("roundtable orchestrator", () => {
  it("imports main context into the shared ledger", async () => {
    const session = createRoundtableSession({
      title: "项目路线讨论",
      objective: "讨论五轮",
      mainProvider: "chatgpt",
      mainTabId: 1,
      participantProviders: ["deepseek"],
      maxRounds: 5
    });
    const orchestrator = createRoundtableOrchestrator({
      sendToTab: vi.fn(async () => ({
        ok: true,
        type: "tab:capture-recent",
        data: {
          provider: "chatgpt",
          capturedAt: new Date().toISOString(),
          messages: [
            { speaker: "user", text: "如何确定真实开发路线？", source: "article" },
            { speaker: "assistant", text: "先分阶段再落地。", source: "article" }
          ]
        }
      })) as MockSendToTab
    });

    const next = await orchestrator.importMainContext(session);

    expect(next.messages).toHaveLength(2);
    expect(next.importedContextAt).toBeTruthy();
    expect(next.messages[0].source).toBe("main_window_import");
  });

  it("sends the next packet and pauses when auto-send cannot submit", async () => {
    const session = createRoundtableSession({
      title: "项目路线讨论",
      objective: "讨论五轮",
      mainProvider: "chatgpt",
      participantProviders: ["deepseek"],
      maxRounds: 5
    });
    const sendToTab = vi.fn(async (): Promise<ExtensionResponse<"tab:auto-send-text">> => ({
      ok: true,
      type: "tab:auto-send-text",
      data: { state: "no_submit", message: "页面暂时不可发送" }
    }));
    const orchestrator = createRoundtableOrchestrator({ sendToTab: sendToTab as MockSendToTab });

    const result = await orchestrator.step(session);

    expect(result.state).toBe("paused");
    expect(result.participants.find((item) => item.provider === "deepseek")?.state).toBe("error");
  });

  it("captures a provider reply and advances back to GPT", async () => {
    const session = {
      ...createRoundtableSession({
        title: "项目路线讨论",
        objective: "讨论五轮",
        mainProvider: "chatgpt",
        participantProviders: ["deepseek"],
        maxRounds: 5
      }),
      plan: {
        objective: "讨论五轮",
        maxRounds: 5,
        currentRound: 1,
        nextProvider: "deepseek" as const,
        finalSummarizer: "chatgpt" as const,
        mode: "automatic" as const
      }
    };
    const sendToTab = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        type: "tab:auto-send-text",
        data: { state: "sent", message: "已发送" }
      })
      .mockResolvedValueOnce({
        ok: true,
        type: "tab:capture-latest",
        data: {
          provider: "deepseek",
          text: "DeepSeek 认为要加验收标准。",
          capturedAt: new Date().toISOString(),
          source: "article"
        }
      });
    const orchestrator = createRoundtableOrchestrator({ sendToTab: sendToTab as MockSendToTab });

    const waiting = await orchestrator.step(session);
    const captured = await orchestrator.capture(waiting, "deepseek");

    expect(captured.messages.at(-1)?.text).toContain("验收标准");
    expect(captured.plan.nextProvider).toBe("chatgpt");
  });
});
