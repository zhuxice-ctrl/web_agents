# Manual Browser URL Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users own provider navigation, login, and human verification while the roundtable binds and controls only an already-open, validated provider tab.

**Architecture:** Production uses a loopback CDP connection to a dedicated Chrome process started manually by the user. The BrowserManager keeps launch mode for deterministic fake-provider tests, adds CDP mode for production, and requires an explicit URL binding before `getPage` can return a provider page. The server and UI expose connect/bind state without opening or navigating provider pages.

**Tech Stack:** Node.js 24 ESM, Playwright CDP, Chrome remote debugging on loopback, static HTML/CSS/JavaScript, Node test runner, PowerShell/BAT launchers.

---

### Task 1: Browser Connection And Binding Contract

**Files:**
- Modify: `apps/roundtable-web/automation/browser-manager.mjs`
- Create: `apps/roundtable-web/automation/browser-manager.test.mjs`

- [x] Add failing tests for CDP unavailable, exact existing-tab matching, provider-origin rejection, query/hash redaction, and `getPage` refusing an unbound provider.
- [x] Add `mode`, `cdpEndpoint`, injectable `connectOverCDP`, `connect()`, `bindProviderPage()`, `unbindProvider()`, and sanitized `status()` behavior.
- [x] Keep the current launch path behind `mode: "launch"` for fake-provider tests.
- [x] Prove CDP mode never calls `newPage()` or `goto()`.

### Task 2: Worker Binding Safety

**Files:**
- Modify: `apps/roundtable-web/automation/worker.mjs`
- Modify: `apps/roundtable-web/automation/worker.e2e.test.mjs`

- [x] Add a failing test that a missing binding returns `PROVIDER_PAGE_NOT_BOUND` without browser navigation.
- [x] Ensure production requests obtain only a bound page and invalidate the binding after `LOGIN_REQUIRED` or `HUMAN_VERIFICATION_REQUIRED`.
- [x] Keep stale-composer recovery on the same bound page; do not reacquire by navigation.

### Task 3: Connect And Bind HTTP API

**Files:**
- Modify: `apps/roundtable-web/server.mjs`
- Modify: `apps/roundtable-web/server-runtime.test.mjs`

- [x] Replace production `/api/browser/open` behavior with `POST /api/browser/connect` and `POST /api/browser/bind`.
- [x] Make `/api/browser/open` return a migration error and never open a page.
- [x] Validate `{ providerId, url }`, bind an existing tab, run login/verification/composer checks, and return only sanitized URL state.
- [x] Include connection mode, endpoint, and provider bindings in health/status responses without exposing query/hash.

### Task 4: Manual Chrome Launcher

**Files:**
- Create: `scripts/start-web-agents-browser.ps1`
- Create: `scripts/start-web-agents-browser.test.mjs`
- Create: `start-web-agents-browser.bat`
- Modify: `package.json`

- [x] Add a PowerShell launcher for normal Chrome with `--remote-debugging-address=127.0.0.1`, a fixed local CDP port, and the dedicated `browser-profiles/roundtable` profile.
- [x] Do not pass any provider or login URL.
- [x] Reuse an existing verified CDP listener and refuse a foreign listener.
- [x] Add BAT forwarding with UTF-8 console setup and launcher tests.

### Task 5: URL Binding UI

**Files:**
- Modify: `apps/roundtable-web/public/index.html`
- Modify: `apps/roundtable-web/public/app.js`
- Modify: `apps/roundtable-web/public/styles.css`

- [x] Replace “打开模型” with “连接浏览器”.
- [x] Add one URL input and verify button per MVP provider, with unbound, verifying, verified, and blocked states.
- [x] Save only sanitized provider URLs in localStorage and never auto-bind or auto-navigate on reload.
- [x] Replace recovery “打开模型页面” with a binding-state prompt and explicit revalidation before retry.

### Task 6: Verification And Evidence

**Files:**
- Modify: `.adworkflow/worker_state.json`
- Modify: `.adworkflow/verification_result.json`
- Modify: `.adworkflow/review_findings.json`

- [x] Run focused BrowserManager, server, worker, launcher, and UI checks.
- [x] Run `npm.cmd run test:local-runtime` and record exact counts.
- [ ] Start the manual browser script, let the user log in, bind a pasted real URL, and run a single-provider acceptance turn.
- [x] Verify desktop and 390x844 mobile layouts, console health, and no horizontal overflow.
- [x] Run a final read-only `qwen3.7-max` review and record findings.
