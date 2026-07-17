function delay(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("RUN_CANCELLED"));
    }, { once: true });
  });
}

export class ProviderConcurrency {
  constructor({ defaultLimit = 3, limits = {}, baseBackoffMs = 1000, maxBackoffMs = 30000 } = {}) {
    this.defaultLimit = Math.max(1, Number(defaultLimit) || 3);
    this.limits = new Map(Object.entries(limits).map(([key, value]) => [key, Math.max(1, Number(value) || 1)]));
    this.baseBackoffMs = baseBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
    this.providers = new Map();
    this.threadTails = new Map();
    this.backoffs = new Map();
  }

  state(providerId) {
    if (!this.providers.has(providerId)) this.providers.set(providerId, { active: 0, waiters: [] });
    return this.providers.get(providerId);
  }

  limit(providerId) {
    return this.limits.get(providerId) || this.defaultLimit;
  }

  async acquireProvider(providerId, signal) {
    const state = this.state(providerId);
    if (state.active < this.limit(providerId)) {
      state.active += 1;
      return;
    }
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      state.waiters.push(waiter);
      signal?.addEventListener("abort", () => {
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(signal.reason || new Error("RUN_CANCELLED"));
      }, { once: true });
    });
    state.active += 1;
  }

  releaseProvider(providerId) {
    const state = this.state(providerId);
    state.active = Math.max(0, state.active - 1);
    state.waiters.shift()?.resolve();
  }

  async run(providerId, threadKey, operation, { signal } = {}) {
    const key = `${providerId}:${threadKey || "default"}`;
    const previous = this.threadTails.get(key) || Promise.resolve();
    let releaseThread;
    const ticket = new Promise((resolve) => { releaseThread = resolve; });
    const tail = previous.then(() => ticket);
    this.threadTails.set(key, tail);
    await previous;
    try {
      const backoff = this.backoffs.get(providerId);
      if (backoff?.until > Date.now()) await delay(backoff.until - Date.now(), signal);
      await this.acquireProvider(providerId, signal);
      try {
        return await operation();
      } finally {
        this.releaseProvider(providerId);
      }
    } finally {
      releaseThread();
      if (this.threadTails.get(key) === tail) this.threadTails.delete(key);
    }
  }

  reportSignal(providerId, code) {
    const congestion = new Set(["RATE_LIMITED", "HUMAN_VERIFICATION_REQUIRED", "PROVIDER_BUSY", "INPUT_BUSY"]);
    if (!congestion.has(code)) return this.backoffs.get(providerId) || null;
    const previous = this.backoffs.get(providerId)?.attempts || 0;
    const attempts = previous + 1;
    const delayMs = Math.min(this.maxBackoffMs, this.baseBackoffMs * (2 ** (attempts - 1)));
    const state = { attempts, delayMs, until: Date.now() + delayMs, reason: code };
    this.backoffs.set(providerId, state);
    return state;
  }

  clearBackoff(providerId) {
    this.backoffs.delete(providerId);
  }

  stats() {
    return [...this.providers.entries()].map(([providerId, state]) => ({
      providerId,
      active: state.active,
      queued: state.waiters.length,
      limit: this.limit(providerId),
      backoff: this.backoffs.get(providerId) || null,
    }));
  }
}
