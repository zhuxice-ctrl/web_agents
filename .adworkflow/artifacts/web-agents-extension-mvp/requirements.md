# Requirement Translation v1: Web Agents 浏览器插件增强

## 1. 新插件主线

Problem observed: 当前可用扩展是打包产物，能作为参考，但不适合长期改 UI、双语言和权限系统。

User impact: 后续二创会越来越难维护，功能越多越容易在大 bundle 中迷路。

Expected behavior: 新建 `extensions/web-agents-extension` 源码工程，使用 Chrome MV3 + React + TypeScript + Vite。

Scope / non-goals: 当前本地固定版 MCP SuperAssistant 保留为参考和短期可用版本，不在第一阶段继续深度魔改。

Acceptance criteria:

- 新插件源码工程可构建。
- 默认中文 UI。
- 具备清晰模块边界：background、content、ui、adapters、mcp、permissions、sessions、i18n。

## 2. 原生输入框优先

Problem observed: 插件内置聊天输入栏不应强行替代网页模型原生输入框。

User impact: 如果替代原生输入框，用户会丢失网页模型的账号、上下文、附件、模型选择和会员能力。

Expected behavior: 默认由插件组织任务并插入当前网页 AI 原生输入框，用户手动发送。

Scope / non-goals: 第一版不默认自动发送，不默认全模型分发。

Acceptance criteria:

- 当前页面可被识别为 provider。
- 点击插入后，任务内容进入当前网页原生输入框。
- 插件提示用户手动发送。

## 3. 权限和本地配置

Problem observed: 当前允许路径和跨路径权限边界不够产品化；插件 UI 不能成为唯一安全边界。

User impact: 用户很难判断 AI 当前能访问哪里，变更操作是否安全。

Expected behavior: 默认标准模式：路径外可浏览/读取，路径外变更操作必须确认；配置由本地配置/本地网关作为安全源头，插件 UI 同步展示和修改。

Scope / non-goals: 第一版不把最高权限模式设为默认。

Acceptance criteria:

- UI 显示当前权限模式。
- UI 显示允许路径。
- 高风险操作需要本地网关确认流程。
- 最高权限模式必须手动开启并持续显示风险。

## 4. 多模型任务看板

Problem observed: 多模型分发如果默认打开全部网页，会打扰用户并带来账号、风控和资源消耗问题。

User impact: 用户需要控制哪些模型参与，而不是被自动拉起全部账号。

Expected behavior: 默认只作用当前页面；用户在插件面板手动勾选并打开子页面后，进入多模型任务看板。

Scope / non-goals: 第一版不完整复制所有网页聊天历史。

Acceptance criteria:

- 默认参与者只有当前页面。
- 其他模型必须手动勾选。
- 每个模型有状态卡片。
- 插件展示任务级快照和最新回复摘要，完整聊天仍在原网页。

## User-Perspective Additions

- 用户最先需要知道“现在能不能用”：当前页面是否可插入、本地 MCP 是否连接。
- 用户不能被要求记住路径权限规则；权限模式和风险必须常驻可见。
- 多模型功能必须克制，不能一打开插件就弹出多个网页。
- 中文默认很重要，因为插件的使用场景包含大量本地配置和风险提示。
- 长文本任务、空回复、登录失效、限流、DOM 失配都需要明确状态，而不是静默失败。

## Questions To Confirm

- MVP 首屏采用 popup-first 还是 Chrome Side Panel-first？
- 本地权限网关第一版是否立即实现，还是先定义接口并在 UI 中标注“由本地后端执行”？
