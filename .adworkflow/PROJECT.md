# ADworkflo Project State

## Current Phase

Implementation in progress. `extension-source-scaffold` is complete and build-verified.

## Current Task

- Task ID: `web-agents-extension-mvp`
- Goal: Build the first maintainable Web Agents browser extension MVP.
- Risk: high
- Mode: orchestrator-with-workers-and-reviewers
- Project size: large
- Classification source: product_docs

## Product Inputs

- PRD: `PRD.md`, `docs/PRD-web-agents-extension.md`
- ARCH: `ARCH.md`, `docs/ARCH-web-agents-extension.md`
- TODO: `TODO.md`
- PROJECT: `PROJECT.md`

## Active Artifacts

- `.adworkflow/architecture_manifest.json`
- `.adworkflow/execution_plan.json`
- `.adworkflow/task_spec.json`
- `.adworkflow/context_manifest.json`
- `.adworkflow/task_specs/*.json`
- `.adworkflow/worker_state.json`
- `.adworkflow/verification_result.json`
- `.adworkflow/review_findings.json`

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-06-29 | Start with browser extension enhancement. | It is the closest usable product surface. |
| 2026-06-29 | Create a new maintainable extension source project. | The current local-fixed extension is a bundled artifact. |
| 2026-06-29 | Default to native webpage input insertion and manual send. | Preserves provider UX and reduces automation risk. |
| 2026-06-29 | Multi-model dispatch is explicit opt-in. | Avoids unexpected account/page opening. |
| 2026-06-29 | Permission enforcement belongs in local config/gateway. | Plugin UI alone is not a reliable security boundary. |
| 2026-06-30 | Use popup-first for the scaffold. | It is the fastest loadable MV3 surface; Side Panel can be added later. |

## Verification Log

| Date | Command | Result | Notes |
|---|---|---|---|
| 2026-06-29 | ADworkflo JSON validation | passed | JSON artifacts and task_specs parse successfully. |
| 2026-06-29 | prepare_context.py | passed with manual override | Auto context targeted bundled legacy extension; context was corrected to architecture-first. |
| 2026-06-30 | npm run typecheck | passed | New extension TypeScript project passes. |
| 2026-06-30 | npm run build | passed | New extension builds to `extensions/web-agents-extension/dist`. |
| 2026-06-30 | build_codegraph.py | passed | Codegraph includes new TypeScript extension source. |

## Risks

| Risk | Level | Mitigation |
|---|---|---|
| Permission boundary bypass | High | Enforce in local gateway, not only in plugin UI. |
| Webpage DOM instability | Medium | Use provider adapters with visible status and graceful errors. |
| Bundle-only legacy extension | Medium | Treat as reference; create new source project. |
| Scope creep into full Studio | High | Keep MVP task specs focused on plugin foundation. |
