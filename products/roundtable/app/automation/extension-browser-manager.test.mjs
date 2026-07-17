import assert from "node:assert/strict";
import test from "node:test";

import { createProviderAdapters } from "./adapters/index.mjs";
import { ExtensionBrowserManager } from "./extension-browser-manager.mjs";

function providerStatus(patch = {}) {
  return {
    provider: "chatgpt",
    authenticated: true,
    reason: "authenticated",
    tabId: 42,
    label: "ChatGPT",
    url: "https://chatgpt.com/c/roundtable?private=value#secret",
    readiness: "supported",
    canInsert: true,
    ready: true,
    verificationRequired: false,
    ...patch,
  };
}

function createFixture(handler) {
  const calls = [];
  const relay = {
    status: () => ({ connected: true, clients: [], pendingCommands: 0 }),
    async dispatch(request) {
      calls.push(structuredClone(request));
      return handler(request);
    },
  };
  const manager = new ExtensionBrowserManager({ relay, adapters: createProviderAdapters() });
  return { manager, calls };
}

test("extension browser manager discovers and automatically binds a ready normal Chrome tab", async () => {
  const { manager } = createFixture(async (request) => {
    assert.equal(request.type, "tabs:discover-providers");
    return { ok: true, type: request.type, data: { tabs: [providerStatus()] } };
  });

  await manager.connect();
  assert.deepEqual(manager.status().bindings, [{
    providerId: "chatgpt",
    tabId: 42,
    url: "https://chatgpt.com/c/roundtable",
    status: "verified",
    authenticated: true,
    canInsert: true,
    closed: false,
  }]);
});

test("extension browser manager preserves a ready verified tab across rediscovery", async () => {
  let discovery = 0;
  const { manager } = createFixture(async (request) => {
    assert.equal(request.type, "tabs:discover-providers");
    discovery += 1;
    return {
      ok: true,
      type: request.type,
      data: {
        tabs: discovery === 1
          ? [providerStatus({ tabId: 42 })]
          : [providerStatus({ tabId: 42 }), providerStatus({ tabId: 99, url: "https://chatgpt.com/c/newer" })],
      },
    };
  });

  await manager.connect();
  await manager.discover();
  assert.equal(manager.getBinding("chatgpt").tabId, 42);
});

test("extension browser manager binds the exact open tab selected by a pasted URL", async () => {
  const { manager, calls } = createFixture(async (request) => {
    if (request.type === "tabs:discover-providers") {
      return {
        ok: true,
        type: request.type,
        data: {
          tabs: [
            providerStatus({ tabId: 42, url: "https://chatgpt.com/c/manual" }),
            providerStatus({ tabId: 99, url: "https://chatgpt.com/c/automatic" }),
          ],
        },
      };
    }
    assert.equal(request.type, "tabs:probe-provider");
    assert.equal(request.tabId, 42);
    return {
      ok: true,
      type: request.type,
      data: providerStatus({ tabId: 42, url: "https://chatgpt.com/c/manual" }),
    };
  });

  const binding = await manager.bindProviderPage("chatgpt", {
    url: "https://chatgpt.com/c/manual?temporary=secret#private",
    tabId: null,
  });

  assert.equal(binding.tabId, 42);
  assert.equal(binding.url, "https://chatgpt.com/c/manual");
  assert.deepEqual(calls.map((request) => request.type), [
    "tabs:discover-providers",
    "tabs:probe-provider",
  ]);
});

test("extension browser manager rejects a pasted URL from another provider before dispatch", async () => {
  const { manager, calls } = createFixture(async () => {
    throw new Error("must not dispatch");
  });

  await assert.rejects(
    manager.bindProviderPage("chatgpt", { url: "https://chat.deepseek.com/a/chat/s/wrong-provider", tabId: null }),
    (error) => error.code === "PROVIDER_URL_MISMATCH",
  );
  assert.deepEqual(calls, []);
});

test("extension browser manager drops a binding when auth or composer readiness is lost", async () => {
  let discovery = 0;
  const { manager } = createFixture(async (request) => {
    discovery += 1;
    return {
      ok: true,
      type: request.type,
      data: {
        tabs: [providerStatus(discovery === 1 ? {} : {
          authenticated: false,
          reason: "login_required",
          ready: true,
        })],
      },
    };
  });

  await manager.connect();
  assert.equal(manager.status().bindings.length, 1);
  await manager.discover();
  assert.equal(manager.status().bindings.length, 0);
});

test("extension browser manager discovers only explicitly requested providers", async () => {
  const { manager, calls } = createFixture(async (request) => ({
    ok: true,
    type: request.type,
    data: { tabs: [] },
  }));

  await manager.connect({ providers: ["deepseek", "doubao"] });

  assert.deepEqual(calls, [{
    type: "tabs:discover-providers",
    providers: ["deepseek", "doubao"],
  }]);
});

test("extension browser manager refuses unauthenticated and composer-less tabs", async () => {
  const responses = [
    providerStatus({ authenticated: false, reason: "login_required", ready: false }),
    providerStatus({ canInsert: false, ready: false, readiness: "no_input" }),
  ];
  const { manager } = createFixture(async (request) => {
    if (request.type === "tabs:discover-providers") return { ok: true, type: request.type, data: { tabs: [] } };
    return { ok: true, type: request.type, data: responses.shift() };
  });

  await assert.rejects(
    manager.bindProviderPage("chatgpt", { tabId: 42 }),
    (error) => error.code === "LOGIN_REQUIRED"
  );
  await assert.rejects(
    manager.bindProviderPage("chatgpt", { tabId: 42 }),
    (error) => error.code === "COMPOSER_NOT_FOUND"
  );
});

test("extension browser manager attaches secret-free adapter diagnostics to readiness failures", async () => {
  const adapterDiagnostics = {
    bridgeState: "ready",
    adapterSource: "none",
    activationState: "ineffective",
    sidecarInjected: false,
    composerFound: true,
    adapterPresent: false,
    hasInsertText: false,
    hasInsertTextIntoInput: false,
    hasSubmitForm: false,
  };
  const { manager } = createFixture(async (request) => ({
    ok: true,
    type: request.type,
    data: providerStatus({
      canInsert: false,
      ready: false,
      readiness: "unknown",
      reason: "adapter_not_ready",
      adapterDiagnostics,
    }),
  }));

  await assert.rejects(
    manager.bindProviderPage("chatgpt", { tabId: 42 }),
    (error) => error.code === "ADAPTER_NOT_READY"
      && error.diagnostics?.adapterDiagnostics?.activationState === "ineffective",
  );
});

test("extension browser manager routes allowed operations to the bound tab id", async () => {
  const { manager, calls } = createFixture(async (request) => {
    if (request.type === "tabs:probe-provider") return { ok: true, type: request.type, data: providerStatus() };
    if (request.type === "tab:capture-latest") {
      return { ok: true, type: request.type, data: { provider: "chatgpt", text: "A complete response", capturedAt: "now" } };
    }
    throw new Error(`Unexpected ${request.type}`);
  });
  await manager.bindProviderPage("chatgpt", { tabId: 42 });

  const capture = await manager.sendToBoundTab("chatgpt", { type: "tab:capture-latest" });
  assert.equal(capture.text, "A complete response");
  assert.deepEqual(calls.at(-1), { type: "tab:capture-latest", tabId: 42 });
});

test("extension browser manager preserves an allowlisted bridge error code", async () => {
  const { manager } = createFixture(async (request) => {
    if (request.type === "tabs:probe-provider") {
      return { ok: true, type: request.type, data: providerStatus() };
    }
    return { ok: false, type: request.type, error: "ADAPTER_NOT_READY" };
  });
  await manager.bindProviderPage("chatgpt", { tabId: 42 });

  await assert.rejects(
    manager.sendToBoundTab("chatgpt", { type: "tab:detect" }),
    (error) => error.code === "ADAPTER_NOT_READY",
  );
});

test("extension browser manager reuses provider tabs when opening pages", async () => {
  const { manager } = createFixture(async (request) => ({
    ok: true,
    type: request.type,
    data: {
      provider: request.provider,
      label: "ChatGPT",
      tabId: 42,
      url: "https://chatgpt.com/?private=value",
      status: "ready",
      reused: true,
    },
  }));

  assert.deepEqual(await manager.openProviders(["chatgpt"]), [{
    providerId: "chatgpt",
    tabId: 42,
    url: "https://chatgpt.com/",
    reused: true,
  }]);
});
