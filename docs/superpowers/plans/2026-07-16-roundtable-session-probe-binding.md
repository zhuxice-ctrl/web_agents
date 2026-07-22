# Roundtable Session Probe Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the roundtable web page use authenticated tabs in the user's normal Chrome through a minimal Web Agents extension bridge, with automatic provider discovery, login probing, binding, and turn execution.

**Architecture:** Provider authentication is reduced to booleans inside each provider origin. The extension exposes only an allowlisted localhost bridge, while the server retains orchestration and communicates with the extension through a transient in-memory relay serviced by the open roundtable page.

**Tech Stack:** Chrome MV3, TypeScript, Vite, Vitest, Node.js ESM, vanilla browser JavaScript, Node test runner.

---

### Task 1: Provider authentication probes

**Files:**
- Create: `extensions/web-agents-extension/src/auth/page-probes.ts`
- Create: `extensions/web-agents-extension/src/auth/page-probes.test.ts`
- Modify: `extensions/web-agents-extension/src/shared/types.ts`

- [ ] Add a standalone MAIN-world function for ChatGPT, DeepSeek, and Doubao that returns only `{ provider, authenticated, reason }`.
- [ ] Test logged-in, logged-out, endpoint failure, DeepSeek missing token, and Doubao fallback behavior.
- [ ] Assert serialized probe results never contain `accessToken`, bearer values, user IDs, names, or emails.

### Task 2: Extension tab discovery and safe localhost bridge

**Files:**
- Create: `extensions/web-agents-extension/src/bridge/index.ts`
- Create: `extensions/web-agents-extension/src/bridge/protocol.ts`
- Create: `extensions/web-agents-extension/src/bridge/protocol.test.ts`
- Modify: `extensions/web-agents-extension/public/manifest.json`
- Modify: `extensions/web-agents-extension/vite.config.ts`
- Modify: `extensions/web-agents-extension/src/shared/messages.ts`
- Modify: `extensions/web-agents-extension/src/background/index.ts`

- [ ] Add the `scripting` permission and a localhost-only `bridge.js` content script.
- [ ] Add typed messages for provider discovery, provider probing, tab focus, and auth probing.
- [ ] Reuse an existing provider tab before creating a new active tab.
- [ ] Combine MAIN-world authentication with content adapter readiness and redact query/hash values.
- [ ] Restrict localhost bridge requests to the tab/auth/insert/send/capture allowlist.
- [ ] Typecheck, test, and build the unpacked extension.

### Task 3: In-memory server relay

**Files:**
- Create: `apps/roundtable-web/automation/extension-relay.mjs`
- Create: `apps/roundtable-web/automation/extension-relay.test.mjs`
- Modify: `apps/roundtable-web/server.mjs`
- Modify: `apps/roundtable-web/server-runtime.test.mjs`

- [ ] Implement client registration, heartbeat, polling, command completion, timeout, stale-client cleanup, and close behavior.
- [ ] Add loopback endpoints under `/api/extension/*` and keep every request JSON-only.
- [ ] Ensure command payloads and results remain memory-only and are rejected for unknown request types.
- [ ] Test unavailable bridge, successful round trip, timeout, and client disconnect.

### Task 4: Extension browser manager and worker

**Files:**
- Create: `apps/roundtable-web/automation/extension-browser-manager.mjs`
- Create: `apps/roundtable-web/automation/extension-browser-manager.test.mjs`
- Create: `apps/roundtable-web/automation/extension-worker.mjs`
- Create: `apps/roundtable-web/automation/extension-worker.test.mjs`
- Modify: `apps/roundtable-web/core/providers.mjs`
- Modify: `apps/roundtable-web/server.mjs`

- [ ] Add `extension` as an execution mode while preserving `playwright` and `mock`.
- [ ] Bind only authenticated, composer-ready provider tabs and retain tab IDs instead of Playwright pages.
- [ ] Verify authentication before every turn and invalidate stale bindings.
- [ ] Execute insert/send/capture through relay commands and require a stable response different from baseline.
- [ ] Map bridge, login, composer, and timeout failures into existing recovery codes.

### Task 5: Web connection page and relay client

**Files:**
- Modify: `apps/roundtable-web/public/index.html`
- Modify: `apps/roundtable-web/public/app.js`
- Modify: `apps/roundtable-web/public/styles.css`

- [ ] Add extension bridge discovery and a per-page relay client.
- [ ] Replace primary pasted-URL controls with provider cards containing open/focus, automatic probe, bind, retry, and disconnect actions.
- [ ] Show bridge missing, page missing, needs login, human verification, checking, ready, and bound states.
- [ ] Keep the CDP URL input in an advanced fallback section.
- [ ] Poll login state only while a provider is unbound or blocked, and stop polling when the page is hidden.

### Task 6: Verification and release evidence

**Files:**
- Modify: `package.json`
- Modify: `.adworkflow/worker_state.json`
- Modify: `.adworkflow/verification_result.json`
- Modify: `.adworkflow/review_findings.json`

- [ ] Run extension tests, typecheck, and build.
- [ ] Run focused roundtable server/relay/worker tests.
- [ ] Run `npm.cmd run test:local-runtime`.
- [ ] Restart the local service in extension mode and inspect desktop/mobile UI with browser tooling.
- [ ] Verify real tabs return only provider ID, redacted URL, booleans, and reason codes.
- [ ] Record remaining provider-private-API drift risk and manual CAPTCHA boundary.
