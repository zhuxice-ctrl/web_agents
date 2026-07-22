# Roundtable Session Probe Binding Requirements

## Problem Observed

Pasted URL binding is error-prone and the dedicated CDP Chrome cannot reliably expose all real provider pages through Playwright. The user wants to keep normal Chrome sessions, open login pages manually, complete any human verification manually, and have the roundtable detect and bind ready model pages automatically.

## Expected Behavior

1. The roundtable page can open or focus ChatGPT, DeepSeek, and Doubao in normal Chrome through the extension.
2. Login state is detected automatically after manual login or verification.
3. The extension reports only sanitized status and tab metadata.
4. A provider is bound automatically only when authenticated and a usable composer exists.
5. Extension mode can execute real roundtable turns through the same server scheduler, SSE, recovery, and local storage flow.
6. URL paste remains an advanced CDP fallback, not the primary workflow.

## Non-Goals

- Do not submit credentials or solve CAPTCHA.
- Do not export cookies, bearer tokens, session JSON, account identity, or provider request headers.
- Do not upload provider state to a cloud service.
- Do not treat a tab URL alone as authentication.
- Do not remove deterministic Playwright/fake-provider tests.

## Acceptance Criteria

- ChatGPT, DeepSeek, and Doubao probes return authenticated booleans using confirmed same-origin endpoints.
- Probe return values contain no credential or identity payload.
- The web page detects extension availability and discovers provider tabs without pasted URLs.
- Open/focus, probe, bind, unbind, and retry work from provider cards.
- Server-side extension execution completes a fake send/capture turn through the relay.
- Missing bridge, login loss, verification, missing composer, and response timeout enter the existing recovery flow.
- Extension test/typecheck/build and the complete local runtime suite pass.
