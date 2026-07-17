import { useCallback, useEffect, useState } from "react";
import { translate } from "../i18n";
import { DEFAULT_CONFIG, DEFAULT_MCP_STATUS } from "../shared/defaults";
import type {
  AdapterStatus,
  ExtensionConfig,
  InsertResult,
  Locale,
  McpStatus,
  ParticipantStatus,
  PreparedTask,
  ProviderId,
  TaskSession
} from "../shared/types";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import { createTaskSession } from "../sessions/model";
import { CurrentPagePanel } from "./panels/CurrentPagePanel";
import { McpPanel } from "./panels/McpPanel";
import { MultiModelBoard } from "./panels/MultiModelBoard";
import { PermissionPanel } from "./panels/PermissionPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { TaskPanel } from "./panels/TaskPanel";

const fallbackStatus: AdapterStatus = {
  provider: "unknown",
  label: "Unknown",
  readiness: "unknown",
  canInsert: false,
  reason: "尚未检测当前页面。"
};

async function sendMessage<T extends ExtensionRequest["type"]>(
  request: ExtensionRequest
): Promise<ExtensionResponse<T>> {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return { ok: false, type: request.type as T, error: "Chrome 扩展 API 不可用。" };
  }

  return chrome.runtime.sendMessage(request);
}

export function App() {
  const [config, setConfig] = useState<ExtensionConfig>(DEFAULT_CONFIG);
  const [pageStatus, setPageStatus] = useState<AdapterStatus>(fallbackStatus);
  const [mcpStatus, setMcpStatus] = useState<McpStatus>(DEFAULT_MCP_STATUS);
  const [taskText, setTaskText] = useState("");
  const [taskSession, setTaskSession] = useState<TaskSession>(() => createTaskSession(""));
  const [feedback, setFeedback] = useState("");
  const [isBusy, setBusy] = useState(false);

  const t = useCallback((key: string) => translate(config.locale, key), [config.locale]);

  const refreshConfig = useCallback(async () => {
    const response = await sendMessage<"config:get">({ type: "config:get" });
    if (response.ok) setConfig(response.data);
  }, []);

  const detectCurrentPage = useCallback(async () => {
    const response = await sendMessage<"tab:detect">({ type: "tab:detect" });
    if (response.ok) {
      setPageStatus(response.data);
      setFeedback(response.data.reason ?? "");
    } else {
      setFeedback(response.error);
    }
  }, []);

  const refreshMcp = useCallback(async () => {
    const response = await sendMessage<"mcp:get-status">({ type: "mcp:get-status" });
    if (response.ok) {
      setMcpStatus(response.data);
    } else {
      setMcpStatus((current) => ({ ...current, state: "error", message: response.error }));
    }
  }, []);

  const prepareTaskForInsert = useCallback(async (): Promise<PreparedTask | null> => {
    const response = await sendMessage<"task:prepare-local-context">({
      type: "task:prepare-local-context",
      text: taskText
    });

    if (response.ok) {
      if (response.data.usedLocalContext) setFeedback(response.data.message);
      return response.data;
    }

    setFeedback(response.error);
    return null;
  }, [taskText]);

  const insertCurrentPage = useCallback(async () => {
    if (!taskText.trim()) {
      setFeedback(t("task.empty"));
      return;
    }

    setBusy(true);
    try {
      const preparedTask = await prepareTaskForInsert();
      if (!preparedTask) return;

      const response = await sendMessage<"tab:insert-text">({ type: "tab:insert-text", text: preparedTask.text });
      if (response.ok) {
        const result: InsertResult = response.data;
        setFeedback(preparedTask.usedLocalContext ? `${preparedTask.message} ${result.message}` : result.message);
        void detectCurrentPage();
      } else {
        setFeedback(response.error);
      }
    } finally {
      setBusy(false);
    }
  }, [detectCurrentPage, prepareTaskForInsert, t, taskText]);

  const updateParticipant = useCallback(
    (
      provider: ProviderId,
      patch:
        | Partial<TaskSession["participants"][number]>
        | ((participant: TaskSession["participants"][number]) => Partial<TaskSession["participants"][number]>)
    ) => {
      setTaskSession((current) => ({
        ...current,
        participants: current.participants.map((participant) =>
          participant.provider === provider
            ? {
                ...participant,
                ...(typeof patch === "function" ? patch(participant) : patch)
              }
            : participant
        )
      }));
    },
    []
  );

  const toggleParticipant = useCallback(
    (provider: ProviderId, enabled: boolean) => {
      if (provider === pageStatus.provider && pageStatus.provider !== "unknown") {
        updateParticipant(provider, {
          enabled: true,
          status: pageStatus.canInsert ? "ready" : "error",
          tabId: pageStatus.tabId,
          url: pageStatus.url,
          error: pageStatus.reason
        });
        return;
      }

      updateParticipant(provider, (participant) => ({
        enabled,
        status: enabled ? participant.status : "not_open",
        error: enabled ? participant.error : undefined
      }));
    },
    [pageStatus, updateParticipant]
  );

  const openProvider = useCallback(
    async (provider: ProviderId): Promise<number | undefined> => {
      updateParticipant(provider, { enabled: true, status: "opening", error: undefined });
      const response = await sendMessage<"tabs:open-provider">({ type: "tabs:open-provider", provider });
      if (response.ok) {
        updateParticipant(provider, {
          enabled: true,
          status: response.data.status,
          tabId: response.data.tabId,
          url: response.data.url,
          error: undefined
        });
        setFeedback(t("board.opened"));
        return response.data.tabId;
      } else {
        updateParticipant(provider, { status: "error", error: response.error });
        setFeedback(response.error);
        return undefined;
      }
    },
    [t, updateParticipant]
  );

  const insertParticipant = useCallback(
    async (provider: ProviderId) => {
      if (!taskText.trim()) {
        setFeedback(t("task.empty"));
        return;
      }

      const participant = taskSession.participants.find((item) => item.provider === provider);
      const isCurrentPage = provider === pageStatus.provider;
      const tabId = participant?.tabId ?? (isCurrentPage ? pageStatus.tabId : undefined);

      if (!isCurrentPage && !tabId) {
        updateParticipant(provider, { status: "error", error: t("board.openFirst") });
        setFeedback(t("board.openFirst"));
        return;
      }

      const preparedTask = await prepareTaskForInsert();
      if (!preparedTask) return;

      updateParticipant(provider, { status: "ready", error: undefined });
      const response = await sendMessage<"tab:insert-text">({
        type: "tab:insert-text",
        text: preparedTask.text,
        tabId
      });

      if (response.ok) {
        const result: InsertResult = response.data;
        const status: ParticipantStatus = result.ok ? "waiting_user_send" : "error";
        updateParticipant(provider, {
          status,
          insertedPrompt: result.ok ? preparedTask.text : undefined,
          error: result.ok ? undefined : result.message
        });
        setFeedback(preparedTask.usedLocalContext ? `${preparedTask.message} ${result.message}` : result.message);
        if (isCurrentPage) void detectCurrentPage();
      } else {
        updateParticipant(provider, { status: "error", error: response.error });
        setFeedback(response.error);
      }
    },
    [detectCurrentPage, pageStatus, prepareTaskForInsert, t, taskSession.participants, taskText, updateParticipant]
  );

  const insertSelectedParticipants = useCallback(async () => {
    const selected = taskSession.participants.filter((participant) => participant.enabled);
    if (!selected.length) {
      setFeedback(t("board.noParticipants"));
      return;
    }

    for (const participant of selected) {
      await insertParticipant(participant.provider);
    }
  }, [insertParticipant, t, taskSession.participants]);

  const captureParticipant = useCallback(
    async (provider: ProviderId) => {
      const participant = taskSession.participants.find((item) => item.provider === provider);
      const isCurrentPage = provider === pageStatus.provider;
      const tabId = participant?.tabId ?? (isCurrentPage ? pageStatus.tabId : undefined);

      if (!isCurrentPage && !tabId) {
        updateParticipant(provider, { status: "error", error: t("board.openFirst") });
        setFeedback(t("board.openFirst"));
        return;
      }

      const response = await sendMessage<"tab:capture-latest">({ type: "tab:capture-latest", tabId });
      if (response.ok) {
        updateParticipant(provider, {
          status: "captured",
          responseSnapshot: response.data,
          responseSummary: response.data.text.slice(0, 120),
          error: undefined
        });
        setFeedback(t("board.captured"));
      } else {
        updateParticipant(provider, { status: "error", error: response.error });
        setFeedback(response.error);
      }
    },
    [pageStatus, t, taskSession.participants, updateParticipant]
  );

  const changeLocale = useCallback(async (locale: Locale) => {
    const response = await sendMessage<"config:set-locale">({ type: "config:set-locale", locale });
    if (response.ok) setConfig(response.data);
  }, []);

  useEffect(() => {
    setTaskSession((current) => ({
      ...current,
      prompt: taskText,
      title: taskText.trim().slice(0, 36) || t("task.untitled")
    }));
  }, [t, taskText]);

  useEffect(() => {
    if (pageStatus.provider === "unknown") return;

    updateParticipant(pageStatus.provider, {
      enabled: true,
      status: pageStatus.canInsert ? "ready" : "error",
      tabId: pageStatus.tabId,
      url: pageStatus.url,
      error: pageStatus.reason
    });
  }, [pageStatus, updateParticipant]);

  useEffect(() => {
    void refreshConfig();
    void detectCurrentPage();
    void refreshMcp();
  }, [detectCurrentPage, refreshConfig, refreshMcp]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>{t("app.title")}</h1>
          <p>{t("app.subtitle")}</p>
        </div>
        <div className="language-switch" aria-label={t("settings.language")}>
          <button className={config.locale === "zh-CN" ? "active" : ""} onClick={() => void changeLocale("zh-CN")}>
            中
          </button>
          <button className={config.locale === "en" ? "active" : ""} onClick={() => void changeLocale("en")}>
            EN
          </button>
        </div>
      </header>

      <TaskPanel
        feedback={feedback}
        isBusy={isBusy}
        taskText={taskText}
        t={t}
        onInsert={insertCurrentPage}
        onTaskTextChange={setTaskText}
      />

      <div className="panel-grid">
        <CurrentPagePanel status={pageStatus} t={t} onDetect={detectCurrentPage} />
        <McpPanel status={mcpStatus} t={t} onRefresh={refreshMcp} />
        <PermissionPanel snapshot={config.permissions} t={t} />
        <SettingsPanel config={config} t={t} />
      </div>

      <MultiModelBoard
        currentProvider={pageStatus.provider}
        session={taskSession}
        t={t}
        onCapture={captureParticipant}
        onInsert={insertParticipant}
        onInsertSelected={insertSelectedParticipants}
        onOpen={openProvider}
        onToggle={toggleParticipant}
      />
    </main>
  );
}
