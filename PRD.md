# PRD: Web Agents Extension

当前主产品需求是浏览器插件增强。详细 PRD 见：

- [docs/PRD-web-agents-extension.md](docs/PRD-web-agents-extension.md)

## 当前确认范围

- 当前可用主线是 `extensions/mcp-superassistant-local-fixed`，优先增强旧 MCP SuperAssistant 插件。
- 保留旧插件已有网页内 MCP 按钮、右侧栏、连接状态、工具列表、Instructions 和工具执行体验。
- 新增站点适配、默认配置、权限提示和实机验证，都优先改在旧插件中。
- `extensions/web-agents-extension` 仅作为后续重构实验，不作为当前实机使用入口。
- 默认权限模式为标准模式：路径外可浏览/读取，路径外变更操作必须确认。
- 配置采用本地配置文件 + 本地 MCP/网关侧控制，插件 UI 不能作为唯一安全边界。
