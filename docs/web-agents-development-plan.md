# Web Agents Development Plan

## 1. Current Baseline

Main workspace:

```text
F:\web_agents
```

The only unpacked extension is:

```text
F:\web_agents\products\plugin\extension
```

Current runtime decision (2026-07-18): the primary roundtable uses the dedicated Chrome CDP runtime and the controller-owned MCP tool loop, so it does not require the normal browser extension. `products/plugin/extension` is the sole production entry for the independent single-model/manual webpage workflow. The incomplete React/Vite rewrite and its `dist` output have been removed.

The current product direction is documented in:

```text
F:\web_agents\docs\product-unification-roadmap.md
```

### 1.1 Implemented Baseline (2026-07-17)

The approved roundtable expansion is now implemented:

- workspace selection and `<workspace>\.web-agents` persistence
- switchable roundtable sessions and dedicated provider threads
- structured `@` routing, alias completion, discussion, relay, and automatic closure
- incremental shared context with per-seat cursors, capacity estimates, and atomic handoff
- controller-owned MCP reads, permission-confirmed external writes, transactions, audit, and rollback
- thread-level concurrency, provider soft limits, checkpoints, and restart recovery without automatic replay
- one-composer responsive UI with roundtable attraction, node repulsion, and host snap
- one-command CDP runtime for ports `3006`, `3017`, `9223`, `8931`, and `3020`

The intentionally deferred backend item is `BE-LARGE-IO-01`: chunked/streaming large-file and large-project execution with bounded concurrency and resume support.

## 2. Product Direction

The product should be built as **Web Agents Local Workspace**, not as a plugin-only product.

The recommended architecture is:

```text
One local core
  -> Plugin entry: direct local read/write from an existing model webpage
  -> Roundtable entry: multiple webpage models coordinated by a local control page
```

The extension should stay lightweight. It should connect model webpages to local tools, insert prompts, capture replies, and expose current-page actions.

The launcher and self-built roundtable page should become the long-term main control surface for multi-model collaboration, task state, local write audit, and rollback.

## 3. Development Principles

1. Keep `products/plugin/extension` as the sole normal-plugin runtime.
2. Do not put roundtable orchestration into the popup as the primary UI.
3. Treat MCP filesystem, gateway, ledger, audit, and rollback as shared core capabilities.
4. Prefer manual confirmation first, then add automation only after the workflow is observable and recoverable.
5. Every local write must be auditable and eventually reversible.

## 4. Phase 0: Stabilize The Main Workspace

Goal: make `F:\web_agents` the only active development workspace.

Tasks:

- Use `F:\web_agents\products\plugin\extension` as the sole loadable extension.
- Keep the normal plugin and Roundtable runtimes independent.
- Verify the extension with:

```powershell
cd F:\web_agents
npm run test:plugin
```

Exit criteria:

- The canonical extension loads directly without a build step.
- The normal plugin remains independently usable and contains no Roundtable runtime.
- Product roadmap and development plan both live under `F:\web_agents\docs`.

## 5. Phase 1: One-Command Local Runtime

Goal: one command starts the local backend needed by both plugin and roundtable.

Create:

```text
F:\web_agents\scripts\start-web-agents-roundtable.ps1
F:\web_agents\scripts\start-web-agents-browser.ps1
F:\web_agents\scripts\start-web-agents-local-services.mjs
F:\web_agents\start-web-agents.bat
```

The launcher should start:

- MCP filesystem server on `127.0.0.1:3006`
- local result/config gateway on `127.0.0.1:3017`
- dedicated Chrome CDP on `127.0.0.1:9223`
- Playwright MCP on `127.0.0.1:8931`
- roundtable web UI on `127.0.0.1:3020`

Exit criteria:

- One command starts all required local services.
- Ports and logs are printed clearly.
- Existing backend scripts are reused where possible.
- Failure states are explicit: port occupied, missing Node.js, missing config, backend failed.

## 6. Phase 2: Minimal Roundtable Web UI

Goal: build the first self-owned control page for multi-model collaboration.

Create:

```text
F:\web_agents\apps\roundtable-web
```

Current MVP scope:

- select a local workspace before creating or loading a roundtable
- create, switch, rename, and persist roundtable sessions
- select and reorder ChatGPT, DeepSeek, and Doubao seats with one dedicated browser thread per seat
- route confirmed `@` tokens while treating unconfirmed provider names as references
- run discussion rounds from immutable snapshots or sequential relay through the snapped host
- maintain an append-only shared event ledger and per-seat incremental delivery cursors
- automatically insert, send, capture, retry, skip, or accept a manual recovery reply
- create a visible closure turn even when preceding rounds contain degraded output
- execute controller-owned MCP reads and transactional writes with permission, audit, and rollback
- preview and confirm thread handoff while preserving the previous thread on failure

Out of scope for the current MVP:

- full chat history sync
- account management
- replacing the native model webpages
- automated login, CAPTCHA, or human-verification bypass
- cloud synchronization or cross-device credentials
- large-file chunking and project-scale streaming (`BE-LARGE-IO-01`)

Exit criteria:

- A real user can run one local task across at least two model pages.
- The final output can be written to a local file.
- Every write has an audit record.

## 7. Phase 3: Shared Packages

Goal: stop duplicating model, tool, and session logic between extension and roundtable UI.

Create shared packages:

```text
F:\web_agents\packages\provider-adapters
F:\web_agents\packages\tool-protocol
F:\web_agents\packages\session-ledger
```

Move gradually from the canonical plugin behavior and Roundtable automation modules only when a shared abstraction has a verified consumer on both sides.

Exit criteria:

- Extension and roundtable page consume the same provider definitions.
- Tool calls and tool results use the same protocol.
- Session ledger format is stable enough to save and replay.

## 8. Phase 4: Audit And Rollback

Goal: local writes become recoverable, not only logged.

Backend requirements:

- every write operation records before/after metadata
- destructive operations require an audit entry
- generated outputs are stored under a predictable session directory
- rollback can restore or reverse supported write operations

Suggested directories:

```text
<workspace>\.web-agents\sessions
<workspace>\.web-agents\handoffs
<workspace>\.web-agents\artifacts
<workspace>\.web-agents\audit
<workspace>\.web-agents\backups
```

Exit criteria:

- User can inspect what changed.
- User can roll back supported writes from the local UI or a script.
- Roundtable final outputs are linked to task/session IDs.

## 9. Phase 5: Canonical Extension Maintenance

Goal: maintain the directly loadable extension without creating a second competing implementation.

Required checks:

- current-page detection works on target providers
- prompt insertion works on target providers
- reply capture works on target providers
- MCP connection status is accurate
- permission gateway summary is accurate
- the unpacked extension loads directly from `products/plugin/extension`

Exit criteria:

- The canonical extension can handle the common single-page local read/write workflow.
- Any future rewrite requires a separate product decision and real-page parity before it enters this repository.

## 10. Current Milestone And Next Backend Task

The current milestone is implemented as:

```text
one BAT -> verified local services -> dedicated Chrome -> workspace -> roundtable session
-> structured routing -> discussion or relay -> visible closure
-> controller MCP transaction -> audit and rollback
```

The next backend optimization is `BE-LARGE-IO-01`. It must add bounded chunking, streaming, pagination, and resumable large-file/project execution without weakening the current transaction, path-lock, and recovery contracts. Provider DOM hardening remains routine compatibility maintenance; automated login and CAPTCHA handling remain out of scope.
