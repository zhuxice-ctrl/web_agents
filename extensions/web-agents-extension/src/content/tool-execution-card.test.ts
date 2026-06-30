import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_CARD_TTL_MS, upsertToolExecutionCard } from "./tool-execution-card";
import type { WebAgentToolCall } from "../shared/types";

const call: WebAgentToolCall = {
  name: "write_file",
  callId: "1",
  arguments: {
    path: "F:\\web_agents\\hello.md"
  },
  rawText: "{}"
};

describe("tool execution card", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a compact running state next to the response instead of the input", () => {
    document.body.innerHTML = `
      <article id="response">assistant response</article>
      <textarea style="width:240px;height:48px"></textarea>
    `;

    const response = document.querySelector<HTMLElement>("#response")!;
    upsertToolExecutionCard(document, response, "1:write_file:{}", {
      call,
      status: "running"
    });

    const card = document.querySelector<HTMLElement>("[data-web-agents-tool-card]");
    expect(card?.previousElementSibling).toBe(response);
    expect(card?.textContent).toContain("write_file");
    expect(card?.textContent).toContain("执行中");
    expect(document.querySelector("textarea")?.value).toBe("");
  });

  it("keeps execution results compact and auto dismisses after sent", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<article id="response">assistant response</article>`;
    const response = document.querySelector<HTMLElement>("#response")!;

    upsertToolExecutionCard(document, response, "1:write_file:{}", {
      call,
      status: "running"
    });
    upsertToolExecutionCard(document, response, "1:write_file:{}", {
      call,
      status: "sent",
      resultText: "done",
      note: "已自动续发给模型"
    });

    expect(document.querySelectorAll("[data-web-agents-tool-card]")).toHaveLength(1);
    expect(document.querySelector("[data-web-agents-tool-card]")?.textContent).not.toContain("done");
    expect(document.querySelector("[data-web-agents-tool-card]")?.textContent).toContain("已自动续发给模型");

    vi.advanceTimersByTime(TERMINAL_CARD_TTL_MS);

    expect(document.querySelectorAll("[data-web-agents-tool-card]")).toHaveLength(0);
  });

  it("auto dismisses waiting and failed states so placeholders do not stand in the chat", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<article id="response">assistant response</article>`;
    const response = document.querySelector<HTMLElement>("#response")!;

    upsertToolExecutionCard(document, response, "1:write_file:{}", {
      call,
      status: "waiting",
      resultText: "long internal result",
      note: "暂时没有找到发送按钮"
    });

    expect(document.querySelector("[data-web-agents-tool-card]")?.textContent).toContain("暂时没有找到发送按钮");
    expect(document.querySelector("[data-web-agents-tool-card]")?.textContent).not.toContain("long internal result");

    vi.advanceTimersByTime(TERMINAL_CARD_TTL_MS);

    expect(document.querySelectorAll("[data-web-agents-tool-card]")).toHaveLength(0);
  });

  it("handles fingerprints containing JSON and Windows paths", () => {
    document.body.innerHTML = `<article id="response">assistant response</article>`;
    const response = document.querySelector<HTMLElement>("#response")!;
    const fingerprint = '1:write_file:{"path":"F:\\\\web_agents\\\\hello.md"}';

    upsertToolExecutionCard(document, response, fingerprint, {
      call,
      status: "running"
    });
    upsertToolExecutionCard(document, response, fingerprint, {
      call,
      status: "executed",
      resultText: "ok"
    });

    expect(document.querySelectorAll("[data-web-agents-tool-card]")).toHaveLength(1);
  });
});
