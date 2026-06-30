# Web Agents Extension

新的可维护浏览器插件源码工程。

## 技术栈

- Chrome Manifest V3
- React
- TypeScript
- Vite

## 开发命令

```powershell
npm install
npm run typecheck
npm run build
```

构建后在 Chrome 中加载：

```text
extensions/web-agents-extension/dist
```

## 当前范围

- 默认中文 UI，支持 English。
- 当前网页 AI 页面检测。
- 将任务插入当前网页原生输入框。
- MCP SSE 连接状态检查和 `tools/list` 展示。
- 工具风险分级和 schema 可解析状态展示。
- 权限模式、允许路径和高风险状态展示。
- 可选读取 `http://127.0.0.1:3007/config` 本地权限网关。
- 多模型任务看板，默认只启用当前页面；其他模型必须手动勾选并打开子页面。
- 支持向已打开的参与模型插入任务，并捕获最新回复快照。

## 本地服务

在仓库根目录启动：

```powershell
.\scripts\start-gemini-backend.local.ps1
.\scripts\start-web-agents-gateway.local.ps1
```

默认端点：

```text
MCP SSE: http://127.0.0.1:3006/sse
权限网关: http://127.0.0.1:3007/config
```

权限网关会读取仓库根目录下的 `config.local.json`，并从 `allowedRoots`、`permissions.allowedRoots` 或 filesystem MCP 参数里推导允许路径。

## 暂不包含

- 默认自动发送。
- 默认打开所有模型页面。
- 完整网页聊天历史同步。
- 真实工具执行拦截仍应由本地 MCP/网关在执行前再次校验，插件 UI 不能作为唯一安全边界。

## 手动验证清单

- 在 Chrome `chrome://extensions` 加载 `dist`。
- 打开 ChatGPT / Gemini / DeepSeek 任一页面，确认“当前页面”显示可插入。
- 输入任务，点击“插入当前页面”，确认文本进入网页原生输入框且没有自动发送。
- 启动 MCP 后端后点击“检查连接”，确认工具数量和风险标签显示。
- 启动权限网关后刷新插件，确认权限摘要显示“本地网关”和允许路径。
- 在多模型看板中手动勾选其他 provider，点击打开，再等待页面加载后插入。
