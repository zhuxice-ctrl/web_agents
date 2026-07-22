# Roundtable Binding and Streaming Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair stale cross-session provider bindings and make active roundtable generation compact, collapsible, naturally worded, and centered on the current user command.

**Architecture:** Exact `providerId + threadKey` bindings remain authoritative. Explicit reconnect safely transfers an idle provider page after orphaning old leases, while the UI combines persisted thread state with live browser bindings refreshed every ten seconds. Existing transient `turn.progress` data is rendered through a focused disclosure controller that preserves user-controlled expansion and scroll position.

**Tech Stack:** Node.js 24, ECMAScript modules, `node:test`, Playwright/CDP, local page-lease registry, browser DOM with marked and DOMPurify, CSS.

---

## File map and boundaries

- `.adworkflow/artifacts/roundtable-binding-streaming-polish/requirements.md`: confirmed requirement and diagnostic evidence.
- `.adworkflow/task_specs/roundtable-binding-streaming-polish.json`: independent task contract.
- `products/roundtable/app/automation/browser-manager.mjs`: safe transfer of an idle page from old thread bindings to the explicitly reconnected thread.
- `products/roundtable/app/orchestrator/scheduler.mjs`: suppress identical automatic retry for missing or busy page bindings.
- `products/roundtable/app/public/thread-status-model.mjs`: pure live-binding status projection for seats.
- `products/roundtable/app/public/roundtable-command-model.mjs`: pure current/recent command selection.
- `products/roundtable/app/public/progress-disclosure-controller.mjs`: transient disclosure and inner-scroll state preservation.
- `products/roundtable/app/public/app.js`: compose the models into the existing UI.
- `products/roundtable/app/public/styles.css`: compact paragraphs and bounded streaming disclosure.
- `products/roundtable/app/orchestrator/context-builder.mjs`: natural human tone and paragraph rhythm instruction.
- Adjacent `*.test.mjs` files: focused regression coverage.

## Dirty-worktree safety

Most roundtable files already contain user-owned uncommitted work. Do not stage or commit a whole modified source file unless the cached diff can be proven to contain only this task's hunks. Commit newly created requirement and plan files independently; leave overlapping source changes unstaged when isolation is uncertain.

### Task 1: Record the confirmed requirement

**Files:**
- Create: `.adworkflow/artifacts/roundtable-binding-streaming-polish/requirements.md`
- Create: `.adworkflow/task_specs/roundtable-binding-streaming-polish.json`

- [ ] **Step 1: Write the requirement artifact**

Create `requirements.md` with:

```markdown
# 圆桌页面绑定与流式体验需求

## 已确认问题

- 当前会话豆包线程缺少实际 CDP 页面绑定，但持久化状态仍显示 verified。
- 存活豆包页面属于前一个会话，发送前报 PROVIDER_PAGE_NOT_BOUND。
- 流式文本持续撑高公共会话。
- 连续短段落和模板化汇报腔影响阅读。
- 圆桌中央没有显示当前或最近命令。

## 预期行为

- 实时绑定缺失时显示“需要重新连接”。
- 显式重连只转交空闲页面，并清理同页旧绑定和旧租约。
- 页面正在被其他执行使用时拒绝抢占。
- 缺页错误不进行相同的无效自动重试。
- 生成中内容使用默认展开的折叠卡片，内部自动滚动并尊重用户上滚或折叠。
- 最终回复保持原文；段落仅通过提示词和样式改善。
- 运行时中央显示当前命令，空闲时显示最近用户命令。
```

- [ ] **Step 2: Write the task spec**

Create `roundtable-binding-streaming-polish.json` with:

```json
{
  "task_id": "roundtable-binding-streaming-polish",
  "goal": "Keep provider page bindings live and make streamed model output compact and controllable.",
  "non_goals": [
    "Do not rewrite final provider replies.",
    "Do not silently steal a page from an active execution.",
    "Do not persist progress disclosure state.",
    "Do not change round scheduling or the local tool protocol."
  ],
  "acceptance_criteria": [
    "A persisted verified thread without an exact live binding displays reconnect required.",
    "Explicit reconnect orphans idle same-page bindings before assigning the current thread.",
    "Missing page bindings are attempted once, not twice.",
    "Streaming text is collapsible and follows its own bottom until the user takes control.",
    "Prompts request human conversational tone and coherent paragraphs.",
    "The roundtable center displays the active command or latest user command.",
    "Roundtable tests and rendered QA pass."
  ],
  "risk_level": "medium",
  "execution_mode": "inline_with_review",
  "allowed_actions": ["read", "edit", "test"],
  "required_outputs": ["requirements.md", "verification_result.json"]
}
```

- [ ] **Step 3: Validate and commit only the new artifacts**

```powershell
node -e "JSON.parse(require('fs').readFileSync('.adworkflow/task_specs/roundtable-binding-streaming-polish.json','utf8')); console.log('valid')"
git add -- .adworkflow/artifacts/roundtable-binding-streaming-polish/requirements.md .adworkflow/task_specs/roundtable-binding-streaming-polish.json
git diff --cached --check
git commit -m "docs: define binding and streaming polish task"
```

Expected: `valid`, then one documentation-only commit.

### Task 2: Transfer reused provider pages safely

**Files:**
- Modify: `products/roundtable/app/automation/browser-manager.mjs:299-402`
- Test: `products/roundtable/app/automation/browser-manager.test.mjs:188-251`

- [ ] **Step 1: Add failing reconnect transfer tests**

Add tests using the existing `createPage`, `createCdpFixture`, and `PageLeaseRegistry` helpers:

```js
test("explicit reconnect transfers an idle provider page and orphans the old thread lease", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-manager-transfer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new PageLeaseRegistry({ filePath: path.join(root, "page-leases.json") });
  const page = createPage("https://chatgpt.com/c/old");
  const { manager } = createCdpFixture({ pages: [page] });
  manager.setLeaseRegistry(registry);
  const oldKey = "session-old:chatgpt:thread-old";
  const newKey = "session-new:chatgpt:thread-new";
  await manager.bindProviderPage("chatgpt", page.currentUrl, { threadKey: oldKey, sessionId: "session-old" });
  const oldLease = registry.find({ providerId: "chatgpt", threadKey: oldKey });

  await manager.reconnectProviderThread("chatgpt", {
    threadKey: newKey,
    sessionId: "session-new",
    seatId: "chatgpt",
    refresh: true,
  });

  assert.equal(await manager.getPage("chatgpt", { threadKey: newKey }), page);
  await assert.rejects(
    () => manager.getPage("chatgpt", { threadKey: oldKey }),
    (error) => error.code === "PROVIDER_PAGE_NOT_BOUND",
  );
  assert.equal(registry.get(oldLease.pageBindingId).state, "ORPHANED");
});
```

Add a second test that calls `manager.acquirePage` for the old thread and asserts reconnect rejects with `PROVIDER_PAGE_IN_USE`, leaving the old binding accessible.

- [ ] **Step 2: Run the browser-manager test and verify failure**

```powershell
node --test products/roundtable/app/automation/browser-manager.test.mjs
```

Expected: the old thread remains bound after reconnect, and the busy-page protection code does not exist.

- [ ] **Step 3: Implement one transfer helper**

Add this method to `BrowserManager`:

```js
async transferPageBinding(page, { targetKey = null } = {}) {
  const conflicts = [...this.bindings.entries()]
    .filter(([key, binding]) => key !== targetKey && binding.page === page);
  for (const [, binding] of conflicts) {
    const lease = binding.pageBindingId ? this.leaseRegistry?.get(binding.pageBindingId) : null;
    const unexpired = !lease?.leaseExpiresAt || Date.parse(lease.leaseExpiresAt) > Date.now();
    if (lease?.state === "BUSY" && lease.ownerExecutionId && unexpired) {
      throw new AutomationError("PROVIDER_PAGE_IN_USE", `${binding.providerId} page is being used by another roundtable execution.`, {
        providerId: binding.providerId,
        sessionId: binding.sessionId || null,
        threadKey: binding.threadKey || null,
        ownerExecutionId: lease.ownerExecutionId,
      });
    }
  }
  for (const [key, binding] of conflicts) {
    this.bindings.delete(key);
    if (this.leaseRegistry && binding.pageBindingId) {
      await this.leaseRegistry.markOrphaned(binding.pageBindingId);
    }
  }
}
```

In `createProviderThread`, compute the target binding key before reuse cleanup and replace the current inline loop with `await this.transferPageBinding(page, { targetKey: key })`.

In `reconnectProviderThread`, after selecting the page and before reserving/binding the current lease, call the same helper with the new thread key.

- [ ] **Step 4: Re-run binding and lease tests**

```powershell
node --test products/roundtable/app/automation/browser-manager.test.mjs products/roundtable/app/automation/page-lease-registry.test.mjs
```

Expected: idle transfer passes, busy transfer is rejected, and existing reconciliation tests remain green.

### Task 3: Project live binding status into the UI

**Files:**
- Create: `products/roundtable/app/public/thread-status-model.mjs`
- Create: `products/roundtable/app/public/thread-status-model.test.mjs`
- Modify: `products/roundtable/app/public/app.js:145-175,187-205,246-253`
- Test: `products/roundtable/app/public/ui-contract.test.mjs`

- [ ] **Step 1: Write pure status-model tests**

Create tests covering exact match, stale verified state, closed binding, and another-session binding:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { resolveThreadStatus } from "./thread-status-model.mjs";

const thread = { status: "verified", threadKey: "current:doubao:1" };

test("verified thread requires an exact live binding", () => {
  assert.equal(resolveThreadStatus(thread, [{ providerId: "doubao", threadKey: "current:doubao:1", status: "verified", closed: false }]).state, "verified");
  assert.equal(resolveThreadStatus(thread, [{ providerId: "doubao", threadKey: "old:doubao:1", status: "verified", closed: false }]).state, "needs_reconnect");
  assert.equal(resolveThreadStatus(thread, [{ providerId: "doubao", threadKey: "current:doubao:1", status: "verified", closed: true }]).state, "needs_reconnect");
});

test("login and verification states remain actionable without a live binding", () => {
  assert.equal(resolveThreadStatus({ status: "waiting_login", threadKey: "t" }, []).state, "waiting_login");
  assert.equal(resolveThreadStatus({ status: "waiting_verification", threadKey: "t" }, []).state, "waiting_verification");
});
```

- [ ] **Step 2: Run the test and verify missing module failure**

```powershell
node --test products/roundtable/app/public/thread-status-model.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the status model**

Export `resolveThreadStatus(thread, liveBindings)` returning `{ state, className, label, detail }`. Preserve the existing labels for `waiting_login`, `waiting_verification`, `composer_missing`, `opening`, and generic errors. For persisted `verified`, require one exact non-closed live binding with `status === "verified"`; otherwise return:

```js
{
  state: "needs_reconnect",
  className: "is-waiting",
  label: "需要重新连接",
  detail: "当前会话没有可用的网页绑定",
}
```

Import the model into `app.js`, remove the local `threadStatus` implementation, and pass `state.health?.browser?.bindings || []` from both participant and roundtable-seat renderers. Keep the existing ten-second `refreshRuntime` timer as the live refresh source.

- [ ] **Step 4: Add and run UI contract checks**

Assert `app.js` imports `resolveThreadStatus`, passes health browser bindings, and includes “需要重新连接”. Run:

```powershell
node --test products/roundtable/app/public/thread-status-model.test.mjs products/roundtable/app/public/ui-contract.test.mjs
```

Expected: all tests pass.

### Task 4: Avoid identical retries for binding failures

**Files:**
- Modify: `products/roundtable/app/orchestrator/scheduler.mjs:823-888`
- Modify: `products/roundtable/app/automation/browser-manager.mjs:479-501`
- Modify: `products/roundtable/app/server.mjs:153-190`
- Test: `products/roundtable/app/orchestrator/orchestrator.test.mjs:727-756`

- [ ] **Step 1: Add a no-retry integration test**

Add a test based on the existing multi-model absence test. Make DeepSeek throw `Object.assign(new Error("DeepSeek 当前会话没有可用页面，请重新连接。"), { code: "PROVIDER_PAGE_NOT_BOUND" })`, then assert its worker call count is `1`, its turn is `absent`, and the absence text contains the Chinese reconnect instruction.

```js
assert.equal(calls.filter((call) => call.providerId === "deepseek").length, 1);
assert.match(placeholder.content, /需要重新连接/);
```

- [ ] **Step 2: Run the orchestrator test and verify two calls**

```powershell
node --test products/roundtable/app/orchestrator/orchestrator.test.mjs
```

Expected: DeepSeek is called twice because every technical failure currently receives one automatic retry.

- [ ] **Step 3: Add non-retryable binding codes**

In `scheduler.mjs` add:

```js
const NON_RETRYABLE_TECHNICAL_CODES = new Set([
  "PROVIDER_PAGE_NOT_BOUND",
  "PROVIDER_PAGE_IN_USE",
]);
```

Include `NON_RETRYABLE_TECHNICAL_CODES.has(error?.code)` in the throw condition before emitting `turn.retrying`.

Change both missing-binding messages in `BrowserManager.getPage` to actionable Chinese, for example:

```js
`${adapter.label} 当前会话没有可用页面，请在席位菜单点击“重新登录/刷新”。`
```

Map `PROVIDER_PAGE_IN_USE` to HTTP `409` in `server.mjs`; keep `PROVIDER_PAGE_NOT_BOUND` in the existing client-error group.

- [ ] **Step 4: Re-run scheduler, server, and browser tests**

```powershell
node --test products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/server-runtime.test.mjs products/roundtable/app/automation/browser-manager.test.mjs
```

Expected: binding failure receives one attempt; transient composer failure still retries once.

### Task 5: Add natural tone, compact paragraphs, and current command selection

**Files:**
- Create: `products/roundtable/app/public/roundtable-command-model.mjs`
- Create: `products/roundtable/app/public/roundtable-command-model.test.mjs`
- Modify: `products/roundtable/app/orchestrator/context-builder.mjs:230-246`
- Modify: `products/roundtable/app/orchestrator/orchestrator.test.mjs:284-302`
- Modify: `products/roundtable/app/public/app.js:230-244`
- Modify: `products/roundtable/app/public/styles.css:102-105,137-155`
- Test: `products/roundtable/app/public/ui-contract.test.mjs`

- [ ] **Step 1: Write command-selection tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoundtableCommand } from "./roundtable-command-model.mjs";

test("active plan command wins over the latest ledger command", () => {
  const session = {
    plans: [{ status: "running", commandText: "当前正在执行" }],
    events: [{ type: "command", content: "最近用户命令" }],
  };
  assert.equal(resolveRoundtableCommand(session), "当前正在执行");
});

test("idle session shows the latest user command", () => {
  const session = {
    plans: [{ status: "completed", commandText: "旧计划" }],
    events: [
      { type: "command", content: "第一条" },
      { type: "reply", content: "回复" },
      { type: "command", content: "最近一条" },
    ],
  };
  assert.equal(resolveRoundtableCommand(session), "最近一条");
});
```

- [ ] **Step 2: Add failing prompt assertions**

Require the prompt to match `模仿人类语气进行自然、正常的交流`, `不要每句话单独分段`, and `只有真正枚举时才使用列表`.

Run the command-model and orchestrator tests; expect the new module and prompt assertions to fail.

- [ ] **Step 3: Implement command selection and prompt copy**

`resolveRoundtableCommand` searches plans from newest to oldest for `running`, `waiting_recovery`, or `paused`, then searches events from newest to oldest for a user `command`, otherwise returns `等待第一条指令`.

In `renderRoundtable`, set both text and title:

```js
const commandText = resolveRoundtableCommand(state.session);
$("#roundtableObjective").textContent = commandText;
$("#roundtableObjective").title = commandText;
```

Add to `buildPrompt`:

```js
"模仿人类语气进行自然、正常的交流。直接回应其他参与者和用户，不要使用模板化汇报腔。",
"相关句子组成完整段落，不要每句话单独分段，只有真正枚举时才使用列表。",
```

Update `.roundtable-objective` to a two-to-three-line clamp and change ordinary paragraph margin to `.35em 0`; do not alter list, heading, table, quote, or code styles.

- [ ] **Step 4: Run prompt and UI tests**

```powershell
node --test products/roundtable/app/public/roundtable-command-model.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/public/ui-contract.test.mjs
```

Expected: command priority, exact prompt copy, line clamp, and compact paragraph assertions pass.

### Task 6: Build the transient streaming disclosure controller

**Files:**
- Create: `products/roundtable/app/public/progress-disclosure-controller.mjs`
- Create: `products/roundtable/app/public/progress-disclosure-controller.test.mjs`
- Modify: `products/roundtable/app/public/app.js:292-363`
- Modify: `products/roundtable/app/public/styles.css:156-170`
- Test: `products/roundtable/app/public/ui-contract.test.mjs`

- [ ] **Step 1: Write controller tests with small fake nodes**

Test `captureProgressView(node)` and `restoreProgressView(node, state)` with fakes exposing `querySelector`, `open`, `scrollTop`, `scrollHeight`, and `clientHeight`:

```js
assert.deepEqual(captureProgressView(nodeAtBottom), { open: true, follow: true, scrollTop: 180 });
assert.deepEqual(captureProgressView(nodeScrolledUp), { open: true, follow: false, scrollTop: 20 });
restoreProgressView(newNode, { open: false, follow: false, scrollTop: 20 });
assert.equal(newDetails.open, false);
assert.equal(newScroller.scrollTop, 20);
restoreProgressView(newNode, { open: true, follow: true, scrollTop: 20 });
assert.equal(newScroller.scrollTop, newScroller.scrollHeight);
```

- [ ] **Step 2: Run the test and verify missing module failure**

```powershell
node --test products/roundtable/app/public/progress-disclosure-controller.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement capture and restore functions**

Use a `24px` bottom threshold. `captureProgressView` defaults to `{ open: true, follow: true, scrollTop: 0 }` for a new card. `restoreProgressView` restores `details.open`; when open and following it scrolls to `scrollHeight`, otherwise it restores the bounded prior `scrollTop`. Add `bindProgressDisclosure(node)` so reopening a card scrolls its body to the latest content once.

- [ ] **Step 4: Render progress as a disclosure and preserve state**

Change `renderProgressItem` to output:

```html
<details class="progress-disclosure" open>
  <summary>模型 · 阶段 · 正在生成</summary>
  <div class="progress-stream" data-progress-scroll>
    <!-- sanitized partial Markdown or generation placeholder -->
  </div>
</details>
```

The card displays only the provider-visible partial response already emitted by `turn.progress`; it does not request, infer, or expose hidden chain-of-thought.

Before replacing a progress node's `innerHTML`, call `captureProgressView(node)`. After replacement, call `restoreProgressView` and `bindProgressDisclosure`. Continue hardening links inside Markdown.

Add CSS with `max-height: 220px`, `overflow: auto`, compact border/background, and a visible summary focus state. Preserve the outer chat stream's existing near-bottom behavior.

- [ ] **Step 5: Run progress and UI tests**

```powershell
node --test products/roundtable/app/public/progress-disclosure-controller.test.mjs products/roundtable/app/public/turn-progress-store.test.mjs products/roundtable/app/public/ui-contract.test.mjs
```

Expected: disclosure state survives streaming rerenders, inner auto-follow respects user control, and terminal progress cleanup remains green.

### Task 7: Full verification and rendered QA

**Files:**
- Create: `.adworkflow/artifacts/roundtable-binding-streaming-polish/verification_result.json`
- Temporary screenshot: `C:/tmp/roundtable-binding-streaming-polish.png` (do not commit)

- [ ] **Step 1: Run focused tests**

```powershell
node --test products/roundtable/app/automation/browser-manager.test.mjs products/roundtable/app/automation/page-lease-registry.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/public/thread-status-model.test.mjs products/roundtable/app/public/roundtable-command-model.test.mjs products/roundtable/app/public/progress-disclosure-controller.test.mjs products/roundtable/app/public/turn-progress-store.test.mjs products/roundtable/app/public/ui-contract.test.mjs
```

Expected: exit code `0`.

- [ ] **Step 2: Run the complete roundtable suite**

```powershell
npm run test:roundtable
```

Expected: core, browser E2E, and launcher suites pass.

- [ ] **Step 3: Restart the local service**

```powershell
& '.\products\roundtable\start-roundtable.bat' -Restart -NoOpen
curl.exe --silent --show-error --max-time 5 http://127.0.0.1:3020/api/health
```

Expected: roundtable `3020`, Chrome CDP `9223`, and Playwright MCP `8931` are healthy.

- [ ] **Step 4: Perform rendered QA with installed Chrome**

The Browser plugin is not available and Playwright's bundled headless shell is absent. Use repository Playwright with `executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"`, navigate with `waitUntil: "domcontentloaded"`, wait two seconds, and verify:

- page URL/title and meaningful DOM;
- no framework overlay;
- no relevant console error or warning;
- stale current-session Doubao binding renders “需要重新连接”;
- center shows the latest user command while idle;
- paragraph spacing is visibly tighter;
- participant menu opens as the interaction proof;
- desktop `1440x1000` and mobile-width viewport do not clip the center or disclosure styles.

Save the desktop screenshot to `C:/tmp/roundtable-binding-streaming-polish.png`.

- [ ] **Step 5: Write the verification artifact with actual counts**

Create JSON containing `task_id`, `status`, commands with real exit codes/test counts, health results, rendered checks, and acceptance booleans. Set `status` to `failed` if any required check fails.

- [ ] **Step 6: Review scope and preserve user changes**

```powershell
git diff --check
git diff --name-only --diff-filter=U
git status --short
```

Expected: no conflicts or whitespace errors. Do not stage overlapping source files unless task-only ownership is proven.

## Acceptance trace

- Safe binding transfer and busy-page protection: Task 2.
- Live seat status and stale verified correction: Task 3.
- One-attempt missing-binding failure and actionable copy: Task 4.
- Human tone, paragraph rhythm, compact spacing, and current command: Task 5.
- Collapsible streaming, inner follow, and user scroll ownership: Task 6.
- Desktop/mobile rendered proof and full regression: Task 7.
