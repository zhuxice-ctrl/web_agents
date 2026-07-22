import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

import { atomicWriteJson } from "@web-agents/local-core/atomic-file";

const SCHEMA = "web-agents-page-leases.v1";
const ACTIVE_STATES = new Set(["RESERVED", "BOUND", "BOUND_IDLE", "BUSY", "RECOVERING"]);

function iso(now) {
  return new Date(now()).toISOString();
}

function fingerprint({ providerId, url, title = "" } = {}) {
  return createHash("sha256")
    .update(`${String(providerId || "")}\n${String(url || "")}\n${String(title || "")}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizeRecord(record) {
  return {
    pageBindingId: String(record.pageBindingId),
    providerId: String(record.providerId || ""),
    sessionId: record.sessionId || null,
    threadKey: record.threadKey || null,
    browserContextId: record.browserContextId || null,
    targetId: record.targetId || null,
    state: record.state || "BOUND_IDLE",
    leaseEpoch: Math.max(1, Number(record.leaseEpoch) || 1),
    ownerExecutionId: record.ownerExecutionId || null,
    url: record.url || null,
    pageFingerprint: record.pageFingerprint || null,
    createdAt: record.createdAt || new Date().toISOString(),
    lastHeartbeatAt: record.lastHeartbeatAt || null,
    leaseExpiresAt: record.leaseExpiresAt || null,
    releasedAt: record.releasedAt || null,
  };
}

export function pageMarker(pageBindingId, leaseEpoch) {
  return `roundtable:${pageBindingId}:${Number(leaseEpoch) || 1}`;
}

export function parsePageMarker(value) {
  const match = String(value || "").match(/^roundtable:([^:]+):(\d+)$/);
  return match ? { pageBindingId: match[1], leaseEpoch: Number(match[2]) } : null;
}

export class PageLeaseRegistry {
  constructor({ filePath, now = () => Date.now(), leaseTtlMs = 120000, controlStore = null } = {}) {
    if (!filePath) throw new Error("PAGE_LEASE_FILE_REQUIRED");
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.leaseTtlMs = Math.max(5000, Number(leaseTtlMs) || 120000);
    this.records = new Map();
    this.lock = Promise.resolve();
    this.initialized = false;
    this.controlStore = controlStore || null;
  }

  setControlStore(controlStore) {
    this.controlStore = controlStore || null;
    return this.controlStore;
  }

  async initialize() {
    if (this.initialized) return this;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const jsonRecords = new Map();
    try {
      const payload = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      for (const record of payload.records || []) {
        if (record?.pageBindingId) jsonRecords.set(record.pageBindingId, normalizeRecord(record));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.records = new Map(jsonRecords);
    if (this.controlStore?.available) {
      try {
        const sqliteRecords = this.controlStore.listPageBindings();
        if (sqliteRecords.length) {
          const sqliteIds = new Set(sqliteRecords.map((record) => record.pageBindingId));
          const jsonOnly = [...jsonRecords.values()].filter((record) => !sqliteIds.has(record.pageBindingId));
          if (jsonOnly.length) this.controlStore.importPageBindings(jsonOnly);
        } else if (jsonRecords.size) {
          this.controlStore.importPageBindings([...jsonRecords.values()]);
        }
        const primaryRecords = this.controlStore.listPageBindings();
        this.records = new Map();
        for (const record of primaryRecords) {
          if (record?.pageBindingId) this.records.set(record.pageBindingId, normalizeRecord(record));
        }
        await this.writeJsonSnapshot();
      } catch (error) {
        this.controlStore.markDegraded?.(error);
        this.records = new Map(jsonRecords);
      }
    }
    this.initialized = true;
    return this;
  }

  async writeJsonSnapshot() {
    await atomicWriteJson(this.filePath, {
      schema: SCHEMA,
      updatedAt: new Date(this.now()).toISOString(),
      records: [...this.records.values()],
    });
  }

  async withLock(operation) {
    await this.initialize();
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async persist() {
    await this.writeJsonSnapshot();
    if (this.controlStore?.available) {
      try {
        const records = [...this.records.values()];
        const accepted = this.controlStore.importPageBindings(records);
        if (accepted < records.length) {
          this.records = new Map(this.controlStore.listPageBindings().map((record) => [
            record.pageBindingId,
            normalizeRecord(record),
          ]));
          await this.writeJsonSnapshot();
        }
      } catch (error) {
        this.controlStore.markDegraded?.(error);
      }
    }
  }

  list() {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  get(pageBindingId) {
    const record = this.records.get(String(pageBindingId));
    return record ? { ...record } : null;
  }

  find({ providerId, threadKey = null, sessionId = null } = {}) {
    return this.list().find((record) => record.providerId === providerId
      && (threadKey == null || record.threadKey === threadKey)
      && (sessionId == null || record.sessionId === sessionId)
      && ACTIVE_STATES.has(record.state)) || null;
  }

  async reserve(details = {}) {
    return this.withLock(async () => {
      const existing = this.find(details);
      const now = new Date(this.now()).toISOString();
      const record = normalizeRecord({
        ...(existing || {}),
        ...details,
        pageBindingId: existing?.pageBindingId || details.pageBindingId || randomUUID(),
        state: "RESERVED",
        leaseEpoch: (existing?.leaseEpoch || 0) + 1,
        ownerExecutionId: details.ownerExecutionId || null,
        createdAt: existing?.createdAt || now,
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(this.now() + this.leaseTtlMs).toISOString(),
        releasedAt: null,
      });
      this.records.set(record.pageBindingId, record);
      await this.persist();
      return { ...record };
    });
  }

  async bind(pageBindingId, details = {}) {
    return this.withLock(async () => {
      const current = this.records.get(String(pageBindingId));
      if (!current) throw new Error("PAGE_LEASE_NOT_FOUND");
      const record = normalizeRecord({
        ...current,
        ...details,
        pageBindingId: current.pageBindingId,
        state: details.state || "BOUND_IDLE",
        ownerExecutionId: details.ownerExecutionId || null,
        lastHeartbeatAt: new Date(this.now()).toISOString(),
        leaseExpiresAt: null,
        releasedAt: null,
      });
      this.records.set(record.pageBindingId, record);
      await this.persist();
      return { ...record };
    });
  }

  async acquire(pageBindingId, ownerExecutionId) {
    if (!ownerExecutionId) throw new Error("PAGE_LEASE_OWNER_REQUIRED");
    return this.withLock(async () => {
      const current = this.records.get(String(pageBindingId));
      if (!current || !ACTIVE_STATES.has(current.state)) throw new Error("PAGE_LEASE_INVALID");
      const now = this.now();
      const expired = current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) <= now;
      if (current.state === "BUSY" && !expired && current.ownerExecutionId !== ownerExecutionId) {
        const error = new Error("PAGE_LEASE_BUSY");
        error.code = "PAGE_LEASE_BUSY";
        throw error;
      }
      const record = normalizeRecord({
        ...current,
        state: "BUSY",
        ownerExecutionId: String(ownerExecutionId),
        lastHeartbeatAt: new Date(now).toISOString(),
        leaseExpiresAt: new Date(now + this.leaseTtlMs).toISOString(),
      });
      this.records.set(record.pageBindingId, record);
      await this.persist();
      return { ...record };
    });
  }

  async assert(pageBindingId, leaseEpoch, ownerExecutionId = null) {
    await this.initialize();
    const record = this.records.get(String(pageBindingId));
    const expired = record?.leaseExpiresAt && Date.parse(record.leaseExpiresAt) <= this.now();
    if (!record || !ACTIVE_STATES.has(record.state) || record.leaseEpoch !== Number(leaseEpoch)
      || (ownerExecutionId && record.ownerExecutionId !== ownerExecutionId)
      || (record.state === "BUSY" && expired)) {
      const error = new Error("PAGE_LEASE_STALE");
      error.code = "PAGE_LEASE_STALE";
      error.details = { pageBindingId, leaseEpoch, ownerExecutionId, current: record || null };
      throw error;
    }
    return { ...record };
  }

  async heartbeat(pageBindingId, leaseEpoch, ownerExecutionId) {
    return this.withLock(async () => {
      const current = await this.assert(pageBindingId, leaseEpoch, ownerExecutionId);
      const now = this.now();
      const record = normalizeRecord({ ...current, lastHeartbeatAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + this.leaseTtlMs).toISOString() });
      this.records.set(record.pageBindingId, record);
      await this.persist();
      return { ...record };
    });
  }

  async release(pageBindingId, leaseEpoch, ownerExecutionId = null, { state = "BOUND_IDLE" } = {}) {
    return this.withLock(async () => {
      const current = await this.assert(pageBindingId, leaseEpoch, ownerExecutionId);
      const record = normalizeRecord({ ...current, state, ownerExecutionId: null, leaseExpiresAt: null, releasedAt: state === "FREE" ? new Date(this.now()).toISOString() : null, lastHeartbeatAt: new Date(this.now()).toISOString() });
      this.records.set(record.pageBindingId, record);
      await this.persist();
      return { ...record };
    });
  }

  async markOrphaned(pageBindingId, state = "ORPHANED") {
    return this.withLock(async () => {
      const current = this.records.get(String(pageBindingId));
      if (!current) return null;
      const record = normalizeRecord({ ...current, state, ownerExecutionId: null, leaseExpiresAt: null, releasedAt: new Date(this.now()).toISOString() });
      this.records.set(record.pageBindingId, record);
      await this.persist();
      return { ...record };
    });
  }

  async reconcile(candidates = []) {
    return this.withLock(async () => {
      const available = candidates.map((candidate) => ({
        providerId: candidate.providerId || null,
        browserContextId: candidate.browserContextId || null,
        targetId: candidate.targetId || null,
        url: candidate.url || null,
        pageFingerprint: candidate.pageFingerprint || null,
        pageBindingId: candidate.pageBindingId || null,
        leaseEpoch: Number(candidate.leaseEpoch) || null,
      }));
      const matched = [];
      const ambiguous = [];
      const orphaned = [];
      for (const record of this.records.values()) {
        if (!ACTIVE_STATES.has(record.state)) continue;
        const byTarget = record.targetId ? available.filter((candidate) => candidate.targetId === record.targetId) : [];
        const byMarker = available.filter((candidate) => candidate.pageBindingId === record.pageBindingId && Number(candidate.leaseEpoch) === record.leaseEpoch);
        const byFingerprint = record.pageFingerprint ? available.filter((candidate) => candidate.pageFingerprint === record.pageFingerprint && candidate.providerId === record.providerId) : [];
        const options = byTarget.length ? byTarget : byMarker.length ? byMarker : byFingerprint;
        if (options.length === 1) {
          const candidate = options[0];
          Object.assign(record, candidate, { state: "BOUND_IDLE", ownerExecutionId: null, leaseExpiresAt: null, lastHeartbeatAt: new Date(this.now()).toISOString() });
          matched.push({ ...record });
          continue;
        }
        if (options.length > 1) {
          record.state = "RECOVERING";
          record.ownerExecutionId = null;
          record.leaseExpiresAt = null;
          ambiguous.push({ ...record, candidates: options });
        }
        else orphaned.push({ ...record });
      }
      for (const record of orphaned) {
        const current = this.records.get(record.pageBindingId);
        if (current) {
          current.state = "ORPHANED";
          current.ownerExecutionId = null;
          current.leaseExpiresAt = null;
          record.state = "ORPHANED";
        }
      }
      for (const record of matched) this.records.set(record.pageBindingId, record);
      if (orphaned.length || matched.length || ambiguous.length) await this.persist();
      return { matched, orphaned, ambiguous };
    });
  }
}

export { ACTIVE_STATES, SCHEMA, fingerprint };
