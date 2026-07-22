# Web Agents Real Browser Roundtable MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a web-only local roundtable that automatically sends prompts to signed-in ChatGPT, DeepSeek, and Doubao webpages, captures real replies, shares context across turns, and persists recoverable local artifacts.

**Architecture:** Keep the existing HTML/CSS/JavaScript control page and Node.js HTTP server, but move storage, orchestration, and browser automation into focused ESM modules. The orchestrator receives a provider worker interface, making deterministic fake pages and real Playwright pages use the same discussion and relay execution paths. Session events are append-only JSONL records; mutable state is written atomically.

**Tech Stack:** Node.js 24 ESM, Playwright with a persistent Chrome profile, Server-Sent Events, `node:test`, local JSON/JSONL/Markdown files.

---

### Task 1: Freeze Contracts And Establish Module Boundaries

**Files:**
- Create: `apps/roundtable-web/core/providers.mjs`
- Create: `apps/roundtable-web/orchestrator/command-parser.mjs`
- Create: `apps/roundtable-web/orchestrator/context-builder.mjs`
- Create: `apps/roundtable-web/orchestrator/scheduler.mjs`
- Modify: `apps/roundtable-web/server.mjs`
- Test: `apps/roundtable-web/orchestrator/orchestrator.test.mjs`

- [ ] Preserve existing public exports and HTTP routes while moving pure logic into focused modules.
- [ ] Cover `@全体`, aliases such as `@ds`, single-target discussion, immutable same-round context, and host-final relay ordering with failing tests first.
- [ ] Make provider execution injectable through `execute({ providerId, prompt, signal, diagnosticsDir })`.
- [ ] Run `node --test apps/roundtable-web/orchestrator/orchestrator.test.mjs apps/roundtable-web/server.test.mjs` and require zero failures.

### Task 2: Add Atomic Local Workspace Storage

**Files:**
- Create: `apps/roundtable-web/storage/local-workspace-store.mjs`
- Create: `apps/roundtable-web/storage/local-workspace-store.test.mjs`
- Create: `config/data-root.example.txt`
- Modify: `apps/roundtable-web/server.mjs`

- [ ] Resolve the data root from `WEB_AGENTS_DATA_ROOT`, `config/data-root.local.txt`, or the repository default in that order.
- [ ] Write `store.json`, `session.json`, and `state.json` with temp-file plus rename; append events to `ledger.jsonl` without rewriting prior records.
- [ ] Implement session list/read, legacy import, export, root switching, and index rebuild APIs.
- [ ] Preserve compatibility with existing `generated/sessions/<id>/ledger.json` imports.
- [ ] Run the focused storage and server API tests and inspect a generated session tree.

### Task 3: Implement Browser Manager And Provider Adapters

**Files:**
- Create: `apps/roundtable-web/automation/browser-manager.mjs`
- Create: `apps/roundtable-web/automation/completion-detector.mjs`
- Create: `apps/roundtable-web/automation/worker.mjs`
- Create: `apps/roundtable-web/automation/adapters/base-adapter.mjs`
- Create: `apps/roundtable-web/automation/adapters/chatgpt.mjs`
- Create: `apps/roundtable-web/automation/adapters/deepseek.mjs`
- Create: `apps/roundtable-web/automation/adapters/doubao.mjs`
- Test: `apps/roundtable-web/automation/automation.test.mjs`

- [ ] Launch one persistent Chrome context under `browser-profiles/roundtable` and reuse one bound page per provider.
- [ ] Isolate every provider URL and DOM selector in its adapter.
- [ ] Capture a response baseline, insert the prompt, submit, observe busy/stop controls, and return only a new stable assistant response.
- [ ] Detect login gates, missing composers, timeouts, detached streaming nodes, and cancellation with structured error codes.
- [ ] Save screenshots, HTML snippets, URL, selector attempts, and timestamps under the turn diagnostics directory on failure.

### Task 4: Build Deterministic Full-Loop Fake Provider Tests

**Files:**
- Create: `apps/roundtable-web/test-support/fake-provider-server.mjs`
- Create: `apps/roundtable-web/automation/worker.e2e.test.mjs`
- Modify: provider adapters to accept URL overrides during tests.

- [ ] Serve three deterministic fake provider pages that exercise textarea and contenteditable composers, click and Enter submit paths, streaming text, and stop-button completion.
- [ ] Verify the full worker loop from prompt insertion through stable response capture for all three providers.
- [ ] Verify same-round prompts use the same snapshot and the next round receives all completed prior-round replies.
- [ ] Verify relay execution is DeepSeek to Doubao to ChatGPT host summary.

### Task 5: Add Runtime Eventing And Recovery Controls

**Files:**
- Create: `apps/roundtable-web/orchestrator/event-bus.mjs`
- Create: `apps/roundtable-web/orchestrator/run-registry.mjs`
- Modify: `apps/roundtable-web/server.mjs`
- Modify: `apps/roundtable-web/public/app.js`
- Modify: `apps/roundtable-web/public/index.html`
- Modify: `apps/roundtable-web/public/styles.css`

- [ ] Add `/api/events` SSE with session, plan, turn, provider, storage, and runtime events.
- [ ] Return real browser commands immediately with a running plan while execution continues in the background.
- [ ] Add pause/resume, cancel, retry failed turn, skip failed turn, and manual reply takeover endpoints and controls.
- [ ] Reconnect SSE after transient disconnects and refresh the authoritative session after each state event.
- [ ] Keep all controls stable on desktop and mobile without changing the approved visual direction.

### Task 6: Add Artifacts, Audit, And Rollback

**Files:**
- Create: `apps/roundtable-web/orchestrator/artifact-writer.mjs`
- Create: `apps/roundtable-web/orchestrator/artifact-writer.test.mjs`
- Modify: `apps/roundtable-web/server.mjs`
- Modify: `apps/roundtable-web/public/app.js`

- [ ] Write summaries and requested artifacts through the existing filesystem tool contract.
- [ ] Save before-content backups for overwritten files and append audit entries containing operation, path, session, hash, and backup path.
- [ ] Add artifact list/write and rollback endpoints; reject rollback when the target has changed since the audited write.
- [ ] Show artifact and rollback states in the existing Files and Audit tabs.

### Task 7: Verify Real Provider Workflows

**Files:**
- Update: `apps/roundtable-web/automation/adapters/*.mjs` only when live diagnostics prove selectors need adjustment.
- Record: `.adworkflow/verification_result.json`

- [ ] Start the runtime with the persistent Chrome profile and complete login where the provider requires it.
- [ ] Run `@ds 先分析如何训练审美` and confirm the captured DeepSeek reply enters the shared ledger.
- [ ] Run `@全体 根据 DeepSeek 的观点分别说说看法` and confirm ChatGPT, DeepSeek, and Doubao all receive shared context and produce captured replies.
- [ ] Switch to relay mode, place ChatGPT at the host snap point, and verify `DeepSeek -> Doubao -> ChatGPT` with ChatGPT producing the final report.
- [ ] Confirm the saved summary, JSONL ledger, diagnostics, audit, and rollback behavior from disk.

### Task 8: Release Launcher And Independent Review

**Files:**
- Create: `start-web-agents.bat`
- Modify: `scripts/start-web-agents-roundtable.ps1`
- Modify: `package.json`
- Update: `.adworkflow/worker_state.json`
- Update: `.adworkflow/verification_result.json`
- Update: `.adworkflow/review_findings.json`

- [ ] Make the root BAT verify Node.js, npm dependencies, Chrome availability, data-root configuration, and service health before opening `http://127.0.0.1:3020`.
- [ ] Run all repository-local tests plus the fake-provider Playwright suite.
- [ ] Ask Claude Code in read-only mode to review the scoped diff and verification evidence; fix every confirmed blocking finding.
- [ ] Run the final smoke test from the BAT and record exact evidence and remaining external risks.
