# web_Agent v1

web_Agent 是一个面向网页大模型的本地浏览器插件产品。它让 ChatGPT、Gemini、DeepSeek、Kimi、Qwen、豆包、Grok 等网页通过 MCP 工具读取本地文件，并在授权后执行写入、编辑、移动等操作。

本分支只维护插件产品：

- 稳定基线分支：`webagent`
- 独立 v1 分支：`webagent-v1`
- 圆桌产品分支：`tablellm`
- 两个分支独立开发、独立发布，不互相合并

## 主要能力

- 在已适配的模型网页中提供中文 MCP 面板、连接状态、工具列表和使用说明。
- 连接本地文件系统 MCP，执行读取目录、读取文件、搜索、写入、编辑和移动等工具。
- 对写入白名单之外的目录显示授权请求，并使用一次性令牌重试原始调用。
- 支持多步骤任务按顺序执行：每次只运行一个工具，前一步结果返回模型后再继续下一步，最后统一汇报。
- 为不同网页维护独立适配，包括 Kimi 授权回退、豆包绝对路径约束和 Grok 工具调用兼容。
- 提供本地网关，用于权限审批、工具结果保存和自动化任务队列。

## 目录

```text
extensions/mcp-superassistant-local-fixed/  当前实际加载的 web_Agent 扩展
products/plugin/
  config/                                插件本地配置说明
  data/                                  运行时数据，默认不提交 Git
  services/                              文件系统 MCP 与插件网关
  tests/                                 插件、服务和边界测试
  start-plugin.bat                       Windows 启动脚本
```

文件系统安全底座使用独立版本 `@web-agents/local-core@1.0.0`，来源固定为仓库的 `local-core-v1` 分支。本分支不再包含圆桌代码、core 源码副本或历史扩展副本。

## 环境要求

- Windows 10/11
- Node.js 24 或更高版本
- Chrome 或 Edge

安装依赖：

```powershell
npm install
```

## 启动本地服务

在仓库根目录运行：

```powershell
.\products\plugin\start-plugin.bat
```

默认服务：

| 服务 | 地址 |
| --- | --- |
| 文件系统 MCP | `http://127.0.0.1:3006/sse` |
| 插件网关 | `http://127.0.0.1:3017` |
| 文件系统健康检查 | `http://127.0.0.1:3006/health` |
| 网关健康检查 | `http://127.0.0.1:3017/health` |

## 加载扩展

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择仓库中的 `extensions/mcp-superassistant-local-fixed`。
5. 修改扩展代码后，在扩展管理页重新加载扩展，并刷新模型网页。

扩展中的 MCP 连接使用：

```text
Connection Type: SSE
Server URI: http://127.0.0.1:3006/sse
```

不要同时启用商店版和本地开发版扩展，否则可能出现重复面板、旧适配器覆盖或结果卡重复执行。

## 权限与本地数据

读取操作可以访问用户明确提供的绝对路径。写入、编辑、创建和移动操作受可写目录白名单与一次性授权保护。

本地可写目录配置位于：

```text
products/plugin/config/allowed-directories.local.txt
```

以下内容不应提交 Git：

- `products/plugin/data/`
- `products/plugin/config/*.local.*`
- `node_modules/`
- 本机绝对路径、账号信息、令牌和真实会话内容
- 浏览器 profile、日志和临时测试文件

## 验证

运行插件完整测试：

```powershell
npm run test:plugin
```

验证未解压扩展及 Manifest 声明的运行文件：

```powershell
npm run build:plugin
```

检查插件产品、独立 core 依赖和扩展版本边界：

```powershell
npm run check:boundaries
```

更具体的开发说明见 [`products/plugin/README.md`](products/plugin/README.md) 和 [`extensions/mcp-superassistant-local-fixed/README.md`](extensions/mcp-superassistant-local-fixed/README.md)。

## License

MIT
