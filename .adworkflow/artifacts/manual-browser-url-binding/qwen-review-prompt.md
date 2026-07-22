# Final Read-Only Review: Manual Browser URL Binding

You are the independent release reviewer for `F:\web_agents`.

Review only the current task `roundtable-manual-browser-binding`. Do not edit files, do not create files, and do not change git state. The worktree contains unrelated legacy changes, so do not review or propose reverting them.

Read these task inputs first:

- `.adworkflow/task_spec.json`
- `.adworkflow/artifacts/manual-browser-url-binding/requirements.md`
- `docs/superpowers/plans/2026-07-16-manual-browser-url-binding.md`

Then inspect the relevant implementation and tests:

- `apps/roundtable-web/automation/browser-manager.mjs`
- `apps/roundtable-web/automation/browser-manager.test.mjs`
- `apps/roundtable-web/automation/worker.mjs`
- `apps/roundtable-web/automation/worker.e2e.test.mjs`
- `apps/roundtable-web/server.mjs`
- `apps/roundtable-web/server-runtime.test.mjs`
- `apps/roundtable-web/public/index.html`
- `apps/roundtable-web/public/app.js`
- `apps/roundtable-web/public/styles.css`
- `scripts/start-web-agents-browser.ps1`
- `scripts/start-web-agents-browser.test.mjs`
- `start-web-agents-browser.bat`
- `scripts/start-web-agents-roundtable.ps1`
- `package.json`

Acceptance intent:

1. Login-page navigation, login, credentials, and CAPTCHA are entirely user-controlled.
2. Production connects only to a user-started dedicated Chrome over loopback CDP.
3. A pasted URL is not authentication. Binding must find the matching existing tab, validate the provider origin, reject login/verification states, and require a usable composer.
4. Production CDP mode must never create a page, navigate a provider page, retry login, import cookies, or close the user's browser.
5. Returned and persisted URLs must omit query and hash data.
6. Login or verification loss invalidates the binding and requires explicit revalidation.
7. The UI must expose connection and per-provider binding states without auto-binding on reload.
8. The browser launcher must use a dedicated profile and loopback CDP, open no provider URL, reuse only a verified listener, and refuse foreign listeners.

Verification already run by the coordinator:

- `npm.cmd run test:local-runtime`: 79/79 passed (4 + 52 + 8 + 8 + 7).
- Real service restarted on `127.0.0.1:3020` in CDP mode.
- Dedicated Chrome started on `127.0.0.1:9223` with `browser-profiles/roundtable` and no provider URL.
- `/api/browser/connect` succeeded with zero bindings.
- Binding a ChatGPT URL that was not open returned `404 PROVIDER_TAB_NOT_FOUND`; the Chrome tab list remained unchanged.
- Desktop 1280x720 and mobile 390x844 checks found no horizontal overflow or console errors.

Prioritize concrete bugs, security or privacy regressions, behavioral gaps, and missing tests. Report findings first, ordered by severity, with file and line references. Distinguish release blockers from non-blocking residual risk. Do not praise or summarize unrelated code.

End with exactly one verdict line:

`VERDICT: APPROVED`

or

`VERDICT: BLOCKED`
