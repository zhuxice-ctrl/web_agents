# TODO: Web Agents Local Fixed MCP SuperAssistant

## Module 1: 旧插件主线纠偏

- [x] 明确 `extensions/mcp-superassistant-local-fixed` 是当前主线可用插件。
- [x] 明确 `extensions/web-agents-extension` 只作为后续重构实验。
- [x] 更新根 README 和旧插件说明，避免用户加载错误插件。

## Module 2: 豆包旧插件实机验证

- [x] 确认旧插件 manifest 已包含 `*.doubao.com` 权限。
- [x] 确认旧插件 bundle 已包含 `DoubaoAdapter`。
- [ ] 在 Chrome 加载 `extensions/mcp-superassistant-local-fixed`。
- [ ] 打开 `https://www.doubao.com/chat/` 并刷新页面。
- [ ] 验证 MCP 按钮、右侧栏、Server Connected、Available Tools。
- [ ] 如果 MCP 按钮不出现，只在旧插件 Doubao adapter 中补选择器。

## Module 3: 权限安全增强

- [ ] 路径外变更操作确认流程放到本地 MCP/代理执行层。
- [ ] 插件侧只显示提示，不宣称单独完成安全拦截。
- [ ] 标准模式默认：路径外浏览/读取允许，变更需要确认。

## Module 4: 中文化与默认配置

- [ ] 旧插件默认连接地址固定为 `http://127.0.0.1:3006/sse`。
- [ ] 旧插件使用说明中文化。
- [ ] 能公开推广：别人克隆后按 README 可直接加载旧插件并连接本地 MCP。
