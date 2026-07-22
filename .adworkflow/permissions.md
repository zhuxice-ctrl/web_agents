# ADworkflo Permissions

This file defines the project-local operating boundary for AI-assisted engineering tasks.

## Default Allowed

- Read project files needed by `task_spec` and `context_manifest`.
- Create and edit roundtable sidecar files under `extensions/mcp-superassistant-local-fixed/` for the confirmed MVP.
- Edit project docs and ADworkflo artifacts under `.adworkflow/`.
- Run local build, lint, typecheck, unit test, and smoke test commands.
- Read `extensions/web-agents-extension/` only as an isolated rewrite reference; do not make it the active MVP runtime.
- Add one static import to the first line of the legacy `background.js`; leave the remaining generated bundle bytes unchanged.

## Require User Confirmation

- Installing or upgrading dependencies.
- Changing public architecture decisions in PRD/ARCH/TODO.
- Changing local file permission semantics, high-privilege mode, or local gateway behavior.
- Enabling automatic send by default.
- Opening multiple provider pages automatically.
- Deleting files, moving large directories, or applying broad formatting across unrelated files.
- Running commands that call external production services or mutate remote state.
- Operating a ChatGPT tab or conversation without fresh authorization for that exact test.

## Forbidden By Default

- Reverting unrelated user changes.
- Editing files outside `F:\web_agents` unless the user explicitly asks.
- Reading, printing, returning, or persisting provider cookies, tokens, localStorage values, account identity, or authentication response bodies.
- Implementing a second MCP, JSONL, or local-file executor in the roundtable sidecars.
- Committing browser profiles, logs, tokens, secrets, or private runtime data.
- Claiming completion without writing `.adworkflow/verification_result.json`.
- Treating plugin UI confirmation as the only real file permission boundary.
