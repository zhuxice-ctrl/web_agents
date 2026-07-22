# Roundtable Session Probe Binding Design

## Goal

Replace pasted provider URLs as the primary connection flow with a Web Agents extension bridge that opens or focuses provider tabs in the user's normal Chrome, detects login in the provider origin, binds the verified tab automatically, and executes roundtable turns without exporting provider credentials.

## Confirmed Product Behavior

- The roundtable web page remains the primary product surface.
- Each MVP provider card exposes an open/focus action, live login state, readiness state, and automatic binding.
- Login, CAPTCHA, and human verification remain manual user actions in the provider tab.
- The bridge returns only provider ID, tab ID, redacted URL, authentication state, readiness, and reason codes.
- Cookies, access tokens, complete session payloads, account identity, and provider response headers never cross the bridge or enter local logs.
- Pasted URL binding remains available only as a folded CDP fallback.

## Provider Probes

| Provider | Login page | Primary same-origin probe | Authenticated signal |
| --- | --- | --- | --- |
| ChatGPT | `https://chatgpt.com/` | `GET /api/auth/session` | response has `user` |
| DeepSeek | `https://chat.deepseek.com/sign_in` | `GET /api/v0/users/current` with the page-owned `userToken` bearer | response `code === 0` and has data |
| Doubao | `https://www.doubao.com/chat/` | `GET /passport/account/info/v2/` | response has `data.user_id_str` |
| Doubao fallback | same page | `POST /alice/profile/self` | response has `data.profile_brief.id` |

The probes run in the provider page's MAIN world through `chrome.scripting.executeScript`. Each probe reduces the provider response to a boolean result before returning to extension code.

## Architecture

```text
Roundtable page at 127.0.0.1:3020
  -> loopback bridge content script
  -> extension service worker
  -> chrome.tabs + chrome.scripting
  -> provider content script / MAIN-world auth probe
  -> sanitized tab status

Roundtable server scheduler
  -> in-memory extension relay command
  -> roundtable page relay poller
  -> loopback bridge content script
  -> extension service worker
  -> bound provider tab
  -> sanitized operation result
```

### Extension bridge

A dedicated localhost content script accepts only an allowlisted set of roundtable messages. It forwards those messages to the extension service worker and posts sanitized responses back to the local page. It does not expose MCP execution, permission mutation, or raw provider network data.

### Provider discovery and binding

The service worker queries existing provider tabs, reuses a matching tab before opening a new one, probes authentication in MAIN world, and combines the result with the content adapter's composer readiness. A binding is verified only when both `authenticated` and `canInsert` are true.

### Server relay

The loopback server keeps an in-memory command queue. The open roundtable page registers as a relay client, polls for one command at a time, executes it through the extension bridge, and returns the result. Commands expire, disappear on restart, and never persist credentials.

### Extension execution worker

The existing scheduler remains authoritative for shared context, rounds, recovery, SSE, and local storage. In extension mode, a dedicated worker uses the bound tab to:

1. verify authentication and composer readiness;
2. capture the current response baseline;
3. insert and send the turn prompt;
4. poll the latest response until it differs from baseline and remains stable for the configured settle interval;
5. return only the captured model text and redacted tab metadata.

## Error Handling

- `EXTENSION_BRIDGE_UNAVAILABLE`: the local page cannot reach the installed extension.
- `EXTENSION_COMMAND_TIMEOUT`: the page, extension, or provider tab stopped responding.
- `PROVIDER_TAB_NOT_FOUND`: no matching provider tab exists.
- `LOGIN_REQUIRED`: the session probe reports unauthenticated.
- `HUMAN_VERIFICATION_REQUIRED`: the provider is on a known verification route or page.
- `COMPOSER_NOT_FOUND`: authentication succeeded but the chat composer is unavailable.
- `PROVIDER_RESPONSE_TIMEOUT`: a submitted turn did not produce a stable new response.

All errors preserve the server's existing recovery workflow. Authentication loss invalidates the binding before retry.

## Verification

- Unit-test each provider probe with synthetic response shapes and prove no token or identity field is returned.
- Unit-test localhost bridge allowlisting and extension tab discovery/binding.
- Unit-test relay registration, command delivery, result completion, timeout, and disconnect behavior.
- Integration-test extension worker send/capture with a fake relay client.
- Build and typecheck the extension.
- Run the complete local runtime suite.
- Load the unpacked extension in normal Chrome and verify real ChatGPT, DeepSeek, and Doubao cards report only sanitized status.
