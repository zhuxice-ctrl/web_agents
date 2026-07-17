import { randomUUID } from "node:crypto";

export class EventBus {
  constructor({ historyLimit = 200 } = {}) {
    this.historyLimit = Math.max(0, historyLimit);
    this.listeners = new Set();
    this.events = [];
  }

  emit(event) {
    const normalized = {
      id: event.id || randomUUID(),
      at: event.at || new Date().toISOString(),
      ...event,
    };
    if (this.historyLimit > 0) {
      this.events.push(normalized);
      if (this.events.length > this.historyLimit) this.events.splice(0, this.events.length - this.historyLimit);
    }
    for (const subscription of this.listeners) {
      if (subscription.sessionId && subscription.sessionId !== normalized.sessionId) continue;
      try {
        subscription.listener(normalized);
      } catch {
        // One UI listener must not prevent runtime events reaching other listeners.
      }
    }
    return normalized;
  }

  subscribe(listener, { sessionId = null } = {}) {
    const subscription = { listener, sessionId };
    this.listeners.add(subscription);
    return () => this.listeners.delete(subscription);
  }

  history({ sessionId = null } = {}) {
    return this.events.filter((event) => !sessionId || event.sessionId === sessionId);
  }
}
