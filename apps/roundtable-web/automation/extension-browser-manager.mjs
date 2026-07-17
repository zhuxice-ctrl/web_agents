import { sanitizePageUrl } from "./browser-manager.mjs";
import { AutomationError } from "./errors.mjs";

const BRIDGE_ERROR_CODES = new Set([
  "ADAPTER_NOT_READY",
  "INPUT_BUSY",
  "SUBMIT_FAILED",
  "PROVIDER_TAB_NOT_FOUND",
  "PROVIDER_URL_MISMATCH",
  "HUMAN_VERIFICATION_REQUIRED",
  "LOGIN_REQUIRED",
]);

function responseError(response, code, message, details = {}) {
  const bridgeCode = String(response?.error || "");
  return new AutomationError(
    BRIDGE_ERROR_CODES.has(bridgeCode) ? bridgeCode : code,
    bridgeCode || message,
    details,
  );
}

function statusScore(tab) {
  return Number(tab.ready) * 4 + Number(tab.authenticated) * 2 + Number(tab.canInsert);
}

export class ExtensionBrowserManager {
  constructor({ relay, adapters } = {}) {
    if (!relay) throw new Error("EXTENSION_RELAY_REQUIRED");
    this.mode = "extension";
    this.relay = relay;
    this.adapters = adapters || new Map();
    this.bindings = new Map();
    this.discoveredTabs = [];
    this.started = false;
  }

  getAdapter(providerId) {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new AutomationError("UNSUPPORTED_PROVIDER", `No browser adapter is available for ${providerId}.`, {
        providerId,
      });
    }
    return adapter;
  }

  validateStatus(providerId, status) {
    const adapter = this.getAdapter(providerId);
    if (!status || status.provider !== providerId || !Number.isInteger(status.tabId)) {
      throw new AutomationError("INVALID_BROWSER_BINDING", `${adapter.label} returned an invalid extension tab binding.`, {
        providerId,
      });
    }
    const url = sanitizePageUrl(status.url);
    if (new URL(url).origin !== new URL(adapter.url).origin) {
      throw new AutomationError("PROVIDER_URL_MISMATCH", `The extension tab does not belong to ${adapter.label}.`, {
        providerId,
      });
    }
    return { ...status, url };
  }

  syncDiscoveredTabs(tabs = [], providerIds = [...this.adapters.keys()]) {
    const requestedProviders = new Set(providerIds);
    const nextTabs = tabs.map((tab) => {
      try {
        return this.validateStatus(tab.provider, tab);
      } catch {
        return null;
      }
    }).filter(Boolean);
    this.discoveredTabs = [
      ...this.discoveredTabs.filter((tab) => !requestedProviders.has(tab.provider)),
      ...nextTabs,
    ];

    for (const providerId of requestedProviders) {
      const candidates = this.discoveredTabs
        .filter((tab) => tab.provider === providerId)
        .sort((left, right) => statusScore(right) - statusScore(left) || right.tabId - left.tabId);
      const current = this.bindings.get(providerId);
      const currentStatus = current
        ? candidates.find((candidate) => candidate.tabId === current.tabId)
        : null;
      if (
        currentStatus?.ready
        && currentStatus.authenticated
        && currentStatus.canInsert
        && !currentStatus.verificationRequired
      ) {
        this.bindings.set(providerId, {
          ...current,
          url: currentStatus.url,
          authenticated: true,
          canInsert: true,
        });
        continue;
      }
      if (current) this.bindings.delete(providerId);

      const best = candidates[0];
      if (best?.ready && best.authenticated && best.canInsert && !best.verificationRequired) {
        this.bindings.set(providerId, {
          providerId,
          tabId: best.tabId,
          url: best.url,
          status: "verified",
          authenticated: true,
          canInsert: true,
        });
      }
    }
    return this.discoveredTabs;
  }

  async discover(providerIds = [...this.adapters.keys()]) {
    const requestedProviders = [...new Set((Array.isArray(providerIds) ? providerIds : [])
      .map((providerId) => String(providerId || "").trim())
      .filter(Boolean))];
    for (const providerId of requestedProviders) this.getAdapter(providerId);
    if (requestedProviders.length === 0) {
      this.started = true;
      return [];
    }
    const response = await this.relay.dispatch({
      type: "tabs:discover-providers",
      providers: requestedProviders,
    }, { timeoutMs: 20000 });
    if (!response?.ok) {
      throw responseError(response, "EXTENSION_BRIDGE_UNAVAILABLE", "The extension could not discover provider tabs.");
    }
    this.started = true;
    return this.syncDiscoveredTabs(response.data?.tabs || [], requestedProviders);
  }

  async connect({ providers } = {}) {
    await this.discover(providers === undefined ? [...this.adapters.keys()] : providers);
    return this;
  }

  async bindProviderPage(providerId, value = {}) {
    const adapter = this.getAdapter(providerId);
    const requested = typeof value === "object" && value ? value : { url: value };
    let tabId = Number.isInteger(requested.tabId) && requested.tabId >= 0
      ? requested.tabId
      : Number.NaN;
    if (!Number.isInteger(tabId)) {
      const requestedUrl = requested.url ? sanitizePageUrl(requested.url) : null;
      if (requestedUrl && new URL(requestedUrl).origin !== new URL(adapter.url).origin) {
        throw new AutomationError("PROVIDER_URL_MISMATCH", `The pasted URL does not belong to ${adapter.label}.`, {
          providerId,
        });
      }
      await this.discover([providerId]);
      const candidates = this.discoveredTabs.filter((tab) => tab.provider === providerId);
      const selected = requestedUrl
        ? candidates.find((tab) => tab.url === requestedUrl)
        : candidates.sort((left, right) => statusScore(right) - statusScore(left))[0];
      tabId = selected?.tabId;
    }
    if (!Number.isInteger(tabId)) {
      throw new AutomationError("PROVIDER_TAB_NOT_FOUND", `No open ${adapter.label} tab was found in normal Chrome.`, {
        providerId,
      });
    }

    const response = await this.relay.dispatch({ type: "tabs:probe-provider", provider: providerId, tabId }, {
      timeoutMs: 20000,
    });
    if (!response?.ok) throw responseError(response, "PROVIDER_TAB_NOT_FOUND", `${adapter.label} tab probing failed.`, { providerId });
    const status = this.validateStatus(providerId, response.data);
    if (status.verificationRequired) {
      this.bindings.delete(providerId);
      throw new AutomationError("HUMAN_VERIFICATION_REQUIRED", `${adapter.label} requires manual human verification.`, {
        providerId,
        diagnostics: {
          reason: status.reason,
          adapterDiagnostics: status.adapterDiagnostics || null,
        },
      });
    }
    if (!status.authenticated) {
      this.bindings.delete(providerId);
      throw new AutomationError("LOGIN_REQUIRED", `${adapter.label} is not signed in.`, {
        providerId,
        reason: status.reason,
        diagnostics: {
          reason: status.reason,
          adapterDiagnostics: status.adapterDiagnostics || null,
        },
      });
    }
    if (!status.canInsert) {
      this.bindings.delete(providerId);
      const composerMissing = status.readiness === "no_input" || status.reason === "composer_not_found";
      throw new AutomationError(
        composerMissing ? "COMPOSER_NOT_FOUND" : "ADAPTER_NOT_READY",
        composerMissing
          ? `${adapter.label} has no usable composer.`
          : `${adapter.label} legacy adapter is not ready.`,
        {
          providerId,
          diagnostics: {
            reason: status.reason,
            adapterDiagnostics: status.adapterDiagnostics || null,
          },
        },
      );
    }
    const binding = {
      providerId,
      tabId: status.tabId,
      url: status.url,
      status: "verified",
      authenticated: true,
      canInsert: true,
    };
    this.bindings.set(providerId, binding);
    return { ...binding };
  }

  getBinding(providerId) {
    const binding = this.bindings.get(providerId);
    if (!binding) {
      const adapter = this.getAdapter(providerId);
      throw new AutomationError("PROVIDER_PAGE_NOT_BOUND", `${adapter.label} is not bound to a verified normal Chrome tab.`, {
        providerId,
      });
    }
    return binding;
  }

  async sendToBoundTab(providerId, request, { timeoutMs = 30000 } = {}) {
    const binding = this.getBinding(providerId);
    const response = await this.relay.dispatch({ ...request, tabId: binding.tabId }, { timeoutMs });
    if (!response?.ok) {
      throw responseError(response, "EXTENSION_TAB_COMMAND_FAILED", "The extension tab command failed.", {
        providerId,
        tabId: binding.tabId,
        type: request.type,
      });
    }
    return response.data;
  }

  async openProviders(providerIds) {
    const pages = [];
    for (const providerId of providerIds) {
      this.getAdapter(providerId);
      const response = await this.relay.dispatch({ type: "tabs:open-provider", provider: providerId }, {
        timeoutMs: 20000,
      });
      if (!response?.ok) throw responseError(response, "EXTENSION_TAB_OPEN_FAILED", `Could not open ${providerId}.`);
      pages.push({
        providerId,
        tabId: response.data.tabId,
        url: sanitizePageUrl(response.data.url),
        reused: Boolean(response.data.reused),
      });
    }
    this.started = true;
    return pages;
  }

  unbindProvider(providerId) {
    return this.bindings.delete(providerId);
  }

  forgetPage(providerId) {
    this.bindings.delete(providerId);
  }

  status() {
    const relayStatus = this.relay.status();
    const bindings = [...this.bindings.values()].map((binding) => ({ ...binding, closed: false }));
    return {
      mode: this.mode,
      started: this.started,
      connected: relayStatus.connected,
      profileDir: null,
      cdpEndpoint: null,
      channel: "chrome-extension",
      headless: false,
      bridge: relayStatus,
      bindings,
      discoveredTabs: this.discoveredTabs.map((tab) => ({ ...tab })),
      pages: bindings,
    };
  }

  async close() {
    this.bindings.clear();
    this.discoveredTabs = [];
    this.started = false;
  }
}
