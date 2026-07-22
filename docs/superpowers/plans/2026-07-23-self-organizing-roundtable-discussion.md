# Self-Organizing Roundtable Discussion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed mandatory discussion rounds with persistent dynamic cycles in which every seat reads one immutable snapshot, then speaks naturally, responds briefly, or privately passes before the east-host gives a natural public closure.

**Architecture:** Keep the existing public ledger, browser worker, execution checkpoints, compression, and relay mode. Add small pure modules for participation parsing, reply relations, cycle lifecycle, and session-level roles/interventions; let the scheduler append one cycle at a time and persist completion-order results. Ordinary discussion prompts become natural transcript prompts, while relay and local-tool prompts retain their current strict protocol.

**Tech Stack:** Node.js 24, ECMAScript modules, `node:test`, local JSON/JSONL workspace storage, SSE, Playwright/CDP, browser DOM, marked, DOMPurify.

---

## File map and boundaries

- `.adworkflow/artifacts/self-organizing-roundtable-discussion/requirements.md`: confirmed requirement in Chinese.
- `.adworkflow/task_specs/self-organizing-roundtable-discussion.json`: implementation contract and acceptance criteria.
- `products/roundtable/app/orchestrator/participation-result.mjs`: exact `PASS` recognition only.
- `products/roundtable/app/orchestrator/reply-relations.mjs`: explicit-name reply relation extraction and event targeting.
- `products/roundtable/app/orchestrator/discussion-cycle.mjs`: pure cycle/turn creation and terminal decision helpers.
- `products/roundtable/app/core/discussion-session-state.mjs`: seat roles and persistent pending-intervention mutations.
- `products/roundtable/app/orchestrator/context-builder.mjs`: natural first-cycle, later-cycle, and east-host closure prompts.
- `products/roundtable/app/orchestrator/scheduler.mjs`: dynamic cycle execution, completion-order persistence, pass handling, restart, and no-fallback closure.
- `products/roundtable/app/core/providers.mjs`: default/max cycle settings.
- `products/roundtable/app/storage/local-workspace-store.mjs`: persist new session-level state.
- `products/roundtable/app/server.mjs`: role, intervention, and continuation HTTP operations.
- `products/roundtable/app/public/discussion-view-model.mjs`: pure UI projection for cycle and seat state.
- `products/roundtable/app/public/index.html`, `app.js`, `styles.css`: cycle controls, role dialog, intervention queue, reply links, and pass cleanup.
- Adjacent `*.test.mjs` files: focused unit, scheduler, API, recovery, and UI contracts.

## Dirty-worktree safety

The roundtable source files already contain user-owned uncommitted work. Newly created artifacts, modules, tests, and this plan can be committed independently. Existing modified source files must remain unstaged unless `git diff --cached` proves the staged patch contains only this feature; never commit a whole overlapping file merely to satisfy a task checkpoint.

### Task 1: Record the confirmed ADworkflo contract

**Files:**
- Create: `.adworkflow/artifacts/self-organizing-roundtable-discussion/requirements.md`
- Create: `.adworkflow/task_specs/self-organizing-roundtable-discussion.json`
- Create or update: `.adworkflow/task_spec.json`

- [ ] **Step 1: Write the requirement artifact**

Use the approved design as the source and include these explicit decisions:

```markdown
# 自组织动态圆桌讨论需求

## 核心行为
- 第一周期所有可用席位并行独立发言。
- 后续周期每个席位读取同一个上一周期快照，选择自然发言、简短回应或 PASS。
- 被点名但无新增论点时至少回应一至两句；未被涉及且无增量时允许 PASS。
- PASS 不进入公共账本，但席位后续仍可重新参与。
- 周期上限 2–10，默认 5；全体 PASS 时提前结束。
- 当前东家负责最终自然收束，不自动换人。
- 普通讨论不发送 ROUND_TABLE 协议块或任务表单字段。
- 原文优先；内部结构化压缩重建成自然背景，不公开结构字段。
- 用户运行中插话进入持久化、可编辑、可撤回的下一周期队列。
- 只展示明确点名形成的回复关系，不创建阵营标签。

## 非目标
- 不增加第四个主持模型或私有主持网页。
- 不把自然回复改写成固定结构。
- 不用语义分类器推断支持方、反对方或永久阵营。
- 不改变传递模式和本地工具安全协议。
```

- [ ] **Step 2: Write the task spec**

```json
{
  "task_id": "self-organizing-roundtable-discussion",
  "goal": "Turn fixed mandatory rounds into persistent self-organizing discussion cycles with natural public replies.",
  "non_goals": [
    "Do not add a fourth moderator model or moderator browser thread.",
    "Do not expose structured compression or program control fields in public discussion.",
    "Do not infer permanent camps or rewrite provider replies.",
    "Do not change relay scheduling or the local tool protocol."
  ],
  "acceptance_criteria": [
    "Cycle one requires independent replies from every available target.",
    "Later cycles accept spoken replies or exact PASS from one immutable snapshot.",
    "A passed seat emits no public message and may speak in a later cycle.",
    "Explicit provider names become lightweight reply relations without stance labels.",
    "Pending user interventions persist and enter the next cycle in order.",
    "Ordinary discussion prompts are natural transcripts and keep raw content primary.",
    "The east-host alone performs the final natural closure.",
    "Restart recovery does not replay already submitted work."
  ],
  "risk_level": "high",
  "execution_mode": "inline_with_review",
  "allowed_actions": ["read", "edit", "test"],
  "required_outputs": ["requirements.md", "verification_result.json"]
}
```

- [ ] **Step 3: Validate and commit only the new contract files**

Run:

```powershell
node -e "for (const p of ['.adworkflow/task_specs/self-organizing-roundtable-discussion.json','.adworkflow/task_spec.json']) JSON.parse(require('fs').readFileSync(p,'utf8')); console.log('valid')"
git add -- .adworkflow/artifacts/self-organizing-roundtable-discussion/requirements.md .adworkflow/task_specs/self-organizing-roundtable-discussion.json .adworkflow/task_spec.json
git diff --cached --check
git commit -m "docs: define self-organizing discussion task"
```

Expected: `valid`; the commit contains only the three ADworkflo files.

### Task 2: Parse participation and explicit reply relations

**Files:**
- Create: `products/roundtable/app/orchestrator/participation-result.mjs`
- Create: `products/roundtable/app/orchestrator/participation-result.test.mjs`
- Create: `products/roundtable/app/orchestrator/reply-relations.mjs`
- Create: `products/roundtable/app/orchestrator/reply-relations.test.mjs`

- [ ] **Step 1: Write failing participation tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseParticipationResult } from "./participation-result.mjs";

test("only an exact pass response becomes private participation", () => {
  assert.deepEqual(parseParticipationResult(" PASS \n"), { kind: "passed", content: null });
  assert.deepEqual(parseParticipationResult("pass"), { kind: "passed", content: null });
  assert.deepEqual(parseParticipationResult("我先 PASS，但补充一点"), {
    kind: "spoken",
    content: "我先 PASS，但补充一点",
  });
  assert.deepEqual(parseParticipationResult("   "), { kind: "invalid", content: null });
});
```

- [ ] **Step 2: Write failing relation tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { extractReplyRelations } from "./reply-relations.mjs";

const participants = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "doubao", label: "豆包" },
];
const events = [
  { id: "ds-1", type: "reply", providerId: "deepseek", commandId: "plan-1", content: "DS 原文" },
  { id: "db-1", type: "reply", providerId: "doubao", commandId: "plan-1", content: "豆包原文" },
];

test("explicit names create message-scoped relations without stance", () => {
  assert.deepEqual(extractReplyRelations({
    content: "DeepSeek 的大方向我同意，但豆包关于时间投入的判断有问题。",
    sourceProviderId: "chatgpt",
    commandId: "plan-1",
    participants,
    events,
  }), [
    { providerId: "deepseek", eventId: "ds-1", extraction: "explicit_name" },
    { providerId: "doubao", eventId: "db-1", extraction: "explicit_name" },
  ]);
});

test("implicit references and self mentions do not create guessed relations", () => {
  assert.deepEqual(extractReplyRelations({
    content: "另外两位的看法都值得继续观察，ChatGPT 先保留意见。",
    sourceProviderId: "chatgpt",
    commandId: "plan-1",
    participants,
    events,
  }), []);
});
```

- [ ] **Step 3: Run the tests and verify missing-module failures**

```powershell
node --test products/roundtable/app/orchestrator/participation-result.test.mjs products/roundtable/app/orchestrator/reply-relations.test.mjs
```

Expected: both files fail with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement the pure parsers**

`participation-result.mjs`:

```js
export function parseParticipationResult(value) {
  const content = String(value ?? "").trim();
  if (!content) return { kind: "invalid", content: null };
  if (/^pass$/iu.test(content)) return { kind: "passed", content: null };
  return { kind: "spoken", content };
}
```

`reply-relations.mjs`:

```js
import { extractProviderReferences } from "./command-parser.mjs";
import { isCommittedReplyEvent } from "./reply-lifecycle.mjs";

export function extractReplyRelations({ content, sourceProviderId, commandId, participants = [], events = [] } = {}) {
  const providerIds = extractProviderReferences(content, { providers: participants })
    .filter((providerId) => providerId !== sourceProviderId);
  return providerIds.flatMap((providerId) => {
    const target = [...events].reverse().find((event) =>
      event.providerId === providerId
      && event.commandId === commandId
      && isCommittedReplyEvent(event)
    );
    return target ? [{ providerId, eventId: target.id, extraction: "explicit_name" }] : [];
  });
}
```

- [ ] **Step 5: Re-run and commit the isolated new files**

```powershell
node --test products/roundtable/app/orchestrator/participation-result.test.mjs products/roundtable/app/orchestrator/reply-relations.test.mjs
git add -- products/roundtable/app/orchestrator/participation-result.mjs products/roundtable/app/orchestrator/participation-result.test.mjs products/roundtable/app/orchestrator/reply-relations.mjs products/roundtable/app/orchestrator/reply-relations.test.mjs
git diff --cached --check
git commit -m "feat: parse self-organizing discussion participation"
```

Expected: 3 tests pass; the commit contains only four new files.

### Task 3: Persist seat roles and pending interventions

**Files:**
- Create: `products/roundtable/app/core/discussion-session-state.mjs`
- Create: `products/roundtable/app/core/discussion-session-state.test.mjs`
- Modify: `products/roundtable/app/core/providers.mjs`
- Modify: `products/roundtable/app/storage/local-workspace-store.mjs`
- Test: `products/roundtable/app/storage/local-workspace-store.test.mjs`

- [ ] **Step 1: Write failing state-model tests**

Cover default roles, temporary overrides, ordered queue creation, editing, removal, and atomic consumption:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  consumePendingInterventions,
  queueIntervention,
  removeIntervention,
  resolveSeatRole,
  setDefaultSeatRole,
  updateIntervention,
} from "./discussion-session-state.mjs";

test("temporary role overrides the session default", () => {
  const session = { participants: [{ id: "chatgpt" }], participantRoles: {} };
  setDefaultSeatRole(session, { providerId: "chatgpt", role: "学习科学研究者" });
  assert.equal(resolveSeatRole(session, "chatgpt", { chatgpt: "实践派" }), "实践派");
  assert.equal(resolveSeatRole(session, "chatgpt", {}), "学习科学研究者");
});

test("pending interventions remain ordered and editable until consumption", () => {
  const session = { pendingInterventions: [] };
  queueIntervention(session, { id: "i1", planId: "p1", content: "第一条", now: "2026-07-23T00:00:00.000Z" });
  queueIntervention(session, { id: "i2", planId: "p1", content: "第二条", now: "2026-07-23T00:00:01.000Z" });
  updateIntervention(session, { id: "i1", content: "修改后第一条", now: "2026-07-23T00:00:02.000Z" });
  removeIntervention(session, { id: "i2" });
  assert.deepEqual(consumePendingInterventions(session, { planId: "p1" }).map((item) => item.content), ["修改后第一条"]);
  assert.deepEqual(session.pendingInterventions, []);
});
```

- [ ] **Step 2: Add failing store round-trip coverage**

Extend `local-workspace-store.test.mjs` so a saved and reloaded session preserves:

```js
participantRoles: { chatgpt: "学习科学研究者" },
pendingInterventions: [{
  id: "i1",
  planId: "p1",
  content: "请考虑时间有限的情况",
  status: "pending",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z"
}]
```

- [ ] **Step 3: Run and verify failures**

```powershell
node --test products/roundtable/app/core/discussion-session-state.test.mjs products/roundtable/app/storage/local-workspace-store.test.mjs
```

Expected: the new module is missing and the store drops the new fields.

- [ ] **Step 4: Implement session-state mutations**

Use exact participant membership validation, trimmed roles capped at 160 characters, non-empty intervention content capped at 4000 characters, and immutable IDs. The module mutates the session object only inside a store lock and returns cloned results to callers.

Add to `stateFromSession`, `importSessionObject`, and session creation defaults:

```js
participantRoles: session.participantRoles || {},
pendingInterventions: session.pendingInterventions || [],
```

Change discussion settings in `providers.mjs`:

```js
defaultRounds: 5,
// coerceSettings discussion cycles remain bounded from 2 to 10.
defaultRounds: coerceInteger(value.defaultRounds, DEFAULT_SETTINGS.defaultRounds, 2, 10),
```

Relay mode still forces one sequential route internally and does not use the discussion minimum.

- [ ] **Step 5: Re-run focused persistence tests**

```powershell
node --test products/roundtable/app/core/discussion-session-state.test.mjs products/roundtable/app/storage/local-workspace-store.test.mjs products/roundtable/app/orchestrator/command-parser.test.mjs
```

Expected: all tests pass; discussion defaults to 5 and explicit values clamp to 2–10.

### Task 4: Build natural transcript prompts

**Files:**
- Modify: `products/roundtable/app/orchestrator/context-builder.mjs`
- Modify: `products/roundtable/app/orchestrator/orchestrator.test.mjs`
- Test: `products/roundtable/app/orchestrator/prompt-header.test.mjs`

- [ ] **Step 1: Add failing prompt contracts**

Add three tests for independent, later-cycle, and closure prompts. The later-cycle contract must assert:

```js
assert.match(prompt, /截至上一周期的公开讨论记录/);
assert.match(prompt, /明确点名/);
assert.match(prompt, /只回复 PASS/);
assert.match(prompt, /用户：如何进行自学/);
assert.match(prompt, /豆包：先建立反馈循环/);
assert.doesNotMatch(prompt, /\[ROUND_TABLE_/);
assert.doesNotMatch(prompt, /任务标题|任务目标|当前阶段|压缩修订|覆盖事件/);
assert.doesNotMatch(prompt, /<compressed_roundtable_context>/);
```

The first-cycle test must assert `不要假装已经看到同周期其他参与者的发言` and must not include same-cycle replies. The closure test must assert `像圆桌中的最后一位参与者一样自然收束` and no fixed report fields.

- [ ] **Step 2: Run and verify the current administrative prompt fails**

```powershell
node --test products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/prompt-header.test.mjs
```

Expected: the new natural-prompt assertions fail against the current task block.

- [ ] **Step 3: Implement natural prompt routing**

Add `buildNaturalDiscussionPrompt(session, providerId, context)` and route to it only when:

```js
context.conversationMode === "discussion" && !context.enableToolProtocol
```

Use `context.cycleNumber`, `context.maxCycles`, `context.seatRole`, and `context.isClosure`. Render transcript lines as `用户：...` and `<模型名>：...` with sanitized raw content. For active compression, render prose such as:

```text
较早的讨论背景中，已经出现的主要判断包括：……
仍未解决的分歧包括：……
最近的公开原文如下：
```

Do not render revision numbers, event ranges, source IDs, XML tags, JSON, or program state. Retain the existing strict builder for relay and tool-enabled discussion.

- [ ] **Step 4: Re-run prompt and compression tests**

```powershell
node --test products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/prompt-header.test.mjs products/roundtable/app/orchestrator/context-compressor.test.mjs
```

Expected: natural prompt contracts pass; compression still retains structured internal state and recent raw events.

### Task 5: Model dynamic cycle lifecycle

**Files:**
- Create: `products/roundtable/app/orchestrator/discussion-cycle.mjs`
- Create: `products/roundtable/app/orchestrator/discussion-cycle.test.mjs`
- Modify: `products/roundtable/app/orchestrator/scheduler.mjs`
- Test: `products/roundtable/app/orchestrator/orchestrator.test.mjs`

- [ ] **Step 1: Write failing pure lifecycle tests**

Test that cycle one creates one turn per target, later cycles are appended only after prior completion, direct mentions mark the next turn as requiring a response, all-pass stops, pending interventions force continuation below the cap, and the cap blocks automatic continuation:

```js
assert.equal(createDiscussionCycle(plan, session, { cycleNumber: 1 }).turnIds.length, 3);
assert.deepEqual(createDiscussionCycle(plan, sessionWithDoubaoMentioned, { cycleNumber: 3 }).addressedProviderIds, ["doubao"]);
assert.equal(decideCycleContinuation({ results: ["passed", "passed", "passed"], hasPendingInterventions: false, cycleNumber: 2, maxCycles: 5 }), "close");
assert.equal(decideCycleContinuation({ results: ["passed", "passed", "passed"], hasPendingInterventions: true, cycleNumber: 2, maxCycles: 5 }), "continue");
assert.equal(decideCycleContinuation({ results: ["spoken", "passed", "spoken"], hasPendingInterventions: true, cycleNumber: 5, maxCycles: 5 }), "awaiting_capacity");
```

- [ ] **Step 2: Run and verify missing-module failure**

```powershell
node --test products/roundtable/app/orchestrator/discussion-cycle.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement cycle records and dynamic turns**

Cycle records use this stable shape:

```js
{
  number: 2,
  status: "planned",
  snapshotThroughEventIndex: 8,
  turnIds: ["..."],
  addressedProviderIds: ["doubao"],
  startedAt: null,
  completedAt: null,
  spokenCount: 0,
  passedCount: 0,
  absentCount: 0
}
```

Discussion turns retain the current execution and checkpoint fields, add `cycleNumber`, `mustRespond`, and `addressedByEventIds`, and keep `round` equal to `cycleNumber` for file-name and compatibility consumers. A later turn has `mustRespond: true` when the prior cycle contains a committed reply whose `metadata.replyRelations` explicitly targets that provider. `createTurnPlan` creates only cycle one; later cycles and the closure turn are appended under `store.updateSession`.

Persist `roleOverrides` from the command payload on the plan after validating that every key belongs to a selected participant. Prompt construction resolves the temporary override first, then the session default role.

Relay plans keep their current precomputed sequential turns unchanged.

- [ ] **Step 4: Update plan creation tests**

Replace assertions that discussion plans contain every future round with assertions that they contain only cycle one and `maxCycles`. Preserve relay assertions exactly.

- [ ] **Step 5: Run lifecycle and plan tests**

```powershell
node --test products/roundtable/app/orchestrator/discussion-cycle.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs
```

Expected: cycle creation and existing relay behavior pass.

### Task 6: Execute, persist, and recover dynamic participation

**Files:**
- Modify: `products/roundtable/app/orchestrator/scheduler.mjs`
- Modify: `products/roundtable/app/orchestrator/execution-index.mjs`
- Test: `products/roundtable/app/orchestrator/orchestrator.test.mjs`
- Test: `products/roundtable/app/orchestrator/reply-lifecycle-scheduler.test.mjs`
- Test: `products/roundtable/app/orchestrator/idempotency.test.mjs`

- [ ] **Step 1: Add failing scheduler scenarios**

Use the existing fixture worker and store to cover:

1. cycle one rejects `PASS` as `FIRST_CYCLE_PASS_NOT_ALLOWED`;
2. later exact `PASS` marks an unaddressed turn `passed`, writes no reply file/event, emits `turn.passed`, and can speak in cycle three;
3. a directly addressed seat that returns `PASS` receives one bounded correction attempt asking for a one-to-two-sentence response;
4. two fulfilled provider calls persist in completion order rather than participant order;
5. all-pass closes early;
6. one absence does not count as pass and does not block healthy seats;
7. reply events contain `metadata.replyRelations` from the snapshot;
8. restart resumes only unfinished cycle turns and never replays submitted executions;
9. discussion closure uses `plan.hostId` only and does not call `selectHealthyClosureProvider`.

- [ ] **Step 2: Run the focused scheduler tests and verify failures**

```powershell
node --test products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/reply-lifecycle-scheduler.test.mjs products/roundtable/app/orchestrator/idempotency.test.mjs
```

Expected: fixed-round scheduling, participant-order persistence, and closure fallback violate the new assertions.

- [ ] **Step 3: Add private pass persistence**

At the start of `persistTurnSuccess`, call `parseParticipationResult(result.text)`. For a later-cycle pass, use `persistTurnPass` to:

```js
Object.assign(savedTurn, {
  status: "passed",
  completedAt: now,
  participation: "passed",
  replyPath: null,
  error: null
});
```

Advance the seat projection using prompt characters and zero reply characters, upsert the completed execution checkpoint with `{ participation: "passed", sendState: "COMMITTED" }`, append a private audit event, emit `turn.passed`, and do not call `writeReply` or `appendEvents`.

Before persisting a pass, enforce `turn.mustRespond`. When true, perform one explicit participation correction attempt with a fresh attempt ID and the natural suffix `你在上一周期被直接点名，请用一至两句话明确回应；不要只返回 PASS。`. Store `participationCorrectionAttempts: 1` on the turn. If the correction also returns `PASS`, persist the turn as `absent` with code `DIRECT_MENTION_UNANSWERED`; do not synthesize a reply on the model's behalf.

- [ ] **Step 4: Persist spoken results as they complete**

Replace `Promise.allSettled` followed by an ordered persistence loop with one async task per turn that executes and persists its own result immediately. Wait for every task before emitting `cycle.completed`, then re-read the session under the store lock. Store serialization preserves completion-order ledger appends while every model still uses the same captured snapshot.

Before creating the public reply event, call `extractReplyRelations` with the cycle snapshot and attach the returned array as `metadata.replyRelations`.

- [ ] **Step 5: Loop cycles and consume interventions**

After every cycle:

1. update cycle counters and terminal timestamps;
2. inspect pending interventions for the current plan;
3. when continuation is allowed, atomically consume them into ordered user `command` events before recording the next snapshot boundary;
4. append the next cycle under the session lock;
5. stop on all-pass without pending interventions;
6. return an `awaiting_continuation` outcome at the configured cap when interventions remain.

Make `executePreparedPlan` preserve `plan.status = "awaiting_continuation"` and `runtime.status = "awaiting_continuation"` without treating the outcome as failure or completion.

- [ ] **Step 6: Restrict closure to the east-host**

Create the closure turn only after the discussion is ready to close. Its provider is exactly `plan.hostId`. On ordinary discussion closure failure, persist absence/failure and expose retry; do not select a fallback. Keep relay fallback behavior unchanged.

- [ ] **Step 7: Re-run scheduler and recovery tests**

```powershell
node --test products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/reply-lifecycle-scheduler.test.mjs products/roundtable/app/orchestrator/idempotency.test.mjs products/roundtable/app/orchestrator/execution-index.test.mjs
```

Expected: dynamic cycles, pass cleanup, completion order, exact reply relations, no-fallback discussion closure, and restart idempotency pass.

### Task 7: Expose roles, interventions, and continuation through HTTP

**Files:**
- Modify: `products/roundtable/app/server.mjs`
- Modify: `products/roundtable/app/server-runtime.test.mjs`
- Modify: `products/roundtable/app/server.test.mjs`

- [ ] **Step 1: Add failing API tests**

Cover these operations:

```text
POST   /api/sessions/:sessionId/participant-role
POST   /api/sessions/:sessionId/interventions
PATCH  /api/sessions/:sessionId/interventions/:interventionId
DELETE /api/sessions/:sessionId/interventions/:interventionId
POST   /api/sessions/:sessionId/plans/:planId/continue
```

Assert that interventions require an active or awaiting discussion plan, remain ordered, survive a session reload, cannot be changed after consumption, and cannot increase `maxCycles` above 10. Assert that role updates reject providers not seated in the session.

- [ ] **Step 2: Run server tests and verify 404/405 failures**

```powershell
node --test products/roundtable/app/server-runtime.test.mjs products/roundtable/app/server.test.mjs
```

Expected: the new routes are not found.

- [ ] **Step 3: Implement locked session mutations**

Use `discussion-session-state.mjs` inside `store.updateSession` for role and queue writes. Emit:

```text
participant.role_updated
intervention.queued
intervention.updated
intervention.removed
intervention.committed
cycle.started
cycle.completed
turn.passed
```

The continuation endpoint verifies `plan.status === "awaiting_continuation"`, increases `maxCycles` by exactly one up to 10, creates a fresh run ID and abort controller, sets the plan back to `running`, and invokes the existing background runner with `resumePersisted: true`.

- [ ] **Step 4: Route active composer submissions to the queue**

The server command endpoint remains reserved for starting a new plan. An active-plan user message must use `/interventions`; do not overload command parsing or append a public event until cycle-boundary consumption.

- [ ] **Step 5: Re-run API and SSE tests**

```powershell
node --test products/roundtable/app/server-runtime.test.mjs products/roundtable/app/server.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs
```

Expected: role, queue CRUD, continuation, persistence, and event publication pass.

### Task 8: Render cycles, reply links, roles, and the intervention queue

**Files:**
- Create: `products/roundtable/app/public/discussion-view-model.mjs`
- Create: `products/roundtable/app/public/discussion-view-model.test.mjs`
- Modify: `products/roundtable/app/public/index.html`
- Modify: `products/roundtable/app/public/app.js`
- Modify: `products/roundtable/app/public/styles.css`
- Modify: `products/roundtable/app/public/ui-contract.test.mjs`
- Modify: `products/roundtable/app/public/turn-progress-store.mjs`
- Modify: `products/roundtable/app/public/turn-progress-store.test.mjs`

- [ ] **Step 1: Write failing pure view-model tests**

Test `resolveDiscussionView(session)` with a running cycle containing two spoken turns and one passed turn:

```js
assert.deepEqual(view.progress, { current: 3, maximum: 5, spoken: 2, passed: 1 });
assert.equal(view.seats.doubao.state, "listening");
assert.equal(view.pendingInterventions[0].content, "补充考虑时间有限的情况");
```

Also test that `replyRelations` remains message-scoped and no stance/camp field is produced.

- [ ] **Step 2: Add failing UI contract checks**

Require:

```text
id="pendingInterventionQueue"
id="roleDialog"
data-reply-event-id
最多周期
本周期旁听
```

Require `app.js` to subscribe to `turn.passed`, `cycle.started`, `cycle.completed`, and intervention events.

- [ ] **Step 3: Run and verify failures**

```powershell
node --test products/roundtable/app/public/discussion-view-model.test.mjs products/roundtable/app/public/turn-progress-store.test.mjs products/roundtable/app/public/ui-contract.test.mjs
```

Expected: view model and UI elements are missing.

- [ ] **Step 4: Add intervention and role controls**

Insert the persistent queue above mention tokens. Each item has Edit and Withdraw buttons. While an active discussion run exists, composer submission posts to `/interventions`; otherwise it starts a new command. Editing uses a small inline textarea and does not modify public ledger events.

Add a role dialog opened from a seat menu. It edits session defaults for every seated provider and provides per-command temporary role inputs. The command payload sends:

```js
roleOverrides: {
  chatgpt: "实践派"
}
```

Rename the round stepper label to `最多周期`, clamp it to 2–10, and default to 5.

- [ ] **Step 5: Render reply navigation and cycle state**

Add `data-event-id` to public articles. Render reply relations above the markdown body as buttons; clicking one calls `scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" })` and applies a temporary highlight.

Display `周期 3 / 最多 5 · 2 位发言 · 1 位旁听` in the stage toolbar. A passed seat shows `本周期旁听`; do not create a public message or increment the event count.

- [ ] **Step 6: Clean transient progress on pass**

Treat `turn.passed` as a terminal event in `TurnProgressStore` and `connectEvents`, so the progress disclosure disappears immediately. Preserve completed replies and current outer/inner scroll behavior.

- [ ] **Step 7: Add compact responsive styles**

Style queue items, reply-relation buttons, listening seat status, role fields, and the temporary reply highlight. At widths below 900px, queue actions wrap without horizontal overflow and reply links remain keyboard accessible.

- [ ] **Step 8: Run UI tests**

```powershell
node --test products/roundtable/app/public/discussion-view-model.test.mjs products/roundtable/app/public/turn-progress-store.test.mjs products/roundtable/app/public/ui-contract.test.mjs products/roundtable/app/public/conversation-renderer.test.mjs
```

Expected: cycle projection, pass cleanup, reply links, role and queue contracts pass.

### Task 9: Full recovery, browser verification, and artifacts

**Files:**
- Create: `.adworkflow/artifacts/self-organizing-roundtable-discussion/verification_result.json`
- Temporary: `C:/tmp/self-organizing-roundtable-discussion-desktop.png`
- Temporary: `C:/tmp/self-organizing-roundtable-discussion-mobile.png`

- [ ] **Step 1: Run focused tests**

```powershell
node --test products/roundtable/app/orchestrator/participation-result.test.mjs products/roundtable/app/orchestrator/reply-relations.test.mjs products/roundtable/app/core/discussion-session-state.test.mjs products/roundtable/app/orchestrator/discussion-cycle.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/reply-lifecycle-scheduler.test.mjs products/roundtable/app/orchestrator/idempotency.test.mjs products/roundtable/app/server-runtime.test.mjs products/roundtable/app/public/discussion-view-model.test.mjs products/roundtable/app/public/turn-progress-store.test.mjs products/roundtable/app/public/ui-contract.test.mjs
```

Expected: exit code 0 with no skipped dynamic-discussion scenarios.

- [ ] **Step 2: Run complete product suites**

```powershell
npm --workspace @web-agents/roundtable-product run test:core
npm --workspace @web-agents/roundtable-product run test:browser
npm --workspace @web-agents/roundtable-product run test:launcher
```

Expected: all three commands exit 0. Run them separately so a server-runtime hang is attributable and does not hide browser/launcher results.

- [ ] **Step 3: Restart services and verify health**

```powershell
& '.\products\roundtable\start-roundtable.bat' -Restart -NoOpen
curl.exe --silent --show-error --max-time 5 http://127.0.0.1:3020/api/health
```

Expected: roundtable 3020, Chrome CDP 9223, and Playwright MCP 8931 report healthy.

- [ ] **Step 4: Perform deterministic mock discussion QA**

Use a mock/fixture session rather than sending real provider prompts. Verify in installed Chrome with `waitUntil: "domcontentloaded"`:

- cycle one has three independent public messages;
- cycle two has a multi-target reply relation, one brief response, and one pass;
- the passed progress card disappears and the seat shows listening;
- the passed seat speaks again in cycle three;
- an intervention can be queued, edited, reloaded, and consumed next cycle;
- all-pass triggers east-host closure;
- reply buttons locate the target without moving existing messages;
- desktop 1440x1000 and mobile 390x844 have no horizontal overflow or console error.

Save screenshots to the temporary paths above.

- [ ] **Step 5: Write the verification artifact**

Record actual test counts, exit codes, health JSON summary, rendered checks, screenshots, and acceptance booleans. Set `status` to `failed` if any required focused test, API recovery scenario, or rendered check fails; record unrelated pre-existing suite failures separately without changing their result.

- [ ] **Step 6: Review scope and preserve user changes**

```powershell
git diff --check
git diff --name-only --diff-filter=U
git status --short
```

Expected: no conflict markers or whitespace errors. Do not stage overlapping source files unless cached diff isolation is proven.

## Acceptance trace

- Dynamic immutable-snapshot cycles and pass/rejoin behavior: Tasks 5–6.
- Natural output, exact `PASS`, raw-first context, and hidden compression: Tasks 2 and 4.
- Evolving reply graph without camp labels: Tasks 2, 6, and 8.
- Session/default roles and single-run overrides: Tasks 3, 7, and 8.
- Persistent editable intervention queue: Tasks 3, 6, 7, and 8.
- Completion-order display and pass progress cleanup: Tasks 6 and 8.
- East-host-only natural closure: Tasks 4 and 6.
- Restart/idempotency, desktop/mobile, and full regressions: Task 9.
