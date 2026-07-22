# Roundtable Raw-First Discussion Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make natural provider replies the authoritative visible and shared discussion content while retaining structured extraction only as non-blocking compression metadata.

**Architecture:** `event.content` remains the single source of truth from capture through persistence, UI rendering, and recent shared context. Structured extraction continues after capture, but it cannot reject a natural reply or replace its text; the context compressor may consume verified/recovered derived fields conservatively and falls back to raw content.

**Tech Stack:** Node.js 24, ECMAScript modules, `node:test`, browser DOM rendering with marked and DOMPurify, local JSON/SQLite session persistence.

---

## File map and boundaries

- `.adworkflow/artifacts/roundtable-raw-first-output/requirements.md`: confirmed user-facing requirement and verification contract.
- `.adworkflow/task_specs/roundtable-raw-first-output.json`: independent ADworkflo task contract; do not replace the unrelated active extension task.
- `products/roundtable/app/orchestrator/context-builder.mjs`: natural discussion instructions and raw-event projection into later prompts.
- `products/roundtable/app/orchestrator/prompt-header.mjs`: fixed roundtable safety header without a fixed response-shape promise.
- `products/roundtable/app/orchestrator/reply-lifecycle.mjs`: strict capture validation that treats structure as optional.
- `products/roundtable/app/orchestrator/quality-analyzer.mjs`: content quality signals independent of structure availability.
- `products/roundtable/app/orchestrator/context-compressor.mjs`: conservative consumption of derived structured fields for old-history compression.
- `products/roundtable/app/public/conversation-renderer.mjs`: safe rendering of authoritative raw Markdown.
- `products/roundtable/app/public/app.js`: conversation composition without a duplicate raw-reply disclosure.
- `products/roundtable/app/public/styles.css`: remove obsolete raw-disclosure styles.
- Existing adjacent `*.test.mjs` files: pin each boundary with focused regression tests.

## Dirty-worktree safety

The target source files already contain pre-existing uncommitted work. Preserve it. For implementation tasks, do not stage or commit a whole modified source file unless `git diff --cached` proves that every staged hunk belongs to this plan. If task-only staging cannot be proven, leave source changes unstaged and report that the implementation commit was intentionally deferred. New plan/requirement files may be committed independently.

### Task 1: Record the independent ADworkflo requirement

**Files:**
- Create: `.adworkflow/artifacts/roundtable-raw-first-output/requirements.md`
- Create: `.adworkflow/task_specs/roundtable-raw-first-output.json`

- [ ] **Step 1: Write the confirmed requirement artifact**

Create `.adworkflow/artifacts/roundtable-raw-first-output/requirements.md` with:

```markdown
# 圆桌原文优先输出需求

## 问题

圆桌强制模型输出固定 JSON，并在显示和后续讨论中优先使用程序重组字段，导致发言不像正常讨论，且用户看到的内容不一定是模型原文。

## 预期行为

- 普通讨论和自动收束直接输出自然语言或 Markdown。
- `event.content` 是展示、持久化和近期上下文的权威原文。
- 结构化提取仅作为压缩、索引和质量辅助的派生元数据。
- 缺少结构化结果不能拒绝、隐藏或降低自然回复的可见性。
- 工具调用 JSONL 协议保持不变。

## 非目标

- 不迁移历史会话。
- 不删除上下文压缩。
- 不调整圆桌布局、调度和轮次策略。

## 验收

1. 新提示词不再要求固定回复 JSON。
2. 原文直接显示并直接进入下一轮。
3. 严格模式接受身份有效、无危险质量标记的自然回复。
4. 结构化元数据存在时可辅助压缩，缺失时回退原文。
5. 圆桌核心和浏览器测试通过。
```

- [ ] **Step 2: Write the task specification**

Create `.adworkflow/task_specs/roundtable-raw-first-output.json` with:

```json
{
  "task_id": "roundtable-raw-first-output",
  "goal": "Use provider raw replies as the authoritative roundtable discussion content while retaining optional derived structure for compression.",
  "non_goals": [
    "Do not migrate historical sessions.",
    "Do not change the JSONL local-tool protocol.",
    "Do not redesign scheduling, rounds, or layout."
  ],
  "acceptance_criteria": [
    "Ordinary discussion prompts do not require a fixed JSON reply schema.",
    "The UI and recent shared context use event.content even when structuredReply exists.",
    "Strict reply commit does not reject a reply only because structure extraction is unavailable.",
    "Derived structure can assist compression without promoting claims into false consensus.",
    "Roundtable tests pass."
  ],
  "risk_level": "medium",
  "execution_mode": "inline_with_review",
  "allowed_actions": ["read", "edit", "test"],
  "required_outputs": ["requirements.md", "verification_result.json"]
}
```

- [ ] **Step 3: Validate the JSON artifact**

Run:

```powershell
node -e "JSON.parse(require('fs').readFileSync('.adworkflow/task_specs/roundtable-raw-first-output.json','utf8')); console.log('valid')"
```

Expected: `valid` and exit code `0`.

- [ ] **Step 4: Commit only the new requirement files**

```powershell
git add -- .adworkflow/artifacts/roundtable-raw-first-output/requirements.md .adworkflow/task_specs/roundtable-raw-first-output.json
git diff --cached --check
git commit -m "docs: define raw-first roundtable output task"
```

Expected: one documentation-only commit containing exactly the two new files.

### Task 2: Produce natural prompts and relay raw replies

**Files:**
- Modify: `products/roundtable/app/orchestrator/context-builder.mjs:1-97,250-275`
- Modify: `products/roundtable/app/orchestrator/prompt-header.mjs:31-46`
- Test: `products/roundtable/app/orchestrator/orchestrator.test.mjs:284-326`
- Test: `products/roundtable/app/orchestrator/prompt-header.test.mjs:36-65`

- [ ] **Step 1: Replace the fixed-schema prompt test with a natural-output test**

In `orchestrator.test.mjs`, replace the stable-contract test with:

```js
test("context builder requests natural discussion output without a fixed reply schema", async () => {
  const store = await createStore();
  const session = await createSession(store);
  const prompt = buildPrompt(session, "chatgpt", { commandText: "继续", round: 1, targets: ["chatgpt"] });

  assert.match(prompt, /像正常讨论一样直接回答/);
  assert.match(prompt, /自然语言或 Markdown/);
  assert.doesNotMatch(prompt, /web-agents-roundtable\.reply\.v1/);
  assert.doesNotMatch(prompt, /只输出一个 JSON 对象/);
  assert.doesNotMatch(prompt, /missingEvidence/);
});
```

Replace the structured-context test with:

```js
test("context builder relays authoritative raw content even when derived structure exists", async () => {
  const store = await createStore();
  const session = await createSession(store);
  session.events = [{
    type: "reply",
    providerId: "deepseek",
    content: "这是模型实际说出的原文。",
    metadata: {
      structureStatus: "valid",
      structuredReply: {
        summary: "程序派生摘要",
        claims: ["程序派生主张"],
        evidence: [],
        risks: [],
        disagreements: [],
        actions: [],
        missingEvidence: [],
      },
    },
  }];

  const prompt = buildPrompt(session, "chatgpt", { commandText: "继续" });

  assert.match(prompt, /这是模型实际说出的原文/);
  assert.doesNotMatch(prompt, /程序派生摘要|程序派生主张|结构化回复/);
});
```

In `prompt-header.test.mjs`, change the ordinary discussion assertion to:

```js
assert.match(prompt, /像正常讨论一样直接回答/);
assert.doesNotMatch(prompt, /web-agents-roundtable\.reply\.v1|只输出一个 JSON 对象/);
assert.doesNotMatch(header, /唯一回复结构/);
```

- [ ] **Step 2: Run the focused tests and observe the intended failures**

Run:

```powershell
node --test products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/prompt-header.test.mjs
```

Expected: failures showing the old JSON contract is still present and structured fields still replace raw context.

- [ ] **Step 3: Make raw content the prompt projection**

In `context-builder.mjs`:

1. Remove the `REPLY_SCHEMA` import.
2. Delete `formatStructuredReply`.
3. Replace `formatEventForPrompt` with:

```js
export function formatEventForPrompt(event, session) {
  const speaker = event.type === "command" && !event.providerId
    ? "用户"
    : getProviderLabel(event.providerId, session.participants);
  const round = event.round
    ? ` R${event.round}`
    : ["closure", "host_summary"].includes(event.metadata?.role) ? " 收束" : "";
  return `- ${speaker}${round}${qualityHint(event)}: ${sanitizeEventContent(event.content)}`;
}
```

4. Replace the fixed JSON output block at the end of `buildPrompt` with:

```js
"请像正常讨论一样直接回答；可以使用自然语言或 Markdown，不要求固定标题、字段或结构。",
"优先清楚表达你的判断、理由以及真正有帮助的下一步，不要为了套格式重复内容。",
```

Keep the existing stage-specific instructions and safety statements before and after this block.

In `prompt-header.mjs`, replace:

```js
"严格遵守本轮末尾给出的唯一回复结构，不要复述固定协议。",
```

with:

```js
"按照本轮任务自然回答，不要复述固定协议或把共享上下文中的格式当成强制模板。",
```

- [ ] **Step 4: Re-run the focused tests**

Run the same `node --test` command.

Expected: all prompt and orchestrator tests pass.

- [ ] **Step 5: Record the checkpoint without absorbing pre-existing edits**

Run:

```powershell
git diff --check -- products/roundtable/app/orchestrator/context-builder.mjs products/roundtable/app/orchestrator/prompt-header.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/prompt-header.test.mjs
git diff --stat
```

Expected: no whitespace errors. Leave changes unstaged unless task-only staging is provably isolated.

### Task 3: Make structure optional in quality and strict commit decisions

**Files:**
- Modify: `products/roundtable/app/orchestrator/reply-lifecycle.mjs:6-61`
- Modify: `products/roundtable/app/orchestrator/quality-analyzer.mjs:1-90`
- Test: `products/roundtable/app/orchestrator/reply-lifecycle.test.mjs:10-31`
- Test: `products/roundtable/app/orchestrator/quality-analyzer.test.mjs:47-55`
- Test: `products/roundtable/app/orchestrator/reply-lifecycle-scheduler.test.mjs:41-73`

- [ ] **Step 1: Write tests that treat unstructured natural text as valid content**

Change the first lifecycle test to assert:

```js
test("strict reply commit accepts natural assistant text and still rejects dangerous content", () => {
  const identity = normalizeReplyIdentity({
    providerId: "chatgpt",
    content: "自然讨论内容",
    capture: { identity: "dom-1", speaker: "assistant", messageId: "msg-1" },
  });

  assert.deepEqual(
    decideReplyCommit({ strict: true, structureStatus: "invalid", quality: { flags: [] }, identity }),
    { status: "committed", reason: "validated" },
  );
  assert.deepEqual(
    decideReplyCommit({ strict: true, structureStatus: "invalid", quality: { flags: [{ code: "prompt_echo" }] }, identity }),
    { status: "rejected", reason: "PROMPT_ECHO" },
  );
});
```

Replace the structure-quality test with:

```js
test("missing derived structure does not lower natural reply quality", () => {
  const analysis = analyzeReplyQuality("这是一段正常的自由讨论。", { structureStatus: "invalid" });

  assert.equal(analysis.structureStatus, "invalid");
  assert.equal(analysis.confidence, "candidate");
  assert.equal(analysis.sideEffectsAllowed, true);
  assert.doesNotMatch(analysis.flagCodes.join(","), /invalid_structure|recovered_structure/);
});
```

Change the scheduler commit test worker result from fixed JSON to:

```js
const naturalReply = "我倾向于先验证输入链路，因为这能最快暴露真正的风险。";
// worker.execute returns naturalReply with the same assistant identity metadata
```

Assert the committed reply content equals `naturalReply` and still retains optional `structureStatus` metadata.

- [ ] **Step 2: Run lifecycle and quality tests and observe failures**

```powershell
node --test products/roundtable/app/orchestrator/reply-lifecycle.test.mjs products/roundtable/app/orchestrator/quality-analyzer.test.mjs products/roundtable/app/orchestrator/reply-lifecycle-scheduler.test.mjs
```

Expected: natural text is rejected by `STRUCTURE_INVALID` and receives `invalid_structure` low-confidence flags.

- [ ] **Step 3: Remove structure from blocking decisions**

In `reply-lifecycle.mjs`:

- Remove `invalid_structure` and `recovered_structure` from `DANGEROUS_FLAGS`.
- Remove the `structureStatus !== "valid"` rejection from `decideReplyCommit`.
- Keep assistant-role verification, manual recovery, and dangerous content-quality checks unchanged.
- Keep the parameter for compatibility with current scheduler call sites.

In `quality-analyzer.mjs`:

- Remove the `invalid_structure` and `recovered_structure` flag definitions.
- Remove both structure-status `addFlag` calls.
- Remove both codes from `lowConfidenceCodes`.
- Continue returning `structureStatus` as diagnostic metadata.

- [ ] **Step 4: Re-run lifecycle and quality tests**

Run the same focused command.

Expected: all tests pass; prompt echo remains rejected while plain natural text commits.

- [ ] **Step 5: Check the scheduler contract**

```powershell
rg -n "STRUCTURE_INVALID|invalid_structure|recovered_structure" products/roundtable/app/orchestrator
```

Expected: no runtime references; historical test data may only remain if explicitly testing backward-compatible metadata.

### Task 4: Render authoritative raw content in the conversation UI

**Files:**
- Modify: `products/roundtable/app/public/conversation-renderer.mjs:1-49`
- Modify: `products/roundtable/app/public/app.js:9,288-294,350`
- Modify: `products/roundtable/app/public/styles.css:156-158`
- Test: `products/roundtable/app/public/conversation-renderer.test.mjs:5-37`
- Test: `products/roundtable/app/public/ui-contract.test.mjs:55-64`

- [ ] **Step 1: Change renderer tests to require raw-first behavior**

Remove the `structuredReplyToMarkdown` import and replace the first renderer test with:

```js
test("event markdown always uses authoritative raw content", () => {
  const event = {
    content: "# 模型原文\n\n这是实际回复。",
    metadata: {
      structureStatus: "valid",
      structuredReply: {
        summary: "程序派生摘要",
        claims: ["派生主张"],
      },
    },
  };

  assert.equal(markdownForEvent(event), event.content);
  assert.doesNotMatch(markdownForEvent(event), /程序派生摘要|派生主张/);
});
```

In `ui-contract.test.mjs`, replace the positive structured-rendering assertions with:

```js
assert.doesNotMatch(app, /structuredReply|structureStatus|查看原始回复|reply-raw/);
assert.doesNotMatch(css, /\.reply-raw/);
```

- [ ] **Step 2: Run UI tests and observe failures**

```powershell
node --test products/roundtable/app/public/conversation-renderer.test.mjs products/roundtable/app/public/ui-contract.test.mjs
```

Expected: the renderer still emits structured sections and the application still contains the duplicate raw disclosure.

- [ ] **Step 3: Simplify the renderer to raw Markdown**

In `conversation-renderer.mjs`, remove `VALID_STRUCTURE_STATUSES`, `STRUCTURED_SECTIONS`, `normalizeList`, and `structuredReplyToMarkdown`. Implement:

```js
export function markdownForEvent(event = {}) {
  return String(event.content || "");
}
```

Keep `escapeHtml`, `renderSafeMarkdown`, and `hardenRenderedLinks` unchanged.

In `app.js`, replace `renderStructuredReply` with:

```js
function renderReplyContent(event) {
  return `<div class="markdown-body">${renderSafeMarkdown(markdownForEvent(event))}</div>`;
}
```

Update its conversation call site to use `renderReplyContent(event)`. Remove the obsolete structure-status and `<details class="reply-raw">` logic.

Remove the three `.reply-raw` CSS rules from `styles.css`.

- [ ] **Step 4: Re-run UI tests**

Run the same focused command.

Expected: all tests pass; Markdown parsing, sanitization, and link hardening tests remain green.

- [ ] **Step 5: Verify there is no visible structured substitution path**

```powershell
rg -n "structuredReplyToMarkdown|renderStructuredReply|查看原始回复|reply-raw" products/roundtable/app/public
```

Expected: no matches.

### Task 5: Use derived structure conservatively during compression

**Files:**
- Modify: `products/roundtable/app/orchestrator/context-compressor.mjs:45-105`
- Test: `products/roundtable/app/orchestrator/context-compressor.test.mjs:20-75`

- [ ] **Step 1: Add compression tests for derived structure and raw fallback**

Add:

```js
test("compression uses derived structure as auxiliary data without inventing consensus", () => {
  const session = createSession();
  session.events[0] = {
    id: "e1",
    type: "reply",
    content: "这是不可改写的模型原文",
    metadata: {
      structureStatus: "valid",
      structuredReply: {
        summary: "建议先验证输入链路",
        claims: ["网页原文应是主数据"],
        evidence: ["下一轮能读取 event.content"],
        risks: ["派生结构可能误判"],
        disagreements: ["是否保留旧格式"],
        actions: ["增加回归测试"],
        missingEvidence: ["真实长会话样本"],
      },
    },
  };
  const originalEvents = structuredClone(session.events);

  const result = compressSessionContext(session, {
    prompt: buildPrompt(session),
    buildPrompt,
    estimatePromptTokens,
    estimateEventTokens: () => 3,
    now: () => "2026-07-22T12:00:00.000Z",
    idFactory: () => "compression-derived",
  });

  assert.equal(result.compression.consensus.length, 0);
  assert.equal(result.compression.evidence[0].text, "下一轮能读取 event.content");
  assert.equal(result.compression.disagreements[0].text, "是否保留旧格式");
  assert.ok(result.compression.unclassified.some((entry) => entry.text === "核心判断：建议先验证输入链路"));
  assert.ok(result.compression.unclassified.some((entry) => entry.text === "风险：派生结构可能误判"));
  assert.deepEqual(session.events, originalEvents);
});
```

Add a second assertion to an existing or new test where `structureStatus: "invalid"`: compression must store one compact raw `unclassified` entry and must not create consensus, evidence, disagreement, or decision entries.

- [ ] **Step 2: Run the compressor test and observe failure**

```powershell
node --test products/roundtable/app/orchestrator/context-compressor.test.mjs
```

Expected: derived evidence and disagreement entries are absent because the compressor currently reads only explicit raw markers.

- [ ] **Step 3: Add conservative derived-entry extraction**

Add a helper with this field mapping:

```js
const DERIVED_COMPRESSION_FIELDS = Object.freeze([
  ["summary", "unclassified", "核心判断"],
  ["claims", "unclassified", "主张"],
  ["evidence", "evidence", ""],
  ["risks", "unclassified", "风险"],
  ["disagreements", "disagreements", ""],
  ["actions", "unclassified", "行动"],
  ["missingEvidence", "unclassified", "信息缺口"],
]);
```

Implement `derivedEntries(event, eventIndex)` so it:

- accepts only `structureStatus` values `valid` or `recovered`;
- converts a string summary and array fields into compact entries;
- prefixes only unclassified fields with their semantic label;
- uses stable IDs such as `${bucket}:${event.id || eventIndex}:${field}:${itemIndex}`;
- sets `sourceEventIds` to the source event ID;
- never writes derived content to `consensus` or `decisions`.

Update `appendCoveredEvents` in this order:

```js
const marked = markerEntry(event, index);
if (marked) {
  buckets[marked.bucket].push(marked.entry);
  continue;
}
const derived = derivedEntries(event, index);
if (derived.length) {
  for (const item of derived) buckets[item.bucket].push(item.entry);
  continue;
}
buckets.unclassified.push({
  id: `unclassified:${event.id}`,
  text: compactText(event.content),
  sourceEventIds: [String(event.id)],
});
```

- [ ] **Step 4: Re-run compressor and scheduler-compression tests**

```powershell
node --test products/roundtable/app/orchestrator/context-compressor.test.mjs products/roundtable/app/orchestrator/scheduler-compression.test.mjs
```

Expected: all tests pass, raw events remain byte-for-byte unchanged, and no derived claim is promoted to consensus.

### Task 6: Pin natural completion and run full verification

**Files:**
- Test: `products/roundtable/app/automation/completion-detector.test.mjs:1-45`
- Create: `.adworkflow/artifacts/roundtable-raw-first-output/verification_result.json`

- [ ] **Step 1: Add a natural Markdown completion regression**

Import `responseStructureComplete` and add:

```js
test("completion detector accepts settled natural Markdown with inline braces", () => {
  assert.equal(responseStructureComplete("结论：保留原文。\n\n示例对象为 `{ key: value }`。"), true);
  assert.equal(responseStructureComplete("```json\n{\"key\":\"value\""), false);
});
```

This protects the natural path while preserving the existing incomplete fenced-JSON guard used by tool-capable or historical responses.

- [ ] **Step 2: Run the completion detector tests**

```powershell
node --test products/roundtable/app/automation/completion-detector.test.mjs
```

Expected: all tests pass without changing completion-detector runtime code.

- [ ] **Step 3: Run all focused suites together**

```powershell
node --test products/roundtable/app/orchestrator/prompt-header.test.mjs products/roundtable/app/orchestrator/orchestrator.test.mjs products/roundtable/app/orchestrator/reply-lifecycle.test.mjs products/roundtable/app/orchestrator/quality-analyzer.test.mjs products/roundtable/app/orchestrator/reply-lifecycle-scheduler.test.mjs products/roundtable/app/orchestrator/context-compressor.test.mjs products/roundtable/app/orchestrator/scheduler-compression.test.mjs products/roundtable/app/public/conversation-renderer.test.mjs products/roundtable/app/public/ui-contract.test.mjs products/roundtable/app/automation/completion-detector.test.mjs
```

Expected: exit code `0`, no failures.

- [ ] **Step 4: Run the complete roundtable suite**

```powershell
npm run test:roundtable
```

Expected: core, browser, compatibility, and launcher suites pass.

- [ ] **Step 5: Restart and verify local service health**

```powershell
& '.\products\roundtable\start-roundtable.bat' -Restart -NoOpen
curl.exe --silent --show-error --max-time 5 http://127.0.0.1:3020/api/health
```

Expected: launcher exits `0`; health JSON contains `"ok":true`, browser `"connected":true`, and all three local services report `"healthy":true`.

- [ ] **Step 6: Write the verification artifact**

Create `.adworkflow/artifacts/roundtable-raw-first-output/verification_result.json` with actual results in this exact shape:

```json
{
  "task_id": "roundtable-raw-first-output",
  "status": "passed",
  "commands": [
    { "command": "focused node --test suites", "exit_code": 0 },
    { "command": "npm run test:roundtable", "exit_code": 0 },
    { "command": "roundtable launcher restart and health check", "exit_code": 0 }
  ],
  "acceptance": {
    "natural_prompt": true,
    "raw_ui": true,
    "raw_recent_context": true,
    "optional_structure": true,
    "compression_auxiliary": true,
    "tool_protocol_preserved": true
  }
}
```

If any command fails, set `status` to `failed`, record its real nonzero exit code, and do not claim completion.

- [ ] **Step 7: Review the final diff for scope and user changes**

```powershell
git diff --check
git status --short
git diff -- products/roundtable/app/orchestrator/context-builder.mjs products/roundtable/app/orchestrator/prompt-header.mjs products/roundtable/app/orchestrator/reply-lifecycle.mjs products/roundtable/app/orchestrator/quality-analyzer.mjs products/roundtable/app/orchestrator/context-compressor.mjs products/roundtable/app/public/conversation-renderer.mjs products/roundtable/app/public/app.js products/roundtable/app/public/styles.css
```

Expected: no unrelated refactor, no history migration, no tool-protocol change, and no lost pre-existing work. Keep overlapping implementation files unstaged unless task-only staging is certain.

## Final acceptance trace

- Natural output requirement: Tasks 2 and 6.
- Raw UI and safe Markdown: Task 4.
- Raw next-round context: Task 2.
- Optional, non-blocking structure: Task 3.
- Structured compression assistance with raw fallback: Task 5.
- Tool protocol preservation: Task 2 prompt-header tests and Task 6 full suite.
- Historical compatibility and no migration: no storage schema or migration files are modified.
