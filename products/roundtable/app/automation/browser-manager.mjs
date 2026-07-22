import fs from "node:fs/promises";
import path from "node:path";

import { AutomationError } from "./errors.mjs";
import { fingerprint as pageFingerprint, pageMarker, parsePageMarker } from "./page-lease-registry.mjs";

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

function leaseError(error, providerId) {
  if (error instanceof AutomationError || !String(error?.code || error?.message || "").startsWith("PAGE_LEASE_")) return error;
  const code = error.code || error.message;
  return new AutomationError(code, `The ${providerId} page lease is no longer valid for this execution.`, {
    providerId,
    ...(error.details || {}),
  });
}

async function waitForUsableComposer(adapter, page, { timeoutMs = 30000 } = {}) {
  const effectiveTimeoutMs = Math.max(500, Number(timeoutMs) || 30000);
  const deadline = Date.now() + effectiveTimeoutMs;
  while (Date.now() < deadline) {
    await adapter.assertAutomationReady(page, { phase: "wait_for_composer", allowSelectorFallback: true });
    if (await adapter.hasUsableComposer(page)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new AutomationError("COMPOSER_NOT_FOUND", `Could not find a usable ${adapter.label} composer.`, {
    providerId: adapter.id,
    url: page.url(),
    selectors: adapter.inputSelectors || [],
    timeoutMs: effectiveTimeoutMs,
  });
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
    leaseRegistry = null,
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
    this.leaseRegistry = leaseRegistry || null;
  }

  setLeaseRegistry(registry) {
    this.leaseRegistry = registry || null;
    return this.leaseRegistry;
  }

  async pageIdentity(page, providerId = null) {
    const url = statusPageUrl(page.url()) || page.url() || null;
    const title = await page.title().catch(() => "");
    let targetId = null;
    try {
      const session = await page.context().newCDPSession(page);
      targetId = (await session.send("Target.getTargetInfo")).targetInfo?.targetId || null;
      await session.detach().catch(() => {});
    } catch {
      // Playwright mocks and non-CDP contexts may not expose a CDP session.
    }
    return { targetId, url, pageFingerprint: pageFingerprint({ providerId, url, title }) };
  }

  async writeLeaseMarker(page, binding) {
    if (!binding?.pageBindingId) return;
    await page.evaluate((value) => {
      if (!window.name || window.name.startsWith("roundtable:")) window.name = value;
    }, pageMarker(binding.pageBindingId, binding.leaseEpoch)).catch(() => {});
  }

  async readLeaseMarker(page) {
    return parsePageMarker(await page.evaluate(() => window.name).catch(() => ""));
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
    const identity = await this.pageIdentity(page, providerId);
    const lease = this.leaseRegistry
      ? await this.leaseRegistry.reserve({ providerId, sessionId, threadKey, ...identity })
      : null;
    const binding = { page, url: sanitized, providerId, threadKey, sessionId, seatId, ...(lease || {}) };
    this.bindings.set(key, binding);
    await this.writeLeaseMarker(page, binding);
    if (lease) await this.leaseRegistry.bind(lease.pageBindingId, { ...identity, url: sanitized });
    return {
      providerId,
      ...(threadKey ? { threadKey } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(seatId ? { seatId } : {}),
      status: "verified",
      url: sanitized,
      ...(lease ? { pageBindingId: lease.pageBindingId, leaseEpoch: lease.leaseEpoch } : {}),
    };
  }

  unbindProvider(providerId, { threadKey = null } = {}) {
    const key = bindingKey(providerId, threadKey);
    const binding = this.bindings.get(key);
    const removed = this.bindings.delete(key);
    if (removed && this.leaseRegistry && binding?.pageBindingId) {
      void this.leaseRegistry.release(binding.pageBindingId, binding.leaseEpoch, null, { state: "FREE" }).catch(() => {});
    }
    return removed;
  }

  async transferPageBinding(page, { targetKey = null } = {}) {
    const conflicts = [...this.bindings.entries()]
      .filter(([key, binding]) => key !== targetKey && binding.page === page);
    for (const [, binding] of conflicts) {
      const lease = binding.pageBindingId ? this.leaseRegistry?.get(binding.pageBindingId) : null;
      const unexpired = !lease?.leaseExpiresAt || Date.parse(lease.leaseExpiresAt) > Date.now();
      if (lease?.state === "BUSY" && lease.ownerExecutionId && unexpired) {
        throw new AutomationError(
          "PROVIDER_PAGE_IN_USE",
          `${binding.providerId} page is being used by another roundtable execution.`,
          {
            providerId: binding.providerId,
            sessionId: binding.sessionId || null,
            threadKey: binding.threadKey || null,
            ownerExecutionId: lease.ownerExecutionId,
          },
        );
      }
    }
    for (const [key, binding] of conflicts) {
      this.bindings.delete(key);
      if (this.leaseRegistry && binding.pageBindingId) {
        await this.leaseRegistry.markOrphaned(binding.pageBindingId);
      }
    }
  }

  async createProviderThread(providerId, { threadKey, sessionId = null, seatId = null, navigate = true, readyTimeoutMs = 30000 } = {}) {
    if (!threadKey) throw new AutomationError("THREAD_KEY_REQUIRED", "A dedicated browser thread key is required.");
    const adapter = this.getAdapter(providerId);
    const context = this.mode === "cdp" ? await this.connect() : await this.start();
    const expectedOrigin = new URL(adapter.url).origin;
    const matchesProvider = (candidate) => {
      if (!candidate || candidate.isClosed()) return false;
      try { return new URL(candidate.url()).origin === expectedOrigin; } catch { return false; }
    };
    let page = [...this.bindings.values()]
      .reverse()
      .find((binding) => binding.providerId === providerId && matchesProvider(binding.page))
      ?.page;
    if (!page) page = context.pages().find(matchesProvider) || null;
    const reused = Boolean(page);
    if (!page) page = await context.newPage();
    const key = bindingKey(providerId, threadKey);

    if (reused) await this.transferPageBinding(page, { targetKey: key });
    const identity = await this.pageIdentity(page, providerId);
    const lease = this.leaseRegistry
      ? await this.leaseRegistry.reserve({ providerId, sessionId, threadKey, ...identity })
      : null;
    const binding = { page, url: "about:blank", providerId, threadKey, sessionId, seatId, ...(lease || {}) };
    this.bindings.set(key, binding);
    await this.writeLeaseMarker(page, binding);
    try {
      if (navigate) await page.goto(adapter.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      binding.url = statusPageUrl(page.url()) || adapter.url;
      if (this.leaseRegistry && lease) {
        const currentIdentity = await this.pageIdentity(page, providerId);
        await this.leaseRegistry.bind(lease.pageBindingId, { ...currentIdentity, url: binding.url });
        Object.assign(binding, this.leaseRegistry.get(lease.pageBindingId) || {});
      }
      let status = "opened";
      let diagnostics = null;
      try {
        await waitForUsableComposer(adapter, page, { timeoutMs: readyTimeoutMs });
        status = "verified";
      } catch (error) {
        diagnostics = error?.details || null;
        status = error?.code === "LOGIN_REQUIRED"
          ? "waiting_login"
          : error?.code === "HUMAN_VERIFICATION_REQUIRED" ? "waiting_verification"
            : error?.code === "COMPOSER_NOT_FOUND" ? "composer_missing" : "opened";
      }
      return { providerId, threadKey, sessionId, seatId, status, url: binding.url, reused, diagnostics,
        ...(lease ? { pageBindingId: lease.pageBindingId, leaseEpoch: lease.leaseEpoch } : {}) };
    } catch (error) {
      this.bindings.delete(key);
      if (this.leaseRegistry && lease?.pageBindingId) await this.leaseRegistry.markOrphaned(lease.pageBindingId);
      if (!reused) await page.close().catch(() => {});
      throw new AutomationError("PROVIDER_NAVIGATION_FAILED", `Could not open a fresh ${adapter.label} thread.`, {
        providerId,
        cause: error.message,
      });
    }
  }

  async reconnectProviderThread(providerId, { threadKey, sessionId = null, seatId = null, refresh = true } = {}) {
    if (!threadKey) throw new AutomationError("THREAD_KEY_REQUIRED", "A dedicated browser thread key is required.");
    const adapter = this.getAdapter(providerId);
    const context = this.mode === "cdp" ? await this.connect() : await this.start();
    const expectedOrigin = new URL(adapter.url).origin;
    let page = context.pages().find((candidate) => {
      try { return new URL(candidate.url()).origin === expectedOrigin; } catch { return false; }
    });
    if (!page) page = await context.newPage();
    const key = bindingKey(providerId, threadKey);
    try {
      await this.transferPageBinding(page, { targetKey: key });
      let onProvider = false;
      try { onProvider = new URL(page.url()).origin === expectedOrigin; } catch { }
      if (!onProvider) await page.goto(adapter.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      else if (refresh) await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
      await page.bringToFront().catch(() => {});
      let status = "opened";
      try {
        await adapter.assertAutomationReady(page, { phase: "reconnect_thread", allowSelectorFallback: true });
        status = (await adapter.hasUsableComposer(page)) ? "verified" : "composer_missing";
      } catch (error) {
        status = error?.code === "LOGIN_REQUIRED"
          ? "waiting_login"
          : error?.code === "HUMAN_VERIFICATION_REQUIRED" ? "waiting_verification" : "opened";
      }
      const identity = await this.pageIdentity(page, providerId);
      const existing = this.leaseRegistry?.find({ providerId, threadKey, sessionId });
      const lease = this.leaseRegistry
        ? (existing
          ? await this.leaseRegistry.bind(existing.pageBindingId, { ...identity, url: statusPageUrl(page.url()) || adapter.url })
          : await this.leaseRegistry.reserve({ providerId, sessionId, threadKey, ...identity }))
        : null;
      const boundLease = lease?.state === "RESERVED"
        ? await this.leaseRegistry.bind(lease.pageBindingId, { ...identity, url: statusPageUrl(page.url()) || adapter.url })
        : lease;
      const binding = { page, url: statusPageUrl(page.url()) || adapter.url, providerId, threadKey, sessionId, seatId, ...(boundLease || {}) };
      this.bindings.set(key, binding);
      await this.writeLeaseMarker(page, binding);
      return { providerId, threadKey, sessionId, seatId, status, url: binding.url };
    } catch (error) {
      if (error?.code === "PROVIDER_PAGE_IN_USE") throw error;
      throw new AutomationError("PROVIDER_RECONNECT_FAILED", `Could not refresh ${adapter.label}.`, {
        providerId,
        cause: error.message,
      });
    }
  }

  async acquirePage(providerId, { threadKey = null, executionId = null } = {}) {
    const page = await this.getPage(providerId, { threadKey });
    const binding = this.bindings.get(bindingKey(providerId, threadKey));
    if (this.leaseRegistry && binding?.pageBindingId && executionId) {
      let lease;
      try {
        lease = await this.leaseRegistry.acquire(binding.pageBindingId, executionId);
      } catch (error) {
        throw leaseError(error, providerId);
      }
      Object.assign(binding, lease);
      await this.writeLeaseMarker(page, binding);
      return { page, lease };
    }
    return { page, lease: binding?.pageBindingId ? { ...binding } : null };
  }

  async assertPageLease(providerId, { threadKey = null, executionId = null, leaseEpoch = null } = {}) {
    if (!this.leaseRegistry || !executionId) return null;
    const binding = this.bindings.get(bindingKey(providerId, threadKey));
    if (!binding?.pageBindingId) throw new AutomationError("PAGE_LEASE_NOT_BOUND", "The provider page has no persistent lease.");
    try {
      return await this.leaseRegistry.assert(binding.pageBindingId, leaseEpoch ?? binding.leaseEpoch, executionId);
    } catch (error) {
      throw leaseError(error, providerId);
    }
  }

  async heartbeatPageLease(providerId, { threadKey = null, executionId = null, leaseEpoch = null } = {}) {
    if (!this.leaseRegistry || !executionId) return null;
    const binding = this.bindings.get(bindingKey(providerId, threadKey));
    if (!binding?.pageBindingId) return null;
    return this.leaseRegistry.heartbeat(binding.pageBindingId, leaseEpoch ?? binding.leaseEpoch, executionId);
  }

  async releasePageLease(providerId, { threadKey = null, executionId = null, leaseEpoch = null, state = "BOUND_IDLE" } = {}) {
    if (!this.leaseRegistry || !executionId) return null;
    const binding = this.bindings.get(bindingKey(providerId, threadKey));
    if (!binding?.pageBindingId) return null;
    const lease = await this.leaseRegistry.release(binding.pageBindingId, leaseEpoch ?? binding.leaseEpoch, executionId, { state });
    Object.assign(binding, lease);
    return lease;
  }

  async reconcilePageLeases() {
    if (!this.leaseRegistry || !this.context) return { matched: [], orphaned: [], ambiguous: [] };
    const candidates = [];
    for (const page of this.context.pages()) {
      if (page.isClosed()) continue;
      const url = statusPageUrl(page.url());
      if (!url) continue;
      const providerId = [...this.adapters.entries()].find(([, adapter]) => {
        try { return new URL(adapter.url).origin === new URL(url).origin; } catch { return false; }
      })?.[0] || null;
      if (!providerId) continue;
      const marker = await this.readLeaseMarker(page);
      const identity = await this.pageIdentity(page, providerId);
      candidates.push({ page, providerId, url, ...identity, ...(marker || {}) });
    }
    const result = await this.leaseRegistry.reconcile(candidates.map(({ page, ...candidate }) => candidate));
    for (const binding of result.matched) {
      const candidate = candidates.find((item) => item.targetId === binding.targetId || item.pageBindingId === binding.pageBindingId);
      if (!candidate) continue;
      this.bindings.set(bindingKey(binding.providerId, binding.threadKey), { page: candidate.page, ...binding, seatId: null });
    }
    return result;
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
          `${adapter.label} 当前会话没有可用页面，请在席位菜单点击“重新登录/刷新”。`,
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
          `${adapter.label} 当前页面已失效，请在席位菜单点击“重新登录/刷新”。`,
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
      if (!page || binding?.page === page) {
        this.bindings.delete(key);
        if (this.leaseRegistry && binding?.pageBindingId) void this.leaseRegistry.markOrphaned(binding.pageBindingId, "INVALID").catch(() => {});
      }
      return;
    }
    if (threadKey) {
      const binding = this.bindings.get(key);
      if (!page || binding?.page === page) {
        this.bindings.delete(key);
        if (this.leaseRegistry && binding?.pageBindingId) void this.leaseRegistry.markOrphaned(binding.pageBindingId, "INVALID").catch(() => {});
      }
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
        ...(binding.pageBindingId ? { pageBindingId: binding.pageBindingId, leaseEpoch: binding.leaseEpoch, leaseState: binding.state } : {}),
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
