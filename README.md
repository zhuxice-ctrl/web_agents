# Web Agents

本仓库包含一个共享底座和两个相互独立的产品方向。三个正式分支独立发布，插件与圆桌不互相合并，只通过带版本标签的 `@web-agents/local-core` 共享文件系统能力。

| 正式分支 | 当前版本 | 职责 | Core 依赖 |
| --- | --- | --- | --- |
| [`main`](https://github.com/zhuxice-ctrl/web_agents/tree/main) | `local-core 1.0.1` | 路径、权限、事务和文件工具共享底座 | 独立底座 |
| [`webagent`](https://github.com/zhuxice-ctrl/web_agents/tree/webagent) | `web_Agent 1.0.2` | 网页大模型浏览器插件与本地 MCP 服务 | `local-core 1.0.1` |
| [`tablellm`](https://github.com/zhuxice-ctrl/web_agents/tree/tablellm) | `TableLLM 1.0.1` | 多模型圆桌工作台与调度运行时 | `local-core 1.0.0` |

仓库永久保留的分支只有 `main`、`webagent` 和 `tablellm`。历史版本由 `local-core-v*`、`webagent-v*`、`tablellm-v*` 标签保存；日常功能开发从对应正式分支创建短期功能分支，合入后删除。跨产品共享能力先在 `main` 发布 Core 标签，再由两个产品分别升级和验证。

## Shared Local Core

`@web-agents/local-core` is the versioned filesystem and permission foundation shared by web_Agent and TableLLM. It contains no browser UI, provider adapter, HTTP server, or product runtime.

## Version

Current release: `1.0.1`

The Git branch `main` is the stable Core integration branch. Immutable `local-core-v*` tags identify exact package versions and retain release history without permanent version branches.

## Install

```json
{
  "dependencies": {
    "@web-agents/local-core": "https://github.com/zhuxice-ctrl/web_agents/archive/refs/tags/local-core-v1.0.1.tar.gz"
  }
}
```

## Exports

- `@web-agents/local-core/paths`
- `@web-agents/local-core/real-paths`
- `@web-agents/local-core/atomic-file`
- `@web-agents/local-core/permissions`
- `@web-agents/local-core/permission-store`
- `@web-agents/local-core/transactions`
- `@web-agents/local-core/tool-registry`
- `@web-agents/local-core/filesystem-tools`

## Security boundary

The package owns path normalization, real-path validation, mutation locking, permission decisions, one-time permission tokens, transactions, atomic writes, and filesystem tool definitions.

The filesystem tool set includes permission-gated single-file deletion through `delete_file`. Recursive directory deletion is intentionally not exposed.

Products remain responsible for their own UI, HTTP transport, browser integration, workspace selection, and user-facing approval flow.

## Test

```powershell
npm test
```

## Release policy

- Patch releases keep the exported API compatible.
- Minor releases may add exports or optional behavior.
- Major releases may change permission or filesystem contracts.
- web_Agent and TableLLM upgrade this package independently; their product branches are never merged together.
- Product branches consume immutable Core tags rather than copying Core source.

## License

MIT
