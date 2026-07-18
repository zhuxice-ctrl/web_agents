# web_Agent 本地固定版

这是 GitHub `main` 分支 `extensions/mcp-superassistant-local-fixed` 的中文入口适配版，同时保留本地开发分支的 Grok 反向任务通道。

## 加载路径

在 Chrome 或 Edge 打开 `chrome://extensions` / `edge://extensions`，启用开发者模式，选择“加载已解压的扩展程序”：

```text
F:\web_agents-plugin-extension\extensions\mcp-superassistant-local-fixed
```

不要加载 `products/plugin/extension/dist`；那个目录是另一套源码构建产物。

## MCP 连接

扩展设置使用：

```text
Connection Type: Server-Sent Events (SSE)
Server URI: http://127.0.0.1:3006/sse
```

插件专属服务：

- MCP 文件读写：`http://127.0.0.1:3006`
- 反向任务和图片保存：`http://127.0.0.1:3017`

## 已适配入口

保留原有输入框 MCP 集成，并补齐中文入口和国产模型站点：

- ChatGPT、Gemini、Google AI Studio
- DeepSeek、豆包、Kimi、Qwen
- BigModel / Zhipu / GLM、Chat Z、Mistral、OpenRouter
- GitHub Copilot、Perplexity、Grok / X

非 Grok 页面加载从 GitHub `main` 提取的 `content/index-main.iife.js` 中文 bundle；Grok / X 页面继续加载保留 Grok 适配的 `content/index.iife.js`，并叠加 `local-automation-bridge.js`。两个入口不会在同一页面重复加载。

Grok / X 还会加载 `grok-zh-localization.js`，仅翻译插件自己的 MCP 按钮、弹层、侧栏、状态提示和结果卡操作，不改动 Grok 网页正文或对话内容。

`web-agent-result-enhancer.js` 和 `web-agent-insert-fallback.js` 负责跨网页的中文结果卡、稳定结果保存和“插入失败时复制”兜底；它们不替换原有 MCP 输入框 bundle。

## Grok 反向任务

Grok 页面会从 `3017` 异步领取 `provider.generate_image` 任务，输入提示词、等待新图片、保存到任务的 `targetDirectory`，再回传任务结果。不同页面可以并发执行，任务自身携带 `sessionId`、`workspaceRoot` 和目标目录。

目标项目目录必须位于插件白名单中。白名单文件是本机忽略配置：

```text
products/plugin/config/allowed-directories.local.txt
```

## 运行

从 `F:\web_agents-plugin-extension` 启动：

```powershell
node products/plugin/services/start-plugin-services.mjs
```

启动后刷新模型网页。不要同时启用商店版和此本地版扩展。
