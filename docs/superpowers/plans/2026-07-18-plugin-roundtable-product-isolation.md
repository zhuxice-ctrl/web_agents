# Web Agents Plugin And Roundtable Product Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current mixed Web Agents worktree into one repository containing an independently installable normal plugin product, an extension-independent roundtable product, and a shared product-neutral local security core.

**Architecture:** First checkpoint the currently untracked implementation so every move is reversible. Remove roundtable code from both plugin implementations, move the temporary relay into a roundtable-owned compatibility extension, extract product-neutral filesystem safety into `packages/local-core`, then move each product behind its own package, runtime, configuration, data, tests, and launcher. The roundtable defaults to dedicated-Chrome CDP/Playwright automation and invokes filesystem tools in process; the normal plugin alone owns ports 3006 and 3017.

**Tech Stack:** Node.js 24 ESM, npm workspaces, TypeScript 5, React 19, Vite 6, Chrome MV3, Playwright 1.61/CDP, Node test runner, PowerShell/BAT, JSON/JSONL persistence.

## Global Constraints

- Keep the repository on `codex/legacy-local-fixed-enhancements`; do not recreate `F:\web_agents-new-plugin-rewrite` as a daily development worktree.
- Never stage `config/*.local.*`, `generated/**`, `browser-profiles/**`, credentials, provider conversations, `.codegraph/*.lock`, or `node_modules/**`.
- Do not modify `products/plugin/legacy-extension/content/index.iife.js`; it remains the protected legacy bundle.
- The normal plugin must not contain roundtable scripts, roundtable UI, roundtable message types, a `3020` relay call, or roundtable-only `tabs`/`scripting` permissions.
- The roundtable must complete its default acceptance path without either plugin or the compatibility extension installed.
- `products/plugin` and `products/roundtable` may import only public exports from `@web-agents/local-core`; they may not import each other.
- `packages/local-core` must contain no HTTP server, fixed port, Chrome API, DOM selector, product UI, browser profile, plugin storage key, or roundtable session state.
- Plugin runtime ownership: filesystem MCP `3006`, permission/config gateway `3017`, user browser profile, plugin-owned config and audit data.
- Roundtable runtime ownership: workbench `3020`, dedicated Chrome CDP `9223`, Playwright MCP `8931`, `<workspace>/.web-agents`, and roundtable-owned logs.
- Preserve UTF-8 explicitly for every PowerShell read/write and do not normalize unrelated repository line endings.
- Use TDD for every behavioral change and make the listed commit after each task passes.

---

## File And Ownership Map

**Create:**

- `products/plugin/package.json`: normal plugin product commands.
- `products/plugin/extension/**`: maintainable normal plugin source.
- `products/plugin/legacy-extension/**`: compatibility copy of the current normal plugin.
- `products/plugin/services/**`: plugin-only MCP/gateway processes.
- `products/plugin/tests/**`: plugin manifests, injected UI, permission, and service tests.
- `products/roundtable/package.json`: roundtable product commands.
- `products/roundtable/app/**`: roundtable server, UI, storage, scheduler, and browser workers.
- `products/roundtable/launcher/**`: dedicated Chrome and roundtable lifecycle.
- `products/roundtable/compat-extension/**`: temporary roundtable-only extension bridge.
- `products/roundtable/tests/**`: cross-component roundtable tests.
- `packages/local-core/package.json`: shared package metadata and exports.
- `packages/local-core/src/**`: path, permissions, transaction, atomic-file, audit, and filesystem tool logic.
- `packages/local-core/test/**`: product-neutral contract tests.
- `tools/check-product-boundaries.mjs`: repository dependency and release-boundary enforcement.
- `docs/superpowers/baselines/2026-07-18-product-isolation-baseline.md`: pre-migration verification record.

**Remove after verified moves:**

- `apps/roundtable-web/**`
- `extensions/web-agents-extension/**`
- `extensions/mcp-superassistant-local-fixed/**`
- root `scripts/web-agent-roundtable-*.test.mjs`
- root roundtable/browser launcher scripts and BAT files
- roundtable sidecar imports and files from the normal plugin manifests/builds

**Keep at repository root:**

- `package.json` and `package-lock.json` as workspace aggregation only.
- product-neutral documentation and tooling.
- explicit compatibility shims only when they print the new product entrypoint and forward arguments without owning runtime logic.

---

### Task 1: Checkpoint The Current Product Implementation

**Files:**
- Create: `docs/superpowers/baselines/2026-07-18-product-isolation-baseline.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: current dirty worktree and commit `83c1058`.
- Produces: a reversible Git baseline in which all product source used by later `git mv` commands is tracked.

- [ ] **Step 1: Verify local-data exclusions before staging anything**

Add these exact patterns if they are not already covered:

```gitignore
config/*.local.*
generated/
browser-profiles/
**/node_modules/
**/dist/
**/*.tsbuildinfo
.codegraph/*.lock
```

- [ ] **Step 2: Run the pre-migration product suites**

Run:

```powershell
npm.cmd run test:legacy-roundtable-extension
npm.cmd --prefix extensions/web-agents-extension test
npm.cmd --prefix extensions/web-agents-extension run typecheck
npm.cmd run test:roundtable-web
node --test scripts/start-web-agents-browser.test.mjs
node --test --test-name-pattern="launcher source|root BAT" scripts/start-web-agents-roundtable.test.mjs
```

Expected: every command exits `0`; the roundtable suite reports `201` passing tests at the current baseline. Do not run the known slow dynamic launcher chain in this checkpoint.

- [ ] **Step 3: Write the baseline record**

Create the file with this structure and replace each command's `exit` value with the observed numeric exit code:

```markdown
# Product Isolation Baseline

Date: 2026-07-18
Base commit: 83c1058

| Command | Required result |
|---|---|
| `npm.cmd run test:legacy-roundtable-extension` | exit 0 |
| `npm.cmd --prefix extensions/web-agents-extension test` | exit 0 |
| `npm.cmd --prefix extensions/web-agents-extension run typecheck` | exit 0 |
| `npm.cmd run test:roundtable-web` | exit 0, 201 passed |
| `node --test scripts/start-web-agents-browser.test.mjs` | exit 0 |
| roundtable launcher static tests | exit 0 |

Known open issue: the complete launcher start/reuse/restart/stop chain passes functionally but has shown approximately 252 seconds of host-dependent latency. It is not accepted by this baseline.
```

- [ ] **Step 4: Stage only product source and the baseline**

Run these commands separately and inspect `git diff --cached --name-only` afterward:

```powershell
git add -- .gitignore package.json package-lock.json
git add -- apps/roundtable-web extensions/web-agents-extension
git add -- extensions/mcp-superassistant-local-fixed/README.md extensions/mcp-superassistant-local-fixed/background.js extensions/mcp-superassistant-local-fixed/manifest.json extensions/mcp-superassistant-local-fixed/content/web-agent-result-enhancer.js extensions/mcp-superassistant-local-fixed/content/roundtable-content-bridge.js extensions/mcp-superassistant-local-fixed/content/roundtable-page-bridge.js extensions/mcp-superassistant-local-fixed/content/roundtable-protocol.js extensions/mcp-superassistant-local-fixed/roundtable-background.js extensions/mcp-superassistant-local-fixed/roundtable
git add -- scripts/start-web-agents-browser.ps1 scripts/start-web-agents-browser.test.mjs scripts/start-web-agents-local-services.mjs scripts/start-web-agents-local-services.test.mjs scripts/start-web-agents-roundtable.ps1 scripts/start-web-agents-roundtable.test.mjs scripts/web-agent-config-gateway.mjs scripts/web-agent-config-gateway.test.mjs scripts/web-agent-filesystem-http-server.mjs scripts/web-agent-filesystem-http-server.test.mjs scripts/web-agent-filesystem-server.mjs scripts/web-agent-filesystem-server.test.mjs scripts/web-agent-image-save-gateway.mjs scripts/web-agent-result-enhancer.test.mjs scripts/web-agent-roundtable-background.test.mjs scripts/web-agent-roundtable-content-bridge.test.mjs scripts/web-agent-roundtable-manifest.test.mjs scripts/web-agent-roundtable-page-bridge.test.mjs scripts/web-agent-roundtable-protocol.test.mjs scripts/web-agents-native-process.ps1
git add -- start-web-agents.bat start-web-agents-browser.bat docs/superpowers/baselines/2026-07-18-product-isolation-baseline.md
```

Expected: no path under `config`, `generated`, `browser-profiles`, `.codegraph`, `.adworkflow`, or `node_modules` appears in the staged list.

- [ ] **Step 5: Commit the reversible checkpoint**

```powershell
git commit -m "chore: checkpoint plugin and roundtable implementation"
```

---

### Task 2: Detach The Legacy Plugin From The Roundtable Relay

**Files:**
- Create: `products/roundtable/compat-extension/manifest.json`
- Create: `products/roundtable/compat-extension/background.js`
- Move: legacy `content/roundtable-*.js` to `products/roundtable/compat-extension/content/`
- Move: legacy `roundtable/background-core.js` to `products/roundtable/compat-extension/background/background-core.js`
- Modify: `extensions/mcp-superassistant-local-fixed/background.js`
- Modify: `extensions/mcp-superassistant-local-fixed/manifest.json`
- Move/Modify: `scripts/web-agent-roundtable-*.test.mjs` to `products/roundtable/compat-extension/test/`
- Create: `products/plugin/tests/legacy-release-boundary.test.mjs`

**Interfaces:**
- Consumes: the `legacy-sidecar-v1` page/content/background protocol.
- Produces: standalone compatibility extension version `0.1.0`; normal legacy plugin version returns to `0.6.7` until it receives a plugin-only release.

- [ ] **Step 1: Add a failing normal-plugin release-boundary test**

```js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(testDir, "../../../extensions/mcp-superassistant-local-fixed");

test("legacy normal plugin contains no roundtable runtime", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
  const background = await fs.readFile(path.join(pluginDir, "background.js"), "utf8");
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(background, /roundtable-background/);
  assert.doesNotMatch(serialized, /roundtable-|127\.0\.0\.1\/\*|localhost\/\*/i);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
});
```

- [ ] **Step 2: Run the test and verify the existing coupling fails it**

Run: `node --test products/plugin/tests/legacy-release-boundary.test.mjs`

Expected: FAIL because background imports `roundtable-background.js` and manifest contains roundtable content scripts/permissions.

- [ ] **Step 3: Move the relay files into the roundtable product**

Use `git mv` for these exact files:

```powershell
git mv extensions/mcp-superassistant-local-fixed/content/roundtable-protocol.js products/roundtable/compat-extension/content/roundtable-protocol.js
git mv extensions/mcp-superassistant-local-fixed/content/roundtable-page-bridge.js products/roundtable/compat-extension/content/roundtable-page-bridge.js
git mv extensions/mcp-superassistant-local-fixed/content/roundtable-content-bridge.js products/roundtable/compat-extension/content/roundtable-content-bridge.js
git mv extensions/mcp-superassistant-local-fixed/roundtable-background.js products/roundtable/compat-extension/background.js
git mv extensions/mcp-superassistant-local-fixed/roundtable/background-core.js products/roundtable/compat-extension/background/background-core.js
```

Update `background.js` to import `./background/background-core.js`.

- [ ] **Step 4: Add the standalone compatibility manifest**

```json
{
  "manifest_version": 3,
  "name": "Web Agents Roundtable Compatibility Bridge",
  "description": "Temporary bridge for the standalone Web Agents roundtable.",
  "version": "0.1.0",
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["storage", "tabs", "scripting"],
  "host_permissions": [
    "http://127.0.0.1:3020/*",
    "http://localhost:3020/*",
    "*://*.chat.openai.com/*",
    "*://*.chatgpt.com/*",
    "*://*.chat.deepseek.com/*",
    "*://*.doubao.com/*"
  ],
  "content_scripts": [
    {
      "matches": ["http://127.0.0.1:3020/*", "http://localhost:3020/*"],
      "js": ["content/roundtable-protocol.js", "content/roundtable-page-bridge.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://*.chat.openai.com/*", "*://*.chatgpt.com/*", "*://*.chat.deepseek.com/*", "*://*.doubao.com/*"],
      "js": ["content/roundtable-protocol.js", "content/roundtable-content-bridge.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 5: Restore the normal legacy manifest and background**

Remove only the first line `import "./roundtable-background.js";` from background. Remove both roundtable content-script entries, localhost wildcard host permissions, `tabs`, and `scripting` from manifest. Set the normal plugin version to `0.6.7`; retain plugin-owned host permissions and all existing MCP/result-enhancer behavior.

- [ ] **Step 6: Move and retarget the relay tests**

Move the five `web-agent-roundtable-*.test.mjs` files into `products/roundtable/compat-extension/test/`, change their fixture root to `path.resolve(testDir, "..")`, and add a manifest test that requires version `0.1.0`, port-scoped localhost matches, and no wildcard localhost match.

- [ ] **Step 7: Run both product boundaries**

Run:

```powershell
node --test products/plugin/tests/legacy-release-boundary.test.mjs scripts/web-agent-insert-fallback.test.mjs scripts/web-agent-result-enhancer.test.mjs scripts/web-agent-background-permission.test.mjs
node --test products/roundtable/compat-extension/test/*.test.mjs
```

Expected: zero failures.

- [ ] **Step 8: Commit**

```powershell
git add -- products/roundtable/compat-extension products/plugin/tests/legacy-release-boundary.test.mjs extensions/mcp-superassistant-local-fixed/background.js extensions/mcp-superassistant-local-fixed/manifest.json
git commit -m "refactor: detach legacy plugin from roundtable relay"
```

---

### Task 3: Remove Roundtable State And UI From The Source Plugin

**Files:**
- Delete: `extensions/web-agents-extension/src/background/roundtable-orchestrator.ts`
- Delete: `extensions/web-agents-extension/src/background/roundtable-orchestrator.test.ts`
- Delete: `extensions/web-agents-extension/src/sessions/roundtable.ts`
- Delete: `extensions/web-agents-extension/src/sessions/roundtable.test.ts`
- Delete: `extensions/web-agents-extension/src/sessions/context-packet.ts`
- Delete: `extensions/web-agents-extension/src/sessions/context-packet.test.ts`
- Delete: `extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.tsx`
- Delete: `extensions/web-agents-extension/src/ui/panels/RoundtableSessionPanel.test.tsx`
- Delete: `extensions/web-agents-extension/src/bridge/**`
- Modify: `extensions/web-agents-extension/src/background/index.ts`
- Modify: `extensions/web-agents-extension/src/ui/App.tsx`
- Modify: `extensions/web-agents-extension/src/shared/messages.ts`
- Modify: `extensions/web-agents-extension/src/shared/types.ts`
- Modify: `extensions/web-agents-extension/src/ui/styles.css`
- Modify: `extensions/web-agents-extension/src/i18n/en.json`
- Modify: `extensions/web-agents-extension/src/i18n/zh-CN.json`
- Modify: `extensions/web-agents-extension/public/manifest.json`
- Modify: `extensions/web-agents-extension/vite.config.ts`
- Create: `products/plugin/tests/source-release-boundary.test.mjs`

**Interfaces:**
- Consumes: existing normal task, provider tab, MCP, permission, inline-entry, and tool-card features.
- Produces: source plugin with no `roundtable:*` message union, session model, orchestrator, bridge, or panel.

- [ ] **Step 1: Add the failing recursive source-boundary test**

```js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(testDir, "../../../extensions/web-agents-extension");

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ["dist", "node_modules"].includes(entry.name)) continue;
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(item));
    else if (/\.(?:ts|tsx|js|json|css)$/.test(entry.name)) output.push(item);
  }
  return output;
}

test("source normal plugin contains no roundtable product code", async () => {
  for (const file of await sourceFiles(extensionDir)) {
    const relative = path.relative(extensionDir, file).replaceAll("\\", "/");
    const source = await fs.readFile(file, "utf8");
    assert.doesNotMatch(`${relative}\n${source}`, /roundtable/i, relative);
  }
});
```

- [ ] **Step 2: Verify the test fails on current source modules**

Run: `node --test products/plugin/tests/source-release-boundary.test.mjs`

Expected: FAIL naming `src/background/roundtable-orchestrator.ts` or another roundtable source.

- [ ] **Step 3: Remove roundtable-only modules and public bridge registration**

Delete the files listed above. In `public/manifest.json`, delete the localhost `bridge.js` content-script entry and replace localhost wildcards with only the plugin-owned 3006/3017 origins required by normal MCP/gateway APIs. Keep provider host permissions used by normal page insertion. In `vite.config.ts`, delete the `bridge` Rollup input so the normal build cannot emit `bridge.js`.

- [ ] **Step 4: Remove roundtable state and handlers from background**

Delete imports `appendRoundtableMessage`, `createRoundtableSession`, `joinRoundtableParticipant`, `RoundtableSession`, and `createRoundtableOrchestrator`; delete `roundtableSessions`, `roundtableOrchestrator`, `getRoundtableSessionOrError`, `saveRoundtableSession`, `pauseRoundtableSession`; delete every `case` whose message type starts with `roundtable:`. Preserve provider-tab, MCP, permission, insert, capture, and normal task handlers.

- [ ] **Step 5: Remove roundtable view state from `App.tsx`**

Delete `RoundtableSessionPanel` and roundtable type imports, all `roundtableObjective`, `roundtableGuidance`, and `roundtableSession` state, callbacks `createRoundtable`, `updateRoundtable`, `addRoundtableGuidance`, `addRoundtableParticipant`, and the `<RoundtableSessionPanel ... />` render block. Keep the normal task panel, current-page panel, MCP panel, permission panel, settings panel, and non-roundtable provider board.

- [ ] **Step 6: Narrow shared contracts and styles**

Remove the `roundtable:*` variants and response map keys from `shared/messages.ts`; remove `Roundtable*` types from `shared/types.ts`; remove `.roundtable-*` CSS rules and `roundtable` i18n keys. Do not remove provider, task session, MCP, permission, inline-entry, or tool-execution types.

- [ ] **Step 7: Verify normal plugin tests, types, and build**

Run:

```powershell
node --test products/plugin/tests/source-release-boundary.test.mjs
npm.cmd --prefix extensions/web-agents-extension test
npm.cmd --prefix extensions/web-agents-extension run typecheck
npm.cmd --prefix extensions/web-agents-extension run build
rg -n -i "roundtable" extensions/web-agents-extension/dist
```

Expected: the tests, typecheck, and build exit `0`; the final `rg` exits `1` because the production build contains no case-insensitive `roundtable` token.

- [ ] **Step 8: Commit**

```powershell
git add -- extensions/web-agents-extension products/plugin/tests/source-release-boundary.test.mjs
git commit -m "refactor: remove roundtable product from normal plugin"
```

---

### Task 4: Create The Product-Neutral Path And Atomic-File Core

**Files:**
- Create: `packages/local-core/package.json`
- Move: `apps/roundtable-web/mcp/path-lock-manager.mjs` to `packages/local-core/src/path-lock-manager.mjs`
- Move: `apps/roundtable-web/mcp/path-lock-manager.test.mjs` to `packages/local-core/test/path-lock-manager.test.mjs`
- Move: `apps/roundtable-web/mcp/real-path-policy.mjs` to `packages/local-core/src/real-path-policy.mjs`
- Move: `apps/roundtable-web/mcp/real-path-policy.test.mjs` to `packages/local-core/test/real-path-policy.test.mjs`
- Create: `packages/local-core/src/atomic-file.mjs`
- Create: `packages/local-core/test/atomic-file.test.mjs`
- Modify: `apps/roundtable-web/storage/local-workspace-store.mjs`
- Modify: `apps/roundtable-web/mcp/transaction-manager.mjs`
- Modify: root `package.json` and `package-lock.json`

**Interfaces:**
- Produces: `canonicalizeWindowsPath(value)`, `canonicalPathKeys(paths)`, `PathLockManager`, `resolvePathIdentity(value, options)`, `assertMutationPathIdentity(identity)`, `atomicWriteFile(filePath, content, options)`, and `atomicWriteJson(filePath, value, options)` through public package exports.

- [ ] **Step 1: Add the workspace and local-core package**

Root package adds:

```json
{
  "workspaces": ["packages/*", "products/*", "products/*/*"]
}
```

Create `packages/local-core/package.json`:

```json
{
  "name": "@web-agents/local-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./paths": "./src/path-lock-manager.mjs",
    "./real-paths": "./src/real-path-policy.mjs",
    "./atomic-file": "./src/atomic-file.mjs"
  },
  "scripts": {
    "test": "node --test test/*.test.mjs"
  }
}
```

Run `npm.cmd install --package-lock-only` and `npm.cmd install --ignore-scripts` so workspace links exist without running product builds.

- [ ] **Step 2: Move path modules and make imports package-relative**

Use `git mv` for the four path files. In `real-path-policy.mjs`, replace `./path-lock-manager.mjs` with `./path-lock-manager.mjs` unchanged because both files remain in one package. Update all external imports to:

```js
import { canonicalizeWindowsPath, PathLockManager } from "@web-agents/local-core/paths";
import { assertMutationPathIdentity, resolvePathIdentity } from "@web-agents/local-core/real-paths";
```

- [ ] **Step 3: Add failing atomic-file tests using the existing Windows conflict cases**

Move the atomic replacement assertions currently duplicated in `transaction-manager.test.mjs` and `local-workspace-store.test.mjs` into `packages/local-core/test/atomic-file.test.mjs`. Include this install-failure case:

```js
test("atomic write restores the original when installing the replacement fails", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-atomic-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "state.json");
  await fs.writeFile(target, "original", "utf8");
  let renameCall = 0;
  const fileSystem = {
    ...fs,
    async rename(from, to) {
      renameCall += 1;
      if (renameCall === 1) throw Object.assign(new Error("target exists"), { code: "EEXIST" });
      if (renameCall === 3) throw Object.assign(new Error("install failed"), { code: "EPERM" });
      return fs.rename(from, to);
    },
  };
  await assert.rejects(() => atomicWriteFile(target, "replacement", { fileSystem, idFactory: () => `id-${renameCall}` }), /install failed/);
  assert.equal(await fs.readFile(target, "utf8"), "original");
});
```

Run: `npm.cmd --workspace @web-agents/local-core test`

Expected: FAIL because `atomic-file.mjs` does not exist.

- [ ] **Step 4: Implement one atomic-file API**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWriteFile(filePath, content, {
  fileSystem = fs,
  idFactory = randomUUID,
} = {}) {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${idFactory()}.tmp`);
  const recovery = path.join(directory, `.${path.basename(filePath)}.${idFactory()}.recovery`);
  await fileSystem.mkdir(directory, { recursive: true });
  await fileSystem.writeFile(temporary, content);
  try {
    await fileSystem.rename(temporary, filePath);
  } catch (firstError) {
    try {
      await fileSystem.rename(filePath, recovery);
      await fileSystem.rename(temporary, filePath);
      await fileSystem.rm(recovery, { force: true });
    } catch (secondError) {
      await fileSystem.rename(recovery, filePath).catch(() => {});
      await fileSystem.rm(temporary, { force: true }).catch(() => {});
      secondError.cause = firstError;
      throw secondError;
    }
  }
}

export async function atomicWriteJson(filePath, value, options) {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}
```

Reuse this API from the workspace store and transaction manager; delete their private atomic-write implementations.

- [ ] **Step 5: Run focused and roundtable regression tests**

```powershell
npm.cmd --workspace @web-agents/local-core test
node --test apps/roundtable-web/storage/*.test.mjs apps/roundtable-web/mcp/transaction-manager.test.mjs scripts/web-agent-filesystem-server.test.mjs
```

Expected: zero failures.

- [ ] **Step 6: Commit**

```powershell
git add -- package.json package-lock.json packages/local-core apps/roundtable-web scripts/web-agent-filesystem-server.mjs scripts/web-agent-filesystem-server.test.mjs
git commit -m "refactor: extract shared path and atomic file core"
```

---

### Task 5: Move Permissions, Transactions, And Filesystem Tools Into Local Core

**Files:**
- Move: `apps/roundtable-web/mcp/permission-broker.mjs` to `packages/local-core/src/permission-broker.mjs`
- Move: its test to `packages/local-core/test/permission-broker.test.mjs`
- Move: `apps/roundtable-web/mcp/tool-registry.mjs` to `packages/local-core/src/tool-registry.mjs`
- Move: its test to `packages/local-core/test/tool-registry.test.mjs`
- Move: `apps/roundtable-web/mcp/transaction-manager.mjs` to `packages/local-core/src/transaction-manager.mjs`
- Move: its test to `packages/local-core/test/transaction-manager.test.mjs`
- Move/Refactor: `scripts/web-agent-permission-store.mjs` into `packages/local-core/src/permission-store.mjs`
- Create: `packages/local-core/src/filesystem-tools.mjs`
- Create: `packages/local-core/test/filesystem-tools.test.mjs`
- Create: `packages/local-core/test/no-product-dependencies.test.mjs`
- Modify: `scripts/web-agent-filesystem-server.mjs`
- Modify: `scripts/web-agent-filesystem-http-server.mjs`
- Modify: `apps/roundtable-web/server.mjs`
- Modify: `apps/roundtable-web/mcp/tool-loop.mjs`

**Interfaces:**
- Produces: public exports `./permissions`, `./permission-store`, `./transactions`, `./tool-registry`, and `./filesystem-tools`.
- `createFilesystemTools(options)` returns `{ definitions, call(name, args, context) }`.
- `PermissionBroker` accepts `{ requestKind = "local_permission_request", ...options }`; roundtable passes `roundtable_permission_request` from its adapter.

- [ ] **Step 1: Extend package exports before moving consumers**

```json
{
  "exports": {
    "./paths": "./src/path-lock-manager.mjs",
    "./real-paths": "./src/real-path-policy.mjs",
    "./atomic-file": "./src/atomic-file.mjs",
    "./permissions": "./src/permission-broker.mjs",
    "./permission-store": "./src/permission-store.mjs",
    "./transactions": "./src/transaction-manager.mjs",
    "./tool-registry": "./src/tool-registry.mjs",
    "./filesystem-tools": "./src/filesystem-tools.mjs"
  }
}
```

- [ ] **Step 2: Add a failing no-product-dependencies test**

```js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

test("local core has no product runtime dependency", async () => {
  for (const name of await fs.readdir(root)) {
    if (!name.endsWith(".mjs")) continue;
    const source = await fs.readFile(path.join(root, name), "utf8");
    assert.doesNotMatch(source, /products[\\/]|apps[\\/]|extensions[\\/]|chrome\.|document\.|localhost|127\.0\.0\.1|\b(?:3006|3017|3020|8931|9223)\b/i, name);
    assert.doesNotMatch(source, /node:http|createServer\s*\(/, name);
  }
});
```

- [ ] **Step 3: Move generic managers and make request kind injectable**

Use `git mv` for broker, registry, transaction manager, permission store, and their tests. Replace relative path/atomic imports with package-local imports. Change the broker constructor to store `this.requestKind = options.requestKind || "local_permission_request"` and use `kind: this.requestKind` when creating a request; remove the hard-coded roundtable kind from shared code.

- [ ] **Step 4: Extract filesystem tool execution from the stdio server**

Move tool definitions, path normalization, read/write/edit/move/search operations, permission marker builders, and `callTool` implementation into `filesystem-tools.mjs`. Replace module-level product paths with the factory:

```js
export function createFilesystemTools({
  repoRoot,
  configFile,
  permissionStoreDir,
  auditFile,
}) {
  if (!repoRoot || !configFile || !permissionStoreDir || !auditFile) {
    throw new Error("FILESYSTEM_TOOL_PATHS_REQUIRED");
  }
  const runtime = {
    repoRoot: path.resolve(repoRoot),
    configFile: path.resolve(configFile),
    permissionStoreDir: path.resolve(permissionStoreDir),
    auditFile: path.resolve(auditFile),
  };
  return {
    definitions: toolDefinitions,
    call(name, args = {}, context = {}) {
      return callToolImpl(name, args, { ...runtime, ...context });
    },
  };
}
```

Change audit writes to accept `auditFile` from runtime. Shared code must not derive `generated`, `config`, or repository paths itself.

Add this factory contract test before the implementation and verify it fails with a missing export:

```js
test("filesystem tools require product-owned paths", () => {
  assert.throws(() => createFilesystemTools({}), /FILESYSTEM_TOOL_PATHS_REQUIRED/);
});
```

- [ ] **Step 5: Make the old stdio/HTTP files thin adapters**

The stdio adapter constructs `createFilesystemTools` with its current plugin defaults and retains JSON-RPC framing only. The HTTP adapter receives a filesystem runtime through `createFilesystemHttpServer({ filesystemTools, ...options })` and calls `filesystemTools.call`; it no longer imports product-neutral internals by relative path.

- [ ] **Step 6: Update roundtable imports**

Use:

```js
import { PermissionBroker } from "@web-agents/local-core/permissions";
import { TransactionManager } from "@web-agents/local-core/transactions";
import { defaultToolRegistry } from "@web-agents/local-core/tool-registry";
import { createFilesystemTools, CONTROLLER_TOOL_CAPABILITY } from "@web-agents/local-core/filesystem-tools";
```

Create one roundtable filesystem runtime from the selected workspace paths. Pass `requestKind: "roundtable_permission_request"` to the broker and `controllerCapability` only after the roundtable broker authorizes the transaction.

- [ ] **Step 7: Run all core and affected adapter tests**

```powershell
npm.cmd --workspace @web-agents/local-core test
node --test scripts/web-agent-permission-store.test.mjs scripts/web-agent-filesystem-server.test.mjs scripts/web-agent-filesystem-http-server.test.mjs
npm.cmd run test:roundtable-web
```

Expected: zero failures; core dependency test finds no UI, port, HTTP server, or product path.

- [ ] **Step 8: Commit**

```powershell
git add -- packages/local-core apps/roundtable-web scripts/web-agent-permission-store.mjs scripts/web-agent-permission-store.test.mjs scripts/web-agent-filesystem-server.mjs scripts/web-agent-filesystem-server.test.mjs scripts/web-agent-filesystem-http-server.mjs scripts/web-agent-filesystem-http-server.test.mjs package.json package-lock.json
git commit -m "refactor: centralize filesystem safety in local core"
```

---

### Task 6: Move And Package The Normal Plugin Product

**Files:**
- Move: `extensions/web-agents-extension` to `products/plugin/extension`
- Move: `extensions/mcp-superassistant-local-fixed` to `products/plugin/legacy-extension`
- Move plugin service adapters from `scripts/` to `products/plugin/services/`
- Move corresponding tests to `products/plugin/tests/`
- Create: `products/plugin/services/start-plugin-services.mjs`
- Create: `products/plugin/services/start-plugin-services.test.mjs`
- Create: `products/plugin/services/plugin-gateway.mjs`
- Create: `products/plugin/start-plugin.bat`
- Create: `products/plugin/package.json`
- Modify: root `package.json` and `package-lock.json`

**Interfaces:**
- Produces: `npm run test:plugin`, `npm run build:plugin`, and `products/plugin/start-plugin.bat`.
- Plugin services own ports `3006` and `3017` and pass all storage/config paths explicitly to local core.

- [ ] **Step 1: Move plugin-owned directories and adapters**

Use `git mv` for both extension directories and this mapping:

```text
scripts/web-agent-filesystem-server.mjs      -> products/plugin/services/filesystem-stdio-server.mjs
scripts/web-agent-filesystem-http-server.mjs -> products/plugin/services/filesystem-http-server.mjs
scripts/web-agent-config-gateway.mjs         -> products/plugin/services/config-gateway.mjs
scripts/web-agent-image-save-gateway.mjs     -> products/plugin/services/plugin-gateway.mjs
scripts/web-agent-permission-store.mjs       -> products/plugin/services/permission-store-adapter.mjs
```

Move each corresponding `*.test.mjs`, plus result-enhancer, insert-fallback, and background-permission tests, under `products/plugin/tests` or beside its service. Rename the image/config/permission HTTP composition to `plugin-gateway.mjs` and export `createPluginGatewayServer({ productRoot, configDir, dataDir })`; do not export a module-level listening singleton. Update fixture roots to `products/plugin` and imports to package exports.

- [ ] **Step 2: Add a failing plugin service lifecycle test**

```js
test("plugin launcher owns only filesystem and gateway services", async (t) => {
  const services = await startPluginServices({ productRoot, filesystemPort: 0, gatewayPort: 0 });
  t.after(() => services.close());
  assert.deepEqual(Object.keys(services.ports).sort(), ["filesystem", "gateway"]);
  const health = await Promise.all([
    fetch(`http://127.0.0.1:${services.ports.filesystem}/health`).then((response) => response.json()),
    fetch(`http://127.0.0.1:${services.ports.gateway}/health`).then((response) => response.json()),
  ]);
  assert.doesNotMatch(JSON.stringify(health), /roundtable|3020|9223|8931/i);
});
```

The test starts both servers on port `0`, asserts their service identities, then closes them and confirms subsequent health requests reject.

Run: `node --test products/plugin/services/start-plugin-services.test.mjs`

Expected: FAIL because the product-specific service launcher does not exist.

- [ ] **Step 3: Implement the plugin service launcher**

```js
import { once } from "node:events";
import path from "node:path";
import { createFilesystemHttpServer } from "./filesystem-http-server.mjs";
import { createPluginGatewayServer } from "./plugin-gateway.mjs";

async function listen(server, port, host) {
  server.listen(port, host);
  await once(server, "listening");
  return server.address().port;
}

export async function startPluginServices({
  productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  host = "127.0.0.1",
  filesystemPort = 3006,
  gatewayPort = 3017,
} = {}) {
  const configDir = path.join(productRoot, "config");
  const dataDir = path.join(productRoot, "data");
  const filesystem = createFilesystemHttpServer({ productRoot, configDir, dataDir });
  const gateway = createPluginGatewayServer({ productRoot, configDir, dataDir });
  const ports = {
    filesystem: await listen(filesystem, filesystemPort, host),
    gateway: await listen(gateway, gatewayPort, host),
  };
  return {
    ports,
    async close() {
      await Promise.all([filesystem, gateway].map((server) => new Promise((resolve) => server.close(resolve))));
    },
  };
}
```

Add `import { fileURLToPath } from "node:url";` beside the existing imports.

Use per-user/local config paths supplied by the adapter; do not create committed files under `products/plugin/config`.

- [ ] **Step 4: Add the product package**

```json
{
  "name": "@web-agents/plugin-product",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test:legacy": "node --test tests/legacy-*.test.mjs tests/result-*.test.mjs tests/permission-*.test.mjs services/*.test.mjs",
    "test:source": "npm --prefix extension test && npm --prefix extension run typecheck",
    "test": "npm run test:legacy && npm run test:source",
    "build": "npm --prefix extension run build"
  },
  "dependencies": {
    "@web-agents/local-core": "0.1.0"
  }
}
```

Root scripts become `test:plugin` and `build:plugin` workspace delegates.

- [ ] **Step 5: Add the BAT entrypoint**

The BAT sets UTF-8, resolves its own directory, and executes only `services/start-plugin-services.mjs`. It must not start Chrome, Playwright MCP, or the roundtable page.

- [ ] **Step 6: Run plugin-only verification**

```powershell
npm.cmd run test:plugin
npm.cmd run build:plugin
node --test products/plugin/tests/*release-boundary.test.mjs
```

Expected: zero failures; build output contains no roundtable token.

- [ ] **Step 7: Commit**

```powershell
git add -- products/plugin package.json package-lock.json
git add -u -- extensions/web-agents-extension extensions/mcp-superassistant-local-fixed scripts/web-agent-config-gateway.mjs scripts/web-agent-config-gateway.test.mjs scripts/web-agent-filesystem-http-server.mjs scripts/web-agent-filesystem-http-server.test.mjs scripts/web-agent-filesystem-server.mjs scripts/web-agent-filesystem-server.test.mjs scripts/web-agent-image-save-gateway.mjs scripts/web-agent-image-save-gateway.test.mjs scripts/web-agent-permission-store.mjs scripts/web-agent-permission-store.test.mjs scripts/web-agent-insert-fallback.test.mjs scripts/web-agent-result-enhancer.test.mjs scripts/web-agent-background-permission.test.mjs
git commit -m "refactor: package normal plugin as an independent product"
```

---

### Task 7: Move And Package The Roundtable Product

**Files:**
- Move: `apps/roundtable-web` to `products/roundtable/app`
- Move/Rename: roundtable/browser launcher scripts to `products/roundtable/launcher/`
- Move: `scripts/council-browser*` to `products/roundtable/tests/legacy-council/`
- Move: `start-web-agents.bat` to `products/roundtable/start-roundtable.bat`
- Move: `start-web-agents-browser.bat` to `products/roundtable/launcher/start-browser.bat`
- Create: `products/roundtable/package.json`
- Create: `products/roundtable/README.md`
- Modify: root `package.json` and `package-lock.json`

**Interfaces:**
- Produces: `npm run test:roundtable`, `npm run start:roundtable`, and roundtable-local launcher paths.

- [ ] **Step 1: Move the application and launcher files with history**

Use `git mv` with these exact launcher names:

```text
scripts/start-web-agents-roundtable.ps1      -> products/roundtable/launcher/start-roundtable.ps1
scripts/start-web-agents-roundtable.test.mjs -> products/roundtable/launcher/start-roundtable.test.mjs
scripts/start-web-agents-browser.ps1         -> products/roundtable/launcher/start-browser.ps1
scripts/start-web-agents-browser.test.mjs    -> products/roundtable/launcher/start-browser.test.mjs
scripts/start-web-agents-local-services.mjs  -> products/roundtable/launcher/start-roundtable-services.mjs
scripts/start-web-agents-local-services.test.mjs -> products/roundtable/launcher/start-roundtable-services.test.mjs
scripts/web-agents-native-process.ps1        -> products/roundtable/launcher/native-process.ps1
```

After the move, `server.mjs` calculates repository root with `path.resolve(__dirname, "..", "..", "..")`; public assets remain `path.join(__dirname, "public")`. Launcher scripts calculate product root first and repository root as three levels above `launcher`.

- [ ] **Step 2: Replace every old path reference**

Run:

```powershell
rg -n "apps/roundtable-web|scripts/start-web-agents|extensions/mcp-superassistant-local-fixed|extensions/web-agents-extension" products/roundtable package.json
```

Expected before edits: matches identify every stale path. Update tests, PowerShell entrypoints, fixture roots, docs, and package scripts until the command exits with no matches except migration-history documentation.

- [ ] **Step 3: Add the roundtable product package**

```json
{
  "name": "@web-agents/roundtable-product",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node app/server.mjs",
    "test:core": "node --test app/server.test.mjs app/server-runtime.test.mjs app/server-workspace.test.mjs app/storage/*.test.mjs app/orchestrator/*.test.mjs app/mcp/*.test.mjs app/public/*.test.mjs app/automation/browser-manager.test.mjs app/automation/provider-concurrency.test.mjs app/automation/controller-tool-worker.test.mjs app/automation/completion-detector.test.mjs app/automation/extension-relay.test.mjs app/automation/extension-browser-manager.test.mjs app/automation/extension-worker.test.mjs",
    "test:browser": "node --test app/automation/worker.e2e.test.mjs app/automation/roundtable-fake.e2e.test.mjs",
    "test:compat": "node --test compat-extension/test/*.test.mjs",
    "test:launcher": "node --test launcher/*.test.mjs",
    "test": "npm run test:core && npm run test:browser && npm run test:launcher"
  },
  "dependencies": {
    "@playwright/mcp": "0.0.78",
    "@web-agents/local-core": "0.1.0",
    "playwright": "^1.61.1"
  }
}
```

Note that `test` intentionally excludes `test:compat`; compatibility verification is available but is not part of default roundtable acceptance.

- [ ] **Step 4: Update BAT and PowerShell entrypoints**

The primary BAT invokes `launcher/start-roundtable.ps1`. The browser BAT invokes `launcher/start-browser.ps1`. Neither entrypoint resolves or loads a normal plugin directory. Dedicated profile defaults to `products/roundtable/data/browser-profile` or an explicit user-local override ignored by Git.

- [ ] **Step 5: Run moved application tests**

```powershell
npm.cmd run test:roundtable
npm.cmd --workspace @web-agents/roundtable-product run test:compat
```

Expected: default tests pass without loading either extension; compatibility tests pass separately.

- [ ] **Step 6: Commit**

```powershell
git add -- products/roundtable package.json package-lock.json
git add -u -- apps/roundtable-web scripts/start-web-agents-browser.ps1 scripts/start-web-agents-browser.test.mjs scripts/start-web-agents-local-services.mjs scripts/start-web-agents-local-services.test.mjs scripts/start-web-agents-roundtable.ps1 scripts/start-web-agents-roundtable.test.mjs scripts/web-agents-native-process.ps1 scripts/council-browser.mjs scripts/council-browser.ps1 scripts/council-browser.test.mjs start-web-agents.bat start-web-agents-browser.bat
git commit -m "refactor: package roundtable as an independent product"
```

---

### Task 8: Split Runtime Lifecycles And Remove Plugin Ports From Roundtable

**Files:**
- Modify: `products/roundtable/launcher/start-roundtable-services.mjs`
- Modify: `products/roundtable/launcher/start-roundtable.ps1`
- Modify: `products/roundtable/launcher/start-roundtable.test.mjs`
- Modify: `products/roundtable/app/server.mjs`
- Modify: `products/roundtable/app/server-runtime.test.mjs`
- Modify: `products/plugin/services/start-plugin-services.mjs`
- Create: `tools/product-runtime-isolation.test.mjs`
- Modify: both product READMEs

**Interfaces:**
- Roundtable health returns only `roundtable`, `chromeCdp`, and `playwrightMcp` runtime components.
- Plugin health returns only `filesystem` and `gateway` components.

- [ ] **Step 1: Add failing roundtable and cross-product runtime-isolation tests**

Inside roundtable launcher tests, assert that roundtable startup never binds 3006/3017, its health JSON has no `filesystem` or `gateway` fields, and roundtable source contains no import from `products/plugin`. Put the cross-product test at repository level so neither product imports the other:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { startPluginServices } from "../products/plugin/services/start-plugin-services.mjs";
import { startRoundtableServices } from "../products/roundtable/launcher/start-roundtable-services.mjs";

test("plugin and roundtable lifecycles are independent", async (t) => {
  const plugin = await startPluginServices({ filesystemPort: 0, gatewayPort: 0 });
  const roundtable = await startRoundtableServices({ roundtablePort: 0, skipPlaywrightMcp: true });
  t.after(() => Promise.allSettled([plugin.close(), roundtable.close()]));

  assert.deepEqual(Object.keys(plugin.ports).sort(), ["filesystem", "gateway"]);
  assert.equal("filesystem" in roundtable.ports, false);
  assert.equal("gateway" in roundtable.ports, false);

  await plugin.close();
  assert.equal((await fetch(roundtable.healthUrl)).ok, true);
});
```

Run the new test and expect FAIL because the existing `startLocalServices` starts all five services together.

- [ ] **Step 2: Implement the roundtable-only service launcher**

Refactor the existing launcher module to start only:

```js
const roundtableServer = createRoundtableServer({
  repoRoot,
  browserMode: "cdp",
  browserCdpEndpoint: `http://${host}:${cdpPort}`,
  localServicesProvider: async () => ({
    roundtable: { port: roundtablePort, healthy: true },
    chromeCdp: { port: cdpPort, healthy: await httpReady(`http://${host}:${cdpPort}/json/version`) },
    playwrightMcp: { port: playwrightMcpPort, healthy: await tcpReady(host, playwrightMcpPort) },
  }),
});

const actualPort = await listen(roundtableServer, roundtablePort, host);
return {
  ports: { roundtable: actualPort, chromeCdp: cdpPort, playwrightMcp: playwrightMcpPort },
  healthUrl: `http://${host}:${actualPort}/api/health`,
  async close() {
    if (playwrightProcess && !playwrightProcess.killed) playwrightProcess.kill();
    await closeServer(roundtableServer);
  },
};
```

Do not construct filesystem or gateway servers. Roundtable file operations use the in-process local-core runtime configured from the selected workspace.

- [ ] **Step 3: Narrow PowerShell identity checks and stop behavior**

Change launcher health matching from five endpoints to `3020`, `9223`, and `8931`. Retain native process/TCP identity, command-line, parent PID, creation time, foreign-listener refusal, and verified process-tree stop protections.

- [ ] **Step 4: Add bounded phase timing to the dynamic launcher test**

Wrap `start`, `reuse`, `restart`, and `stop` calls with `performance.now()`. Assert each call is below 30 seconds and the whole chain is below 90 seconds. When a threshold fails, print JSON containing the four durations and process counts; do not raise timeouts to accept the prior 252-second behavior.

- [ ] **Step 5: Run independent and concurrent lifecycles**

```powershell
npm.cmd run test:plugin
npm.cmd run test:roundtable
node --test products/roundtable/launcher/start-roundtable.test.mjs
node --test tools/product-runtime-isolation.test.mjs
```

Expected: zero failures; plugin can stop while roundtable remains healthy and vice versa.

- [ ] **Step 6: Commit**

```powershell
git add -- products/plugin products/roundtable tools/product-runtime-isolation.test.mjs
git commit -m "refactor: isolate plugin and roundtable lifecycles"
```

---

### Task 9: Enforce Repository Boundaries And Independent Data

**Files:**
- Create: `tools/check-product-boundaries.mjs`
- Create: `tools/check-product-boundaries.test.mjs`
- Create: `products/plugin/config/README.md`
- Create: `products/roundtable/config/README.md`
- Modify: `.gitignore`
- Modify: root `package.json`
- Modify: product READMEs

**Interfaces:**
- Produces: `npm run check:boundaries`, `npm run test:core`, `npm run test:plugin`, `npm run test:roundtable`, and `npm run test:all`.

- [ ] **Step 1: Add failing boundary-checker fixtures**

Create temporary fixture trees and use this table-driven assertion:

```js
for (const fixture of [
  ["plugin-imports-roundtable", "products/plugin/index.mjs", 'import "@web-agents/roundtable";'],
  ["roundtable-imports-plugin", "products/roundtable/index.mjs", 'import "@web-agents/plugin";'],
  ["core-imports-product", "packages/local-core/src/index.mjs", 'import "../../../products/plugin/index.mjs";'],
  ["normal-manifest-has-roundtable", "products/plugin/legacy-extension/manifest.json", '{"name":"roundtable"}'],
]) {
  test(`rejects ${fixture[0]}`, async (t) => {
    const root = await createValidFixture(t);
    await writeFixture(root, fixture[1], fixture[2]);
    await assert.rejects(() => checkProductBoundaries({ repoRoot: root }), /PRODUCT_BOUNDARY_VIOLATION/);
  });
}

test("accepts products that share only local-core exports", async (t) => {
  const root = await createValidFixture(t);
  await writeFixture(root, "products/plugin/index.mjs", 'import "@web-agents/local-core/paths";');
  await writeFixture(root, "products/roundtable/index.mjs", 'import "@web-agents/local-core/paths";');
  assert.deepEqual(await checkProductBoundaries({ repoRoot: root }), { ok: true, violations: [] });
});
```

`createValidFixture` writes empty normal manifests and a roundtable package whose default `test` script is `node --test`; `writeFixture` creates parent directories before writing UTF-8.

- [ ] **Step 2: Implement the static boundary checker**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set(["node_modules"]);
const STATIC_IMPORT = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

async function walkFiles(root) {
  const output = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const item = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(item));
    else output.push(item);
  }
  return output;
}

async function scanImports(root, inspect) {
  for (const file of await walkFiles(root)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(STATIC_IMPORT)) inspect(match[1] || match[2], file);
  }
}

async function scanCoreForProductTerms(root, violations) {
  const forbidden = /products[\\/]|apps[\\/]|extensions[\\/]|node:http|chrome\.|document\.|localhost|127\.0\.0\.1|\b(?:3006|3017|3020|8931|9223)\b/i;
  for (const file of await walkFiles(root)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
    const source = await fs.readFile(file, "utf8");
    if (forbidden.test(source)) violations.push({ file, rule: "product-neutral-core" });
  }
}

async function checkNormalPluginManifests(root, violations) {
  for (const file of await walkFiles(root)) {
    if (path.basename(file) !== "manifest.json") continue;
    const source = await fs.readFile(file, "utf8");
    if (/roundtable/i.test(source)) violations.push({ file, rule: "normal-plugin-roundtable-manifest" });
  }
  for (const directory of ["extension/src", "extension/public", "extension/dist", "legacy-extension"]) {
    for (const file of await walkFiles(path.join(root, directory))) {
      if (!/\.(?:js|mjs|ts|tsx|json|css)$/.test(file)) continue;
      const source = await fs.readFile(file, "utf8");
      if (/roundtable/i.test(source)) violations.push({ file, rule: "normal-plugin-roundtable-code" });
    }
  }
}

export async function checkProductBoundaries({ repoRoot }) {
  const violations = [];
  await scanImports(path.join(repoRoot, "products/plugin"), (specifier, file) => {
    if (specifier.includes("products/roundtable") || specifier.includes("@web-agents/roundtable")) violations.push({ file, specifier });
  });
  await scanImports(path.join(repoRoot, "products/roundtable"), (specifier, file) => {
    if (specifier.includes("products/plugin") || specifier.includes("@web-agents/plugin")) violations.push({ file, specifier });
  });
  await scanCoreForProductTerms(path.join(repoRoot, "packages/local-core/src"), violations);
  await checkNormalPluginManifests(path.join(repoRoot, "products/plugin"), violations);
  const roundtablePackage = JSON.parse(await fs.readFile(path.join(repoRoot, "products/roundtable/package.json"), "utf8"));
  if (/test:compat/.test(roundtablePackage.scripts?.test || "")) {
    violations.push({ file: "products/roundtable/package.json", rule: "compat-in-default-test" });
  }
  if (violations.length) {
    const error = new Error("PRODUCT_BOUNDARY_VIOLATION");
    error.violations = violations;
    throw error;
  }
  return { ok: true, violations: [] };
}

const currentFile = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] || "") === currentFile) {
  await checkProductBoundaries({ repoRoot: path.resolve(path.dirname(currentFile), "..") });
  console.log("Product boundaries: OK");
}
```

Parse ESM import/export specifiers with a bounded regex covering static imports used in this repository; separately scan manifest JSON and emitted plugin build files for forbidden roundtable tokens.

- [ ] **Step 3: Separate config and data documentation**

Plugin README states that its local files live under plugin-owned config/data and ports 3006/3017. Roundtable README states that session data lives under `<workspace>/.web-agents`, browser/log data belongs to roundtable, and ports are 3020/9223/8931. Neither README tells one product to start the other.

- [ ] **Step 4: Add root aggregation scripts**

```json
{
  "scripts": {
    "check:boundaries": "node tools/check-product-boundaries.mjs",
    "test:core": "npm --workspace @web-agents/local-core test",
    "test:plugin": "npm --workspace @web-agents/plugin-product test",
    "test:roundtable": "npm --workspace @web-agents/roundtable-product test",
    "test:all": "npm run check:boundaries && npm run test:core && npm run test:plugin && npm run test:roundtable"
  }
}
```

- [ ] **Step 5: Run boundary and product tests**

```powershell
node --test tools/check-product-boundaries.test.mjs
npm.cmd run check:boundaries
npm.cmd run test:all
```

Expected: zero violations and zero test failures.

- [ ] **Step 6: Commit**

```powershell
git add -- tools products/plugin/config products/roundtable/config products/plugin/README.md products/roundtable/README.md .gitignore package.json package-lock.json
git commit -m "test: enforce plugin and roundtable boundaries"
```

---

### Task 10: Real Acceptance, Evidence, And Worktree Cleanup

**Files:**
- Modify: `.adworkflow/task_spec.json`
- Modify: `.adworkflow/execution_plan.json`
- Modify: `.adworkflow/worker_state.json`
- Modify: `.adworkflow/verification_result.json`
- Modify: `.adworkflow/review_findings.json`
- Modify: `.adworkflow/impact_report.json`
- Modify: `docs/web-agents-development-plan.md`
- Modify: both product READMEs

**Interfaces:**
- Produces: auditable proof that both products run independently and the obsolete rewrite worktree is not required.

- [ ] **Step 1: Run syntax, boundary, and complete automated verification**

```powershell
npm.cmd run check:boundaries
npm.cmd run test:core
npm.cmd run test:plugin
npm.cmd run build:plugin
npm.cmd run test:roundtable
npm.cmd --workspace @web-agents/roundtable-product run test:compat
git diff --check
```

Expected: every command exits `0`; compatibility tests remain separate from default roundtable tests.

- [ ] **Step 2: Run normal plugin real-browser smoke**

Load only `products/plugin/legacy-extension` first, then the source build. On a non-sensitive provider test page, verify the normal in-page UI, insert, attachment entry, settings, MCP connection, permission request, approval, one retry, and result card. Confirm no roundtable UI appears and no request reaches port 3020.

- [ ] **Step 3: Run roundtable without extensions**

Disable both normal plugin and compatibility extension in the dedicated Chrome Profile. Start `products/roundtable/start-roundtable.bat`, bind approved DeepSeek/Doubao test tabs, execute one discussion turn, one relay turn, one in-workspace filesystem transaction, and one rollback. Confirm no extension relay registration and no dependency on ports 3006/3017.

- [ ] **Step 4: Run simultaneous-product acceptance**

Start plugin services and roundtable. Verify all five owned ports are held by the correct product, stop plugin services and confirm roundtable remains healthy, restart plugin services, stop roundtable and confirm normal plugin filesystem/gateway health remains available.

- [ ] **Step 5: Prune only the stale worktree registration**

Run `git worktree list --porcelain` and confirm `F:/web_agents-new-plugin-rewrite` is marked prunable and absent. Run `git worktree prune --dry-run`, verify it names only the missing worktree metadata, then run `git worktree prune`. Do not delete branch `codex/new-plugin-rewrite` or remote ref `origin/codex/new-plugin-rewrite`.

- [ ] **Step 6: Record evidence and independent review**

Update ADworkflo files with exact commands, pass counts, product versions, port owners, runtime PIDs, browser modes, screenshots, and remaining risks. Run a read-only independent review focused on product-boundary leaks, local-core purity, permission preservation, launcher identity, and accidental inclusion of local data; resolve every high/medium finding before completion.

- [ ] **Step 7: Commit final evidence**

```powershell
git add -- .adworkflow/task_spec.json .adworkflow/execution_plan.json .adworkflow/worker_state.json .adworkflow/verification_result.json .adworkflow/review_findings.json .adworkflow/impact_report.json docs/web-agents-development-plan.md products/plugin/README.md products/roundtable/README.md
git commit -m "docs: record independent product acceptance"
```

---

## Completion Gate

Do not mark the migration complete until all conditions are true:

- `npm run test:plugin` does not start or test the roundtable.
- `npm run test:roundtable` does not load or test either extension.
- Normal plugin source and build contain no case-insensitive `roundtable` token.
- Normal plugin manifests contain no roundtable scripts, 3020 relay access, or roundtable-only permissions.
- Roundtable default runtime owns no plugin ports and imports no plugin product path.
- Local core imports no product and contains no fixed port, UI, HTTP server, Chrome API, or product state.
- Dedicated-Chrome roundtable acceptance succeeds with extensions disabled.
- Plugin and roundtable can start, stop, test, build, version, and roll back independently.
- The stale worktree registration is pruned while `codex/new-plugin-rewrite` branch refs remain intact.
- Every committed change excludes local configuration, user data, generated data, and browser profiles.
