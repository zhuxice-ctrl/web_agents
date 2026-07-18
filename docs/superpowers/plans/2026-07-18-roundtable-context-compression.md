# Roundtable Context Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically compress an estimated 128K-token roundtable prompt at 80% usage to a traceable 20% projection while preserving the append-only event ledger and allowing user revisions.

**Architecture:** Add a deterministic token estimator and a pure compression engine under the roundtable orchestrator. The scheduler applies compression inside the existing atomic session update before a turn is sent; the context projector and prompt builder consume the active revision, while the server and UI expose revision and inspection workflows. Raw events remain authoritative and unchanged.

**Tech Stack:** Node.js 24 ESM, Node test runner, JSON/JSONL persistence, browser-native HTML/CSS/JavaScript.

---

### Task 1: Token Budget Contract

**Files:**
- Create: `products/roundtable/app/orchestrator/context-token-estimator.mjs`
- Create: `products/roundtable/app/orchestrator/context-token-estimator.test.mjs`
- Modify: `products/roundtable/app/core/providers.mjs`

- [ ] **Step 1: Write failing estimator and settings tests**

Cover empty input, Chinese text, ASCII prose, code/JSON, deterministic totals, and the approved defaults:

```js
assert.equal(estimateTextTokens(""), 0);
assert.equal(estimateTextTokens("圆桌上下文"), 6);
assert.ok(estimateTextTokens(JSON.stringify({ command: "write_file", path: "a.txt" })) > 5);
assert.equal(DEFAULT_SETTINGS.contextWindowTokens, 131072);
assert.equal(DEFAULT_SETTINGS.compressionTriggerPercent, 80);
assert.equal(DEFAULT_SETTINGS.compressionTargetPercent, 20);
assert.equal(DEFAULT_SETTINGS.recentRawTokenBudget, 16384);
```

- [ ] **Step 2: Verify RED**

Run: `node --test products/roundtable/app/orchestrator/context-token-estimator.test.mjs`  
Expected: FAIL because the estimator module and settings do not exist.

- [ ] **Step 3: Implement a deterministic conservative estimator**

Export `estimateTextTokens(text)` and `estimatePromptTokens(prompt)`. Count each CJK code point as one token, estimate ASCII runs by `ceil(utf8Bytes / 4)`, estimate other non-ASCII runs by `ceil(utf8Bytes / 2)`, and add a fixed 32-token envelope only in `estimatePromptTokens`.

Add these coerceable settings:

```js
contextWindowTokens: 131072,
compressionTriggerPercent: 80,
compressionTargetPercent: 20,
recentRawTokenBudget: 16384,
```

Keep valid ranges bounded so trigger is `50..95`, target is `10..40`, target is always below trigger, and recent raw budget cannot exceed the target token budget.

- [ ] **Step 4: Verify GREEN**

Run: `node --test products/roundtable/app/orchestrator/context-token-estimator.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- products/roundtable/app/core/providers.mjs products/roundtable/app/orchestrator/context-token-estimator.mjs products/roundtable/app/orchestrator/context-token-estimator.test.mjs
git commit -m "feat(roundtable): define context token budget"
```

### Task 2: Deterministic Compression Engine

**Files:**
- Create: `products/roundtable/app/orchestrator/context-compressor.mjs`
- Create: `products/roundtable/app/orchestrator/context-compressor.test.mjs`

- [ ] **Step 1: Write failing compression tests**

Test `compressSessionContext(session, options)` with injected `estimatePromptTokens`, `buildPrompt`, and `now`. Require no change below 80%, one revision at the threshold, no duplicate revision for the same boundary, a 20% target, a 16K recent-raw preference, and source IDs for every derived item.

Use explicit event content such as:

```js
{ id: "e1", type: "reply", content: "共识：原始账本不可修改" }
{ id: "e2", type: "reply", content: "分歧：是否调用模型生成摘要" }
{ id: "e3", type: "reply", content: "普通观点不会被提升为共识" }
```

Assert `e1` and `e2` enter their named buckets, `e3` enters `unclassified`, and the input `events` array remains deeply equal to its pre-compression clone.

- [ ] **Step 2: Verify RED**

Run: `node --test products/roundtable/app/orchestrator/context-compressor.test.mjs`  
Expected: FAIL because `context-compressor.mjs` does not exist.

- [ ] **Step 3: Implement explicit-marker extraction and revision state**

Export:

```js
export function compressSessionContext(session, options = {})
export function reviseSessionCompression(session, payload, options = {})
export function getActiveCompression(session)
```

Use schema `web-agents-roundtable-compression.v1`. A revision contains `id`, `revision`, `createdAt`, `reason`, `coveredFromEventIndex`, `coveredThroughEventIndex`, `sourceEventIds`, five arrays (`consensus`, `disagreements`, `evidence`, `decisions`, `unclassified`), and `estimate: { beforeTokens, afterTokens, windowTokens, triggerTokens, targetTokens }`.

Recognize only line-leading `共识:`, `共识：`, `分歧:`, `分歧：`, `证据:`, `证据：`, `决定:`, `决定：`, `决策:`, and `决策：`. Store bucket entries as `{ id, text, sourceEventIds }`. Everything else receives a bounded index entry `{ id, text, sourceEventIds }`; trim unclassified entries first until the target budget is met.

- [ ] **Step 4: Implement revision validation**

`reviseSessionCompression` must reject unknown source event IDs, invalid buckets, empty text, duplicate entry IDs, stale `baseRevision`, and a missing active compression. A valid correction appends a new revision with `reason: "user_revision"`, preserves the covered range, and never changes `session.events`.

- [ ] **Step 5: Verify GREEN**

Run: `node --test products/roundtable/app/orchestrator/context-compressor.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- products/roundtable/app/orchestrator/context-compressor.mjs products/roundtable/app/orchestrator/context-compressor.test.mjs
git commit -m "feat(roundtable): add deterministic context compression"
```

### Task 3: Prompt Projection And Atomic Scheduler Integration

**Files:**
- Modify: `products/roundtable/app/orchestrator/context-projector.mjs`
- Modify: `products/roundtable/app/orchestrator/context-projector.test.mjs`
- Modify: `products/roundtable/app/orchestrator/context-builder.mjs`
- Modify: `products/roundtable/app/orchestrator/orchestrator.test.mjs`
- Modify: `products/roundtable/app/orchestrator/scheduler.mjs`
- Modify: `products/roundtable/app/orchestrator/scheduler-compression.test.mjs`

- [ ] **Step 1: Write failing projection tests**

Add an active compression revision covering events `0..9` and assert that `projectContextForSeat()` returns it under `projection.compression`, excludes covered raw events from `promptEvents`, and still returns the complete cursor delta in `events` for exact synchronization.

- [ ] **Step 2: Write failing prompt tests**

Assert the prompt contains a clearly labeled `<compressed_roundtable_context>` block with revision, covered range, source IDs, and the four structured buckets before `<shared_roundtable_context>`. Assert covered raw content does not reappear in the prompt and recent raw content does.

- [ ] **Step 3: Write failing scheduler tests**

Create a store fixture whose prompt estimate crosses 80%. Run one prepared turn and assert the session persisted one automatic revision before worker execution, the worker prompt uses that revision, and a second same-boundary turn does not append another revision. Inject a compressor failure and assert the original prompt is sent while `context.compression.lastError` is persisted.

- [ ] **Step 4: Verify RED**

Run:

```powershell
node --test products/roundtable/app/orchestrator/context-projector.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/scheduler-compression.test.mjs
```

Expected: FAIL because active compression is not projected or scheduled.

- [ ] **Step 5: Integrate compression without changing ledger semantics**

Keep `projection.events` as the full public cursor delta. Build `projection.promptEvents` from the first event after `coveredThroughEventIndex`, then apply the existing recent-raw bound. Add `projection.compression` as a structured clone of the active revision.

Inside `RoundtableScheduler.prepareTurnPrompt`, first build the uncompressed candidate prompt, call `compressSessionContext` on the session object already held by `store.updateSession`, re-project and rebuild only when `changed === true`, and persist diagnostic failure state without throwing. Extend `projectionSummary` with compression revision and token estimates.

- [ ] **Step 6: Verify GREEN and regression behavior**

Run:

```powershell
node --test products/roundtable/app/orchestrator/context-projector.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/scheduler-compression.test.mjs
```

Expected: PASS, including unchanged same-round snapshots and exact seat cursors.

- [ ] **Step 7: Commit**

```powershell
git add -- products/roundtable/app/orchestrator
git commit -m "feat(roundtable): apply compression before prompt delivery"
```

### Task 4: Compression API, Persistence, And Audit

**Files:**
- Modify: `products/roundtable/app/server.mjs`
- Modify: `products/roundtable/app/server-runtime.test.mjs`
- Modify: `products/roundtable/app/storage/local-workspace-store.test.mjs`

- [ ] **Step 1: Write failing persistence test**

Persist a session containing two compression revisions, reload it, and assert both revisions and the active revision survive while `ledger.jsonl` remains byte-for-byte equal before and after a user revision.

- [ ] **Step 2: Write failing API tests**

Cover:

```text
GET  /api/sessions/:id/context/compression
POST /api/sessions/:id/context/compression/revise
```

Require `404 COMPRESSION_NOT_FOUND` before the first compression, `200` with active revision and estimate afterward, `409 STALE_COMPRESSION_REVISION` for a stale edit, and `400 UNKNOWN_COMPRESSION_SOURCE_EVENT` for a foreign event ID.

- [ ] **Step 3: Verify RED**

Run:

```powershell
node --test --test-name-pattern="compression" products/roundtable/app/storage/local-workspace-store.test.mjs products/roundtable/app/server-runtime.test.mjs
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 4: Implement session-scoped routes**

Read routes return only the active compression, revision metadata, settings, and estimates. The revise route uses `store.updateSession`, calls `reviseSessionCompression`, updates `updatedAt`, and appends a `compression_revision` audit entry after persistence. Do not add a route that overwrites raw events or forces arbitrary compression content.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
node --test --test-name-pattern="compression" products/roundtable/app/storage/local-workspace-store.test.mjs products/roundtable/app/server-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- products/roundtable/app/server.mjs products/roundtable/app/server-runtime.test.mjs products/roundtable/app/storage/local-workspace-store.test.mjs
git commit -m "feat(roundtable): expose compression revisions"
```

### Task 5: Context Inspection And Correction UI

**Files:**
- Modify: `products/roundtable/app/public/index.html`
- Modify: `products/roundtable/app/public/app.js`
- Modify: `products/roundtable/app/public/styles.css`
- Modify: `products/roundtable/app/public/ui-contract.test.mjs`

- [ ] **Step 1: Write failing UI contract tests**

Require a fourth `data-tab="context"` tab, `contextUsage`, `compressionRevision`, `compressionCoverage`, `compressedContextView`, `recentRawContextView`, and `compressionEditDialog`. Keep exactly one element marked `data-task-input="true"`; correction controls are not task inputs.

- [ ] **Step 2: Verify RED**

Run: `node --test products/roundtable/app/public/ui-contract.test.mjs`  
Expected: FAIL because the context view does not exist.

- [ ] **Step 3: Build the non-blocking context view**

Render estimated usage as `used / 128K（估算）`, the 80% trigger, active revision, creation time, and covered event range. Render structured buckets with source-event buttons and show recent raw events separately. In the conversation timeline, replace the covered range with one expandable compression marker while preserving access to every original event.

- [ ] **Step 4: Build revision controls**

Use dynamic text inputs for entry text and read-only source ID labels. Provide icon buttons with tooltips for add/remove, Cancel, and Save. Save `baseRevision` plus all five buckets to `/context/compression/revise`, reload the session on success, and show server validation errors without discarding the user's draft.

- [ ] **Step 5: Add stable responsive styling**

Use the existing restrained workbench palette and radius tokens. Give usage meters stable dimensions, keep bucket rows unframed, prevent source IDs from overflowing, and stack edit rows below `520px`. Do not add nested cards or a second task composer.

- [ ] **Step 6: Verify GREEN**

Run: `node --test products/roundtable/app/public/ui-contract.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- products/roundtable/app/public/index.html products/roundtable/app/public/app.js products/roundtable/app/public/styles.css products/roundtable/app/public/ui-contract.test.mjs
git commit -m "feat(roundtable): add context compression workspace"
```

### Task 6: Full Regression And Acceptance Evidence

**Files:**
- Modify only if failures require scoped repairs under `products/roundtable/**`.

- [ ] **Step 1: Run syntax and focused suites**

```powershell
node --check products/roundtable/app/orchestrator/context-token-estimator.mjs
node --check products/roundtable/app/orchestrator/context-compressor.mjs
node --check products/roundtable/app/orchestrator/context-projector.mjs
node --check products/roundtable/app/orchestrator/context-builder.mjs
node --check products/roundtable/app/orchestrator/scheduler.mjs
node --check products/roundtable/app/server.mjs
node --check products/roundtable/app/public/app.js
npm.cmd --workspace @web-agents/roundtable-product run test:core
```

Expected: all checks and roundtable core tests pass.

- [ ] **Step 2: Run product boundary and full roundtable suites**

```powershell
npm.cmd run check:boundaries
npm.cmd run test:roundtable
node --test tools/product-runtime-isolation.test.mjs
```

Expected: zero failures; plugin and roundtable remain independently stoppable.

- [ ] **Step 3: Verify ledger immutability evidence**

Run the compression storage test with a temporary workspace and confirm its before/after SHA-256 assertion passes. Record the active revision, covered range, and before/after token estimates in the test output or final report; do not add generated workspace data to Git.

- [ ] **Step 4: Inspect the final diff**

```powershell
git diff --check
git status --short
git diff -- products/roundtable
```

Expected: no plugin files, generated data, browser profiles, or unrelated user files appear in the feature diff.

- [ ] **Step 5: Commit any final scoped repairs**

```powershell
git add -- products/roundtable
git commit -m "test(roundtable): verify context compression MVP"
```
