# web_Agent 本地固定版

这是当前可实机使用的 web_Agent 浏览器插件本地解压版，目录为：

```text
extensions/mcp-superassistant-local-fixed
```

当前本地版本：`0.6.1`。

这条分支只负责旧插件小步增强：新增站点权限、修选择器、优化提示词、补中文说明和做小范围 UI polish。新插件重构不放在这里。

## 快速开始

1. 启动本地 MCP 后端：

```powershell
cd F:\web_agents
.\scripts\start-gemini-backend.local.ps1
```

2. 打开 Chrome：

```text
chrome://extensions
```

3. 开启 `开发者模式`。
4. 点击 `加载已解压的扩展程序`。
5. 选择：

```text
F:\web_agents\extensions\mcp-superassistant-local-fixed
```

6. 在插件连接设置里使用：

```text
Connection Type: Server-Sent Events (SSE)
Server URI: http://127.0.0.1:3006/sse
```

7. 刷新 DeepSeek、豆包、Gemini、Qwen 等网页。

## 使用方式

网页模型本身不会直接拥有本地文件权限。web_Agent 的流程是：先把工具说明插入网页模型上下文，让模型输出 `jsonl` 工具调用，再由插件调用本地 MCP 后端执行。

建议第一次使用时：

1. 打开右侧 web_Agent 面板。
2. 确认 `Server Connected`。
3. 切到 `使用说明`。
4. 插入说明并发送。
5. 再请求模型进行文件操作。

示例请求：

```text
请使用 web_Agent 的 write_file 工具，在 F:\web_agents\hello.md 写入：你好。只输出 jsonl 工具调用。
```

## 已包含站点权限

- ChatGPT
- Gemini
- Google AI Studio
- DeepSeek
- BigModel / Zhipu / GLM
- Qwen
- Kimi
- Doubao
- Grok
- GitHub Copilot

## 排障

- `SSE error: Failed to fetch`：本地 MCP 后端未启动，或地址不是 `http://127.0.0.1:3006/sse`。
- 工具列表为空：刷新网页，确认后端运行，并避免商店版和本地版插件同时启用。
- 模型说不能访问本地文件：先插入 `使用说明`，并要求它只输出 `jsonl` 工具调用。
- 没有 `Run` 按钮：模型输出格式不符合插件解析规则。
- 写入跨目录失败：运行 `.\scripts\mcp-call.local.ps1 call list_allowed_directories '{}'` 查看允许目录。

## 权限与路径

当前旧插件走标准本地 MCP 文件系统权限：浏览器插件负责把工具调用转给本地后端，真正能读写哪些目录由后端的 allowed directories 决定。

直接验证命令：

```powershell
cd F:\web_agents
.\scripts\mcp-call.local.ps1 tools
.\scripts\mcp-call.local.ps1 call list_allowed_directories '{}'
.\scripts\mcp-call.local.ps1 call write_file '{"path":"F:\\web_agents\\hello-from-mcp.md","content":"MCP 写入测试"}'
```

如果这些命令能写入，但网页模型拒绝，优先检查是否已经插入 `使用说明`，以及模型是否输出了 `jsonl` 工具调用。

## 文本与多模态能力边界

当前旧插件的稳定能力以文本文件和目录操作为主。`read_text_file`、`write_file`、`edit_file` 适合文本、Markdown、JSON、代码等内容；图片、音频、视频、压缩包和 Office 文档不要直接用文本工具读写。

如果后端暴露了 `read_media_file`，它更接近“读取媒体文件为 base64/MIME 供传输”。当前旧插件先支持 GPT 图片上传分析，其他多模态能力仍需要单独做页面适配、工具设计和实机验证。

### GPT 图片读取试验功能

当 MCP 工具返回 `read_media_file` 的图片结果时，结果卡片会显示 `附加到 GPT`。

使用方式：

1. 确认图片在允许目录内，例如 `F:\web_agents\images\demo.png`。
2. 在 ChatGPT 页面插入 web_Agent 使用说明。
3. 让 ChatGPT 调用 `read_media_file` 读取图片。
4. 工具执行成功后点击结果卡片里的 `附加到 GPT`。
5. 等 ChatGPT 输入框出现图片预览后，再手动发送。

第一版只支持 `png`、`jpg/jpeg`、`webp`、`gif`。音频、视频、Office、PDF 和图片编辑暂不作为稳定能力。

如果图片在同一个文件夹里，先让模型调用 `list_directory` 或 `search_files` 找出图片。结果卡片会在识别到图片路径后显示 `附加最多20张图片到 GPT`，点击后插件会逐张读取并附加，超过 20 张时只取前 20 张。看到 ChatGPT 输入框里的图片预览后，再手动发送。

### GPT 生成图片自动保存

启动 `scripts/start-gemini-backend.local.ps1` 后，会同时启动本地图片保存服务：

- MCP 地址：`http://127.0.0.1:3006/sse`
- 图片保存服务：`http://127.0.0.1:3017`
- 默认保存目录：`F:\web_agents\generated\gpt-images\`

在 ChatGPT 页面生成新图片时，插件会尝试自动保存 assistant 新生成的图片结果。插件会跳过头像、用户上传预览、历史旧图和小图标。保存成功后页面会显示中文提示和本地绝对路径。

如果提示“本地图片保存服务未连接”，请重新运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-gemini-backend.local.ps1
```

## Upstream

MCP SuperAssistant 是上游开源项目。本目录是为了本地桥接和二创准备的可运行固定版，已重命名为 web_Agent。
