# Web Agents Plugin Multi-Session Local Channel Design

Status: Approved for implementation planning

Date: 2026-07-18

## 1. Objective

Extend the normal browser plugin in three related areas:

1. Complete Grok support in the existing provider system, including a typed image-generation workflow.
2. Allow a local client such as Codex to submit typed browser tasks through the existing plugin gateway.
3. Improve local MCP concurrency so multiple browser sessions and long-running single-session instructions can read and write local files reliably.

The design keeps the current local service ports:

- Filesystem MCP: `3006`
- Plugin gateway: `3017`

No additional browser automation process or browser debugging connection is introduced.

## 2. Scope

### 2.1 Included

- Grok provider selectors, authentication/readiness detection, prompt submission, response capture, and image result capture.
- A generic typed browser-task envelope that supports all catalog providers.
- The first automated task type: `provider.generate_image`, initially implemented for Grok.
- A simple task queue exposed by the plugin gateway.
- Session-specific local workspaces and MCP connections.
- Reusable, multiplexed MCP sessions and bounded local-service backpressure.
- A plugin UI control that connects to and checks the already-running local MCP services.
- Concurrency and isolation tests for independent browser sessions.

### 2.2 Excluded

- Arbitrary DOM commands, coordinate clicks, or unrestricted browser scripting submitted by local clients.
- Starting Chrome or connecting through browser debugging protocols.
- Automatically bypassing login, CAPTCHA, payment, content-policy, or provider verification flows.
- Installing or registering a Native Messaging Host in the first release.
- Starting a local executable directly from the browser extension.

## 3. Provider Model

Grok remains one entry in the shared provider catalog. The task channel does not create a Grok-only subsystem.

The provider catalog gains optional capabilities needed by typed automation:

- provider-specific input selectors
- provider-specific submit selectors
- provider-specific response selectors
- provider-specific image-result selectors
- supported automated task types

The existing ChatGPT, Doubao, Gemini, DeepSeek, Kimi, Qwen, GLM, and Google AI Studio paths continue to use the same provider interfaces. Grok receives the provider-specific selectors and behavior needed to move it from manual verification toward a working provider integration.

## 4. Typed Local Task Protocol

The local client submits tasks to the existing gateway on port `3017`.

### 4.1 Submit

`POST /automation/tasks`

```json
{
  "version": 1,
  "type": "provider.generate_image",
  "clientRequestId": "caller-generated-id",
  "sessionId": "browser-session-id",
  "provider": "grok",
  "tabId": 123,
  "workspaceRoot": "F:\\project",
  "payload": {
    "prompt": "Generate a clean product illustration",
    "targetDirectory": "F:\\project\\assets",
    "fileName": "hero.webp"
  }
}
```

The gateway validates the envelope and immediately returns a generated `taskId`. Repeated `clientRequestId` values return the existing task rather than enqueueing duplicate work.

### 4.2 Receive

The extension background connects to:

`GET /automation/next?waitMs=15000`

This is a low-latency long poll. An available task returns immediately. An empty queue returns an empty response after the wait period. The public protocol does not expose lease transitions or a complex state machine.

### 4.3 Complete

`POST /automation/tasks/:taskId/result`

The extension returns either a successful typed result or a stable error code. A local client can inspect the simplified result through:

`GET /automation/tasks/:taskId`

The externally visible states are limited to `pending`, `done`, and `error`.

### 4.4 Queue Semantics

- The queue is in memory for the MVP.
- Tasks have an execution timeout and a retention timeout.
- Expired tasks are removed automatically.
- The gateway does not impose a global browser-task execution limit.
- The gateway has a finite queue capacity to prevent memory exhaustion. Capacity is service backpressure, not a browser concurrency policy.
- If the extension disconnects after receiving a task, the MVP may time out and discard that task. The caller can retry with a new `clientRequestId`.

## 5. Multi-Session Local Workspaces

Each plugin task session owns:

- `sessionId`
- provider and browser `tabId`
- `workspaceRoot`
- an MCP logical connection
- task feedback and recent results

The extension sends session identity and workspace identity on MCP requests. The filesystem service validates the workspace against configured allowed directories before creating or reusing a session-specific filesystem tool instance.

The adapter explicitly supplies the shared core inputs:

- `repoRoot`: the validated session workspace
- `configFile`: the plugin allowed-directories file
- `permissionStoreDir`: the plugin permission data directory
- `auditFile`: a plugin audit file scoped to the session or shared plugin audit directory

No shared-core interface change is required. The plugin uses only public exports.

Independent sessions may run concurrently. Operations targeting the same physical path remain serialized. Reads and operations on different paths may proceed concurrently.

## 6. Grok Image Workflow

The first `provider.generate_image` executor supports Grok:

1. Use the requested Grok tab when valid, otherwise select an available authenticated Grok tab or open the Grok image-generation page.
2. Locate the provider-specific composer and submit control.
3. Insert the prompt through native value setters and `input`/`change` events.
4. Submit through the real provider control.
5. Observe DOM mutations after submission instead of relying on fixed sleeps.
6. Identify the first complete downloadable image produced by this task.
7. Read the image URL, data URL, or blob and send the bytes to port `3017`.
8. Validate the output path and atomically write the image.
9. Return the absolute path, MIME type, and byte count.

The first release saves one image. Multiple generated candidates are not exposed as a multi-file protocol yet.

Stable errors include:

- `PROVIDER_TAB_NOT_FOUND`
- `PROVIDER_LOGIN_REQUIRED`
- `PROVIDER_INPUT_NOT_FOUND`
- `PROVIDER_SUBMIT_NOT_FOUND`
- `PROVIDER_GENERATION_TIMEOUT`
- `PROVIDER_IMAGE_NOT_FOUND`
- `WORKSPACE_NOT_ALLOWED`
- `OUTPUT_PATH_NOT_ALLOWED`
- `IMAGE_DOWNLOAD_FAILED`
- `IMAGE_SAVE_FAILED`

## 7. Concurrency Design

### 7.1 Browser Sessions

There is no global browser-task execution limit. Parallelism follows available independent browser sessions and tabs. Multiple provider sessions may execute at once in the same Chrome window.

The same physical composer cannot safely receive concurrent writes. Tasks that refer to one exact browser session serialize only the DOM mutation phase for that session. Separate sessions and tabs remain independent.

### 7.2 MCP Client

- Reuse an MCP SSE session instead of opening a connection for every tool call.
- Multiplex in-flight JSON-RPC requests by `id`.
- Keep request completion isolated by `sessionId`.
- Apply request timeouts with `AbortController`.
- Reconnect with exponential backoff and jitter after transport failures.
- Bound the local request waiting queue so an unavailable service cannot consume unlimited memory.

### 7.3 Filesystem Service

- Process independent reads concurrently.
- Serialize writes to the same physical path.
- Allow writes to different physical paths concurrently.
- Respect HTTP and SSE backpressure, including waiting for `drain` before continuing a saturated stream.
- Reject overloaded requests with `429` instead of holding an unbounded queue.
- Remove abandoned sessions and pending response handlers when connections close.

### 7.4 Image Writes

Image output paths are validated against allowed directories and real-path identity rules. Writes use `@web-agents/local-core/atomic-file`. Concurrent writes to the same destination are serialized by a plugin-owned keyed lock.

## 8. Plugin UI

The MCP panel adds a connection control:

- `Connect local MCP` when disconnected
- `Refresh status` when connected
- clear status for `3006` and `3017`
- an actionable message when services are not running

The control does not claim to start a process. The service remains started through the plugin launcher script.

The task panel displays and edits the current session workspace path. The path is validated by the gateway before the session becomes ready. Provider, tab, session, and workspace are submitted together so local file operations cannot silently fall back to another session's directory.

## 9. Security Requirements

- Bind local services to loopback interfaces.
- Keep the existing product ports only.
- Validate request origin, content type, size, and task schema.
- Accept only declared typed automation tasks.
- Require output paths to be inside configured allowed roots.
- Resolve real paths and reject symbolic-link or junction write escapes.
- Use atomic file replacement for image output.
- Do not expose arbitrary click, script, shell, or DOM execution endpoints.
- Do not weaken permission-token, transaction, path-lock, rollback, or audit behavior.

## 10. Testing

### 10.1 Provider Tests

- Grok hostname and subdomain detection.
- Grok-specific input, submit, response, and image selectors.
- DOM insertion and submit behavior.
- Mutation-based image result detection.
- Login, missing control, timeout, and invalid image errors.

### 10.2 Gateway Tests

- Task schema validation.
- Idempotent `clientRequestId` handling.
- Long-poll wake-up and timeout.
- Queue capacity and task cleanup.
- Result submission and error propagation.
- Allowed and rejected output paths.
- Atomic image output under concurrent requests.

### 10.3 Session and MCP Tests

- Separate workspaces for independent sessions.
- No request or response cross-talk between JSON-RPC IDs.
- Parallel reads.
- Same-path write serialization.
- Different-path write concurrency.
- Queue saturation returns `429` and later recovers.
- SSE disconnect removes waiters and session state.
- A long single-session instruction can complete multiple local tool calls without reopening the transport for every call.

### 10.4 Product Acceptance

Run all plugin, service, shared-core, build, release-boundary, product-boundary, forbidden-term, and diff checks required by the plugin development window.

Real browser verification remains required for Grok selectors, login state, prompt submission, generated-image capture, and concurrent provider sessions.

## 11. Implementation Stages

1. Provider contract and Grok integration.
2. Session-specific workspace routing in the extension and filesystem service.
3. Simple gateway task queue and typed automation protocol.
4. Grok image task executor and atomic save path.
5. MCP connection reuse, multiplexing, and service backpressure.
6. Plugin UI connection and workspace controls.
7. Automated acceptance and real-browser verification checklist.

Each stage starts with a failing behavior test and is committed separately when it forms an independently reviewable change.

## 12. Future Work: Native Messaging Host

After the HTTP/SSE design is working and measured, evaluate a Native Messaging Host for true one-click local-service startup.

The evaluation must cover:

- Chrome and Edge installation and registration flow
- manual installation and upgrade requirements
- first-process startup latency versus persistent-process latency
- failure recovery and host version compatibility
- removal/uninstall behavior
- whether startup convenience justifies the additional native deployment surface

NMH is not part of the first implementation and is not required for local-channel performance.
