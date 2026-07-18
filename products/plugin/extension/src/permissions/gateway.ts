import { DEFAULT_CONFIG } from "../shared/defaults";
import type { ExtensionConfig, PermissionDecision, PermissionSnapshot } from "../shared/types";
import { evaluatePermission } from "./model";

type GatewayConfigResponse = {
  mcp?: Partial<ExtensionConfig["mcp"]>;
  permissions?: Partial<PermissionSnapshot>;
};

export type GatewayConnection = {
  state: "connected" | "disconnected";
  url: string;
};

const REQUEST_TIMEOUT_MS = 1600;

function joinGatewayPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}${path}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {})
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkGatewayConnection(
  config: ExtensionConfig,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<GatewayConnection> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(joinGatewayPath(config.gateway.baseUrl, "/health"), {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    return { state: response.ok ? "connected" : "disconnected", url: config.gateway.baseUrl };
  } catch {
    return { state: "disconnected", url: config.gateway.baseUrl };
  } finally {
    clearTimeout(timeout);
  }
}

export async function syncConfigFromGateway(config: ExtensionConfig): Promise<ExtensionConfig> {
  if (!config.gateway.enabled) {
    return {
      ...config,
      permissions: {
        ...config.permissions,
        enforcement: "ui_only_contract",
        gatewayUrl: config.gateway.baseUrl,
        message: "本地权限网关未启用，当前仅展示插件侧权限合同。"
      }
    };
  }

  try {
    const gatewayConfig = await fetchJson<GatewayConfigResponse>(joinGatewayPath(config.gateway.baseUrl, "/config"));
    const nextPermissions: PermissionSnapshot = {
      ...DEFAULT_CONFIG.permissions,
      ...config.permissions,
      ...(gatewayConfig.permissions ?? {}),
      highPrivilege: {
        ...DEFAULT_CONFIG.permissions.highPrivilege,
        ...config.permissions.highPrivilege,
        ...(gatewayConfig.permissions?.highPrivilege ?? {})
      },
      enforcement: "gateway",
      gatewayUrl: config.gateway.baseUrl,
      lastSyncedAt: new Date().toISOString(),
      message: "已从本地权限网关同步配置。"
    };

    return {
      ...config,
      mcp: {
        ...config.mcp,
        ...(gatewayConfig.mcp ?? {})
      },
      permissions: nextPermissions
    };
  } catch (error) {
    return {
      ...config,
      permissions: {
        ...config.permissions,
        enforcement: "ui_only_contract",
        gatewayUrl: config.gateway.baseUrl,
        message: `未连接本地权限网关，真实文件拦截尚未接入。详情：${
          error instanceof Error ? error.message : String(error)
        }`
      }
    };
  }
}

export async function requestPermissionDecision(
  config: ExtensionConfig,
  toolName: string,
  path?: string
): Promise<PermissionDecision> {
  if (config.gateway.enabled && config.permissions.enforcement === "gateway") {
    try {
      return await fetchJson<PermissionDecision>(joinGatewayPath(config.gateway.baseUrl, "/permission/evaluate"), {
        method: "POST",
        body: JSON.stringify({ toolName, path })
      });
    } catch {
      return evaluatePermission(config.permissions, toolName, path);
    }
  }

  return evaluatePermission(config.permissions, toolName, path);
}
