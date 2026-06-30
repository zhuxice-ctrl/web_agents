# Multi-Model Roundtable Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable Web Agents roundtable session: a plugin-owned shared discussion window that imports ChatGPT context, runs an automatic GPT <-> DeepSeek discussion loop, supports later Gemini/Doubao joins, and sends a final summary back to GPT.

**Architecture:** Add a roundtable session model and context-packet builder under `src/sessions`, expose tab-level recent capture and auto-send APIs through content/background messages, then add a small background orchestrator that advances one safe step at a time. The UI gets a dedicated roundtable panel that displays the shared ledger and controls start/pause/summary.

**Tech Stack:** React 19, TypeScript, Chrome MV3, Vitest/jsdom, existing provider catalog and tab message bridge.

---

## Scope And Sequencing

This plan intentionally builds the feature in layers:

1. Shared session model and context packet builder.
2. Recent main-window context capture.
3. Structured tab auto-send and capture APIs.
4. Background roundtable orchestrator for GPT + DeepSeek.
5. Roundtable session UI.
6. Mid-session participant join support for Gemini/Doubao.
7. Verification, build, and manual test script.

The first working loop is GPT main window and DeepSeek. Gemini and Doubao join after the core ledger and orchestrator are reliable.

## File Map

- Create `extensions/web-agents-extension/src/sessions/roundtable.ts`
  - Owns roundtable types, session creation, participant updates, message append helpers, and next-participant route logic.
- Create `extensions/web-agents-extension/src/sessions/roundtable.test.ts`
  - Tests session creation, message ordering, participant join, state transitions, and round advancement.
- Create `extensions/web-agents-extension/src/sessions/context-packet.ts`
  - Converts ledger messages into bounded provider prompts.
- Create `extensions/web-agents-extension/src/sessions/context-packet.test.ts`
  - Tests prompt content, late join context, final GPT summary packet, and trimming.
- Modify `extensions/web-agents-extension/src/shared/types.ts`
  - Adds `RoundtableSession`, `RoundtableMessage`, `RecentConversationCapture`, `AutoSendResult`, and related state types.
- Modify `extensions/web-agents-extension/src/shared/messages.ts`
  - Adds roundtable and tab API messages.
- Modify `extensions/web-agents-extension/src/adapters/dom.ts`
  - Adds recent conversation extraction helpers.
- Modify `extensions/web-agents-extension/src/adapters/dom.test.ts`
  - Tests recent visible message extraction.
- Modify `extensions/web-agents-extension/src/content/auto-submit.ts`
  - Exposes structured auto-send result usable by orchestration.
- Modify `extensions/web-agents-extension/src/content/auto-submit.test.ts`
  - Tests sent/no_submit/input_busy states remain bounded.
- Modify `extensions/web-agents-extension/src/content/index.ts`
  - Handles `tab:auto-send-text` and `tab:capture-recent`.
- Create `extensions/web-agents-extension/src/background/roundtable-orchestrator.ts`
  - Coordinates session steps in background.
- Create `extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts`
  - Tests step advancement with fake tab bridge functions.
- Modify `extensions/web-agents-extension/src/background/index.ts`
  - Routes roundtable messages to the orchestrator and stores sessions.
- Create `extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.tsx`
  - Renders the standalone session window.
- Create `extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.test.tsx`
  - Tests render and key button callbacks if current test setup supports React component tests. If not, cover state helpers in unit tests and manually verify UI.
- Modify `extensions/web-agents-extension/src/ui/App.tsx`
  - Wires panel state and message calls.
- Modify `extensions/web-agents-extension/src/ui/styles.css`
  - Adds dense application-like roundtable panel styles.
- Modify `extensions/web-agents-extension/src/i18n/zh-CN.json`
  - Adds roundtable Chinese copy and fixes any touched mojibake keys.
- Modify `extensions/web-agents-extension/src/i18n/en.json`
  - Adds matching English copy.

---

### Task 1: Roundtable Session Model

**Files:**
- Modify: `extensions/web-agents-extension/src/shared/types.ts`
- Create: `extensions/web-agents-extension/src/sessions/roundtable.ts`
- Create: `extensions/web-agents-extension/src/sessions/roundtable.test.ts`

- [ ] **Step 1: Write failing session model tests**

Create `extensions/web-agents-extension/src/sessions/roundtable.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd F:\web_agents-new-plugin-rewrite\extensions\web-agents-extension
npm test -- src/sessions/roundtable.test.ts
```

Expected: FAIL because `./roundtable` does not exist.

- [ ] **Step 3: Add shared roundtable types**

Append these exports to `extensions/web-agents-extension/src/shared/types.ts` after existing task/session types:

```ts
export type RoundtableRole = "main" | "participant" | "summarizer";

export type RoundtableParticipantState =
  | "not_open"
  | "opening"
  | "ready"
  | "sending"
  | "waiting_response"
  | "captured"
  | "paused"
  | "error";

export type RoundtableMessageSource =
  | "main_window_import"
  | "web_agents_user"
  | "provider_capture"
  | "orchestrator";

export type RoundtableSpeaker = "user" | "system" | ProviderId;

export type RoundtableMessage = {
  id: string;
  sessionId: string;
  provider?: ProviderId;
  speaker: RoundtableSpeaker;
  text: string;
  source: RoundtableMessageSource;
  round?: number;
  createdAt: string;
};

export type RoundtableParticipant = {
  provider: ProviderId;
  label: string;
  role: RoundtableRole;
  enabled: boolean;
  tabId?: number;
  url?: string;
  state: RoundtableParticipantState;
  lastSentMessageId?: string;
  lastCapturedMessageId?: string;
  error?: string;
};

export type RoundtablePlan = {
  objective: string;
  maxRounds: number;
  currentRound: number;
  nextProvider?: ProviderId;
  finalSummarizer: ProviderId;
  mode: "automatic";
};

export type RoundtableSessionState = "draft" | "ready" | "running" | "paused" | "summarizing" | "complete" | "error";

export type RoundtableSession = {
  id: string;
  title: string;
  mainProvider: ProviderId;
  mainTabId?: number;
  createdAt: string;
  updatedAt: string;
  importedContextAt?: string;
  state: RoundtableSessionState;
  participants: RoundtableParticipant[];
  plan: RoundtablePlan;
  messages: RoundtableMessage[];
};

export type RoundtableCreateInput = {
  title: string;
  objective: string;
  mainProvider: ProviderId;
  mainTabId?: number;
  participantProviders: ProviderId[];
  maxRounds: number;
};
```

- [ ] **Step 4: Implement minimal session model**

Create `extensions/web-agents-extension/src/sessions/roundtable.ts`:

```ts
import { getDefaultParticipants } from "../providers/catalog";
import type {
  ProviderId,
  RoundtableCreateInput,
  RoundtableMessage,
  RoundtableParticipant,
  RoundtableParticipantState,
  RoundtableSession
} from "../shared/types";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTitle(title: string): string {
  return title.trim().slice(0, 48) || "未命名圆桌会话";
}

function createParticipants(input: RoundtableCreateInput): RoundtableParticipant[] {
  const selected = new Set<ProviderId>([input.mainProvider, ...input.participantProviders]);
  return getDefaultParticipants()
    .filter((participant) => participant.provider !== "unknown")
    .map((participant) => {
      const isMain = participant.provider === input.mainProvider;
      const enabled = selected.has(participant.provider);
      return {
        provider: participant.provider,
        label: participant.label,
        role: isMain ? "main" : "participant",
        enabled,
        tabId: isMain ? input.mainTabId : undefined,
        state: enabled ? "ready" : "not_open"
      };
    });
}

export function createRoundtableSession(input: RoundtableCreateInput): RoundtableSession {
  const createdAt = nowIso();
  const firstParticipant = input.participantProviders[0] ?? input.mainProvider;
  return {
    id: createId("roundtable"),
    title: normalizeTitle(input.title),
    mainProvider: input.mainProvider,
    mainTabId: input.mainTabId,
    createdAt,
    updatedAt: createdAt,
    state: "ready",
    participants: createParticipants(input),
    plan: {
      objective: input.objective.trim(),
      maxRounds: input.maxRounds,
      currentRound: 1,
      nextProvider: firstParticipant,
      finalSummarizer: input.mainProvider,
      mode: "automatic"
    },
    messages: []
  };
}

export function appendRoundtableMessage(
  session: RoundtableSession,
  message: Omit<RoundtableMessage, "id" | "sessionId" | "createdAt">
): RoundtableSession {
  const createdAt = nowIso();
  return {
    ...session,
    updatedAt: createdAt,
    messages: [
      ...session.messages,
      {
        ...message,
        id: createId("rt-msg"),
        sessionId: session.id,
        createdAt
      }
    ]
  };
}

export function joinRoundtableParticipant(
  session: RoundtableSession,
  provider: ProviderId,
  tabId?: number
): RoundtableSession {
  const updatedAt = nowIso();
  return {
    ...session,
    updatedAt,
    participants: session.participants.map((participant) =>
      participant.provider === provider
        ? {
            ...participant,
            enabled: true,
            tabId: tabId ?? participant.tabId,
            state: "ready",
            error: undefined
          }
        : participant
    )
  };
}

export function markRoundtableParticipantState(
  session: RoundtableSession,
  provider: ProviderId,
  state: RoundtableParticipantState,
  patch: Partial<RoundtableParticipant> = {}
): RoundtableSession {
  const updatedAt = nowIso();
  return {
    ...session,
    updatedAt,
    participants: session.participants.map((participant) =>
      participant.provider === provider ? { ...participant, ...patch, state } : participant
    )
  };
}

export function getNextRoundtableProvider(session: RoundtableSession): ProviderId | undefined {
  return session.plan.nextProvider;
}
```

- [ ] **Step 5: Run model tests**

Run:

```powershell
npm test -- src/sessions/roundtable.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add extensions/web-agents-extension/src/shared/types.ts extensions/web-agents-extension/src/sessions/roundtable.ts extensions/web-agents-extension/src/sessions/roundtable.test.ts
git commit -m "Add roundtable session model"
```

---

### Task 2: Context Packet Builder

**Files:**
- Create: `extensions/web-agents-extension/src/sessions/context-packet.ts`
- Create: `extensions/web-agents-extension/src/sessions/context-packet.test.ts`

- [ ] **Step 1: Write failing context packet tests**

Create `extensions/web-agents-extension/src/sessions/context-packet.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
npm test -- src/sessions/context-packet.test.ts
```

Expected: FAIL because `./context-packet` does not exist.

- [ ] **Step 3: Implement context packet builder**

Create `extensions/web-agents-extension/src/sessions/context-packet.ts`:

```ts
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
```

- [ ] **Step 4: Run packet tests**

```powershell
npm test -- src/sessions/context-packet.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add extensions/web-agents-extension/src/sessions/context-packet.ts extensions/web-agents-extension/src/sessions/context-packet.test.ts
git commit -m "Build roundtable context packets"
```

---

### Task 3: Recent Conversation Capture

**Files:**
- Modify: `extensions/web-agents-extension/src/shared/types.ts`
- Modify: `extensions/web-agents-extension/src/shared/messages.ts`
- Modify: `extensions/web-agents-extension/src/adapters/dom.ts`
- Modify: `extensions/web-agents-extension/src/adapters/dom.test.ts`
- Modify: `extensions/web-agents-extension/src/content/index.ts`

- [ ] **Step 1: Add failing DOM capture tests**

Append to `extensions/web-agents-extension/src/adapters/dom.test.ts`:

```ts
import { captureRecentConversation } from "./dom";

describe("recent conversation capture", () => {
  it("captures bounded recent visible messages", () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="user" style="width:500px;height:40px">用户问题</article>
        <article data-message-author-role="assistant" style="width:500px;height:80px">GPT 初步回答内容足够长，用于模拟真实回复。</article>
        <article data-message-author-role="assistant" style="width:500px;height:80px">GPT 第二条回答内容足够长，用于模拟真实回复。</article>
      </main>
    `;

    const capture = captureRecentConversation(document, "chatgpt", undefined, 2);

    expect(capture.provider).toBe("chatgpt");
    expect(capture.messages).toHaveLength(2);
    expect(capture.messages[0].text).toContain("GPT 初步回答");
    expect(capture.messages[1].text).toContain("GPT 第二条回答");
  });
});
```

- [ ] **Step 2: Run DOM test to verify failure**

```powershell
npm test -- src/adapters/dom.test.ts
```

Expected: FAIL because `captureRecentConversation` is not exported.

- [ ] **Step 3: Add recent capture types**

Append to `extensions/web-agents-extension/src/shared/types.ts`:

```ts
export type RecentConversationMessage = {
  speaker: "user" | "assistant" | "unknown";
  text: string;
  source: string;
};

export type RecentConversationCapture = {
  provider: ProviderId;
  capturedAt: string;
  messages: RecentConversationMessage[];
};
```

- [ ] **Step 4: Add message API types**

Modify `extensions/web-agents-extension/src/shared/messages.ts`.

Add `RecentConversationCapture` to the import list from `./types`.

Add to `ExtensionRequest`:

```ts
| { type: "tab:capture-recent"; tabId?: number; limit?: number }
```

Add to `ExtensionResponseMap`:

```ts
"tab:capture-recent": RecentConversationCapture;
```

- [ ] **Step 5: Implement recent capture helper**

Add to `extensions/web-agents-extension/src/adapters/dom.ts`:

```ts
import type { ProviderId, RecentConversationCapture, RecentConversationMessage, ResponseSnapshot } from "../shared/types";
```

If `ProviderId` and `ResponseSnapshot` are already imported on one line, update that line rather than creating a duplicate import.

Then append:

```ts
function inferSpeaker(element: HTMLElement): RecentConversationMessage["speaker"] {
  const authorRole = element.getAttribute("data-message-author-role")?.toLowerCase();
  if (authorRole === "user") return "user";
  if (authorRole === "assistant") return "assistant";

  const text = `${element.className} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();
  if (text.includes("user")) return "user";
  if (text.includes("assistant") || text.includes("model") || text.includes("gpt")) return "assistant";
  return "unknown";
}

export function captureRecentConversation(
  documentRef: Document,
  provider: ProviderId,
  providerDefinition: ProviderCatalogEntry | undefined,
  limit = 8
): RecentConversationCapture {
  const messages = mergeResponseSelectors(providerDefinition)
    .flatMap((selector) => Array.from(documentRef.querySelectorAll<HTMLElement>(selector)))
    .filter(isVisible)
    .map((element) => ({
      speaker: inferSpeaker(element),
      text: cleanText(element.innerText || element.textContent || ""),
      source: element.tagName.toLowerCase()
    }))
    .filter((item) => item.text.length > 2)
    .slice(-limit);

  return {
    provider,
    capturedAt: new Date().toISOString(),
    messages
  };
}
```

- [ ] **Step 6: Wire content message handler**

In `extensions/web-agents-extension/src/content/index.ts`, import `detectProviderByHostname` is already present. Add `captureRecentConversation` only if content currently imports DOM helpers directly; otherwise use adapter pattern if extended. The minimal implementation is:

```ts
import { captureRecentConversation } from "../adapters/dom";
```

Add this case in `chrome.runtime.onMessage.addListener` before the final return:

```ts
if (message.type === "tab:capture-recent") {
  const provider = detectProviderByHostname(window.location.hostname);
  const providerId = provider?.id ?? "unknown";
  const limit = "limit" in message && typeof message.limit === "number" ? message.limit : 8;
  const capture = captureRecentConversation(document, providerId, provider, limit);
  sendResponse({ ok: true, type: "tab:capture-recent", data: capture });
  return false;
}
```

- [ ] **Step 7: Route background tab message**

In `extensions/web-agents-extension/src/background/index.ts`, extend the `sendToTab` switch group:

```ts
case "tab:detect":
case "tab:insert-text":
case "tab:capture-latest":
case "tab:capture-recent": {
  sendResponse(await sendToTab(message, sender.tab?.id));
  return;
}
```

- [ ] **Step 8: Run capture tests**

```powershell
npm test -- src/adapters/dom.test.ts
npm test -- src/content/tool-call-scanner.test.ts src/content/auto-submit.test.ts
```

Expected: PASS. The second command checks no content-adjacent regressions.

- [ ] **Step 9: Commit Task 3**

```powershell
git add extensions/web-agents-extension/src/shared/types.ts extensions/web-agents-extension/src/shared/messages.ts extensions/web-agents-extension/src/adapters/dom.ts extensions/web-agents-extension/src/adapters/dom.test.ts extensions/web-agents-extension/src/content/index.ts extensions/web-agents-extension/src/background/index.ts
git commit -m "Capture recent provider conversation context"
```

---

### Task 4: Structured Auto-Send Tab API

**Files:**
- Modify: `extensions/web-agents-extension/src/shared/types.ts`
- Modify: `extensions/web-agents-extension/src/shared/messages.ts`
- Modify: `extensions/web-agents-extension/src/content/auto-submit.ts`
- Modify: `extensions/web-agents-extension/src/content/auto-submit.test.ts`
- Modify: `extensions/web-agents-extension/src/content/index.ts`
- Modify: `extensions/web-agents-extension/src/background/index.ts`

- [ ] **Step 1: Add failing auto-send API tests**

Append to `extensions/web-agents-extension/src/content/auto-submit.test.ts`:

```ts
it("returns a stable no_submit result without leaving text behind", async () => {
  document.body.innerHTML = `
    <form>
      <textarea style="width:240px;height:48px"></textarea>
    </form>
  `;

  const result = await sendTextIfComposerIdle(document, undefined, "<roundtable>next</roundtable>");

  expect(result.state).toBe("no_submit");
  expect(result.message).toContain("不可发送");
  expect(document.querySelector("textarea")?.value).toBe("");
});
```

This may already pass. Keep it as a regression guard.

- [ ] **Step 2: Add shared auto-send types**

Append to `extensions/web-agents-extension/src/shared/types.ts`:

```ts
export type AutoSendState = "sent" | "no_input" | "input_busy" | "no_submit";

export type AutoSendResult = {
  state: AutoSendState;
  message: string;
};
```

Then in `extensions/web-agents-extension/src/content/auto-submit.ts`, replace the local `AutoSubmitState` and `AutoSubmitResult` definitions with aliases to shared types:

```ts
import type { AutoSendResult, AutoSendState } from "../shared/types";

export type AutoSubmitState = AutoSendState;
export type AutoSubmitResult = AutoSendResult;
```

- [ ] **Step 3: Add message API**

Modify `extensions/web-agents-extension/src/shared/messages.ts`.

Add `AutoSendResult` to the type imports.

Add to `ExtensionRequest`:

```ts
| { type: "tab:auto-send-text"; text: string; tabId?: number }
```

Add to `ExtensionResponseMap`:

```ts
"tab:auto-send-text": AutoSendResult;
```

- [ ] **Step 4: Wire content handler**

In `extensions/web-agents-extension/src/content/index.ts`, add:

```ts
if (message.type === "tab:auto-send-text") {
  const text = "text" in message && typeof message.text === "string" ? message.text : "";
  const provider = detectProviderByHostname(window.location.hostname);
  void sendTextIfComposerIdle(document, provider, text).then((result) => {
    sendResponse({ ok: true, type: "tab:auto-send-text", data: result });
  });
  return true;
}
```

- [ ] **Step 5: Route background tab message**

In `extensions/web-agents-extension/src/background/index.ts`, extend the send-to-tab group:

```ts
case "tab:detect":
case "tab:insert-text":
case "tab:auto-send-text":
case "tab:capture-latest":
case "tab:capture-recent": {
  sendResponse(await sendToTab(message, sender.tab?.id));
  return;
}
```

- [ ] **Step 6: Run auto-submit tests**

```powershell
npm test -- src/content/auto-submit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add extensions/web-agents-extension/src/shared/types.ts extensions/web-agents-extension/src/shared/messages.ts extensions/web-agents-extension/src/content/auto-submit.ts extensions/web-agents-extension/src/content/auto-submit.test.ts extensions/web-agents-extension/src/content/index.ts extensions/web-agents-extension/src/background/index.ts
git commit -m "Expose structured roundtable auto-send API"
```

---

### Task 5: Background Roundtable Orchestrator

**Files:**
- Create: `extensions/web-agents-extension/src/background/roundtable-orchestrator.ts`
- Create: `extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts`
- Modify: `extensions/web-agents-extension/src/background/index.ts`
- Modify: `extensions/web-agents-extension/src/shared/messages.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Create `extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createRoundtableSession } from "../sessions/roundtable";
import { createRoundtableOrchestrator } from "./roundtable-orchestrator";
import type { ExtensionResponse } from "../shared/messages";

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
      })) as never
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
    const orchestrator = createRoundtableOrchestrator({ sendToTab: sendToTab as never });

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
    const orchestrator = createRoundtableOrchestrator({ sendToTab: sendToTab as never });

    const waiting = await orchestrator.step(session);
    const captured = await orchestrator.capture(waiting, "deepseek");

    expect(captured.messages.at(-1)?.text).toContain("验收标准");
    expect(captured.plan.nextProvider).toBe("chatgpt");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
npm test -- src/background/roundtable-orchestrator.test.ts
```

Expected: FAIL because orchestrator does not exist.

- [ ] **Step 3: Implement orchestrator**

Create `extensions/web-agents-extension/src/background/roundtable-orchestrator.ts`:

```ts
import { buildFinalSummaryPacket, buildParticipantContextPacket } from "../sessions/context-packet";
import {
  appendRoundtableMessage,
  markRoundtableParticipantState
} from "../sessions/roundtable";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import type { ProviderId, RoundtableSession } from "../shared/types";

type SendToTab = <T extends ExtensionRequest["type"]>(
  request: ExtensionRequest,
  senderTabId?: number
) => Promise<ExtensionResponse<T>>;

type OrchestratorDeps = {
  sendToTab: SendToTab;
};

function participantTabId(session: RoundtableSession, provider: ProviderId): number | undefined {
  if (provider === session.mainProvider) return session.mainTabId;
  return session.participants.find((participant) => participant.provider === provider)?.tabId;
}

function nextAfterCapture(session: RoundtableSession, provider: ProviderId): RoundtableSession["plan"] {
  if (provider === session.mainProvider) {
    const currentRound = session.plan.currentRound + 1;
    const nextProvider = currentRound > session.plan.maxRounds ? undefined : "deepseek";
    return { ...session.plan, currentRound, nextProvider };
  }

  return { ...session.plan, nextProvider: session.mainProvider };
}

export function createRoundtableOrchestrator(deps: OrchestratorDeps) {
  return {
    async importMainContext(session: RoundtableSession): Promise<RoundtableSession> {
      const response = await deps.sendToTab<"tab:capture-recent">({
        type: "tab:capture-recent",
        tabId: session.mainTabId,
        limit: 8
      });

      if (!response.ok) {
        return {
          ...session,
          state: "paused",
          participants: session.participants.map((participant) =>
            participant.provider === session.mainProvider
              ? { ...participant, state: "error", error: response.error }
              : participant
          )
        };
      }

      let next: RoundtableSession = {
        ...session,
        importedContextAt: response.data.capturedAt
      };

      for (const message of response.data.messages) {
        next = appendRoundtableMessage(next, {
          speaker: message.speaker === "assistant" ? session.mainProvider : message.speaker === "user" ? "user" : "system",
          provider: message.speaker === "assistant" ? session.mainProvider : undefined,
          text: message.text,
          source: "main_window_import"
        });
      }

      return next;
    },

    async step(session: RoundtableSession): Promise<RoundtableSession> {
      const targetProvider = session.plan.nextProvider;
      if (!targetProvider) return { ...session, state: "complete" };

      const tabId = participantTabId(session, targetProvider);
      const packet =
        targetProvider === session.mainProvider && session.state === "summarizing"
          ? buildFinalSummaryPacket(session, { maxCharacters: 6000 })
          : buildParticipantContextPacket(session, {
              targetProvider,
              turnInstruction:
                targetProvider === session.mainProvider
                  ? "请回应上一位参与者的观点，并推进本轮讨论。"
                  : "请回应 GPT 的观点，指出补充、反驳和可执行建议。",
              maxCharacters: 6000
            });

      const sending = markRoundtableParticipantState({ ...session, state: "running" }, targetProvider, "sending");
      const response = await deps.sendToTab<"tab:auto-send-text">({
        type: "tab:auto-send-text",
        tabId,
        text: packet
      });

      if (!response.ok) {
        return markRoundtableParticipantState(
          { ...sending, state: "paused" },
          targetProvider,
          "error",
          { error: response.error }
        );
      }

      if (response.data.state !== "sent") {
        return markRoundtableParticipantState(
          { ...sending, state: "paused" },
          targetProvider,
          "error",
          { error: response.data.message }
        );
      }

      return markRoundtableParticipantState(sending, targetProvider, "waiting_response");
    },

    async capture(session: RoundtableSession, provider: ProviderId): Promise<RoundtableSession> {
      const tabId = participantTabId(session, provider);
      const response = await deps.sendToTab<"tab:capture-latest">({
        type: "tab:capture-latest",
        tabId
      });

      if (!response.ok) {
        return markRoundtableParticipantState(
          { ...session, state: "paused" },
          provider,
          "error",
          { error: response.error }
        );
      }

      const withMessage = appendRoundtableMessage(session, {
        speaker: provider,
        provider,
        text: response.data.text,
        source: "provider_capture",
        round: session.plan.currentRound
      });

      return markRoundtableParticipantState(
        {
          ...withMessage,
          plan: nextAfterCapture(session, provider),
          state: "running"
        },
        provider,
        "captured"
      );
    },

    async summarize(session: RoundtableSession): Promise<RoundtableSession> {
      return this.step({
        ...session,
        state: "summarizing",
        plan: { ...session.plan, nextProvider: session.mainProvider }
      });
    }
  };
}
```

- [ ] **Step 4: Run orchestrator tests**

```powershell
npm test -- src/background/roundtable-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add roundtable message types**

Modify `extensions/web-agents-extension/src/shared/messages.ts`.

Add `RoundtableSession` to imports.

Add to `ExtensionRequest`:

```ts
| {
    type: "roundtable:create";
    title: string;
    objective: string;
    mainProvider: ProviderId;
    mainTabId?: number;
    participantProviders: ProviderId[];
    maxRounds: number;
  }
| { type: "roundtable:import-main-context"; sessionId: string }
| { type: "roundtable:start"; sessionId: string }
| { type: "roundtable:pause"; sessionId: string }
| { type: "roundtable:step"; sessionId: string }
| { type: "roundtable:capture"; sessionId: string; provider: ProviderId }
| { type: "roundtable:summarize"; sessionId: string }
| { type: "roundtable:get"; sessionId: string }
```

Add to `ExtensionResponseMap`:

```ts
"roundtable:create": RoundtableSession;
"roundtable:import-main-context": RoundtableSession;
"roundtable:start": RoundtableSession;
"roundtable:pause": RoundtableSession;
"roundtable:step": RoundtableSession;
"roundtable:capture": RoundtableSession;
"roundtable:summarize": RoundtableSession;
"roundtable:get": RoundtableSession;
```

- [ ] **Step 6: Store sessions in background**

In `extensions/web-agents-extension/src/background/index.ts`, import:

```ts
import { createRoundtableOrchestrator } from "./roundtable-orchestrator";
import { createRoundtableSession } from "../sessions/roundtable";
import type { RoundtableSession } from "../shared/types";
```

Add near config constants:

```ts
const roundtableSessions = new Map<string, RoundtableSession>();
```

Add helper near `sendToTab`:

```ts
const roundtableOrchestrator = createRoundtableOrchestrator({ sendToTab });

function getRoundtableSessionOrError(sessionId: string): RoundtableSession {
  const session = roundtableSessions.get(sessionId);
  if (!session) throw new Error("未找到圆桌会话。");
  return session;
}

function saveRoundtableSession(session: RoundtableSession): RoundtableSession {
  roundtableSessions.set(session.id, session);
  return session;
}
```

Add switch cases before tab routing:

```ts
case "roundtable:create": {
  const session = saveRoundtableSession(
    createRoundtableSession({
      title: message.title,
      objective: message.objective,
      mainProvider: message.mainProvider,
      mainTabId: message.mainTabId ?? sender.tab?.id,
      participantProviders: message.participantProviders,
      maxRounds: message.maxRounds
    })
  );
  sendResponse({ ok: true, type: message.type, data: session });
  return;
}
case "roundtable:import-main-context": {
  const session = getRoundtableSessionOrError(message.sessionId);
  const next = saveRoundtableSession(await roundtableOrchestrator.importMainContext(session));
  sendResponse({ ok: true, type: message.type, data: next });
  return;
}
case "roundtable:start":
case "roundtable:step": {
  const session = getRoundtableSessionOrError(message.sessionId);
  const next = saveRoundtableSession(await roundtableOrchestrator.step(session));
  sendResponse({ ok: true, type: message.type, data: next });
  return;
}
case "roundtable:capture": {
  const session = getRoundtableSessionOrError(message.sessionId);
  const next = saveRoundtableSession(await roundtableOrchestrator.capture(session, message.provider));
  sendResponse({ ok: true, type: message.type, data: next });
  return;
}
case "roundtable:summarize": {
  const session = getRoundtableSessionOrError(message.sessionId);
  const next = saveRoundtableSession(await roundtableOrchestrator.summarize(session));
  sendResponse({ ok: true, type: message.type, data: next });
  return;
}
case "roundtable:pause": {
  const session = getRoundtableSessionOrError(message.sessionId);
  const next = saveRoundtableSession({ ...session, state: "paused", updatedAt: new Date().toISOString() });
  sendResponse({ ok: true, type: message.type, data: next });
  return;
}
case "roundtable:get": {
  sendResponse({ ok: true, type: message.type, data: getRoundtableSessionOrError(message.sessionId) });
  return;
}
```

- [ ] **Step 7: Run background-related tests**

```powershell
npm test -- src/background/roundtable-orchestrator.test.ts src/mcp/tool-call-executor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```powershell
git add extensions/web-agents-extension/src/background/roundtable-orchestrator.ts extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts extensions/web-agents-extension/src/background/index.ts extensions/web-agents-extension/src/shared/messages.ts
git commit -m "Add roundtable background orchestrator"
```

---

### Task 6: Roundtable Session UI

**Files:**
- Create: `extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.tsx`
- Modify: `extensions/web-agents-extension/src/ui/App.tsx`
- Modify: `extensions/web-agents-extension/src/ui/styles.css`
- Modify: `extensions/web-agents-extension/src/i18n/zh-CN.json`
- Modify: `extensions/web-agents-extension/src/i18n/en.json`

- [ ] **Step 1: Add i18n keys**

Add these keys to `extensions/web-agents-extension/src/i18n/zh-CN.json`:

```json
{
  "roundtable.title": "圆桌会话",
  "roundtable.subtitle": "在插件内维护共享上下文，让多个网页模型围绕同一条讨论记录协作。",
  "roundtable.create": "启动圆桌",
  "roundtable.import": "搬运主窗口记录",
  "roundtable.start": "开始自动讨论",
  "roundtable.pause": "暂停",
  "roundtable.step": "推进一步",
  "roundtable.capture": "捕获当前回复",
  "roundtable.summarize": "让 GPT 汇总",
  "roundtable.objective": "讨论目标",
  "roundtable.objectivePlaceholder": "例如：你和 GPT 讨论五轮，最后给我一个方案。",
  "roundtable.ledger": "共享讨论记录",
  "roundtable.participants": "参与者",
  "roundtable.mainWindow": "主窗口",
  "roundtable.imported": "已搬运主窗口记录",
  "roundtable.notImported": "尚未搬运主窗口记录",
  "roundtable.next": "下一步",
  "roundtable.round": "轮次",
  "roundtable.empty": "启动圆桌后，这里会显示 GPT、DeepSeek、豆包、Gemini 的共享讨论记录。",
  "roundtable.addGuidance": "发送到会话",
  "roundtable.guidancePlaceholder": "中途引导，例如：让 Gemini 也加入，重点审查落地风险。"
}
```

Add matching keys to `extensions/web-agents-extension/src/i18n/en.json`:

```json
{
  "roundtable.title": "Roundtable Session",
  "roundtable.subtitle": "Keep shared context inside Web Agents while multiple web models collaborate on one discussion.",
  "roundtable.create": "Start roundtable",
  "roundtable.import": "Import main-window context",
  "roundtable.start": "Start automation",
  "roundtable.pause": "Pause",
  "roundtable.step": "Step once",
  "roundtable.capture": "Capture current reply",
  "roundtable.summarize": "Ask GPT to summarize",
  "roundtable.objective": "Objective",
  "roundtable.objectivePlaceholder": "Example: discuss with GPT for five rounds, then produce a plan.",
  "roundtable.ledger": "Shared discussion ledger",
  "roundtable.participants": "Participants",
  "roundtable.mainWindow": "Main window",
  "roundtable.imported": "Main-window context imported",
  "roundtable.notImported": "Main-window context not imported",
  "roundtable.next": "Next",
  "roundtable.round": "Round",
  "roundtable.empty": "After starting a roundtable, shared GPT, DeepSeek, Doubao, and Gemini messages appear here.",
  "roundtable.addGuidance": "Send to session",
  "roundtable.guidancePlaceholder": "Mid-session guidance, such as: ask Gemini to join and review delivery risk."
}
```

- [ ] **Step 2: Create UI panel component**

Create `extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.tsx`:

```tsx
import type { ProviderId, RoundtableSession } from "../../shared/types";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";

type RoundtableSessionPanelProps = {
  session?: RoundtableSession;
  currentProvider: ProviderId;
  objective: string;
  guidance: string;
  t(key: string): string;
  onObjectiveChange(value: string): void;
  onGuidanceChange(value: string): void;
  onCreate(): void;
  onImport(): void;
  onStart(): void;
  onPause(): void;
  onStep(): void;
  onCapture(provider: ProviderId): void;
  onSummarize(): void;
  onAddGuidance(): void;
};

const toneByState = {
  not_open: "neutral",
  opening: "warning",
  ready: "success",
  sending: "warning",
  waiting_response: "warning",
  captured: "success",
  paused: "warning",
  error: "danger"
} as const;

export function RoundtableSessionPanel({
  session,
  currentProvider,
  objective,
  guidance,
  t,
  onObjectiveChange,
  onGuidanceChange,
  onCreate,
  onImport,
  onStart,
  onPause,
  onStep,
  onCapture,
  onSummarize,
  onAddGuidance
}: RoundtableSessionPanelProps) {
  const currentRound = session?.plan.currentRound ?? 1;
  const maxRounds = session?.plan.maxRounds ?? 5;
  const nextProvider = session?.plan.nextProvider ?? "unknown";

  return (
    <Section title={t("roundtable.title")} action={<button className="ghost-button" onClick={onCreate}>{t("roundtable.create")}</button>}>
      <p className="muted-text">{t("roundtable.subtitle")}</p>

      <div className="roundtable-shell">
        <aside className="roundtable-rail">
          <label className="roundtable-label" htmlFor="roundtable-objective">{t("roundtable.objective")}</label>
          <textarea
            id="roundtable-objective"
            className="roundtable-objective"
            value={objective}
            placeholder={t("roundtable.objectivePlaceholder")}
            onChange={(event) => onObjectiveChange(event.target.value)}
          />

          <div className="roundtable-fact">
            <span>{t("roundtable.mainWindow")}</span>
            <strong>{currentProvider === "unknown" ? t("common.unknown") : currentProvider}</strong>
          </div>
          <div className="roundtable-fact">
            <span>{t("roundtable.round")}</span>
            <strong>{currentRound} / {maxRounds}</strong>
          </div>
          <div className="roundtable-fact">
            <span>{t("roundtable.next")}</span>
            <strong>{nextProvider}</strong>
          </div>
          <div className="roundtable-fact">
            <span>{session?.importedContextAt ? t("roundtable.imported") : t("roundtable.notImported")}</span>
          </div>

          <div className="roundtable-actions">
            <button className="mini-button" disabled={!session} onClick={onImport}>{t("roundtable.import")}</button>
            <button className="mini-button" disabled={!session} onClick={onStart}>{t("roundtable.start")}</button>
            <button className="mini-button" disabled={!session} onClick={onPause}>{t("roundtable.pause")}</button>
            <button className="mini-button" disabled={!session} onClick={onStep}>{t("roundtable.step")}</button>
            <button className="mini-button" disabled={!session} onClick={onSummarize}>{t("roundtable.summarize")}</button>
          </div>

          <h3>{t("roundtable.participants")}</h3>
          <div className="roundtable-participants">
            {(session?.participants ?? []).map((participant) => (
              <div className="roundtable-participant" key={participant.provider}>
                <span>{participant.label}</span>
                <StatusBadge tone={toneByState[participant.state]}>{participant.state}</StatusBadge>
                <button className="mini-button" disabled={!participant.enabled} onClick={() => onCapture(participant.provider)}>
                  {t("roundtable.capture")}
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="roundtable-ledger">
          <h3>{t("roundtable.ledger")}</h3>
          {session?.messages.length ? (
            <div className="roundtable-messages">
              {session.messages.map((message) => (
                <article className="roundtable-message" data-speaker={message.speaker} key={message.id}>
                  <strong>{message.speaker}</strong>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-text">{t("roundtable.empty")}</p>
          )}

          <div className="roundtable-composer">
            <textarea
              value={guidance}
              placeholder={t("roundtable.guidancePlaceholder")}
              onChange={(event) => onGuidanceChange(event.target.value)}
            />
            <button className="primary-button" disabled={!session || !guidance.trim()} onClick={onAddGuidance}>
              {t("roundtable.addGuidance")}
            </button>
          </div>
        </section>
      </div>
    </Section>
  );
}
```

- [ ] **Step 3: Wire App state and callbacks**

Modify `extensions/web-agents-extension/src/ui/App.tsx`.

Add imports:

```ts
import { RoundtableSessionPanel } from "./panels/RoundtableSessionPanel";
import type { RoundtableSession } from "../shared/types";
```

Add state:

```ts
const [roundtableObjective, setRoundtableObjective] = useState("你和 GPT 讨论五轮，最后给我一个方案。");
const [roundtableGuidance, setRoundtableGuidance] = useState("");
const [roundtableSession, setRoundtableSession] = useState<RoundtableSession | undefined>();
```

Add callbacks:

```ts
const createRoundtable = useCallback(async () => {
  const response = await sendMessage<"roundtable:create">({
    type: "roundtable:create",
    title: taskText.trim().slice(0, 48) || t("roundtable.title"),
    objective: roundtableObjective,
    mainProvider: pageStatus.provider,
    mainTabId: pageStatus.tabId,
    participantProviders: ["deepseek"],
    maxRounds: 5
  });
  if (response.ok) {
    setRoundtableSession(response.data);
    setFeedback(t("roundtable.create"));
  } else {
    setFeedback(response.error);
  }
}, [pageStatus.provider, pageStatus.tabId, roundtableObjective, t, taskText]);

const updateRoundtable = useCallback(async <T extends ExtensionRequest["type"]>(request: ExtensionRequest) => {
  const response = await sendMessage<T>(request);
  if (response.ok) {
    setRoundtableSession(response.data as RoundtableSession);
  } else {
    setFeedback(response.error);
  }
}, []);

const addRoundtableGuidance = useCallback(() => {
  if (!roundtableSession || !roundtableGuidance.trim()) return;
  setRoundtableSession({
    ...roundtableSession,
    messages: [
      ...roundtableSession.messages,
      {
        id: `ui-msg-${Date.now()}`,
        sessionId: roundtableSession.id,
        speaker: "user",
        text: roundtableGuidance,
        source: "web_agents_user",
        createdAt: new Date().toISOString()
      }
    ],
    updatedAt: new Date().toISOString()
  });
  setRoundtableGuidance("");
}, [roundtableGuidance, roundtableSession]);
```

Add the panel before `MultiModelBoard`:

```tsx
<RoundtableSessionPanel
  currentProvider={pageStatus.provider}
  guidance={roundtableGuidance}
  objective={roundtableObjective}
  session={roundtableSession}
  t={t}
  onAddGuidance={addRoundtableGuidance}
  onCapture={(provider) => roundtableSession && void updateRoundtable<"roundtable:capture">({ type: "roundtable:capture", sessionId: roundtableSession.id, provider })}
  onCreate={() => void createRoundtable()}
  onGuidanceChange={setRoundtableGuidance}
  onImport={() => roundtableSession && void updateRoundtable<"roundtable:import-main-context">({ type: "roundtable:import-main-context", sessionId: roundtableSession.id })}
  onObjectiveChange={setRoundtableObjective}
  onPause={() => roundtableSession && void updateRoundtable<"roundtable:pause">({ type: "roundtable:pause", sessionId: roundtableSession.id })}
  onStart={() => roundtableSession && void updateRoundtable<"roundtable:start">({ type: "roundtable:start", sessionId: roundtableSession.id })}
  onStep={() => roundtableSession && void updateRoundtable<"roundtable:step">({ type: "roundtable:step", sessionId: roundtableSession.id })}
  onSummarize={() => roundtableSession && void updateRoundtable<"roundtable:summarize">({ type: "roundtable:summarize", sessionId: roundtableSession.id })}
/>
```

If TypeScript complains because `updateRoundtable` receives responses whose `data` is not always `RoundtableSession`, replace it with explicit callbacks per message type instead of a generic helper.

- [ ] **Step 4: Add styles**

Append to `extensions/web-agents-extension/src/ui/styles.css`:

```css
.roundtable-shell {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.roundtable-rail {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
  border-right: 1px solid #e6ebf0;
  padding-right: 10px;
}

.roundtable-label,
.roundtable-rail h3,
.roundtable-ledger h3 {
  margin: 0;
  color: #253241;
  font-size: 11px;
  font-weight: 760;
}

.roundtable-objective,
.roundtable-composer textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border: 1px solid #d9dee5;
  border-radius: 8px;
  padding: 8px;
  background: #fbfcfd;
  color: #17202a;
  font-size: 12px;
  line-height: 1.45;
}

.roundtable-fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 8px;
  background: #f4f6f8;
  padding: 8px;
  color: #617080;
  font-size: 11px;
}

.roundtable-fact strong {
  color: #17202a;
  font-size: 12px;
}

.roundtable-actions,
.roundtable-participants {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.roundtable-participant {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  border-radius: 8px;
  background: #f4f6f8;
  padding: 7px;
  font-size: 11px;
}

.roundtable-participant .mini-button {
  grid-column: 1 / -1;
}

.roundtable-ledger {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.roundtable-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  overflow: auto;
  border: 1px solid #e6ebf0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 9px;
}

.roundtable-message {
  border-radius: 8px;
  background: #ffffff;
  padding: 8px;
  border: 1px solid #e6ebf0;
}

.roundtable-message strong {
  display: block;
  margin-bottom: 4px;
  color: #1d4ed8;
  font-size: 11px;
}

.roundtable-message p {
  margin: 0;
  color: #253241;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.roundtable-composer {
  display: grid;
  gap: 8px;
}
```

- [ ] **Step 5: Run typecheck/build**

```powershell
npm run typecheck
npm run build
```

Expected: PASS. If React component tests are added, run them with `npm test -- src/ui/panels/RoundtableSessionPanel.test.tsx`.

- [ ] **Step 6: Commit Task 6**

```powershell
git add extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.tsx extensions/web-agents-extension/src/ui/App.tsx extensions/web-agents-extension/src/ui/styles.css extensions/web-agents-extension/src/i18n/zh-CN.json extensions/web-agents-extension/src/i18n/en.json
git commit -m "Add roundtable session panel"
```

---

### Task 7: Gemini And Doubao Join Support

**Files:**
- Modify: `extensions/web-agents-extension/src/shared/messages.ts`
- Modify: `extensions/web-agents-extension/src/background/index.ts`
- Modify: `extensions/web-agents-extension/src/background/roundtable-orchestrator.ts`
- Modify: `extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts`
- Modify: `extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.tsx`
- Modify: `extensions/web-agents-extension/src/ui/App.tsx`

- [ ] **Step 1: Add failing join test**

Append to `extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts`:

```ts
it("sends late join context to Gemini", async () => {
  const session = createRoundtableSession({
    title: "项目路线讨论",
    objective: "讨论五轮",
    mainProvider: "chatgpt",
    participantProviders: ["deepseek"],
    maxRounds: 5
  });
  const withGemini = {
    ...session,
    participants: session.participants.map((participant) =>
      participant.provider === "gemini"
        ? { ...participant, enabled: true, tabId: 88, state: "ready" as const }
        : participant
    ),
    plan: { ...session.plan, nextProvider: "gemini" as const }
  };
  const sendToTab = vi.fn(async (): Promise<ExtensionResponse<"tab:auto-send-text">> => ({
    ok: true,
    type: "tab:auto-send-text",
    data: { state: "sent", message: "已发送" }
  }));
  const orchestrator = createRoundtableOrchestrator({ sendToTab: sendToTab as never });

  await orchestrator.step(withGemini);

  expect(sendToTab).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "tab:auto-send-text",
      tabId: 88,
      text: expect.stringContaining("共享讨论上下文")
    }),
    undefined
  );
});
```

- [ ] **Step 2: Add roundtable join message type**

In `extensions/web-agents-extension/src/shared/messages.ts`, add:

```ts
| { type: "roundtable:add-participant"; sessionId: string; provider: ProviderId; tabId?: number }
```

Add to response map:

```ts
"roundtable:add-participant": RoundtableSession;
```

- [ ] **Step 3: Implement background join case**

In `extensions/web-agents-extension/src/background/index.ts`, import:

```ts
import { joinRoundtableParticipant } from "../sessions/roundtable";
```

Add switch case:

```ts
case "roundtable:add-participant": {
  const session = getRoundtableSessionOrError(message.sessionId);
  const next = saveRoundtableSession(joinRoundtableParticipant(session, message.provider, message.tabId));
  sendResponse({ ok: true, type: message.type, data: next });
  return;
}
```

- [ ] **Step 4: Add UI participant action**

In `RoundtableSessionPanel.tsx`, add prop:

```ts
onAddParticipant(provider: ProviderId): void;
```

Add buttons below participant list:

```tsx
<div className="roundtable-actions">
  <button className="mini-button" disabled={!session} onClick={() => onAddParticipant("gemini")}>加入 Gemini</button>
  <button className="mini-button" disabled={!session} onClick={() => onAddParticipant("doubao")}>加入豆包</button>
</div>
```

In `App.tsx`, pass:

```tsx
onAddParticipant={(provider) =>
  roundtableSession &&
  void updateRoundtable<"roundtable:add-participant">({
    type: "roundtable:add-participant",
    sessionId: roundtableSession.id,
    provider
  })
}
```

- [ ] **Step 5: Run join tests and typecheck**

```powershell
npm test -- src/background/roundtable-orchestrator.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```powershell
git add extensions/web-agents-extension/src/shared/messages.ts extensions/web-agents-extension/src/background/index.ts extensions/web-agents-extension/src/background/roundtable-orchestrator.ts extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.tsx extensions/web-agents-extension/src/ui/App.tsx
git commit -m "Support late roundtable participants"
```

---

### Task 8: Full Verification And Manual Test Notes

**Files:**
- Create: `docs/roundtable-session-manual-test.md`

- [ ] **Step 1: Create manual test document**

Create `docs/roundtable-session-manual-test.md`:

```md
# Roundtable Session Manual Test

## Setup

1. Build the extension:
   `cd F:\web_agents-new-plugin-rewrite\extensions\web-agents-extension`
   `npm run build`
2. Load `extensions/web-agents-extension/dist` in Chrome or Edge.
3. Open ChatGPT and DeepSeek in signed-in browser tabs.
4. Start the local gateway only if MCP/tool calls are part of the test.

## GPT + DeepSeek MVP Test

1. In ChatGPT, ask:
   `如何确定一个项目真实的开发路线，从设计到落地？`
2. Wait for ChatGPT to answer.
3. Open Web Agents.
4. Create a roundtable session with objective:
   `你和 GPT 讨论五轮，最后给我一个方案。`
5. Import main-window context.
6. Confirm the shared ledger shows the user question and GPT answer.
7. Start automation.
8. Confirm DeepSeek receives a prompt containing shared context.
9. Capture DeepSeek reply.
10. Step back to GPT.
11. Confirm GPT receives DeepSeek context.
12. Send final summary to GPT.

## Gemini/Doubao Join Test

1. During the session, click `加入 Gemini`.
2. Add user guidance:
   `让 Gemini 也加入，重点审查落地风险。`
3. Step to Gemini.
4. Confirm Gemini receives recent shared ledger and the late-join instruction.

## Failure Recovery Test

1. Close or navigate away from DeepSeek.
2. Step the session.
3. Confirm Web Agents pauses with an error and does not loop or repeatedly flash text in the input.
```

- [ ] **Step 2: Run full automated verification**

```powershell
cd F:\web_agents-new-plugin-rewrite\extensions\web-agents-extension
npm test
npm run typecheck
npm run build
Select-String -Path dist\content.js -Pattern '^\s*import\s|\bfrom\s*["'']'
node -e "JSON.parse(require('fs').readFileSync('dist/manifest.json','utf8')); console.log('dist manifest ok')"
cd F:\web_agents-new-plugin-rewrite
git diff --check
```

Expected:

- `npm test`: all test files pass.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `Select-String`: no matches.
- manifest command prints `dist manifest ok`.
- `git diff --check`: no errors.

- [ ] **Step 3: Commit Task 8**

```powershell
git add docs/roundtable-session-manual-test.md
git commit -m "Document roundtable manual verification"
```

- [ ] **Step 4: Push branch**

```powershell
git push
```

Expected: push updates `origin/codex/new-plugin-rewrite`.

---

## Plan Self-Review

Spec coverage:

- Standalone plugin session window: Task 6.
- Shared session ledger: Tasks 1, 2, 6.
- Main-window context import: Task 3 and Task 5.
- GPT + DeepSeek automatic loop: Task 5.
- Safe pause on failure: Task 4 and Task 5.
- Mid-session Gemini/Doubao join: Task 7.
- Final GPT summary: Task 2 and Task 5.
- Manual verification: Task 8.

Known implementation risks:

- Provider response capture may need provider-specific selector refinement after manual testing.
- Auto-send can still fail on provider UI changes; orchestrator must pause rather than loop.
- UI may become dense inside a 440px popup. If cramped, use the existing persistent overlay surface as the primary roundtable view.

Execution recommendation:

- Use subagent-driven development if available, one fresh subagent per task, with review after each task.
- If executing inline, stop after Tasks 1, 3, 5, and 6 for explicit verification checkpoints.
