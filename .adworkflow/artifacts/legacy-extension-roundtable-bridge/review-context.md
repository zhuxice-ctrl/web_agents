# Legacy Extension Roundtable Bridge Review Context

## Objective

Review the implementation that makes `extensions/mcp-superassistant-local-fixed` the only unpacked extension used by the roundtable MVP while preserving the legacy sidebar and MCP execution path.

## Required Reading

1. `.codex/AGENT_HEADER.md`
2. `.adworkflow/task_spec.json`
3. `docs/superpowers/specs/2026-07-16-legacy-extension-roundtable-bridge-design.md`
4. `docs/superpowers/plans/2026-07-16-legacy-extension-roundtable-bridge.md`

## Primary Review Files

- `extensions/mcp-superassistant-local-fixed/content/roundtable-protocol.js`
- `extensions/mcp-superassistant-local-fixed/content/roundtable-page-bridge.js`
- `extensions/mcp-superassistant-local-fixed/content/roundtable-content-bridge.js`
- `extensions/mcp-superassistant-local-fixed/roundtable/background-core.js`
- `extensions/mcp-superassistant-local-fixed/roundtable-background.js`
- `extensions/mcp-superassistant-local-fixed/background.js`
- `extensions/mcp-superassistant-local-fixed/manifest.json`
- `apps/roundtable-web/automation/extension-relay.mjs`
- `apps/roundtable-web/automation/extension-browser-manager.mjs`
- `apps/roundtable-web/automation/extension-worker.mjs`
- `apps/roundtable-web/orchestrator/prompt-header.mjs`
- `apps/roundtable-web/server.mjs`
- `apps/roundtable-web/public/app.js`

Review the matching `*.test.mjs` files under `scripts/` and `apps/roundtable-web/`.

## Non-Negotiable Boundaries

- No second MCP, JSONL, or local-file executor may exist in the roundtable sidecars.
- Provider credentials may be consumed only inside a provider MAIN world probe and must never cross the bridge, logs, status, or persistence boundary.
- Local page messages are trusted only for exact origins `http://127.0.0.1:3020` and `http://localhost:3020`.
- Automatic insertion and submission must use the existing legacy adapter and must never overwrite a user draft.
- Only verified `speaker: assistant` captures may complete a turn.
- Exact `tabId` bindings must fail closed on provider drift.
- Default automatic discovery and live acceptance must not touch ChatGPT; only DeepSeek and Doubao are selected by default.
- `content/index.iife.js` must remain unchanged, and `background.js` may differ only by its one first-line static import.
- Login, CAPTCHA, and human verification remain manual.

## Verification Evidence

- `npm.cmd run test:legacy-roundtable-extension`: 64/64 passed.
- `npm.cmd run test:roundtable-web`: 98/98 passed.
- `npm.cmd run test:local-runtime`: 275 total tests passed across all scripts.
- Rewrite experiment: 85/85 tests passed, TypeScript typecheck passed, Vite build passed.
- Browser fake-provider E2E: 8/8 passed.
- Launcher: 8/8 passed.

## Review Output

Return findings first, ordered by severity, with exact file and line references. Focus on runtime failures, message-routing races, Chrome MV3 compatibility, credential leakage, false assistant capture, user-draft loss, provider drift, repeated auth probes, MCP execution duplication, and missing tests. Do not edit files. If no blocking issues remain, state `APPROVE` and list residual live-browser risks.
