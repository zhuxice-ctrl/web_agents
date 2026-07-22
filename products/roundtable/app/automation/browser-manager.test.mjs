import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AutomationError } from "./errors.mjs";
import { BrowserManager } from "./browser-manager.mjs";
import { PageLeaseRegistry } from "./page-lease-registry.mjs";

function eventTarget() {
  return {
    listeners: new Map(),
    on(name, listener) {
      this.listeners.set(name, listener);
    },
  };
}

function createPage(url) {
  return {
    currentUrl: url,
    closed: false,
    closeCalls: 0,
    gotoCalls: 0,
    gotoUrls: [],
    reloadCalls: 0,
    marker: "",
    targetId: `target-${Math.random().toString(16).slice(2)}`,
    url() { return this.currentUrl; },
    isClosed() { return this.closed; },
    async title() { return "Provider page"; },
    async goto(nextUrl) {
      this.gotoCalls += 1;
      this.gotoUrls.push(nextUrl);
      this.currentUrl = nextUrl;
    },
    async reload() { this.reloadCalls += 1; },
    async close() { this.closeCalls += 1; this.closed = true; },
    async bringToFront() {},
    context() { return this.browserContext; },
    async evaluate(_fn, value) {
      if (arguments.length > 1) {
        if (!this.marker || this.marker.startsWith("roundtable:")) this.marker = value;
        return undefined;
      }
      return this.marker;
    },
  };
}

function createCdpFixture({ pages = [], adapterOverrides = {} } = {}) {
  const context = {
    ...eventTarget(),
    closeCalls: 0,
    newPageCalls: 0,
    pages: () => pages,
    async newCDPSession(page) {
      return {
        async send() { return { targetInfo: { targetId: page.targetId } }; },
        async detach() {},
      };
    },
    async close() { this.closeCalls += 1; },
    async newPage() {
      this.newPageCalls += 1;
      throw new Error("CDP mode must not create pages");
    },
  };
  const browser = {
    ...eventTarget(),
    closeCalls: 0,
    contexts: () => [context],
    async close() { this.closeCalls += 1; },
  };
  const adapter = {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    async assertAutomationReady() {},
    async hasUsableComposer() { return true; },
    ...adapterOverrides,
  };
  const manager = new BrowserManager({
    mode: "cdp",
    cdpEndpoint: "http://127.0.0.1:9223",
    adapters: new Map([["chatgpt", adapter]]),
    connectOverCDP: async () => browser,
  });
  for (const page of pages) page.browserContext = context;
  return { manager, browser, context, adapter };
}

test("CDP bindings recover from the persistent lease registry by target id", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-manager-lease-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "page-leases.json");
  const page = createPage("https://chatgpt.com/c/recover");
  const first = createCdpFixture({ pages: [page] });
  first.manager.setLeaseRegistry(new PageLeaseRegistry({ filePath }));
  await first.manager.bindProviderPage("chatgpt", page.currentUrl, { sessionId: "session", threadKey: "thread" });

  const restoredRegistry = new PageLeaseRegistry({ filePath });
  await restoredRegistry.initialize();
  const restored = createCdpFixture({ pages: [page] });
  restored.manager.setLeaseRegistry(restoredRegistry);
  await restored.manager.connect();
  const reconciliation = await restored.manager.reconcilePageLeases();

  assert.equal(reconciliation.matched.length, 1);
  assert.equal(await restored.manager.getPage("chatgpt", { threadKey: "thread" }), page);
  const acquired = await restored.manager.acquirePage("chatgpt", { threadKey: "thread", executionId: "exec-old" });
  await restoredRegistry.reserve({ providerId: "chatgpt", sessionId: "session", threadKey: "thread", targetId: page.targetId });
  await assert.rejects(
    () => restored.manager.assertPageLease("chatgpt", { threadKey: "thread", executionId: "exec-old", leaseEpoch: acquired.lease.leaseEpoch }),
    (error) => error instanceof AutomationError && error.code === "PAGE_LEASE_STALE",
  );
});

test("manual CDP mode reports an unavailable browser without launching Chrome", async () => {
  let calls = 0;
  const manager = new BrowserManager({
    mode: "cdp",
    cdpEndpoint: "http://127.0.0.1:9223",
    adapters: new Map(),
    connectOverCDP: async () => {
      calls += 1;
      throw new Error("connect ECONNREFUSED");
    },
  });

  await assert.rejects(
    () => manager.connect(),
    (error) => error.code === "MANUAL_BROWSER_UNAVAILABLE" && /127\.0\.0\.1:9223/.test(error.details.endpoint)
  );
  assert.equal(calls, 1);
});

test("binding finds the exact existing provider tab and redacts query and hash", async () => {
  const page = createPage("https://chatgpt.com/c/abc?temporary=secret#private");
  const { manager, context } = createCdpFixture({ pages: [page] });

  const binding = await manager.bindProviderPage("chatgpt", "https://chatgpt.com/c/abc?temporary=secret#private");

  assert.deepEqual(binding, {
    providerId: "chatgpt",
    status: "verified",
    url: "https://chatgpt.com/c/abc",
  });
  assert.equal(await manager.getPage("chatgpt"), page);
  assert.equal(context.newPageCalls, 0);
  assert.equal(page.gotoCalls, 0);
  assert.deepEqual(manager.status().bindings, [{
    providerId: "chatgpt",
    status: "verified",
    url: "https://chatgpt.com/c/abc",
    closed: false,
  }]);
});

test("bound CDP pages are invalidated if the user navigates them away from the provider", async () => {
  const page = createPage("https://chatgpt.com/c/abc");
  const { manager, context } = createCdpFixture({ pages: [page] });
  await manager.bindProviderPage("chatgpt", page.currentUrl);

  page.currentUrl = "https://example.com/unrelated-composer";

  await assert.rejects(
    () => manager.getPage("chatgpt"),
    (error) => error.code === "PROVIDER_PAGE_NOT_BOUND" && error.details.reason === "PROVIDER_URL_MISMATCH"
  );
  assert.deepEqual(manager.status().bindings, []);
  assert.equal(context.newPageCalls, 0);
  assert.equal(page.gotoCalls, 0);
});

test("bound CDP pages may change paths on the same provider without exposing query or hash", async () => {
  const page = createPage("https://chatgpt.com/c/abc");
  const { manager } = createCdpFixture({ pages: [page] });
  await manager.bindProviderPage("chatgpt", page.currentUrl);

  page.currentUrl = "https://chatgpt.com/c/new-thread?token=secret#private";

  assert.equal(await manager.getPage("chatgpt"), page);
  assert.equal(manager.status().bindings[0].url, "https://chatgpt.com/c/new-thread");
});

test("new roundtable threads reuse the existing provider tab and open a fresh conversation", async () => {
  const page = createPage("https://chatgpt.com/c/previous-roundtable");
  const { manager, context } = createCdpFixture({ pages: [page] });
  const previousThreadKey = "session-old:chatgpt:thread-old";
  await manager.bindProviderPage("chatgpt", page.currentUrl, { threadKey: previousThreadKey });

  const opened = await manager.createProviderThread("chatgpt", {
    threadKey: "session-new:chatgpt:thread-new",
    sessionId: "session-new",
    seatId: "chatgpt",
  });

  assert.equal(context.newPageCalls, 0);
  assert.deepEqual(page.gotoUrls, ["https://chatgpt.com/"]);
  assert.equal(await manager.getPage("chatgpt", { threadKey: opened.threadKey }), page);
  await assert.rejects(
    () => manager.getPage("chatgpt", { threadKey: previousThreadKey }),
    (error) => error.code === "PROVIDER_PAGE_NOT_BOUND"
  );
  assert.equal(opened.reused, true);
  assert.equal(opened.url, "https://chatgpt.com/");
});

test("explicit reconnect transfers an idle provider page and orphans the old thread lease", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-manager-transfer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new PageLeaseRegistry({ filePath: path.join(root, "page-leases.json") });
  const page = createPage("https://chatgpt.com/c/old");
  const { manager } = createCdpFixture({ pages: [page] });
  manager.setLeaseRegistry(registry);
  const oldKey = "session-old:chatgpt:thread-old";
  const newKey = "session-new:chatgpt:thread-new";
  await manager.bindProviderPage("chatgpt", page.currentUrl, { threadKey: oldKey, sessionId: "session-old" });
  const oldLease = registry.find({ providerId: "chatgpt", threadKey: oldKey });

  await manager.reconnectProviderThread("chatgpt", {
    threadKey: newKey,
    sessionId: "session-new",
    seatId: "chatgpt",
    refresh: true,
  });

  assert.equal(await manager.getPage("chatgpt", { threadKey: newKey }), page);
  await assert.rejects(
    () => manager.getPage("chatgpt", { threadKey: oldKey }),
    (error) => error.code === "PROVIDER_PAGE_NOT_BOUND",
  );
  assert.equal(registry.get(oldLease.pageBindingId).state, "ORPHANED");
});

test("explicit reconnect refuses to transfer a page that another execution is using", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-manager-busy-transfer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new PageLeaseRegistry({ filePath: path.join(root, "page-leases.json") });
  const page = createPage("https://chatgpt.com/c/old");
  const { manager } = createCdpFixture({ pages: [page] });
  manager.setLeaseRegistry(registry);
  const oldKey = "session-old:chatgpt:thread-old";
  await manager.bindProviderPage("chatgpt", page.currentUrl, { threadKey: oldKey, sessionId: "session-old" });
  await manager.acquirePage("chatgpt", { threadKey: oldKey, executionId: "execution-old" });

  await assert.rejects(
    () => manager.reconnectProviderThread("chatgpt", {
      threadKey: "session-new:chatgpt:thread-new",
      sessionId: "session-new",
      seatId: "chatgpt",
      refresh: true,
    }),
    (error) => error.code === "PROVIDER_PAGE_IN_USE",
  );
  assert.equal(await manager.getPage("chatgpt", { threadKey: oldKey }), page);
});

test("new provider threads wait for a delayed composer before reporting readiness", async () => {
  const page = createPage("https://chatgpt.com/c/previous-roundtable");
  let composerChecks = 0;
  const { manager } = createCdpFixture({
    pages: [page],
    adapterOverrides: {
      async hasUsableComposer() {
        composerChecks += 1;
        return composerChecks >= 2;
      },
    },
  });

  const opened = await manager.createProviderThread("chatgpt", {
    threadKey: "session-delayed:chatgpt:thread-new",
    readyTimeoutMs: 100,
  });

  assert.equal(opened.status, "verified");
  assert.ok(composerChecks >= 2);
});

test("composer readiness failures return selector diagnostics for the UI", async () => {
  const page = createPage("https://chatgpt.com/");
  const { manager } = createCdpFixture({
    pages: [page],
    adapterOverrides: {
      inputSelectors: ["#prompt-textarea"],
      async hasUsableComposer() { return false; },
    },
  });

  const opened = await manager.createProviderThread("chatgpt", {
    threadKey: "session-missing:chatgpt:thread-new",
    readyTimeoutMs: 500,
  });

  assert.equal(opened.status, "composer_missing");
  assert.deepEqual(opened.diagnostics.selectors, ["#prompt-textarea"]);
  assert.equal(opened.diagnostics.timeoutMs, 500);
});

test("bound CDP pages are invalidated when the provider redirects back to login", async () => {
  const page = createPage("https://chatgpt.com/c/abc");
  const { manager } = createCdpFixture({
    pages: [page],
    adapterOverrides: {
      urlMatchesLogin(candidate) { return candidate.url().includes("/auth/login"); },
    },
  });
  await manager.bindProviderPage("chatgpt", page.currentUrl);

  page.currentUrl = "https://chatgpt.com/auth/login?next=%2Fc%2Fabc";

  await assert.rejects(
    () => manager.getPage("chatgpt"),
    (error) => error.code === "LOGIN_REQUIRED"
  );
  assert.deepEqual(manager.status().bindings, []);
});

test("binding rejects a URL from the wrong provider origin", async () => {
  const page = createPage("https://example.com/c/abc");
  const { manager } = createCdpFixture({ pages: [page] });

  await assert.rejects(
    () => manager.bindProviderPage("chatgpt", "https://example.com/c/abc"),
    (error) => error.code === "PROVIDER_URL_MISMATCH"
  );
});

test("binding refuses to navigate when the pasted tab is not already open", async () => {
  const otherPage = createPage("https://chatgpt.com/c/other");
  const { manager, context } = createCdpFixture({ pages: [otherPage] });

  await assert.rejects(
    () => manager.bindProviderPage("chatgpt", "https://chatgpt.com/c/missing"),
    (error) => error.code === "PROVIDER_TAB_NOT_FOUND"
  );
  assert.equal(context.newPageCalls, 0);
  assert.equal(otherPage.gotoCalls, 0);
});

test("binding requires a usable composer after login and verification checks", async () => {
  const page = createPage("https://chatgpt.com/c/abc");
  const { manager } = createCdpFixture({
    pages: [page],
    adapterOverrides: { async hasUsableComposer() { return false; } },
  });

  await assert.rejects(
    () => manager.bindProviderPage("chatgpt", "https://chatgpt.com/c/abc"),
    (error) => error.code === "COMPOSER_NOT_FOUND"
  );
});

test("login or verification errors never create a binding", async () => {
  const page = createPage("https://chatgpt.com/c/abc");
  const { manager } = createCdpFixture({
    pages: [page],
    adapterOverrides: {
      async assertAutomationReady() {
        throw new AutomationError("LOGIN_REQUIRED", "manual login required");
      },
    },
  });

  await assert.rejects(
    () => manager.bindProviderPage("chatgpt", "https://chatgpt.com/c/abc"),
    (error) => error.code === "LOGIN_REQUIRED"
  );
  assert.deepEqual(manager.status().bindings, []);
});

test("manual CDP mode refuses unbound access and provider opening", async () => {
  const { manager } = createCdpFixture();

  await assert.rejects(
    () => manager.getPage("chatgpt"),
    (error) => error.code === "PROVIDER_PAGE_NOT_BOUND"
  );
  await assert.rejects(
    () => manager.openProviders(["chatgpt"]),
    (error) => error.code === "MANUAL_BROWSER_NAVIGATION_DISABLED"
  );
});

test("manual CDP close disconnects local state without closing the user browser", async () => {
  const page = createPage("https://chatgpt.com/c/abc");
  const { manager, browser, context } = createCdpFixture({ pages: [page] });
  await manager.bindProviderPage("chatgpt", page.currentUrl);

  await manager.close();

  assert.equal(browser.closeCalls, 0);
  assert.equal(context.closeCalls, 0);
  assert.equal(page.closeCalls, 0);
  assert.equal(manager.status().connected, false);
  assert.deepEqual(manager.status().bindings, []);
});

test("browser status redacts launch-mode page query and hash", () => {
  const manager = new BrowserManager({
    mode: "launch",
    profileDir: ".browser-test-profile",
    adapters: new Map(),
  });
  manager.pages.set("chatgpt", createPage("https://chatgpt.com/c/abc?token=secret#private"));

  assert.equal(manager.status().pages[0].url, "https://chatgpt.com/c/abc");
});

test("credential-bearing URLs are rejected before login-state classification", () => {
  const { manager } = createCdpFixture({
    adapterOverrides: { urlMatchesLogin() { return true; } },
  });

  assert.throws(
    () => manager.validateProviderUrl("chatgpt", "https://user:password@chatgpt.com/sign_in"),
    (error) => error.code === "INVALID_PROVIDER_URL"
  );
});
