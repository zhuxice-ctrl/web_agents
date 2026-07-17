import fs from "node:fs/promises";
import path from "node:path";

import { AutomationError } from "./errors.mjs";

function sanitizePageUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new AutomationError("INVALID_PROVIDER_URL", "The provider URL is invalid.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new AutomationError("INVALID_PROVIDER_URL", "Provider pages must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new AutomationError("INVALID_PROVIDER_URL", "Provider URLs must not contain credentials.");
  }
  return `${parsed.origin}${parsed.pathname}`;
}

function assertLoopbackEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("INVALID_CDP_ENDPOINT");
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error("CDP_ENDPOINT_MUST_BE_LOOPBACK");
  }
  return parsed.href.replace(/\/$/, "");
}

function statusPageUrl(value) {
  try {
    return sanitizePageUrl(value);
  } catch {
    return null;
  }
}

function bindingKey(providerId, threadKey = null) {
  return threadKey ? `${providerId}::${threadKey}` : providerId;
}

export class BrowserManager {
  constructor({
    mode = "launch",
    profileDir = null,
    cdpEndpoint = "http://127.0.0.1:9223",
    connectOverCDP = null,
    adapters,
    headless = false,
    channel = "chrome",
    viewport = { width: 1440, height: 1000 },
    launchOptions = {},
  } = {}) {
    this.mode = mode === "cdp" ? "cdp" : "launch";
    if (this.mode === "launch" && !profileDir) throw new Error("BROWSER_PROFILE_DIR_REQUIRED");
    this.profileDir = profileDir ? path.resolve(profileDir) : null;
    this.cdpEndpoint = assertLoopbackEndpoint(cdpEndpoint);
    this.connectOverCDP = connectOverCDP;
    this.adapters = adapters || new Map();
    this.headless = headless;
    this.channel = channel;
    this.viewport = viewport;
    this.launchOptions = launchOptions;
    this.browser = null;
    this.context = null;
    this.pages = new Map();
    this.bindings = new Map();
    this.startPromise = null;
  }

  async loadChromium() {
    try {
      return (await import("playwright")).chromium;
    } catch (error) {
      throw new AutomationError("PLAYWRIGHT_UNAVAILABLE", "Playwright is not installed in this repository.", {
        cause: error.message,
      });
    }
  }

  async start() {
    if (this.mode === "cdp") return this.connect();
    if (this.context) return this.context;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      await fs.mkdir(this.profileDir, { recursive: true });
      const chromium = await this.loadChromium();
      const options = {
        headless: this.headless,
        viewport: this.viewport,
        acceptDownloads: false,
        args: ["--disable-session-crashed-bubble", "--no-default-browser-check"],
        ...this.launchOptions,
      };
      if (this.channel) options.channel = this.channel;
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, options);
      } catch (error) {
        throw new AutomationError("BROWSER_LAUNCH_FAILED", `Could not launch the persistent ${this.channel || "Chromium"} browser.`, {
          profileDir: this.profileDir,
          channel: this.channel,
          cause: error.message,
        });
      }
      this.context.on("close", () => this.resetConnection());
      return this.context;
    })();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async connect() {
    if (this.mode !== "cdp") return this.start();
    if (this.context) return this.context;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      try {
        const chromium = this.connectOverCDP ? null : await this.loadChromium();
        const connector = this.connectOverCDP || chromium.connectOverCDP.bind(chromium);
        this.browser = await connector(this.cdpEndpoint);
        this.context = this.browser.contexts()[0] || null;
        if (!this.context) throw new Error("CDP browser has no default context");
        this.browser.on?.("disconnected", () => this.resetConnection());
        this.context.on?.("close", () => this.resetConnection());
        return this.context;
      } catch (error) {
        this.resetConnection();
        if (error instanceof AutomationError) throw error;
        throw new AutomationError(
          "MANUAL_BROWSER_UNAVAILABLE",
          "The user-started Web Agents browser is not available.",
          { endpoint: this.cdpEndpoint, cause: error.message }
        );
      }
    })();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  resetConnection() {
    this.browser = null;
    this.context = null;
    this.pages.clear();
    this.bindings.clear();
  }

  getAdapter(providerId) {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new AutomationError("UNSUPPORTED_PROVIDER", `No browser adapter is available for ${providerId}.`, { providerId });
    }
    return adapter;
  }

  validateProviderUrl(providerId, value) {
    const adapter = this.getAdapter(providerId);
    const sanitized = sanitizePageUrl(value);
    const expected = new URL(adapter.url);
    const actual = new URL(sanitized);
    if (actual.origin !== expected.origin) {
      throw new AutomationError("PROVIDER_URL_MISMATCH", `The pasted URL does not belong to ${adapter.label}.`, {
        providerId,
        expectedOrigin: expected.origin,
        actualOrigin: actual.origin,
      });
    }
    if (adapter.urlMatchesLogin?.({ url: () => sanitized })) {
      throw new AutomationError("LOGIN_REQUIRED", `${adapter.label} requires manual login before it can be bound.`, {
        providerId,
      });
    }
    return sanitized;
  }

  async bindProviderPage(providerId, value, { threadKey = null, sessionId = null, seatId = null } = {}) {
    const adapter = this.getAdapter(providerId);
    const sanitized = this.validateProviderUrl(providerId, value);
    const context = await this.connect();
    const page = context.pages().find((candidate) => {
      try {
        return sanitizePageUrl(candidate.url()) === sanitized;
      } catch {
        return false;
      }
    });
    if (!page) {
      throw new AutomationError(
        "PROVIDER_TAB_NOT_FOUND",
        `No existing ${adapter.label} tab matches the pasted URL in the manual browser.`,
        { providerId, url: sanitized }
      );
    }
    await adapter.assertAutomationReady(page, { phase: "bind_provider", allowSelectorFallback: true });
    if (!(await adapter.hasUsableComposer(page))) {
      throw new AutomationError("COMPOSER_NOT_FOUND", `The existing ${adapter.label} tab has no usable composer.`, {
        providerId,
        url: sanitized,
      });
    }
    const key = bindingKey(providerId, threadKey);
    this.bindings.set(key, { page, url: sanitized, providerId, threadKey, sessionId, seatId });
    return {
      providerId,
      ...(threadKey ? { threadKey } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(seatId ? { seatId } : {}),
      status: "verified",
      url: sanitized,
    };
  }

  unbindProvider(providerId, { threadKey = null } = {}) {
    return this.bindings.delete(bindingKey(providerId, threadKey));
  }

  async createProviderThread(providerId, { threadKey, sessionId = null, seatId = null, navigate = true } = {}) {
    if (!threadKey) throw new AutomationError("THREAD_KEY_REQUIRED", "A dedicated browser thread key is required.");
    const adapter = this.getAdapter(providerId);
    const context = this.mode === "cdp" ? await this.connect() : await this.start();
    const page = await context.newPage();
    const key = bindingKey(providerId, threadKey);
    const binding = { page, url: "about:blank", providerId, threadKey, sessionId, seatId };
    this.bindings.set(key, binding);
    try {
      if (navigate) await page.goto(adapter.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      binding.url = statusPageUrl(page.url()) || adapter.url;
      let status = "opened";
      try {
        await adapter.assertAutomationReady(page, { phase: "create_thread", allowSelectorFallback: true });
        status = (await adapter.hasUsableComposer(page)) ? "verified" : "composer_missing";
      } catch (error) {
        status = error?.code === "LOGIN_REQUIRED"
          ? "waiting_login"
          : error?.code === "HUMAN_VERIFICATION_REQUIRED" ? "waiting_verification" : "opened";
      }
      return { providerId, threadKey, sessionId, seatId, status, url: binding.url };
    } catch (error) {
      this.bindings.delete(key);
      await page.close().catch(() => {});
      throw new AutomationError("PROVIDER_NAVIGATION_FAILED", `Could not open a fresh ${adapter.label} thread.`, {
        providerId,
        cause: error.message,
      });
    }
  }

  async getPage(providerId, { navigate = true, threadKey = null } = {}) {
    const adapter = this.getAdapter(providerId);
    if (this.mode === "cdp") {
      const key = bindingKey(providerId, threadKey);
      const binding = this.bindings.get(key);
      if (!binding || binding.page.isClosed()) {
        this.bindings.delete(key);
        throw new AutomationError(
          "PROVIDER_PAGE_NOT_BOUND",
          `${adapter.label} has not been bound to a verified existing tab.`,
          { providerId }
        );
      }
      try {
        binding.url = this.validateProviderUrl(providerId, binding.page.url());
      } catch (error) {
        this.bindings.delete(key);
        if (error?.code === "LOGIN_REQUIRED") throw error;
        throw new AutomationError(
          "PROVIDER_PAGE_NOT_BOUND",
          `${adapter.label} is no longer on a verified provider page. Paste its current URL and validate it again.`,
          { providerId, reason: error?.code || "PROVIDER_URL_CHANGED" }
        );
      }
      return binding.page;
    }

    const context = await this.start();
    const key = bindingKey(providerId, threadKey);
    let page = threadKey ? this.bindings.get(key)?.page : this.pages.get(providerId);
    if (!page || page.isClosed()) {
      page = await context.newPage();
      if (threadKey) this.bindings.set(key, { page, url: "about:blank", providerId, threadKey });
      else this.pages.set(providerId, page);
    }
    if (navigate && !this.isAtProviderUrl(page.url(), adapter.url)) {
      try {
        await page.goto(adapter.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch (error) {
        throw new AutomationError("PROVIDER_NAVIGATION_FAILED", `Could not open ${adapter.label}.`, {
          providerId,
          url: adapter.url,
          cause: error.message,
        });
      }
    }
    await page.bringToFront().catch(() => {});
    return page;
  }

  isAtProviderUrl(currentUrl, targetUrl) {
    if (!currentUrl || currentUrl === "about:blank") return false;
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);
      if (current.origin !== target.origin) return false;
      if (target.hostname === "127.0.0.1" || target.hostname === "localhost") return current.pathname === target.pathname;
      return true;
    } catch {
      return false;
    }
  }

  async openProviders(providerIds) {
    if (this.mode === "cdp") {
      throw new AutomationError(
        "MANUAL_BROWSER_NAVIGATION_DISABLED",
        "Provider pages must be opened and authenticated manually by the user."
      );
    }
    const results = [];
    for (const providerId of providerIds) {
      const page = await this.getPage(providerId);
      results.push({ providerId, url: page.url(), title: await page.title().catch(() => "") });
    }
    return results;
  }

  forgetPage(providerId, page = null, { threadKey = null } = {}) {
    const key = bindingKey(providerId, threadKey);
    if (this.mode === "cdp") {
      const binding = this.bindings.get(key);
      if (!page || binding?.page === page) this.bindings.delete(key);
      return;
    }
    if (threadKey) {
      const binding = this.bindings.get(key);
      if (!page || binding?.page === page) this.bindings.delete(key);
      return;
    }
    const current = this.pages.get(providerId);
    if (!page || current === page) this.pages.delete(providerId);
  }

  status() {
    const bindings = [];
    for (const [key, binding] of this.bindings.entries()) {
      const providerId = binding.providerId || key.split("::", 1)[0];
      if (binding.page.isClosed()) {
        bindings.push({ providerId, status: "closed", url: binding.url, closed: true });
        continue;
      }
      try {
        binding.url = this.validateProviderUrl(providerId, binding.page.url());
      } catch {
        this.bindings.delete(key);
        continue;
      }
      bindings.push({
        providerId,
        ...(binding.threadKey ? { threadKey: binding.threadKey } : {}),
        ...(binding.sessionId ? { sessionId: binding.sessionId } : {}),
        ...(binding.seatId ? { seatId: binding.seatId } : {}),
        status: "verified",
        url: binding.url,
        closed: false,
      });
    }
    return {
      mode: this.mode,
      started: Boolean(this.context),
      connected: Boolean(this.context),
      profileDir: this.profileDir,
      cdpEndpoint: this.mode === "cdp" ? this.cdpEndpoint : null,
      channel: this.channel,
      headless: this.headless,
      bindings,
      pages: this.mode === "cdp" ? bindings : [...this.pages.entries()].map(([providerId, page]) => ({
        providerId,
        url: page.isClosed() ? null : statusPageUrl(page.url()),
        closed: page.isClosed(),
      })),
    };
  }

  async close() {
    if (this.mode === "cdp") {
      // Disconnecting the local client must not close the user's manually owned browser.
      this.resetConnection();
      return;
    }
    const context = this.context;
    this.resetConnection();
    if (context) await context.close().catch(() => {});
  }
}

export { assertLoopbackEndpoint, bindingKey, sanitizePageUrl, statusPageUrl };
