# ADworkflo Verification Commands

## Static And Unit Checks

```powershell
node --check apps/roundtable-web/server.mjs
node --check apps/roundtable-web/public/app.js
node --check apps/roundtable-web/orchestrator/scheduler.mjs
npm.cmd run test:legacy-roundtable-extension
npm.cmd run test:roundtable-web
npm.cmd run test:roundtable-browser
npm.cmd run test:launcher
npm.cmd run test:local-runtime
```

## Launcher Checks

```powershell
$null = [scriptblock]::Create((Get-Content .\scripts\start-web-agents-roundtable.ps1 -Raw -Encoding UTF8))
npm.cmd ls playwright --depth=0
Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

The launcher test must prove custom-port propagation, verified PID reuse, safe restart, safe stop, foreign-listener refusal, invalid data-root rejection, and no leftover test listener.

## Real Provider Acceptance

Use fresh, dedicated conversations in the user's normal Chrome. Credentials, login, CAPTCHA, and human verification remain manual user actions. Do not inspect cookies, tokens, localStorage values, account identity, or authentication response bodies.

1. Run `@ds 先分析如何训练审美` and confirm a captured DeepSeek reply is appended to the ledger.
2. Run a harmless direct Doubao turn and confirm only an assistant reply is appended.
3. Run `@全体 根据 DeepSeek 的观点分别说说看法` with DeepSeek and Doubao and confirm both complete from the same shared prior context.
4. Set relay mode, use DeepSeek or Doubao as host, and confirm the seat order returns to the host for the final report.
5. Write a summary and a temporary MCP artifact under `generated/roundtable-data/acceptance`, verify permission/audit data, then roll the artifact back through the legacy plugin path.
6. Inspect `session.json`, `state.json`, `ledger.jsonl`, reply Markdown, summary Markdown, diagnostics, audit, and indexes under the configured data root.

Live provider testing defaults to fresh DeepSeek and Doubao conversations. Do not operate ChatGPT unless the user explicitly authorizes that exact test and provides a dedicated new conversation.

## Final Runtime Smoke

After real-provider acceptance, create the root BAT, stop the development server, and start through the BAT/PowerShell launcher. Verify:

```powershell
$h = Invoke-RestMethod http://127.0.0.1:3020/api/health
$owner = (Get-NetTCPConnection -State Listen -LocalPort 3020).OwningProcess
if ($h.service -ne 'web-agents-roundtable' -or $h.pid -ne $owner) { throw 'Identity mismatch' }
(Invoke-WebRequest http://127.0.0.1:3020/ -UseBasicParsing).StatusCode
```

## Evidence Policy

- Record exact commands, counts, session IDs, run IDs, file paths, and captured provider outputs.
- Do not mark a real provider as passed from fake-page tests or DOM inspection alone.
- Record manual login/CAPTCHA gates as external actions, never as automated success.
- Do not report the BAT complete before its real 3020 start and identity smoke test pass.
