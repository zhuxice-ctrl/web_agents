import type { ExtensionConfig, McpStatus, ModelParticipant } from "./types";
import { getDefaultParticipants } from "../providers/catalog";

export const DEFAULT_SERVER_URI = "http://127.0.0.1:3006/sse";
export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:3007";

export const DEFAULT_CONFIG: ExtensionConfig = {
  locale: "zh-CN",
  mcp: {
    serverUri: DEFAULT_SERVER_URI,
    transport: "sse"
  },
  gateway: {
    baseUrl: DEFAULT_GATEWAY_URL,
    enabled: true
  },
  permissions: {
    mode: "standard",
    allowedRoots: [],
    highPrivilege: {
      enabled: false,
      expiresAt: null
    },
    enforcement: "ui_only_contract",
    gatewayUrl: DEFAULT_GATEWAY_URL,
    message: "尚未连接本地权限网关，当前仅展示插件侧权限合同。"
  }
};

export const DEFAULT_MCP_STATUS: McpStatus = {
  state: "unknown",
  serverUri: DEFAULT_SERVER_URI,
  transport: "sse",
  tools: [],
  message: "尚未检查本地 MCP 服务"
};

export const DEFAULT_PARTICIPANTS: ModelParticipant[] = getDefaultParticipants();
