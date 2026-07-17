import assert from "node:assert/strict";
import test from "node:test";

import { AutomationError } from "./errors.mjs";
import { BrowserManager } from "./browser-manager.mjs";

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
    url() { return this.currentUrl; },
    isClosed() { return this.closed; },
    async title() { return "Provider page"; },
    async goto() { this.gotoCalls += 1; },
    async close() { this.closeCalls += 1; this.closed = true; },
    async bringToFront() {},
  };
}

function createCdpFixture({ pages = [], adapterOverrides = {} } = {}) {
  const context = {
    ...eventTarget(),
    closeCalls: 0,
    newPageCalls: 0,
    pages: () => pages,
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
  return { manager, browser, context, adapter };
}

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
