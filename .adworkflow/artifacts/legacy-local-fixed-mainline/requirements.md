# Requirement Translation: Legacy MCP SuperAssistant Mainline

## Problem Observed

用户在实机验证时发现 `extensions/web-agents-extension` 与旧版 MCP SuperAssistant 使用体验差距很大。旧插件已经具备网页内 MCP 按钮、右侧栏、Server Connected、Available Tools、Instructions、Settings 等完整流程；新插件只是 popup/任务看板，无法替代旧插件作为当前可推广使用入口。

## User Impact

- 用户会加载错误插件，导致“看起来能用但没有 MCP SuperAssistant 的核心能力”。
- 豆包、DeepSeek 等网页端真实使用依赖网页内 MCP 按钮和侧栏，popup 原型不符合现有操作习惯。
- 后续开发如果继续围绕新插件，会浪费时间，并偏离当前可推广仓库目标。

## Expected Behavior

- 当前主线只增强 `extensions/mcp-superassistant-local-fixed`。
- 保留旧插件完整体验，不用新插件替代。
- 新增站点、权限提示、默认配置、中文说明、推广文档都优先改在旧插件和本地 MCP/代理层。
- `extensions/web-agents-extension` 只作为后续重构实验，不参与当前实机验证。

## Scope

- 文档纠偏：README、PRD、ARCH、TODO、local-fixed README。
- ADworkflo 当前任务切换为旧插件增强。
- 豆包验证优先使用旧插件。
- 如果豆包页面不出现 MCP 按钮，只在旧插件 DoubaoAdapter/manifest/content script 里补。

## Non-goals

- 不继续开发 `extensions/web-agents-extension`。
- 不把 popup 任务看板作为当前可用体验。
- 不重写旧插件的大 bundle，除非实机验证证明某个站点适配必须修。

## Acceptance Criteria

- 文档明确旧插件是当前主线。
- 旧插件 README 写明 Doubao 支持和验证步骤。
- ADworkflo 当前 task_spec 指向 legacy local-fixed mainline。
- 豆包旧插件实机验证步骤明确。
- 后续实现不得默认触碰新插件。

## Verification Plan

1. 加载 `extensions/mcp-superassistant-local-fixed`。
2. 启动 `scripts/start-gemini-backend.local.ps1`。
3. 打开 `https://www.doubao.com/chat/` 并刷新。
4. 检查 MCP 按钮、右侧栏、Server Connected、Available Tools。
5. 如果失败，记录失败 DOM/截图，只修改旧插件 Doubao adapter。
