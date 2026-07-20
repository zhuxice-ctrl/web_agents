# Roundtable Conversation Layout and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible detail sidebar, safe ChatGPT-style Markdown conversation rendering, per-model transient generation progress, and a regression test proving round-scoped concurrency.

**Architecture:** Keep persisted session events authoritative and hold partial output only in a browser-side `TurnProgressStore`. Feed optional progress snapshots from both browser workers through `RoundtableScheduler` to SSE, while retaining the existing `Promise.allSettled` discussion barrier. Split DOM behavior into focused public modules and load Marked plus DOMPurify from local vendor routes.

**Tech Stack:** Node.js 24 ESM, browser ES modules, Server-Sent Events, Playwright/CDP, Marked 18.0.6, DOMPurify 3.4.12, `node:test`.

---

### Task 1: Detail Sidebar State and Layout

**Files:**
- Create: `products/roundtable/app/public/detail-sidebar-controller.mjs`
- Create: `products/roundtable/app/public/detail-sidebar-controller.test.mjs`
- Modify: `products/roundtable/app/public/index.html`
- Modify: `products/roundtable/app/public/styles.css`
- Modify: `products/roundtable/app/public/app.js`
- Modify: `products/roundtable/app/public/ui-contract.test.mjs`

- [ ] **Step 1: Write failing controller and UI contract tests**

Test a controller created with fake elements and storage:

```js
const controller = createDetailSidebarController({ workspace, sidebar, collapseButton, restoreButton, storage });
controller.initialize();
collapseButton.click();
assert.equal(workspace.classList.contains("is-detail-collapsed"), true);
assert.equal(sidebar.hidden, true);
assert.equal(storage.getItem(DETAIL_SIDEBAR_STORAGE_KEY), "true");
restoreButton.click();
assert.equal(sidebar.hidden, false);
```

Extend `ui-contract.test.mjs` to require `collapseDetailSidebarButton`, `restoreDetailSidebarButton`, the collapsed grid rule, and the persisted storage key.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test products/roundtable/app/public/detail-sidebar-controller.test.mjs products/roundtable/app/public/ui-contract.test.mjs`  
Expected: FAIL because the controller and controls do not exist.

- [ ] **Step 3: Implement the controller and controls**

Export this API:

```js
export const DETAIL_SIDEBAR_STORAGE_KEY = "web-agents-roundtable:detail-sidebar-collapsed";
export function createDetailSidebarController({ workspace, sidebar, collapseButton, restoreButton, storage }) {
  const apply = (collapsed) => {
    workspace.classList.toggle("is-detail-collapsed", collapsed);
    sidebar.hidden = collapsed;
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    restoreButton.hidden = !collapsed;
  };
  return { initialize, collapse, restore };
}
```

Add one collapse icon in the detail toolbar and one restore icon outside the hidden aside. Initialize it once in `app.js`. CSS must reduce the third outer grid track to zero on desktop, keep a one-column layout on narrow screens, and preserve the existing pink-white variables.

- [ ] **Step 4: Run focused tests**

Run: `node --test products/roundtable/app/public/detail-sidebar-controller.test.mjs products/roundtable/app/public/ui-contract.test.mjs`  
Expected: PASS.

### Task 2: Safe Markdown Conversation Renderer

**Files:**
- Create: `products/roundtable/app/public/conversation-renderer.mjs`
- Create: `products/roundtable/app/public/conversation-renderer.test.mjs`
- Modify: `products/roundtable/package.json`
- Modify: `package-lock.json`
- Modify: `products/roundtable/app/server.mjs`
- Modify: `products/roundtable/app/server-runtime.test.mjs`
- Modify: `products/roundtable/app/public/index.html`
- Modify: `products/roundtable/app/public/app.js`
- Modify: `products/roundtable/app/public/styles.css`

- [ ] **Step 1: Add failing renderer and vendor route tests**

Test structured reply conversion and dependency injection:

```js
const markdown = structuredReplyToMarkdown(event);
assert.match(markdown, /^## 核心判断/m);
assert.match(markdown, /## 风险\n\n- 风险 A/);
const html = renderSafeMarkdown("# 标题", { parse: () => "<h1>标题</h1><script>x()</script>", sanitize: (value) => value.replace(/<script.*?<\/script>/s, "") });
assert.equal(html, "<h1>标题</h1>");
```

Add runtime requests asserting `/vendor/marked.umd.js` and `/vendor/purify.min.js` return JavaScript with status 200.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test products/roundtable/app/public/conversation-renderer.test.mjs products/roundtable/app/server-runtime.test.mjs`  
Expected: FAIL because renderer exports and vendor routes are absent.

- [ ] **Step 3: Install pinned local dependencies**

Run: `npm install --workspace @web-agents/roundtable-product marked@18.0.6 dompurify@3.4.12`  
Expected: `products/roundtable/package.json` contains both dependencies and the lockfile records them.

- [ ] **Step 4: Implement safe rendering and local vendor serving**

`conversation-renderer.mjs` exports `structuredReplyToMarkdown`, `markdownForEvent`, and `renderSafeMarkdown`. `renderSafeMarkdown` calls `marked.parse` and then `DOMPurify.sanitize` with a denylist for script-capable tags/attributes; failures return escaped plain text. Add a `hardenRenderedLinks(root)` pass that accepts only `http:`, `https:`, and `mailto:` and applies `target="_blank" rel="noopener noreferrer"` to external links.

In `server.mjs`, resolve the installed browser builds once and expose only these two explicit paths:

```js
const VENDOR_FILES = new Map([
  ["/vendor/marked.umd.js", path.join(path.dirname(require.resolve("marked")), "marked.umd.js")],
  ["/vendor/purify.min.js", path.join(path.dirname(require.resolve("dompurify")), "purify.min.js")],
]);
```

Load both scripts before `/app.js`. Replace raw conversation HTML with sanitized Markdown articles while retaining provider, round, stage, time, quality flags, structured status, and collapsed raw response.

- [ ] **Step 5: Add document-style CSS and run tests**

Style `.event-content.markdown-body` headings, paragraphs, lists, quotes, pre/code, tables, links, and overflow without bubbles or nested cards. Run: `node --test products/roundtable/app/public/conversation-renderer.test.mjs products/roundtable/app/public/ui-contract.test.mjs products/roundtable/app/server-runtime.test.mjs`  
Expected: PASS.

### Task 3: Browser-Side Turn Progress Store

**Files:**
- Create: `products/roundtable/app/public/turn-progress-store.mjs`
- Create: `products/roundtable/app/public/turn-progress-store.test.mjs`
- Modify: `products/roundtable/app/public/app.js`
- Modify: `products/roundtable/app/public/styles.css`

- [ ] **Step 1: Write failing state transition tests**

Cover started, progress, stale execution, terminal refresh, session switch, and running-turn reconstruction:

```js
store.handleStarted(startedEvent);
store.handleProgress({ ...progressEvent, text: "部分结果", at: "2026-07-20T01:00:01Z" });
assert.equal(store.list("session-1")[0].partialText, "部分结果");
store.handleProgress({ ...progressEvent, executionId: "old", text: "迟到文本" });
assert.equal(store.list("session-1")[0].partialText, "部分结果");
store.syncSession(completedSession);
assert.deepEqual(store.list("session-1"), []);
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test products/roundtable/app/public/turn-progress-store.test.mjs`  
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the pure progress store**

Use a `Map` keyed by `${sessionId}:${turnId}`. Map SSE `at` to `updatedAt`; accept a progress snapshot only when session, turn, and execution match and its timestamp is not older. `syncSession(session)` recreates missing `running` turns and deletes terminal turns. `setActiveSession(id)` clears entries from other sessions.

- [ ] **Step 4: Integrate keyed conversation reconciliation**

Parse SSE data for `turn.started`, `turn.progress`, `turn.completed`, and `turn.failed`. Render progress items after persisted events in stable round/turn order. Reuse articles by `data-conversation-key`, update only changed content, and preserve scroll unless the viewport was within 96px of the bottom before rendering. A no-text item shows an animated `内容生成中...`; a partial item uses the safe Markdown renderer plus a subtle active marker.

- [ ] **Step 5: Run public tests**

Run: `node --test products/roundtable/app/public/*.test.mjs`  
Expected: PASS.

### Task 4: Throttled Worker Progress Reporting

**Files:**
- Create: `products/roundtable/app/automation/progress-reporter.mjs`
- Create: `products/roundtable/app/automation/progress-reporter.test.mjs`
- Modify: `products/roundtable/app/automation/completion-detector.mjs`
- Modify: `products/roundtable/app/automation/completion-detector.test.mjs`
- Modify: `products/roundtable/app/automation/worker.mjs`
- Modify: `products/roundtable/app/automation/extension-worker.mjs`
- Modify: `products/roundtable/app/automation/extension-worker.test.mjs`

- [ ] **Step 1: Write failing progress reporting tests**

Assert changed text is emitted at most once per 400ms, values shorter than two characters are ignored, duplicates are ignored, and a throwing callback never fails final capture. For the extension worker, collect `onProgress` calls and assert both `New partial` and a later stable snapshot can be reported without changing `result.text`.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test products/roundtable/app/automation/progress-reporter.test.mjs products/roundtable/app/automation/completion-detector.test.mjs products/roundtable/app/automation/extension-worker.test.mjs`  
Expected: FAIL because progress reporting is not wired.

- [ ] **Step 3: Implement a shared reporter and wire Playwright**

Export `createProgressReporter({ onProgress, now, throttleMs = 400 })` with `report(snapshot)`. It normalizes text, rejects duplicates/noise, and catches callback failures. `waitForCompletedResponse` accepts `onProgress`, `now`, and `progressThrottleMs`; it reports each changed candidate. `BrowserWorker.execute` forwards `request.onProgress`.

- [ ] **Step 4: Wire extension capture polling**

Create one reporter before the extension polling loop and call it only after provider/speaker/prompt-echo validation. Preserve Markdown newlines in progress and final text rather than flattening all whitespace; keep a separate compact normalization only for identity comparisons.

- [ ] **Step 5: Run automation tests**

Run: `node --test products/roundtable/app/automation/progress-reporter.test.mjs products/roundtable/app/automation/completion-detector.test.mjs products/roundtable/app/automation/extension-worker.test.mjs products/roundtable/app/automation/browser-manager.test.mjs`  
Expected: PASS.

### Task 5: Scheduler `turn.progress` SSE Contract

**Files:**
- Modify: `products/roundtable/app/orchestrator/scheduler.mjs`
- Modify: `products/roundtable/app/orchestrator/orchestrator.test.mjs`
- Modify: `products/roundtable/app/orchestrator/event-bus.test.mjs`

- [ ] **Step 1: Write failing event contract tests**

Use a worker that calls `request.onProgress({ text: "中间结果", at })` before returning. Assert one event with exact fields `sessionId`, `planId`, `runId`, `turnId`, `executionId`, `providerId`, `providerLabel`, `round`, `stage`, `text`, and `at`, and assert saved session events contain no progress record.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test products/roundtable/app/orchestrator/event-bus.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs`  
Expected: FAIL because the worker request has no progress callback.

- [ ] **Step 3: Emit transient scheduler progress**

Pass `onProgress` in `executeProvider`. Capture immutable IDs from the current turn and call `this.emit("turn.progress", payload)`. Validate text is non-empty before emit and keep all persistence methods unchanged.

- [ ] **Step 4: Run orchestrator tests**

Run: `node --test products/roundtable/app/orchestrator/event-bus.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs`  
Expected: PASS.

### Task 6: Prove Round-Scoped Concurrency

**Files:**
- Modify: `products/roundtable/app/orchestrator/orchestrator.test.mjs`

- [ ] **Step 1: Replace the timing-implicit discussion test with controlled barriers**

The worker stores a deferred release per discussion turn. Start execution, wait until all three round-one calls are present, release two, and assert no round-two call exists. Release the final round-one turn, wait until all three round-two calls are present, then repeat before allowing closure.

- [ ] **Step 2: Run the test to verify the current scheduler passes**

Run: `node --test --test-name-pattern="discussion turns share" products/roundtable/app/orchestrator/orchestrator.test.mjs`  
Expected: PASS, proving existing `Promise.allSettled` behavior rather than changing the scheduler.

- [ ] **Step 3: Run the complete orchestrator suite**

Run: `node --test products/roundtable/app/orchestrator/*.test.mjs`  
Expected: PASS.

### Task 7: Integrated Verification and Runtime Launch

**Files:**
- Modify only files required by failures found in this feature.

- [ ] **Step 1: Run focused feature suites**

Run: `node --test products/roundtable/app/public/*.test.mjs products/roundtable/app/automation/progress-reporter.test.mjs products/roundtable/app/automation/completion-detector.test.mjs products/roundtable/app/automation/extension-worker.test.mjs products/roundtable/app/orchestrator/*.test.mjs products/roundtable/app/server-runtime.test.mjs`  
Expected: PASS.

- [ ] **Step 2: Run product boundary and full roundtable tests**

Run: `npm.cmd run check:boundaries`  
Expected: PASS.  
Run: `npm.cmd run test:roundtable`  
Expected: PASS; browser tests may explicitly skip only when their documented browser prerequisite is unavailable.

- [ ] **Step 3: Start the existing launcher and inspect health**

Run: `powershell -ExecutionPolicy Bypass -File products/roundtable/launcher/start-roundtable.ps1`  
Expected: the roundtable responds at `http://127.0.0.1:3020` and CDP Chrome at `http://127.0.0.1:9223`.

- [ ] **Step 4: Perform desktop and narrow viewport checks**

Verify nonblank rendering, actual workspace width change after collapse, persistence after refresh, safe Markdown elements, simultaneous placeholders for one round, replacement by final replies, stable upward scroll, and no overlap at desktop and mobile widths.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check` and `git status --short`  
Expected: no whitespace errors; unrelated pre-existing changes remain untouched and are called out separately.
