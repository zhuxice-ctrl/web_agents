[简体中文](README.md) | **English**

# Web Agents

Web Agents is a local AI tooling repository organized as three independent product branches. `main` publishes the shared filesystem safety foundation, `webagent` publishes the browser extension product, and `tablellm` publishes the multi-model roundtable workbench. The three formal branches are developed, tested, and released independently; the plugin and roundtable products are never merged into each other.

## Repository Structure

| Formal branch | Current version | Responsibility | Core dependency |
| --- | --- | --- | --- |
| [`main`](https://github.com/zhuxice-ctrl/web_agents/tree/main) | `local-core 1.0.1` | Shared path, permission, transaction, and filesystem tool foundation | Standalone foundation |
| [`webagent`](https://github.com/zhuxice-ctrl/web_agents/tree/webagent) | `web_Agent 1.0.2` | Browser extension, local filesystem MCP, and plugin gateway | `local-core 1.0.1` |
| [`tablellm`](https://github.com/zhuxice-ctrl/web_agents/tree/tablellm) | `TableLLM 1.0.1` | Multi-model roundtable UI, scheduler, and browser runtime | `local-core 1.0.0` |

```text
main (Local Core)
  ├─ versioned dependency ─> webagent
  └─ versioned dependency ─> tablellm
```

These are the only permanent remote branches. Historical releases are retained through `local-core-v*`, `webagent-v*`, and `tablellm-v*` tags instead of permanent version branches.

## Choosing a Branch

A default clone checks out `main`, which is appropriate for developing or auditing the shared Core:

```powershell
git clone https://github.com/zhuxice-ctrl/web_agents.git
cd web_agents
npm ci
npm test
```

For plugin development:

```powershell
git switch webagent
npm ci
npm run start:plugin
```

For roundtable development:

```powershell
git switch tablellm
npm ci
npm run start:roundtable
```

Use separate working directories for different products. Repeatedly switching these branches in one worktree can mix local configuration, browser data, or uncommitted files into the wrong product.

## Version Compatibility

| Product | Product version | Pinned Core version | Release tag |
| --- | --- | --- | --- |
| Local Core | `1.0.1` | - | `local-core-v1.0.1` |
| web_Agent | `1.0.2` | `1.0.1` | `webagent-v1.0.2` |
| TableLLM | `1.0.1` | `1.0.0` | `tablellm-v1.0.1` |

Products consume immutable Core tags. After a new Core release, the plugin and roundtable upgrade and test independently; they do not have to upgrade at the same time.

## Local Core

`@web-agents/local-core` is the filesystem safety and transaction foundation shared by both products. It owns:

- Windows path normalization, extended path prefixes, and case handling.
- Physical real-path resolution and junction-safe mutation boundaries.
- Concurrent mutation locks for exact paths and directory subtrees.
- Creation, approval, rejection, and consumption of one-time or task-scoped permissions.
- Atomic writes, backups, transaction commits, idempotent recovery, and conflict-aware rollback.
- Filesystem tools with explicit permission metadata and audit records.
- Permission-gated single-file `delete_file`, without recursive directory deletion.

Core contains no browser UI, provider website adapter, HTTP server, workspace selection UI, or product runtime.

## Installation

Requirements: Windows, Linux, or macOS and Node.js 24 or newer.

Pin the dependency to a release tag:

```json
{
  "dependencies": {
    "@web-agents/local-core": "https://github.com/zhuxice-ctrl/web_agents/archive/refs/tags/local-core-v1.0.1.tar.gz"
  }
}
```

Then run:

```powershell
npm install
```

Products should not depend on the moving `main` tip or copy Core source into their own branch.

## Public Modules

| Import path | Purpose |
| --- | --- |
| `@web-agents/local-core/paths` | Path normalization, exact locks, and subtree locks |
| `@web-agents/local-core/real-paths` | Real-path resolution and mutation identity checks |
| `@web-agents/local-core/atomic-file` | Atomic file and JSON writes |
| `@web-agents/local-core/permissions` | Product-injectable permission request broker |
| `@web-agents/local-core/permission-store` | Persistent permission requests, approvals, and tokens |
| `@web-agents/local-core/transactions` | File transactions, backups, rollback, and execution idempotency |
| `@web-agents/local-core/tool-registry` | Tool metadata validation and the default registry |
| `@web-agents/local-core/filesystem-tools` | Filesystem read, search, mutation, and deletion tools |

## Security Boundary

Core fails closed by default. Unknown tools, incomplete permission metadata, authorization paths that differ from physical paths, cross-workspace rollback, and mutation through junction aliases are rejected.

Permission tokens are bound to the request, task, tool, paths, and argument hash; they cannot be reused for a different operation. Transaction rollback checks the current file hash. If a user edits a file after the transaction, Core preserves that later edit and creates a recovery copy instead of silently overwriting it.

Products remain responsible for:

- Deciding which user input constitutes explicit path intent.
- Presenting permission UI and collecting approval or rejection.
- Selecting workspaces, sessions, browsers, and provider pages.
- Protecting HTTP, browser extension, and other transport boundaries.

## Testing

Install dependencies and run the complete Core suite:

```powershell
npm ci
npm test
```

The suite covers atomic writes, Windows paths, concurrency locks, permission tokens, real paths, tool metadata, file deletion, transaction recovery, and product dependency isolation.

## Release and Development Rules

- Patch releases preserve compatibility for existing public exports.
- Minor releases may add exports or optional behavior.
- Major releases may change permission or filesystem contracts.
- Shared capabilities are tested on `main` before creating a `local-core-vX.Y.Z` tag.
- `webagent` and `tablellm` upgrade Core only through pinned tags and are never merged into each other.
- Temporary feature branches are deleted after integration; only three remote branches remain permanent.
- Never commit machine-specific absolute paths, permission allowlists, account data, tokens, or real session data.

## License

[MIT](LICENSE)
