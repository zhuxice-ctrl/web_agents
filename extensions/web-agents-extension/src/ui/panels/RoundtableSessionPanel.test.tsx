import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { appendRoundtableMessage, createRoundtableSession } from "../../sessions/roundtable";
import { RoundtableSessionPanel } from "./RoundtableSessionPanel";

const textByKey: Record<string, string> = {
  "roundtable.title": "Roundtable Session",
  "roundtable.subtitle": "Shared model discussion",
  "roundtable.create": "Create",
  "roundtable.import": "Import",
  "roundtable.start": "Start",
  "roundtable.pause": "Pause",
  "roundtable.step": "Step",
  "roundtable.capture": "Capture",
  "roundtable.summarize": "Summarize",
  "roundtable.objective": "Objective",
  "roundtable.objectivePlaceholder": "Discuss and make a plan",
  "roundtable.ledger": "Shared Ledger",
  "roundtable.participants": "Participants",
  "roundtable.mainWindow": "Main Window",
  "roundtable.imported": "Imported",
  "roundtable.notImported": "Not imported",
  "roundtable.next": "Next",
  "roundtable.round": "Round",
  "roundtable.empty": "No messages",
  "roundtable.addGuidance": "Add guidance",
  "roundtable.guidancePlaceholder": "Guide this session",
  "common.unknown": "Unknown"
};

function t(key: string): string {
  return textByKey[key] ?? key;
}

function sessionWithMessage() {
  const session = createRoundtableSession({
    title: "route discussion",
    objective: "discuss five rounds",
    mainProvider: "chatgpt",
    mainTabId: 1,
    participantProviders: ["deepseek"],
    maxRounds: 5
  });

  return appendRoundtableMessage(session, {
    speaker: "chatgpt",
    provider: "chatgpt",
    text: "Start from milestones and acceptance checks.",
    source: "provider_capture",
    round: 1
  });
}

describe("RoundtableSessionPanel", () => {
  it("renders shared ledger and triggers core controls", () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const callbacks = {
      onObjectiveChange: vi.fn(),
      onGuidanceChange: vi.fn(),
      onCreate: vi.fn(),
      onImport: vi.fn(),
      onStart: vi.fn(),
      onPause: vi.fn(),
      onStep: vi.fn(),
      onCapture: vi.fn(),
      onSummarize: vi.fn(),
      onAddGuidance: vi.fn()
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <RoundtableSessionPanel
          currentProvider="chatgpt"
          guidance="ask for risk review"
          objective="discuss five rounds"
          session={sessionWithMessage()}
          t={t}
          {...callbacks}
        />
      );
    });

    expect(container.textContent).toContain("Roundtable Session");
    expect(container.textContent).toContain("Shared Ledger");
    expect(container.textContent).toContain("DeepSeek");
    expect(container.textContent).toContain("Start from milestones");

    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => buttons.find((button) => button.textContent === "Create")?.click());
    act(() => buttons.find((button) => button.textContent === "Import")?.click());
    act(() => buttons.find((button) => button.textContent === "Step")?.click());

    expect(callbacks.onCreate).toHaveBeenCalledOnce();
    expect(callbacks.onImport).toHaveBeenCalledOnce();
    expect(callbacks.onStep).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });
});
