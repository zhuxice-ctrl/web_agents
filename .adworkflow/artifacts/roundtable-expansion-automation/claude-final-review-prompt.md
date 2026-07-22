# Final read-only review

Review the current `F:\web_agents` working tree against:

- `.adworkflow/task_spec.json`
- `.adworkflow/review_checklist.md`
- `docs/superpowers/specs/2026-07-17-roundtable-expansion-design.md`
- `docs/superpowers/plans/2026-07-17-roundtable-expansion-implementation.md`

Do not edit, create, delete, stage, or commit files. Inspect the actual implementation, including untracked files. Focus on `apps/roundtable-web`, `scripts/start-web-agents-roundtable.ps1`, `start-web-agents.bat`, the legacy extension compatibility bridge, controller-owned MCP permissions and transactions, run recovery, concurrency, session persistence, routing semantics, and launcher process safety.

Look specifically for P0/P1/P2 correctness or security defects, stale-session overwrites, duplicate provider submissions after restart, permission bypasses, rollback corruption, unsafe external writes, wrong `@` routing, thread handoff loss, process-tree misidentification, and missing tests that could hide those defects.

For every finding provide severity, exact file and line, a concrete failure path, and the smallest sound fix. Do not report missing live ChatGPT automation as a defect because it is intentionally excluded without fresh action-time authorization. If there are no unresolved P0/P1/P2 findings, say `APPROVE` explicitly and list only residual P3 risks or verification boundaries.

Security fixes already applied after an earlier independent `REQUEST CHANGES` review include: HTTP MCP origin/content-type/mutation authorization, junction/symlink fail-closed path identity, physical-path transaction locking, ArtifactWriter transaction routing and binary rollback, write authority only on closure/host-summary turns, low-confidence mutation blocking, recoverable Windows atomic replacement, and launch-receipt-based cleanup of only the Chrome started by a failed invocation. Re-audit these implementations rather than assuming the fixes are sound.

Current verification supplied for review, but do not trust it blindly:

- `npm.cmd run test:local-runtime` exited 0 on the final working tree.
- config gateway 4/4.
- legacy extension 84/84.
- rewrite extension 85/85 plus TypeScript typecheck and production build.
- roundtable runtime 195/195.
- council browser 8/8.
- non-ChatGPT fake browser E2E 8/8.
- real Windows launcher and HTTP MCP 17/17, including failed-start Chrome cleanup and preservation of a reused Chrome.
- `node --check` passed for 107 JavaScript/MJS files; `git diff --check` passed with line-ending warnings only.
- Refreshed L1 codegraph: 85 files, 40,513 source lines, 1,415 symbols, 169 imports, 18 tests. L2 remains unavailable because two deterministic attempts returned `source-changed-during-build` at the known UTF-8 BOM hash boundary.

Do not treat live ChatGPT provider acceptance as required evidence. Human login and verification remain manual, and this review must not inspect or operate user-owned browser conversations.
