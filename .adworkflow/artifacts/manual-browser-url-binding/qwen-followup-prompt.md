# Follow-Up Read-Only Review

Review the final hardening delta for task `roundtable-manual-browser-binding` in `F:\web_agents`. Do not edit or create files and do not change git state.

The prior review returned `VERDICT: APPROVED` with only low-severity findings. Since then the coordinator changed only these relevant areas:

- `apps/roundtable-web/automation/browser-manager.mjs`
- `apps/roundtable-web/automation/browser-manager.test.mjs`
- `apps/roundtable-web/server.mjs`
- `apps/roundtable-web/server-runtime.test.mjs`
- `apps/roundtable-web/public/index.html`
- `scripts/start-web-agents-roundtable.test.mjs`

Check specifically that:

1. Successful provider binding returns only provider id, verified status, and a query/hash-redacted URL; page titles or other page data are not returned.
2. A bound CDP page that moves to another origin is invalidated and requires explicit URL revalidation, without creating or navigating any page.
3. Same-provider path changes remain usable and never expose query/hash data.
4. Login URL drift still produces `LOGIN_REQUIRED`, while other invalid drift becomes `PROVIDER_PAGE_NOT_BOUND` for the existing recovery UI.
5. `status()` cannot report a cross-origin page as verified and redacts launch-mode URLs too.
6. Credential-bearing URLs are rejected before login-state classification.
7. CDP `close()` does not close the user's browser, context, or page.
8. The server independently narrows the bind response and sanitizes its URL.
9. Raising the Windows launcher integration-test timeout from 90 to 180 seconds changes no production timeout or safety assertion.

Verification evidence:

- Focused BrowserManager tests: 12/12 passed.
- Focused server runtime tests: 8/8 passed.
- Final `npm.cmd run test:local-runtime`: 84/84 passed in one invocation (4 + 57 + 8 + 8 + 7), with zero failures and zero cancellations.
- Restarting the 3020 service preserved the exact Chrome PID and page target ID on CDP port 9223.

Report findings first, by severity, with file and line references. End with exactly `VERDICT: APPROVED` or `VERDICT: BLOCKED`.
