# @web-agents/local-core

`@web-agents/local-core` is the versioned filesystem and permission foundation shared by web_Agent and TableLLM. It contains no browser UI, provider adapter, HTTP server, or product runtime.

## Version

Current release: `1.0.0`

The Git branch `local-core-v1` is the immutable integration target for the first independently versioned product releases.

## Install

```json
{
  "dependencies": {
    "@web-agents/local-core": "git+https://github.com/zhuxice-ctrl/web_agents.git#local-core-v1"
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

## License

MIT
