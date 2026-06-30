import { DEFAULT_CONFIG } from "../shared/defaults";
import { getProviderDefinition } from "../adapters/providers";
import type { ExtensionConfig, ProviderId } from "../shared/types";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import { isExtensionRequest } from "../shared/messages";
import { checkMcpStatus } from "../mcp/client";
import { requestPermissionDecision, syncConfigFromGateway } from "../permissions/gateway";

const CONFIG_STORAGE_KEY = "webAgentsConfig";

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

async function getTargetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
  if (tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  return getActiveTab();
}

async function sendToTab<T extends ExtensionRequest["type"]>(
  request: ExtensionRequest
): Promise<ExtensionResponse<T>> {
  const tabId = "tabId" in request ? request.tabId : undefined;
  const tab = await getTargetTab(typeof tabId === "number" ? tabId : undefined);
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

async function openProvider(providerId: ProviderId): Promise<ExtensionResponse<"tabs:open-provider">> {
  const provider = getProviderDefinition(providerId);

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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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
        case "tab:capture-latest": {
          sendResponse(await sendToTab(message));
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
