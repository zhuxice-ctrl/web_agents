import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionBrowserWorker } from "./extension-worker.mjs";

function createFixture({ authenticated = true, authProvider = "chatgpt", verificationRequired = false, captures = [] } = {}) {
  const calls = [];
  let now = 0;
  const manager = {
    forgotten: [],
    getBinding(providerId) {
      return { providerId, tabId: 42, url: "https://chatgpt.com/c/roundtable" };
    },
    forgetPage(providerId) {
      this.forgotten.push(providerId);
    },
    async sendToBoundTab(_providerId, request) {
      calls.push(structuredClone(request));
      if (request.type === "tab:auth-probe") {
        return {
          provider: authProvider,
          authenticated,
          reason: authenticated ? "authenticated" : "login_required",
          verificationRequired,
        };
      }
      if (request.type === "tab:capture-recent") {
        return {
          provider: "chatgpt",
          messages: [{ speaker: "assistant", text: "Old response", source: "article" }],
        };
      }
      if (request.type === "tab:detect") {
        return {
          provider: authProvider,
          readiness: "supported",
          canInsert: true,
          verificationRequired,
        };
      }
      if (request.type === "tab:auto-send-text") return { provider: "chatgpt", state: "sent", message: "sent" };
      if (request.type === "tab:insert-text") return { ok: true, provider: "chatgpt", message: "inserted" };
      if (request.type === "tab:capture-latest") {
        const capture = captures.length > 1 ? captures.shift() : captures[0];
        if (!capture) {
          const error = new Error("not ready");
          error.code = "EXTENSION_TAB_COMMAND_FAILED";
          throw error;
        }
        return typeof capture === "string"
          ? { provider: "chatgpt", speaker: "assistant", text: capture, capturedAt: `t-${now}`, source: "article" }
          : { capturedAt: `t-${now}`, source: "article", ...capture };
      }
      throw new Error(`Unexpected request ${request.type}`);
    },
  };
  const worker = new ExtensionBrowserWorker({
    manager,
    now: () => now,
    delay: async (ms) => { now += ms; },
  });
  return { worker, manager, calls };
}

function request(patch = {}) {
  return {
    providerId: "chatgpt",
    prompt: "Discuss the topic",
    autoSend: true,
    autoCapture: true,
    timeoutMs: 5000,
    settleMs: 500,
    ...patch,
  };
}

test("extension worker sends through the bound tab and waits for a stable new response", async () => {
  const { worker, calls } = createFixture({
    captures: ["Old response", "New partial", "New complete response", "New complete response", "New complete response", "New complete response"],
  });
  const checkpoints = [];
  const progress = [];

  const result = await worker.execute(request({
    checkpoint: async (phase, metadata) => checkpoints.push({ phase, metadata }),
    onProgress: async (snapshot) => progress.push(snapshot.text),
  }));
  assert.equal(result.text, "New complete response");
  assert.equal(result.capture.tabId, 42);
  assert.equal(result.capture.url, "https://chatgpt.com/c/roundtable");
  assert.equal(calls.some((call) => call.type === "tab:auto-send-text" && call.text === "Discuss the topic"), true);
  assert.deepEqual(checkpoints.map((checkpoint) => checkpoint.phase), ["submitting", "submitted", "captured"]);
  assert.deepEqual(progress, ["New partial", "New complete response"]);
});

test("extension worker invalidates a binding when authentication is lost", async () => {
  const { worker, manager } = createFixture({ authenticated: false });

  await assert.rejects(worker.execute(request()), (error) => error.code === "LOGIN_REQUIRED");
  assert.deepEqual(manager.forgotten, ["chatgpt"]);
});

test("extension worker invalidates a binding that drifted to another provider", async () => {
  const { worker, manager } = createFixture({ authProvider: "deepseek" });

  await assert.rejects(worker.execute(request()), (error) => error.code === "PROVIDER_URL_MISMATCH");
  assert.deepEqual(manager.forgotten, ["chatgpt"]);
});

test("extension worker stops with the human verification recovery code", async () => {
  const { worker, manager, calls } = createFixture({ verificationRequired: true });

  await assert.rejects(worker.execute(request()), (error) => error.code === "HUMAN_VERIFICATION_REQUIRED");
  assert.deepEqual(manager.forgotten, ["chatgpt"]);
  assert.equal(calls.some((call) => call.type === "tab:auto-send-text"), false);
});

test("extension worker maps a verification page discovered immediately before send", async () => {
  const { worker, manager } = createFixture();
  const originalSend = manager.sendToBoundTab.bind(manager);
  manager.sendToBoundTab = async (providerId, command) => {
    if (command.type === "tab:auto-send-text") {
      return { provider: "chatgpt", state: "verification_required", message: "verification required" };
    }
    return originalSend(providerId, command);
  };

  await assert.rejects(worker.execute(request()), (error) => error.code === "HUMAN_VERIFICATION_REQUIRED");
});

test("extension worker reports input busy without overwriting the user draft", async () => {
  const { worker, manager } = createFixture();
  const originalSend = manager.sendToBoundTab.bind(manager);
  manager.sendToBoundTab = async (providerId, command) => {
    if (command.type === "tab:auto-send-text") {
      return { provider: "chatgpt", state: "input_busy", message: "draft is present" };
    }
    return originalSend(providerId, command);
  };

  await assert.rejects(
    worker.execute(request()),
    (error) => error.code === "INPUT_BUSY" && error.details.state === "input_busy",
  );
});

test("extension worker reports input busy in insert-only mode", async () => {
  const { worker, manager } = createFixture();
  const originalSend = manager.sendToBoundTab.bind(manager);
  manager.sendToBoundTab = async (providerId, command) => {
    if (command.type === "tab:insert-text") {
      return { ok: false, provider: "chatgpt", state: "input_busy", message: "draft is present" };
    }
    return originalSend(providerId, command);
  };

  await assert.rejects(
    worker.execute(request({ autoSend: false })),
    (error) => error.code === "INPUT_BUSY",
  );
});

test("extension worker stops when verification appears during response polling", async () => {
  const { worker, manager, calls } = createFixture();
  const originalSend = manager.sendToBoundTab.bind(manager);
  manager.sendToBoundTab = async (providerId, command) => {
    if (command.type === "tab:detect") {
      return { provider: "chatgpt", readiness: "unknown", canInsert: false, verificationRequired: true };
    }
    return originalSend(providerId, command);
  };

  await assert.rejects(worker.execute(request()), (error) => error.code === "HUMAN_VERIFICATION_REQUIRED");
  assert.equal(calls.some((call) => call.type === "tab:auto-send-text"), true);
});

test("extension worker rejects a capture attributed to another provider", async () => {
  const { worker, manager } = createFixture({
    captures: [{ provider: "deepseek", text: "Wrong provider response" }],
  });

  await assert.rejects(worker.execute(request()), (error) => error.code === "PROVIDER_URL_MISMATCH");
  assert.deepEqual(manager.forgotten, ["chatgpt"]);
});

test("extension worker accepts an assistant reply exactly equal to the prompt", async () => {
  const exactReply = { provider: "chatgpt", speaker: "assistant", text: "Discuss the topic" };
  const { worker } = createFixture({ captures: [exactReply, exactReply, exactReply, exactReply] });

  const result = await worker.execute(request());
  assert.equal(result.text, "Discuss the topic");
});

test("extension worker ignores an echoed user prompt while waiting for an assistant reply", async () => {
  const { worker } = createFixture({
    captures: [
      { provider: "chatgpt", speaker: "user", text: "Discuss the topic" },
      "A new assistant response",
      "A new assistant response",
      "A new assistant response",
      "A new assistant response",
    ],
  });

  const result = await worker.execute(request());
  assert.equal(result.text, "A new assistant response");
});

test("extension worker ignores an unknown prompt wrapper with UI suffix text", async () => {
  const { worker } = createFixture({
    captures: [
      { provider: "chatgpt", speaker: "unknown", text: "Discuss the topic 展开" },
      "A verified assistant response",
      "A verified assistant response",
      "A verified assistant response",
      "A verified assistant response",
    ],
  });

  const result = await worker.execute(request());
  assert.equal(result.text, "A verified assistant response");
});

test("extension worker never persists an unknown-speaker prompt wrapper as a reply", async () => {
  const { worker } = createFixture({
    captures: [{ provider: "chatgpt", speaker: "unknown", text: "Discuss the topic 展开" }],
  });

  await assert.rejects(
    worker.execute(request({ timeoutMs: 1000, settleMs: 250 })),
    (error) => error.code === "PROVIDER_RESPONSE_TIMEOUT" && error.details.observedNewResponse === false,
  );
});

test("extension worker supports insert-only manual send mode", async () => {
  const { worker, calls } = createFixture();

  await assert.rejects(
    worker.execute(request({ autoSend: false })),
    (error) => error.code === "MANUAL_SEND_REQUIRED"
  );
  assert.equal(calls.some((call) => call.type === "tab:insert-text"), true);
  assert.equal(calls.some((call) => call.type === "tab:auto-send-text"), false);
});

test("extension worker reports a response timeout when the latest answer never changes", async () => {
  const { worker } = createFixture({ captures: ["Old response"] });

  await assert.rejects(
    worker.execute(request({ timeoutMs: 1000, settleMs: 250 })),
    (error) => error.code === "PROVIDER_RESPONSE_TIMEOUT" && error.details.observedNewResponse === false
  );
});
