import { DEFAULT_CONFIG } from "../shared/defaults";
import { getProviderById } from "../providers/catalog";
import type { ExtensionConfig, ProviderId } from "../shared/types";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import { isExtensionRequest } from "../shared/messages";
import { checkMcpStatus } from "../mcp/client";
import { prepareTaskWithLocalContext } from "../mcp/local-context";
import { buildWebAgentInstructionTemplate } from "../mcp/instruction-template";
import { executeWebAgentToolCall } from "../mcp/tool-call-executor";
import { requestPermissionDecision, syncConfigFromGateway } from "../permissions/gateway";
import { appendRoundtableMessage, createRoundtableSession } from "../sessions/roundtable";
import type { RoundtableSession } from "../shared/types";
import { createRoundtableOrchestrator } from "./roundtable-orchestrator";

const CONFIG_STORAGE_KEY = "webAgentsConfig";
const roundtableSessions = new Map<string, RoundtableSession>();

async function getConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
  const storedConfig = stored[CONFIG_STORAGE_KEY] as Partial<ExtensionConfig> | undefined;

  const mergedConfig: ExtensionConfig = {
    ...DEFAULT_CONFIG,
    ...(storedConfig ?? {}),
    mcp: {
      ...DEFAULT_CONFIG.mcp,
      ...(storedConfig?.mcp ?? {})
    },
    gateway: {
      ...DEFAULT_CONFIG.gateway,
      ...(storedConfig?.gateway ?? {})
    },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      ...(storedConfig?.permissions ?? {}),
      highPrivilege: {
        ...DEFAULT_CONFIG.permissions.highPrivilege,
        ...(storedConfig?.permissions?.highPrivilege ?? {})
      }
    }
  };

  return syncConfigFromGateway(mergedConfig);
}

async function saveConfig(config: ExtensionConfig): Promise<ExtensionConfig> {
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });
  return config;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function getTabById(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function getTargetTab(tabId?: number, senderTabId?: number): Promise<chrome.tabs.Tab | null> {
  if (typeof tabId === "number") {
    return getTabById(tabId);
  }

  if (typeof senderTabId === "number") {
    return (await getTabById(senderTabId)) ?? getActiveTab();
  }

  return getActiveTab();
}

async function sendToTab<T extends ExtensionRequest["type"]>(
  request: ExtensionRequest,
  senderTabId?: number
): Promise<ExtensionResponse<T>> {
  const tabId = "tabId" in request ? request.tabId : undefined;
  const tab = await getTargetTab(typeof tabId === "number" ? tabId : undefined, senderTabId);
  if (!tab?.id) {
    return { ok: false, type: request.type as T, error: "没有找到目标页面。" };
  }

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, request)) as ExtensionResponse<T>;
    if (response.ok && request.type === "tab:detect") {
      const detectResponse = response as ExtensionResponse<"tab:detect">;
      if (!detectResponse.ok) return response;

      return {
        ...detectResponse,
        data: {
          ...detectResponse.data,
          tabId: tab.id,
          url: tab.url ?? detectResponse.data.url
        }
      } as ExtensionResponse<T>;
    }

    return response;
  } catch (error) {
    return {
      ok: false,
      type: request.type as T,
      error: `目标页面暂不可操作：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

const roundtableOrchestrator = createRoundtableOrchestrator({ sendToTab });

function getRoundtableSessionOrError(sessionId: string): RoundtableSession {
  const session = roundtableSessions.get(sessionId);
  if (!session) {
    throw new Error("Roundtable session not found.");
  }

  return session;
}

function saveRoundtableSession(session: RoundtableSession): RoundtableSession {
  roundtableSessions.set(session.id, session);
  return session;
}

function pauseRoundtableSession(session: RoundtableSession): RoundtableSession {
  return saveRoundtableSession({
    ...session,
    state: "paused",
    updatedAt: new Date().toISOString()
  });
}

async function openProvider(providerId: ProviderId): Promise<ExtensionResponse<"tabs:open-provider">> {
  const provider = getProviderById(providerId);

  if (!provider) {
    return { ok: false, type: "tabs:open-provider", error: "暂不支持该模型页面。" };
  }

  const tab = await chrome.tabs.create({ url: provider.defaultUrl, active: false });
  return {
    ok: true,
    type: "tabs:open-provider",
    data: {
      provider: provider.id,
      label: provider.label,
      tabId: tab.id,
      url: tab.url ?? provider.defaultUrl,
      status: "opening"
    }
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await saveConfig(config);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isExtensionRequest(message)) {
    return false;
  }

  void (async () => {
    try {
      const config = await getConfig();

      switch (message.type) {
        case "config:get":
          sendResponse({ ok: true, type: message.type, data: config });
          return;
        case "config:set-locale": {
          const nextConfig = await saveConfig({ ...config, locale: message.locale });
          sendResponse({ ok: true, type: message.type, data: nextConfig });
          return;
        }
        case "mcp:get-status": {
          const status = await checkMcpStatus(config);
          sendResponse({ ok: true, type: message.type, data: status });
          return;
        }
        case "mcp:get-instruction-template": {
          const status = await checkMcpStatus(config);
          const provider = message.provider ?? "unknown";
          const providerEntry = getProviderById(provider);
          sendResponse({
            ok: true,
            type: message.type,
            data: {
              provider,
              text: buildWebAgentInstructionTemplate({
                provider,
                providerLabel: providerEntry?.label,
                tools: status.tools
              }),
              tools: status.tools,
              mcpState: status.state,
              generatedAt: new Date().toISOString()
            }
          });
          return;
        }
        case "mcp:execute-tool-call": {
          const result = await executeWebAgentToolCall(config, message.call);
          sendResponse({ ok: true, type: message.type, data: result });
          return;
        }
        case "task:prepare-local-context": {
          const preparedTask = await prepareTaskWithLocalContext(config, message.text);
          sendResponse({ ok: true, type: message.type, data: preparedTask });
          return;
        }
        case "permission:evaluate": {
          const decision = await requestPermissionDecision(config, message.toolName, message.path);
          sendResponse({ ok: true, type: message.type, data: decision });
          return;
        }
        case "tabs:open-provider": {
          sendResponse(await openProvider(message.provider));
          return;
        }
        case "tab:detect":
        case "tab:insert-text":
        case "tab:auto-send-text":
        case "tab:capture-latest":
        case "tab:capture-recent": {
          sendResponse(await sendToTab(message, sender.tab?.id));
          return;
        }
        case "roundtable:create": {
          const session = saveRoundtableSession(
            createRoundtableSession({
              title: message.title,
              objective: message.objective,
              mainProvider: message.mainProvider,
              mainTabId: message.mainTabId,
              participantProviders: message.participantProviders,
              maxRounds: message.maxRounds
            })
          );
          sendResponse({ ok: true, type: message.type, data: session });
          return;
        }
        case "roundtable:import-main-context": {
          const session = getRoundtableSessionOrError(message.sessionId);
          const nextSession = saveRoundtableSession(await roundtableOrchestrator.importMainContext(session));
          sendResponse({ ok: true, type: message.type, data: nextSession });
          return;
        }
        case "roundtable:start": {
          const session = getRoundtableSessionOrError(message.sessionId);
          const nextSession = saveRoundtableSession(await roundtableOrchestrator.step({ ...session, state: "running" }));
          sendResponse({ ok: true, type: message.type, data: nextSession });
          return;
        }
        case "roundtable:pause": {
          const session = getRoundtableSessionOrError(message.sessionId);
          sendResponse({ ok: true, type: message.type, data: pauseRoundtableSession(session) });
          return;
        }
        case "roundtable:step": {
          const session = getRoundtableSessionOrError(message.sessionId);
          const nextSession = saveRoundtableSession(await roundtableOrchestrator.step(session));
          sendResponse({ ok: true, type: message.type, data: nextSession });
          return;
        }
        case "roundtable:capture": {
          const session = getRoundtableSessionOrError(message.sessionId);
          const nextSession = saveRoundtableSession(await roundtableOrchestrator.capture(session, message.provider));
          sendResponse({ ok: true, type: message.type, data: nextSession });
          return;
        }
        case "roundtable:summarize": {
          const session = getRoundtableSessionOrError(message.sessionId);
          const nextSession = saveRoundtableSession(await roundtableOrchestrator.summarize(session));
          sendResponse({ ok: true, type: message.type, data: nextSession });
          return;
        }
        case "roundtable:add-guidance": {
          const session = getRoundtableSessionOrError(message.sessionId);
          const text = message.text.trim();
          const nextSession = text
            ? saveRoundtableSession(
                appendRoundtableMessage(session, {
                  speaker: "user",
                  text,
                  source: "web_agents_user"
                })
              )
            : session;
          sendResponse({ ok: true, type: message.type, data: nextSession });
          return;
        }
        case "roundtable:get": {
          const session = getRoundtableSessionOrError(message.sessionId);
          sendResponse({ ok: true, type: message.type, data: session });
          return;
        }
        default:
          sendResponse({ ok: false, type: (message as ExtensionRequest).type, error: "未知消息类型。" });
      }
    } catch (error) {
      sendResponse({
        ok: false,
        type: message.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true;
});
