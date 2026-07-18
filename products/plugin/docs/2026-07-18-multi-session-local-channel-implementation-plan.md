# Multi-Session Local Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Complete Grok provider support, add a typed localhost task channel, and make local MCP access reliable across independent browser sessions and long instructions.

**Architecture:** Keep ports \`3006\` and \`3017\`. Route every local operation by \`sessionId\` and validated \`workspaceRoot\`, reuse multiplexed MCP connections, expose a minimal in-memory task queue, and execute provider-specific typed tasks through extension DOM adapters. Use only public local-core exports for real-path checks, path locks, and atomic files.

**Tech Stack:** TypeScript, React, Chrome Manifest V3, Vitest, Node.js HTTP/SSE, Node test runner, \`@web-agents/local-core\` public exports.

---

## File Map

- \`extension/src/providers/catalog.ts\`: provider capabilities and Grok selectors.
- \`extension/src/sessions/model.ts\`: session creation and workspace identity.
- \`services/session-filesystem-registry.mjs\`: validated session-to-filesystem mapping.
- \`services/automation-task-queue.mjs\`: bounded in-memory typed task queue.
- \`extension/src/automation/client.ts\`: long-poll and result client.
- \`extension/src/automation/session-runner.ts\`: per-session mutation ordering without a global limit.
- \`extension/src/content/provider-image.ts\`: provider image DOM workflow.
- \`extension/src/mcp/client.ts\`: reusable multiplexed SSE sessions.
- \`services/async-request-limiter.mjs\`: bounded local-service backpressure.
- \`services/filesystem-http-server.mjs\`: session routing, path locks, and SSE handling.
- \`extension/src/ui/panels/McpPanel.tsx\`: local MCP connection control.
- \`extension/src/ui/panels/TaskPanel.tsx\`: session workspace input.

All paths below are relative to \`products/plugin\` unless stated otherwise.

### Task 1: Complete the Grok Provider Contract

**Files:**
- Modify: \`extension/src/providers/catalog.ts\`
- Modify: \`extension/src/providers/catalog.test.ts\`
- Modify: \`extension/src/auth/page-probes.ts\`
- Modify: \`extension/src/auth/page-probes.test.ts\`

- [ ] **Step 1: Write failing catalog tests**

Add this desired contract:

\`\`\`ts
const grok = getProviderById("grok")!;
expect(grok.automationCapabilities).toContain("generate_image");
expect(grok.imageGeneration?.defaultUrl).toBe("https://grok.com/imagine");
expect(grok.imageGeneration?.submitSelectors.length).toBeGreaterThan(0);
expect(grok.imageGeneration?.imageSelectors.length).toBeGreaterThan(0);
expect(grok.responseSelectors?.length).toBeGreaterThan(0);
\`\`\`

Add an auth-probe fixture containing a writable Grok composer and no login wall, then expect an authenticated/usable result.

- [ ] **Step 2: Run focused tests and observe RED**

Run:

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/providers/catalog.test.ts src/auth/page-probes.test.ts
\`\`\`

Expected: FAIL because the Grok image contract does not exist.

- [ ] **Step 3: Add the minimal contract**

Add:

\`\`\`ts
export type ProviderAutomationCapability = "generate_image";
export type ProviderImageGeneration = {
  defaultUrl: string;
  submitSelectors: string[];
  imageSelectors: string[];
};
\`\`\`

Declare optional \`automationCapabilities\` and \`imageGeneration\` fields, add Grok-specific input/submit/response/image selectors, and make the Grok page probe recognize a usable composer without bypassing login or verification.

- [ ] **Step 4: Run tests and observe GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

\`\`\`powershell
git add products/plugin/extension/src/providers/catalog.ts products/plugin/extension/src/providers/catalog.test.ts products/plugin/extension/src/auth/page-probes.ts products/plugin/extension/src/auth/page-probes.test.ts
git commit -m "feat(plugin): complete Grok provider contract"
\`\`\`

### Task 2: Add Session-Specific Workspace Routing

**Files:**
- Modify: \`extension/src/shared/types.ts\`
- Modify: \`extension/src/sessions/model.ts\`
- Create: \`extension/src/sessions/model.test.ts\`
- Create: \`services/session-filesystem-registry.mjs\`
- Create: \`services/session-filesystem-registry.test.mjs\`
- Modify: \`services/filesystem-http-server.mjs\`
- Modify: \`services/filesystem-http-server.test.mjs\`

- [ ] **Step 1: Write failing session tests**

\`\`\`ts
const first = createTaskSession("one", "F:\\project-a");
const second = createTaskSession("two", "F:\\project-b");
expect(first.id).not.toBe(second.id);
expect(first.workspaceRoot).toBe("F:\\project-a");
expect(first.mcpSessionId).toContain(first.id);
\`\`\`

For the registry, inject a tool factory and assert it receives:

\`\`\`js
assert.equal(calls[0].repoRoot, path.resolve(allowedRoot));
assert.equal(calls[0].configFile, path.resolve(configFile));
assert.equal(calls[0].permissionStoreDir, path.resolve(permissionStoreDir));
assert.equal(calls[0].auditFile, path.resolve(auditFile));
\`\`\`

Also assert an unconfigured workspace rejects with \`WORKSPACE_NOT_ALLOWED\`.

- [ ] **Step 2: Run tests and observe RED**

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/sessions/model.test.ts
node --test products/plugin/services/session-filesystem-registry.test.mjs
\`\`\`

Expected: both commands fail for missing fields/modules.

- [ ] **Step 3: Implement session identity and registry**

Extend \`TaskSession\` with \`workspaceRoot\` and \`mcpSessionId\`. Implement \`createSessionFilesystemRegistry()\` so \`get()\` validates the requested workspace against \`getAllowedRoots()\`, checks physical identity via \`@web-agents/local-core/real-paths\`, caches by session plus physical workspace, and calls:

\`\`\`js
createFilesystemTools({ repoRoot, configFile, permissionStoreDir, auditFile })
\`\`\`

- [ ] **Step 4: Route HTTP/SSE sessions**

Accept \`x-web-agents-session\` and \`x-web-agents-workspace\` headers. Store the resolved tool instance with each SSE session and select it per \`/mcp\` request. Preserve the current default workspace when both headers are absent.

- [ ] **Step 5: Verify GREEN**

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/sessions/model.test.ts
node --test products/plugin/services/session-filesystem-registry.test.mjs products/plugin/services/filesystem-http-server.test.mjs
\`\`\`

Expected: all tests pass.

- [ ] **Step 6: Commit**

\`\`\`powershell
git add products/plugin/extension/src/shared/types.ts products/plugin/extension/src/sessions/model.ts products/plugin/extension/src/sessions/model.test.ts products/plugin/services/session-filesystem-registry.mjs products/plugin/services/session-filesystem-registry.test.mjs products/plugin/services/filesystem-http-server.mjs products/plugin/services/filesystem-http-server.test.mjs
git commit -m "feat(plugin): isolate local workspaces by session"
\`\`\`

### Task 3: Add the Minimal Gateway Task Queue

**Files:**
- Create: \`services/automation-task-queue.mjs\`
- Create: \`services/automation-task-queue.test.mjs\`
- Modify: \`services/plugin-gateway.mjs\`
- Modify: \`services/plugin-gateway.test.mjs\`

- [ ] **Step 1: Write failing queue tests**

\`\`\`js
const queue = createAutomationTaskQueue({ capacity: 2, taskTimeoutMs: 1000 });
const first = queue.submit(validTask("request-1"));
assert.strictEqual(queue.submit(validTask("request-1")), first);
assert.equal((await queue.take({ waitMs: 10 })).taskId, first.taskId);
queue.complete(first.taskId, { ok: true, filePath: "F:\\project\\image.png" });
assert.equal(queue.get(first.taskId).state, "done");
\`\`\`

Also assert the third pending task throws \`AUTOMATION_QUEUE_FULL\`, an empty wait returns \`null\`, and expired tasks are removed.

- [ ] **Step 2: Run and observe RED**

Run \`node --test products/plugin/services/automation-task-queue.test.mjs\`.

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the queue**

Implement \`createAutomationTaskQueue({ capacity, taskTimeoutMs, retentionMs, idFactory, now })\` with public \`pending\`, \`done\`, and \`error\` states. Keep received-but-incomplete bookkeeping private, wake one long poll immediately, and expose \`close()\`.

- [ ] **Step 4: Add gateway endpoint tests**

Test \`POST /automation/tasks\`, \`GET /automation/next?waitMs=10\`, \`POST /automation/tasks/:id/result\`, and \`GET /automation/tasks/:id\`. Validate version, type, request ID, session, provider, workspace, and payload. Expect \`400\`, \`404\`, or \`429\` for invalid, missing, or saturated requests.

- [ ] **Step 5: Implement endpoints and verify GREEN**

\`\`\`powershell
node --test products/plugin/services/automation-task-queue.test.mjs products/plugin/services/plugin-gateway.test.mjs
\`\`\`

Expected: all tests pass.

- [ ] **Step 6: Commit**

\`\`\`powershell
git add products/plugin/services/automation-task-queue.mjs products/plugin/services/automation-task-queue.test.mjs products/plugin/services/plugin-gateway.mjs products/plugin/services/plugin-gateway.test.mjs
git commit -m "feat(plugin): add typed local automation queue"
\`\`\`

### Task 4: Execute Typed Provider Tasks

**Files:**
- Modify: \`extension/src/shared/types.ts\`
- Modify: \`extension/src/shared/messages.ts\`
- Create: \`extension/src/automation/client.ts\`
- Create: \`extension/src/automation/client.test.ts\`
- Create: \`extension/src/automation/session-runner.ts\`
- Create: \`extension/src/automation/session-runner.test.ts\`
- Create: \`extension/src/content/provider-image.ts\`
- Create: \`extension/src/content/provider-image.test.ts\`
- Modify: \`extension/src/content/index.ts\`
- Modify: \`extension/src/background/index.ts\`
- Modify: \`services/plugin-gateway.mjs\`
- Modify: \`services/plugin-gateway.test.mjs\`

- [ ] **Step 1: Write failing automation client tests**

Inject \`fetch\`, timers, and an executor. Assert that \`pollOnce()\` handles empty responses, dispatches one task, posts its result, aborts on timeout, and retries transport errors with bounded backoff.

- [ ] **Step 2: Write failing session runner tests**

Prove two session keys run concurrently and two DOM mutations for the same session run in order:

\`\`\`ts
await Promise.all([
  runner.run("session-a", firstOperation),
  runner.run("session-b", secondOperation)
]);
expect(maxActive).toBe(2);
\`\`\`

Do not add a global task semaphore.

- [ ] **Step 3: Write failing Grok image DOM tests**

Use jsdom fixtures with a Grok composer, submit button, and later-added image. Assert native insertion, submit, mutation capture, timeout, and ignoring images present before submission.

- [ ] **Step 4: Run and observe RED**

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/automation/client.test.ts src/automation/session-runner.test.ts src/content/provider-image.test.ts
\`\`\`

Expected: FAIL because the modules are missing.

- [ ] **Step 5: Implement client, runner, and DOM workflow**

Add typed \`ProviderAutomationTask\` and result unions. Implement the long-poll client, per-session runner, and \`tab:generate-image\` content message. Record pre-existing images, submit through provider selectors, observe mutations, and return only a new downloadable image.

- [ ] **Step 6: Implement safe image persistence**

Validate the output directory against configured roots and real-path identity. Use \`PathLockManager\` from \`@web-agents/local-core/paths\` and \`atomicWriteFile\` from \`@web-agents/local-core/atomic-file\`. Keep plugin data as the default destination when no target is supplied.

- [ ] **Step 7: Wire background execution and verify GREEN**

Start one reconnecting poll loop from the background service worker. Resolve the provider tab, run the content task under its session key, save bytes through \`3017\`, and post the result.

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/automation/client.test.ts src/automation/session-runner.test.ts src/content/provider-image.test.ts
node --test products/plugin/services/plugin-gateway.test.mjs
\`\`\`

Expected: all selected tests pass.

- [ ] **Step 8: Commit**

\`\`\`powershell
git add products/plugin/extension/src/shared/types.ts products/plugin/extension/src/shared/messages.ts products/plugin/extension/src/automation products/plugin/extension/src/content/provider-image.ts products/plugin/extension/src/content/provider-image.test.ts products/plugin/extension/src/content/index.ts products/plugin/extension/src/background/index.ts products/plugin/services/plugin-gateway.mjs products/plugin/services/plugin-gateway.test.mjs
git commit -m "feat(plugin): execute typed provider image tasks"
\`\`\`

### Task 5: Multiplex MCP and Add Backpressure

**Files:**
- Modify: \`extension/src/mcp/client.ts\`
- Create: \`extension/src/mcp/client.test.ts\`
- Create: \`services/async-request-limiter.mjs\`
- Create: \`services/async-request-limiter.test.mjs\`
- Modify: \`services/filesystem-http-server.mjs\`
- Modify: \`services/filesystem-http-server.test.mjs\`

- [ ] **Step 1: Write failing multiplexing tests**

Use a fake SSE transport that returns responses out of order. Start eight requests and assert every promise receives its own JSON-RPC ID payload. Assert two calls with the same connection key open one SSE connection.

- [ ] **Step 2: Write failing limiter tests**

\`\`\`js
const limiter = createAsyncRequestLimiter({ concurrency: 2, maxQueue: 1 });
const firstThree = [limiter.run(block), limiter.run(block), limiter.run(block)];
await assert.rejects(() => limiter.run(block), /REQUEST_QUEUE_FULL/);
releaseAll();
await Promise.all(firstThree);
assert.deepEqual(limiter.snapshot(), { active: 0, waiting: 0, rejected: 1 });
\`\`\`

- [ ] **Step 3: Run and observe RED**

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/mcp/client.test.ts
node --test products/plugin/services/async-request-limiter.test.mjs
\`\`\`

Expected: FAIL because the APIs are missing.

- [ ] **Step 4: Implement reusable MCP sessions**

Use one SSE dispatcher and \`Map<number, PendingRequest>\`. Include session/workspace headers, cache by server URI plus MCP session identity, and remove cached sessions on disconnect.

- [ ] **Step 5: Implement service limits and path locks**

Wrap tool calls with the limiter. Use \`defaultToolRegistry.extractPaths(name, args)\` and shared \`PathLockManager\` for mutating calls so conflicting paths serialize and unrelated paths proceed. Return \`429\` when the queue is full.

- [ ] **Step 6: Implement SSE backpressure and metrics**

Wait for \`drain\` when \`response.write()\` returns false. Add limiter \`active\`, \`waiting\`, and \`rejected\` to \`/health\`. Clear sessions and pending handlers on disconnect.

- [ ] **Step 7: Add integration pressure tests and observe GREEN**

Issue out-of-order reads, same-path writes, and different-path writes across sessions. Assert no response cross-talk, correct final files, recoverable \`429\`, and zero pending counters.

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/mcp/client.test.ts
node --test products/plugin/services/async-request-limiter.test.mjs products/plugin/services/filesystem-http-server.test.mjs
\`\`\`

Expected: all tests pass.

- [ ] **Step 8: Commit**

\`\`\`powershell
git add products/plugin/extension/src/mcp/client.ts products/plugin/extension/src/mcp/client.test.ts products/plugin/services/async-request-limiter.mjs products/plugin/services/async-request-limiter.test.mjs products/plugin/services/filesystem-http-server.mjs products/plugin/services/filesystem-http-server.test.mjs
git commit -m "perf(plugin): multiplex local MCP requests"
\`\`\`

### Task 6: Add Workspace and MCP Controls

**Files:**
- Modify: \`extension/src/shared/messages.ts\`
- Modify: \`extension/src/background/index.ts\`
- Modify: \`extension/src/ui/App.tsx\`
- Modify: \`extension/src/ui/panels/McpPanel.tsx\`
- Modify: \`extension/src/ui/panels/TaskPanel.tsx\`
- Modify: \`extension/src/i18n/en.json\`
- Modify: \`extension/src/i18n/zh-CN.json\`
- Modify: \`extension/src/ui/styles.css\`

- [ ] **Step 1: Write failing UI contract tests**

Extend session model tests with workspace updates and message validation. Assert the MCP connection action checks both local services and does not expose a native-process start command.

- [ ] **Step 2: Run and observe RED**

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test -- src/sessions/model.test.ts src/adapters/runtime.test.ts
\`\`\`

Expected: FAIL on the new workspace/connection assertions.

- [ ] **Step 3: Implement controls**

Add a compact workspace text input to \`TaskPanel\`. Add an icon-plus-label connection button and service status rows to \`McpPanel\`. Keep the current visual language and translations. Show the launcher command only when unavailable.

- [ ] **Step 4: Wire session-aware state**

Update \`App\` so workspace changes update \`TaskSession\`; MCP refresh passes \`mcpSessionId\` and \`workspaceRoot\`; prepared local context and automation use the same identity.

- [ ] **Step 5: Verify extension and build**

\`\`\`powershell
npm.cmd --prefix products/plugin/extension test
npm.cmd --prefix products/plugin/extension run typecheck
npm.cmd run build:plugin
\`\`\`

Expected: tests/typecheck pass and the build completes.

- [ ] **Step 6: Commit**

\`\`\`powershell
git add products/plugin/extension/src/shared/messages.ts products/plugin/extension/src/background/index.ts products/plugin/extension/src/ui products/plugin/extension/src/i18n/en.json products/plugin/extension/src/i18n/zh-CN.json products/plugin/extension/src/sessions/model.ts products/plugin/extension/src/sessions/model.test.ts
git commit -m "feat(plugin): expose session workspace controls"
\`\`\`

### Task 7: Complete Product Acceptance

**Files:**
- Modify only plugin source or test files required by an acceptance failure.

- [ ] **Step 1: Run required checks**

\`\`\`powershell
npm.cmd run check:boundaries
npm.cmd run test:core
npm.cmd run test:plugin
npm.cmd run build:plugin
node --test products/plugin/tests/legacy-release-boundary.test.mjs products/plugin/tests/source-release-boundary.test.mjs
rg -n -i roundtable products/plugin/extension/src products/plugin/extension/public products/plugin/extension/dist
git diff --check
node --test products/plugin/services/*.test.mjs
node --test tools/product-runtime-isolation.test.mjs
\`\`\`

Expected: every command except \`rg\` exits \`0\`; \`rg\` exits \`1\` with no matches.

- [ ] **Step 2: Inspect the final boundary**

\`\`\`powershell
git status --short
git diff --name-only 0141ef958c9684bfa170900094abf5eff37faf33..HEAD
git log --oneline 0141ef958c9684bfa170900094abf5eff37faf33..HEAD
\`\`\`

Expected: only \`products/plugin/**\` changed, with no data, local config, generated profile, dependency directory, or protected legacy bundle.

- [ ] **Step 3: Record manual browser verification**

The completion report must list live-browser checks not automated locally: Grok login state, live selectors, prompt submission, image generation/download, multiple provider tabs, and service-worker reconnect behavior.

- [ ] **Step 4: Commit acceptance fixes only when files changed**

Stage only the exact plugin files changed to fix acceptance failures, inspect \`git diff --cached --name-only\`, then commit with \`test(plugin): complete local channel acceptance\`. Do not create an empty commit.
