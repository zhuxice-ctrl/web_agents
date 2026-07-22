# ADworkflo Review Checklist

## Product Scope

- The deliverable is a web page plus local Node.js runtime, not a desktop application.
- Only ChatGPT, DeepSeek, and Doubao are release-gated real providers.
- Discussion uses one immutable pre-round snapshot and merges all replies into the next round.
- Relay follows seat order and returns to the snapped host for the final report.
- Credentials and human verification are always manual.

## Runtime And Recovery

- Every turn begins with the fixed web_Agent protocol header before task text and shared history.
- The header includes `fixed-io-encoding`, explicit UTF-8 PowerShell/file rules, and reverse-evidence constraints.
- Echoed fixed/task shells are stripped from future context and oversized events are bounded without rewriting raw replies.
- Browser commands return immediately with an asynchronous run handle.
- SSE state reconciles with authoritative persisted session state.
- Pause, resume, cancel, retry, skip, and manual reply takeover cannot duplicate a turn.
- Concurrent commands cannot create two active plans for one session.
- Recovery retries are bounded and expose a structured exhaustion error.
- Login, CAPTCHA, missing composer, timeout, cancellation, and interrupted restart errors remain distinguishable.

## Storage And Artifacts

- The data root is configurable only through an absolute local path and is writable.
- Mutable JSON state is atomic; the ledger is append-only JSONL.
- Import, export, reindex, summary, diagnostics, reply files, audit, and indexes are present.
- Artifact writes use the filesystem contract, preserve before-content, and reject unsafe rollback after external modification.

## HTTP And Launcher Safety

- The server binds to loopback by default and rejects non-loopback Host or Origin values.
- POST API calls require `application/json`; wildcard CORS is absent.
- Health exposes the identity fields required to cross-check the listener PID and repository.
- The launcher starts only port 3020, propagates custom ports, and never downloads `mcp-proxy@latest`.
- `-Restart` and `-Stop` terminate only a fully verified roundtable process tree.
- Preflight validates Node 24+, npm, Playwright, Chrome, and a writable absolute data root.
- Failed startup cleans up only the process created by that launcher run and preserves logs.

## Release Evidence

- Fake-provider browser E2E passes for all three adapters and both conversation modes.
- Real ChatGPT, DeepSeek, and Doubao replies are captured and visible in the shared ledger.
- Real discussion and relay sessions complete with provider order evidence.
- Desktop and 375px mobile UI checks show no overlap, horizontal overflow, or console errors.
- qwen3.7-max performs a final read-only review after the final diff and verification evidence exist.
- `start-web-agents.bat` is created only after the real-provider gate and passes a 3020 identity smoke test.
