import { DEFAULT_CONFIG } from "../shared/defaults";
import { getProviderById } from "../providers/catalog";
import type { ExtensionConfig, ProviderId } from "../shared/types";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import { isExtensionRequest } from "../shared/messages";
import { runProviderAuthProbe } from "../auth/page-probes";
import {
  chooseBestProviderTab,
  providerIdForTabUrl,
  sanitizeDetectedProviderStatus,
  sanitizeProviderTabUrl,
  tabUrlMatchesProvider
} from "./provider-tabs";
import { checkMcpStatus } from "../mcp/client";
import { prepareTaskWithLocalContext } from "../mcp/local-context";
import { buildWebAgentInstructionTemplate } from "../mcp/instruction-template";
import { executeWebAgentToolCall } from "../mcp/tool-call-executor";
import { requestPermissionDecision, syncConfigFromGateway } from "../permissions/gateway";
import { createAutomationClient } from "../automation/client";
import { createSessionRunner } from "../automation/session-runner";
import type { ProviderAutomationResult, ProviderAutomationTask } from "../shared/types";

const CONFIG_STORAGE_KEY = "webAgentsConfig";
const automationSessionRunner = createSessionRunner();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        data: sanitizeDetectedProviderStatus(detectResponse.data, tab.id, tab.url)
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

async function openProvider(providerId: ProviderId): Promise<ExtensionResponse<"tabs:open-provider">> {
  const provider = getProviderById(providerId);

  if (!provider) {
    return { ok: false, type: "tabs:open-provider", error: "暂不支持该模型页面。" };
  }

  const existingTabs = (await chrome.tabs.query({})).filter(
    (tab) => typeof tab.id === "number" && typeof tab.url === "string" && tabUrlMatchesProvider(tab.url, providerId)
  );
  const existing = existingTabs[0];
  const tab = existing?.id
    ? await chrome.tabs.update(existing.id, { active: true })
    : await chrome.tabs.create({ url: provider.defaultUrl, active: true });
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }
  return {
    ok: true,
    type: "tabs:open-provider",
    data: {
      provider: provider.id,
      label: provider.label,
      tabId: tab.id,
      url: sanitizeProviderTabUrl(tab.url ?? provider.defaultUrl) ?? provider.defaultUrl,
      status: existing ? "ready" : "opening",
      reused: Boolean(existing)
    }
  };
}

async function probeProviderTab(tab: chrome.tabs.Tab, expectedProvider?: ProviderId): Promise<ExtensionResponse<"tabs:probe-provider">> {
  if (typeof tab.id !== "number" || typeof tab.url !== "string") {
    return { ok: false, type: "tabs:probe-provider", error: "模型标签页不可用。" };
  }
  const providerId = providerIdForTabUrl(tab.url);
  if (!providerId || providerId === "unknown" || (expectedProvider && providerId !== expectedProvider)) {
    return { ok: false, type: "tabs:probe-provider", error: "标签页与模型不匹配。" };
  }
  const provider = getProviderById(providerId);
  const url = sanitizeProviderTabUrl(tab.url);
  if (!provider || !url) {
    return { ok: false, type: "tabs:probe-provider", error: "模型标签页网址无效。" };
  }

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: runProviderAuthProbe,
      args: [providerId]
    });
    const auth = injected[0]?.result;
    if (!auth || auth.provider !== providerId) {
      return { ok: false, type: "tabs:probe-provider", error: "模型登录探针没有返回有效状态。" };
    }
    const detected = await sendToTab<"tab:detect">({ type: "tab:detect", tabId: tab.id });
    const readiness = detected.ok ? detected.data.readiness : "unknown";
    const canInsert = detected.ok && detected.data.canInsert;
    const verificationRequired = detected.ok && Boolean(detected.data.verificationRequired);
    return {
      ok: true,
      type: "tabs:probe-provider",
      data: {
        ...auth,
        tabId: tab.id,
        label: provider.label,
        url,
        readiness,
        canInsert,
        ready: auth.authenticated && canInsert && !verificationRequired,
        verificationRequired,
        matchedSelector: detected.ok ? detected.data.matchedSelector : undefined,
        error: detected.ok ? undefined : detected.error
      }
    };
  } catch (error) {
    return {
      ok: false,
      type: "tabs:probe-provider",
      error: `模型登录探针执行失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function discoverProviderTabs(providers?: ProviderId[]): Promise<ExtensionResponse<"tabs:discover-providers">> {
  const selected = providers?.length ? new Set(providers) : null;
  const candidates = (await chrome.tabs.query({})).filter((tab) => {
    if (typeof tab.id !== "number" || typeof tab.url !== "string") return false;
    const providerId = providerIdForTabUrl(tab.url);
    return Boolean(providerId && providerId !== "unknown" && (!selected || selected.has(providerId)));
  });
  const probed = await Promise.all(candidates.map((tab) => probeProviderTab(tab)));
  return {
    ok: true,
    type: "tabs:discover-providers",
    data: { tabs: probed.filter((result) => result.ok).map((result) => result.data) }
  };
}

async function probeProvider(providerId: ProviderId, tabId?: number): Promise<ExtensionResponse<"tabs:probe-provider">> {
  const candidates = typeof tabId === "number"
    ? [await getTabById(tabId)].filter((tab): tab is chrome.tabs.Tab => Boolean(tab))
    : (await chrome.tabs.query({})).filter(
        (tab) => typeof tab.id === "number" && typeof tab.url === "string" && tabUrlMatchesProvider(tab.url, providerId)
      );
  if (!candidates.length) {
    return { ok: false, type: "tabs:probe-provider", error: "没有找到已打开的模型标签页。" };
  }
  const results = await Promise.all(candidates.map((tab) => probeProviderTab(tab, providerId)));
  const best = chooseBestProviderTab(results.filter((result) => result.ok).map((result) => result.data));
  return best
    ? { ok: true, type: "tabs:probe-provider", data: best }
    : { ok: false, type: "tabs:probe-provider", error: results.find((result) => !result.ok)?.error ?? "模型标签页不可用。" };
}

async function focusProviderTab(tabId: number): Promise<ExtensionResponse<"tabs:focus-provider">> {
  const tab = await getTabById(tabId);
  if (!tab?.id || !tab.url) return { ok: false, type: "tabs:focus-provider", error: "模型标签页不存在。" };
  const providerId = providerIdForTabUrl(tab.url);
  const provider = providerId ? getProviderById(providerId) : undefined;
  if (!provider) return { ok: false, type: "tabs:focus-provider", error: "该标签页不是受支持的模型页面。" };
  const focused = await chrome.tabs.update(tab.id, { active: true });
  if (typeof focused.windowId === "number") await chrome.windows.update(focused.windowId, { focused: true }).catch(() => undefined);
  return {
    ok: true,
    type: "tabs:focus-provider",
    data: {
      provider: provider.id,
      label: provider.label,
      tabId: focused.id,
      url: sanitizeProviderTabUrl(focused.url ?? provider.defaultUrl) ?? provider.defaultUrl,
      status: "ready",
      reused: true
    }
  };
}

async function resolveAutomationTab(task: ProviderAutomationTask): Promise<chrome.tabs.Tab | null> {
  const provider = getProviderById(task.provider);
  if (!provider?.imageGeneration) return null;
  if (typeof task.tabId === "number") {
    const requested = await getTabById(task.tabId);
    if (requested?.url && tabUrlMatchesProvider(requested.url, task.provider)) return requested;
    return null;
  }
  const existing = (await chrome.tabs.query({})).find(
    (tab) => typeof tab.id === "number" && typeof tab.url === "string" && tabUrlMatchesProvider(tab.url, task.provider)
  );
  return existing ?? chrome.tabs.create({ url: provider.imageGeneration.defaultUrl, active: false });
}

async function requestGeneratedImage(
  task: ProviderAutomationTask,
  tab: chrome.tabs.Tab
): Promise<ExtensionResponse<"tab:generate-image">> {
  let response: ExtensionResponse<"tab:generate-image"> = {
    ok: false,
    type: "tab:generate-image",
    error: "PROVIDER_TAB_NOT_READY"
  };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    response = await sendToTab<"tab:generate-image">({
      type: "tab:generate-image",
      prompt: task.payload.prompt,
      tabId: tab.id
    });
    if (response.ok || !/Receiving end does not exist|暂不可操作|not ready/i.test(response.error)) return response;
    await wait(250);
  }
  return response;
}

async function executeAutomationTask(task: ProviderAutomationTask): Promise<ProviderAutomationResult> {
  if (task.type !== "provider.generate_image") {
    return { ok: false, error: { code: "AUTOMATION_TASK_UNSUPPORTED" } };
  }
  const tab = await resolveAutomationTab(task);
  if (!tab?.id) return { ok: false, error: { code: "PROVIDER_TAB_NOT_FOUND" } };

  return automationSessionRunner.run(`${task.sessionId}:${tab.id}`, async () => {
    const generated = await requestGeneratedImage(task, tab);
    if (!generated.ok) return { ok: false, error: { code: generated.error } };
    const config = await getConfig();
    const response = await fetch(`${config.gateway.baseUrl.replace(/\/+$/g, "")}/save-gpt-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base64: generated.data.dataUrl,
        mimeType: generated.data.mimeType,
        targetDirectory: task.payload.targetDirectory,
        fileName: task.payload.fileName
      })
    });
    const payload = await response.json() as {
      ok?: boolean;
      error?: string;
      filePath?: string;
      mimeType?: string;
      bytes?: number;
    };
    if (!response.ok || !payload.ok || !payload.filePath) {
      return { ok: false, error: { code: payload.error || `IMAGE_SAVE_HTTP_${response.status}` } };
    }
    return {
      ok: true,
      filePath: payload.filePath,
      mimeType: payload.mimeType,
      bytes: payload.bytes
    };
  });
}

async function runAutomationLoop(): Promise<void> {
  const config = await getConfig();
  const client = createAutomationClient({ baseUrl: config.gateway.baseUrl, executeTask: executeAutomationTask });
  let retryMs = 250;
  while (true) {
    try {
      await client.dispatchOnce({ waitMs: 15_000 });
      retryMs = 250;
    } catch {
      await wait(retryMs + Math.floor(Math.random() * Math.max(1, retryMs / 4)));
      retryMs = Math.min(5_000, retryMs * 2);
    }
  }
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
        case "tabs:discover-providers": {
          sendResponse(await discoverProviderTabs(message.providers));
          return;
        }
        case "tabs:probe-provider": {
          sendResponse(await probeProvider(message.provider, message.tabId));
          return;
        }
        case "tabs:focus-provider": {
          sendResponse(await focusProviderTab(message.tabId));
          return;
        }
        case "tab:auth-probe": {
          const tab = await getTargetTab(message.tabId, sender.tab?.id);
          if (!tab) {
            sendResponse({ ok: false, type: message.type, error: "没有找到目标模型标签页。" });
            return;
          }
          const probed = await probeProviderTab(tab);
          sendResponse(probed.ok
            ? {
                ok: true,
                type: message.type,
                data: {
                  provider: probed.data.provider,
                  authenticated: probed.data.authenticated,
                  reason: probed.data.reason,
                  verificationRequired: probed.data.verificationRequired
                }
              }
            : { ok: false, type: message.type, error: probed.error });
          return;
        }
        case "tab:detect":
        case "tab:insert-text":
        case "tab:auto-send-text":
        case "tab:generate-image":
        case "tab:capture-latest":
        case "tab:capture-recent": {
          sendResponse(await sendToTab(message, sender.tab?.id));
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

void runAutomationLoop();
