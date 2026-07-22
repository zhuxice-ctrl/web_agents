# Web Agents Roundtable Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working CDP prototype into the approved workspace-backed, extension-optional, automatically orchestrated Web Agents roundtable.

**Architecture:** Keep the local Node.js controller as the authority for sessions, public events, browser threads, permissions, transactions, and recovery. The browser page remains a thin operational UI; dedicated Chrome plus Playwright CDP handles provider pages, while a controller-owned tool loop executes MCP calls without relying on the legacy extension.

**Tech Stack:** Node.js 24 ESM, Playwright CDP, browser-native HTML/CSS/JavaScript, Node test runner, PowerShell/BAT launcher, JSON/JSONL local persistence.

---

### Task 1: Workspace And Session Authority

**Files:**
- Create: `apps/roundtable-web/storage/workspace-registry.mjs`
- Create: `apps/roundtable-web/storage/workspace-registry.test.mjs`
- Modify: `apps/roundtable-web/storage/local-workspace-store.mjs`
- Modify: `apps/roundtable-web/storage/local-workspace-store.test.mjs`
- Modify: `apps/roundtable-web/server.mjs`
- Test: `apps/roundtable-web/server-runtime.test.mjs`

- [ ] Add a failing test that rejects nonexistent/file paths and verifies `<workspace>/.web-agents/{sessions,handoffs,artifacts,audit,backups}`.
- [ ] Implement canonical path validation, writable probes, workspace metadata, recent workspace persistence, and one store instance per selected workspace.
- [ ] Add session lookup that keeps active runtimes bound to their original workspace when the UI switches workspaces.
- [ ] Add `GET /api/workspaces`, `POST /api/workspaces/select`, and workspace-scoped session list/create routes.
- [ ] Run `node --test apps/roundtable-web/storage/*.test.mjs apps/roundtable-web/server-runtime.test.mjs` and require zero failures.

### Task 2: Structured Composer Routing And Session Threads

**Files:**
- Modify: `apps/roundtable-web/core/providers.mjs`
- Modify: `apps/roundtable-web/orchestrator/command-parser.mjs`
- Create: `apps/roundtable-web/orchestrator/command-parser.test.mjs`
- Create: `apps/roundtable-web/orchestrator/context-projector.mjs`
- Create: `apps/roundtable-web/orchestrator/context-projector.test.mjs`
- Modify: `apps/roundtable-web/server.mjs`

- [ ] Add tests proving that structured `targets` select speakers while plain `gpt`/`豆包` text is reference-only.
- [ ] Add alias suggestions and referenced-provider extraction without implicit routing.
- [ ] Add unnamed-session creation, first-message naming, explicit rename, participant join/leave, join cursor policy, and next-round activation.
- [ ] Persist one thread record and one last-delivered event cursor per seat.
- [ ] Add APIs for session rename, participant lifecycle, and send-preview validation.
- [ ] Run parser, projector, server, and storage tests and require zero failures.

### Task 3: Discussion Kernel, Closure, And Degraded Continuation

**Files:**
- Modify: `apps/roundtable-web/orchestrator/context-builder.mjs`
- Create: `apps/roundtable-web/orchestrator/quality-analyzer.mjs`
- Create: `apps/roundtable-web/orchestrator/quality-analyzer.test.mjs`
- Modify: `apps/roundtable-web/orchestrator/scheduler.mjs`
- Modify: `apps/roundtable-web/orchestrator/orchestrator.test.mjs`
- Modify: `apps/roundtable-web/orchestrator/run-registry.mjs`

- [ ] Add failing tests for independent-position, cross-discussion, convergence, and the extra visible closure turn.
- [ ] Build prompts from the seat cursor, current public state, original task, stage objective, and bounded recent raw events.
- [ ] Persist quality flags without deleting raw replies and prevent low-confidence outputs from directly causing writes.
- [ ] Retry empty/capture/truncation failures once, then append an error placeholder and continue multi-model or relay execution.
- [ ] Keep single-model failures recoverable; select a healthy fallback closer if the host is unavailable.
- [ ] Run all orchestrator tests and require zero failures.

### Task 4: Dedicated Browser Threads And Atomic Handoff

**Files:**
- Modify: `apps/roundtable-web/automation/browser-manager.mjs`
- Modify: `apps/roundtable-web/automation/browser-manager.test.mjs`
- Modify: `apps/roundtable-web/automation/worker.mjs`
- Create: `apps/roundtable-web/automation/provider-concurrency.mjs`
- Create: `apps/roundtable-web/automation/provider-concurrency.test.mjs`
- Create: `apps/roundtable-web/orchestrator/handoff-manager.mjs`
- Create: `apps/roundtable-web/orchestrator/handoff-manager.test.mjs`
- Modify: `apps/roundtable-web/server.mjs`

- [ ] Key browser pages and locks by roundtable seat thread, not globally by provider.
- [ ] Create a fresh provider page for every new seat while leaving login and verification to the user.
- [ ] Enforce same-thread serial execution and a configurable provider soft concurrency limit of three with adaptive backoff.
- [ ] Implement handoff preview, fresh-thread creation, snapshot send, acknowledgement, delta catch-up, verification, and atomic binding swap.
- [ ] Preserve the old thread on every handoff failure and add preview/confirm/status APIs.
- [ ] Run browser manager, concurrency, handoff, and fake-provider E2E tests.

### Task 5: Controller-Owned MCP Tool Loop And Transactions

**Files:**
- Create: `apps/roundtable-web/mcp/tool-registry.mjs`
- Create: `apps/roundtable-web/mcp/tool-call-parser.mjs`
- Create: `apps/roundtable-web/mcp/path-lock-manager.mjs`
- Create: `apps/roundtable-web/mcp/transaction-manager.mjs`
- Create: `apps/roundtable-web/mcp/tool-loop.mjs`
- Create: `apps/roundtable-web/mcp/*.test.mjs`
- Modify: `apps/roundtable-web/automation/worker.mjs`
- Modify: `apps/roundtable-web/orchestrator/artifact-writer.mjs`
- Modify: `apps/roundtable-web/server.mjs`

- [ ] Port the legacy JSONL protocol parser and reject malformed, duplicated, or mismatched calls.
- [ ] Define explicit `readOnly`, `mutating`, `destructive`, `reversible`, `openWorld`, and `idempotent` metadata for every exposed tool.
- [ ] Allow audited reads everywhere, automatically transact workspace writes, and create a one-time confirmation request for external writes.
- [ ] Acquire canonical file locks in stable order, record before/after hashes and backups, rollback partial failures, and create a recovery copy when rollback detects a later edit.
- [ ] Capture model output, execute one controller-side tool call, inject `<function_result>`, and continue until a final answer or a bounded tool-call limit.
- [ ] Add `/撤回`, `/撤回 上一个任务`, `/撤回 <transactionId>`, confirmation, transaction, audit, and rollback APIs.
- [ ] Run all MCP, artifact, server runtime, and fake-provider E2E tests.

### Task 6: Single-Composer Roundtable UI

**Files:**
- Modify: `apps/roundtable-web/public/index.html`
- Modify: `apps/roundtable-web/public/styles.css`
- Modify: `apps/roundtable-web/public/app.js`
- Create: `apps/roundtable-web/public/composer-model.mjs`
- Create: `apps/roundtable-web/public/roundtable-physics.mjs`
- Create: `apps/roundtable-web/public/ui-contract.test.mjs`

- [ ] Replace the current-task form and data-root controls with workspace and top session selectors.
- [ ] Add participant join/leave, thread state, join policy, capacity ring, sync progress, handoff, and verification affordances.
- [ ] Add structured mention chips, `@`/alias autocomplete, click/Tab/Enter acceptance, Esc dismissal, reference detection, and send preview.
- [ ] Keep the roundtable as the strongest attractor, apply node-to-node repulsion, and retain a separate host snap point with a visible host effect.
- [ ] Move advanced automation settings into a drawer and keep the bottom composer as the only task input.
- [ ] Verify desktop and 375px mobile screenshots, no overlap/overflow, no console errors, and stable drag physics.

### Task 7: Background Recovery And Unified Launcher

**Files:**
- Create: `scripts/web-agent-filesystem-http-server.mjs`
- Create: `scripts/web-agent-filesystem-http-server.test.mjs`
- Create: `scripts/start-web-agents-local-services.mjs`
- Create: `scripts/start-web-agents-local-services.test.mjs`
- Modify: `scripts/start-web-agents-roundtable.ps1`
- Modify: `scripts/start-web-agents-roundtable.test.mjs`
- Modify: `start-web-agents.bat`
- Modify: `package.json`

- [ ] Add verified health identities for the filesystem MCP, local gateway, dedicated Chrome CDP, Playwright MCP, and roundtable.
- [ ] Default the root BAT to CDP mode and start/reuse only identity-matching local processes.
- [ ] Persist execution IDs and checkpoints before send/capture/tool side effects; reconcile unfinished work without duplicate execution.
- [ ] Ensure page close does not stop services and `-Stop` terminates only verified managed process trees.
- [ ] Run launcher tests, a real BAT start/health/reuse/stop smoke, and require all five configured endpoints to be healthy.

### Task 8: Integration, Review, And Acceptance

**Files:**
- Modify: `.adworkflow/worker_state.json`
- Modify: `.adworkflow/verification_result.json`
- Modify: `.adworkflow/review_findings.json`
- Modify: `.adworkflow/impact_report.json`
- Modify: `docs/web-agents-development-plan.md`

- [ ] Run `node --check` for every changed JavaScript module.
- [ ] Run focused suites after each batch, then `npm.cmd run test:local-runtime`.
- [ ] Run an independent Claude Code read-only review against the final diff and verification artifacts; repair every high/medium correctness finding or record a justified disposition.
- [ ] Run real DeepSeek/Doubao acceptance only after action-time authorization; do not submit to ChatGPT.
- [ ] Record changed files, commands, counts, runtime identities, remaining deferred risk `BE-LARGE-IO-01`, and final completion evidence.
