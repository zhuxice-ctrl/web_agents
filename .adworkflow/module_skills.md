# ADworkflo Module Skills

Use this file to list project-specific module skills that should be loaded for focused work.

```text
module: extension-ui
skill: build-web-apps:frontend-app-builder
when: Creating or changing the React-based plugin UI, task panel, permission panel, or multi-model board.
inputs: task_spec, context_manifest, docs/PRD-web-agents-extension.md, docs/ARCH-web-agents-extension.md
outputs: patch, worker_state, verification_result
verification: npm run typecheck, npm run build, browser smoke test
```

```text
module: extension-react-quality
skill: build-web-apps:react-best-practices
when: Writing React state, context/store boundaries, memoization-sensitive components, or provider adapter UI.
inputs: task_spec, context_manifest, source files under extensions/web-agents-extension/src
outputs: patch, worker_state, verification_result
verification: typecheck and targeted component behavior check
```

```text
module: permission-boundary
skill: superpowers:systematic-debugging
when: Debugging permission bypasses, unsafe file operation classification, or MCP tool execution failures.
inputs: task_spec, permission requirements, failing command/logs
outputs: root cause, patch, worker_state, verification_result
verification: reproduced failure then passing targeted check
```

```text
module: completion-verification
skill: superpowers:verification-before-completion
when: Before claiming a module implementation is done.
inputs: task_spec, changed files, verification_commands.md
outputs: verification_result, final risk notes
verification: required commands recorded with pass/fail/not_run evidence
```
