# ARCH: Web Agents Extension

当前主架构设计是浏览器插件增强。详细 ARCH 见：

- [docs/ARCH-web-agents-extension.md](docs/ARCH-web-agents-extension.md)

## 架构原则

- 当前打包扩展 `extensions/mcp-superassistant-local-fixed` 是主线可用版本。
- 新插件源码工程只作为后续重构实验，不参与当前实机主线。
- 旧插件继续负责网页内 MCP 按钮、右侧栏、工具列表、Instructions 和工具执行。
- 真正权限拦截由本地配置和本地权限网关执行。
- 站点适配优先补在旧插件 adapter 中。
- 多模型并发和任务看板属于后续重构分支，不阻塞旧插件增强。
