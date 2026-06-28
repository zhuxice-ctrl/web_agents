# Local Fixed MCP SuperAssistant Extension

本仓库附带一个本地解包版 MCP SuperAssistant：

```text
extensions/mcp-superassistant-local-fixed
```

它适合这些情况：

- 商店版扩展被浏览器自动修复，还原了你的本地改动。
- 需要给 DeepSeek、Gemini、BigModel / Zhipu 等网页注入 MCP 工具。
- 想用固定的本地 SSE 地址连接文件系统 MCP 服务。

## 安装步骤

1. 打开 `edge://extensions` 或 `chrome://extensions`。
2. 打开 `Developer mode` / `开发者模式`。
3. 如果已经安装商店版 MCP SuperAssistant，先禁用商店版，避免两个扩展同时注入页面。
4. 点击 `Load unpacked` / `加载解压缩的扩展`。
5. 选择：

```text
extensions/mcp-superassistant-local-fixed
```

6. 刷新 Gemini / DeepSeek / Zhipu 页面。
7. 扩展里选择：

```text
Connection Type: Server-Sent Events (SSE)
Server URI: http://127.0.0.1:3006/sse
```

## 使用前必须启动后端

扩展只是浏览器侧通道。它还需要一个本地 MCP SSE 后端。

默认地址：

```text
http://127.0.0.1:3006/sse
```

如果扩展显示：

```text
SSE error: Failed to fetch
No tools available
```

通常表示本地后端没有运行，或者 3006 端口被关掉了。

## 权限范围

本地版 manifest 里包含常见网页 AI 站点权限，例如：

- `chatgpt.com`
- `gemini.google.com`
- `chat.deepseek.com`
- `bigmodel.cn`
- `chat.qwen.ai`
- `kimi.com`
- `github.com`

如需新增网站，需要修改 `manifest.json` 的 `content_scripts.matches` 和 `host_permissions`，然后在扩展管理页点重新加载。

## 安全提醒

- 不要把自己的真实本地路径写进扩展目录再提交。
- 不要提交浏览器 profile、cookie、token、临时公网地址。
- 不要同时启用商店版和本地版 MCP SuperAssistant。
