import fs from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 2;
const PENDING_SQL = "(status IN ('waiting_recovery', 'failed') OR send_state = 'SEND_UNKNOWN')";

const MIGRATIONS = [
  {
    version: 1,
    name: "initial_control_store",
    sql: `
      CREATE TABLE IF NOT EXISTS control_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS turn_executions (
        execution_id TEXT PRIMARY KEY,
        attempt_id TEXT,
        idempotency_key TEXT,
        session_id TEXT NOT NULL,
        plan_id TEXT,
        turn_id TEXT NOT NULL,
        provider_id TEXT,
        status TEXT,
        execution_phase TEXT,
        send_state TEXT,
        error_json TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_turn_executions_session ON turn_executions(session_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_turn_executions_idempotency ON turn_executions(idempotency_key, attempt_id);
      CREATE INDEX IF NOT EXISTS idx_turn_executions_pending ON turn_executions(send_state, status);
      CREATE TABLE IF NOT EXISTS page_bindings (
        page_binding_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        session_id TEXT,
        thread_key TEXT,
        browser_context_id TEXT,
        target_id TEXT,
        state TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL,
        owner_execution_id TEXT,
        url TEXT,
        page_fingerprint TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT,
        last_heartbeat_at TEXT,
        lease_expires_at TEXT,
        released_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_page_bindings_thread ON page_bindings(provider_id, session_id, thread_key);
      CREATE INDEX IF NOT EXISTS idx_page_bindings_target ON page_bindings(target_id);
      CREATE INDEX IF NOT EXISTS idx_page_bindings_state ON page_bindings(state, lease_expires_at);
    `,
  },
  {
    version: 2,
    name: "conflict_audit_and_identity_constraints",
    sql: `
      CREATE TABLE IF NOT EXISTS control_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        conflict_code TEXT NOT NULL,
        existing_json TEXT,
        incoming_json TEXT,
        detected_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_control_conflicts_entity
        ON control_conflicts(entity_type, entity_id, detected_at);
      INSERT INTO control_conflicts(
        entity_type, entity_id, conflict_code, existing_json, incoming_json, detected_at
      )
      SELECT
        'turn_execution', incoming.execution_id, 'EXECUTION_ATTEMPT_CONFLICT',
        existing.payload_json, incoming.payload_json,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM turn_executions AS incoming
      JOIN turn_executions AS existing
        ON existing.rowid = (
          SELECT candidate.rowid
          FROM turn_executions AS candidate
          WHERE candidate.idempotency_key = incoming.idempotency_key
            AND candidate.attempt_id = incoming.attempt_id
          ORDER BY candidate.updated_at DESC, candidate.rowid DESC
          LIMIT 1
        )
      WHERE incoming.idempotency_key IS NOT NULL
        AND incoming.attempt_id IS NOT NULL
        AND incoming.rowid <> existing.rowid;
      DELETE FROM turn_executions
      WHERE rowid IN (
        SELECT duplicate.rowid
        FROM turn_executions AS duplicate
        WHERE duplicate.idempotency_key IS NOT NULL
          AND duplicate.attempt_id IS NOT NULL
          AND duplicate.rowid <> (
            SELECT candidate.rowid
            FROM turn_executions AS candidate
            WHERE candidate.idempotency_key = duplicate.idempotency_key
              AND candidate.attempt_id = duplicate.attempt_id
            ORDER BY candidate.updated_at DESC, candidate.rowid DESC
            LIMIT 1
          )
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_turn_executions_attempt
        ON turn_executions(idempotency_key, attempt_id)
        WHERE idempotency_key IS NOT NULL AND attempt_id IS NOT NULL;
    `,
  },
];

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function executionFromRow(row) {
  const payload = parseJson(row.payload_json) || {};
  return {
    ...payload,
    executionId: row.execution_id,
    attemptId: row.attempt_id ?? payload.attemptId ?? null,
    idempotencyKey: row.idempotency_key ?? payload.idempotencyKey ?? null,
    sessionId: row.session_id,
    planId: row.plan_id,
    turnId: row.turn_id,
    providerId: row.provider_id,
    status: row.status,
    executionPhase: row.execution_phase,
    sendState: row.send_state,
    error: parseJson(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bindingFromRow(row) {
  const payload = parseJson(row.payload_json) || {};
  return {
    ...payload,
    pageBindingId: row.page_binding_id,
    providerId: row.provider_id,
    sessionId: row.session_id,
    threadKey: row.thread_key,
    browserContextId: row.browser_context_id,
    targetId: row.target_id,
    state: row.state,
    leaseEpoch: row.lease_epoch,
    ownerExecutionId: row.owner_execution_id,
    url: row.url,
    pageFingerprint: row.page_fingerprint,
    createdAt: row.created_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    leaseExpiresAt: row.lease_expires_at,
    releasedAt: row.released_at,
    updatedAt: row.updated_at,
  };
}

function conflictFromRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    conflictCode: row.conflict_code,
    existing: parseJson(row.existing_json),
    incoming: parseJson(row.incoming_json),
    detectedAt: row.detected_at,
  };
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function differs(left, right) {
  return (left ?? null) !== (right ?? null);
}

export class SqliteControlStore {
  constructor({ dbPath, enabled = true, sqliteLoader = () => import("node:sqlite") } = {}) {
    if (!dbPath) throw new Error("SQLITE_CONTROL_PATH_REQUIRED");
    this.dbPath = path.resolve(dbPath);
    this.enabled = Boolean(enabled);
    this.sqliteLoader = sqliteLoader;
    this.database = null;
    this.available = false;
    this.lastError = null;
    this.initialized = false;
    this.appliedSchemaVersion = 0;
    this.migrationStatus = this.enabled ? "pending" : "disabled";
    this.conflictCount = 0;
    this.lastConflict = null;
  }

  async initialize() {
    if (this.initialized) return this.describe();
    this.initialized = true;
    if (!this.enabled) return this.describe();
    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      const { DatabaseSync } = await this.sqliteLoader();
      this.database = new DatabaseSync(this.dbPath);
      this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      this.applyMigrations();
      this.available = true;
      this.refreshConflictSummary();
      this.lastError = null;
    } catch (error) {
      this.available = false;
      this.migrationStatus = "failed";
      this.lastError = { code: error?.code || "SQLITE_CONTROL_UNAVAILABLE", message: error?.message || String(error) };
      this.database?.close?.();
      this.database = null;
    }
    return this.describe();
  }

  describe() {
    return {
      enabled: this.enabled,
      available: this.available,
      mode: this.available ? (this.lastError ? "degraded" : "dual_write") : "json_fallback",
      dbPath: this.dbPath,
      schemaVersion: SCHEMA_VERSION,
      appliedSchemaVersion: this.appliedSchemaVersion,
      migrationStatus: this.migrationStatus,
      conflictCount: this.conflictCount,
      lastConflict: this.lastConflict,
      lastError: this.lastError,
    };
  }

  applyMigrations() {
    const db = this.database;
    db.exec(`
      CREATE TABLE IF NOT EXISTS control_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    let current = Number(db.prepare("PRAGMA user_version").get()?.user_version) || 0;
    if (current === 0) {
      const hasLegacyMeta = db.prepare(`
        SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'control_meta'
      `).get();
      if (hasLegacyMeta) {
        current = Number(db.prepare("SELECT value FROM control_meta WHERE key = 'schema_version'").get()?.value) || 0;
        if (current > 0) {
          const legacyMigration = MIGRATIONS.find((migration) => migration.version === current);
          db.prepare(`
            INSERT INTO control_migrations(version, name, applied_at) VALUES(?, ?, ?)
            ON CONFLICT(version) DO NOTHING
          `).run(current, legacyMigration?.name || "legacy_schema", new Date().toISOString());
          db.exec(`PRAGMA user_version=${current}`);
        }
      }
    }
    if (current > SCHEMA_VERSION) {
      const error = new Error(`SQLITE_CONTROL_SCHEMA_TOO_NEW:${current}`);
      error.code = "SQLITE_CONTROL_SCHEMA_TOO_NEW";
      throw error;
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(migration.sql);
        const appliedAt = new Date().toISOString();
        db.prepare(`
          INSERT INTO control_migrations(version, name, applied_at) VALUES(?, ?, ?)
          ON CONFLICT(version) DO UPDATE SET name=excluded.name
        `).run(migration.version, migration.name, appliedAt);
        db.prepare(`
          INSERT INTO control_meta(key, value, updated_at) VALUES('schema_version', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        `).run(String(migration.version), appliedAt);
        db.exec(`PRAGMA user_version=${migration.version}`);
        db.exec("COMMIT");
        current = migration.version;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    this.appliedSchemaVersion = current;
    this.migrationStatus = current === SCHEMA_VERSION ? "current" : "pending";
  }

  refreshConflictSummary() {
    if (!this.database || this.appliedSchemaVersion < 2) return;
    this.conflictCount = Number(this.database.prepare("SELECT COUNT(*) AS count FROM control_conflicts").get()?.count) || 0;
    const row = this.database.prepare("SELECT * FROM control_conflicts ORDER BY id DESC LIMIT 1").get();
    this.lastConflict = row ? conflictFromRow(row) : null;
  }

  requireDatabase() {
    if (!this.available || !this.database) throw Object.assign(new Error("SQLITE_CONTROL_UNAVAILABLE"), { code: "SQLITE_CONTROL_UNAVAILABLE" });
    return this.database;
  }

  transaction(operation) {
    const db = this.requireDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      this.lastError = { code: error?.code || "SQLITE_CONTROL_WRITE_FAILED", message: error?.message || String(error) };
      throw error;
    }
  }

  upsertExecution(record) {
    if (!record?.executionId) return false;
    const now = record.updatedAt || new Date().toISOString();
    const db = this.requireDatabase();
    const existing = db.prepare("SELECT * FROM turn_executions WHERE execution_id = ?").get(record.executionId);
    if (existing) {
      const identityConflict = [
        ["attempt_id", record.attemptId],
        ["idempotency_key", record.idempotencyKey],
        ["session_id", record.sessionId],
        ["turn_id", record.turnId],
      ].some(([column, incoming]) => differs(existing[column], incoming));
      if (identityConflict) {
        this.recordConflict("turn_execution", record.executionId, "EXECUTION_IDENTITY_CONFLICT", executionFromRow(existing), record);
        return false;
      }
      const existingTime = timestamp(existing.updated_at);
      const incomingTime = timestamp(now);
      if (existingTime != null && incomingTime != null && incomingTime < existingTime) {
        this.recordConflict("turn_execution", record.executionId, "EXECUTION_STALE_WRITE", executionFromRow(existing), record);
        return false;
      }
    }
    if (record.idempotencyKey && record.attemptId) {
      const claimed = db.prepare(`
        SELECT * FROM turn_executions
        WHERE idempotency_key = ? AND attempt_id = ? AND execution_id <> ?
        LIMIT 1
      `).get(record.idempotencyKey, record.attemptId, record.executionId);
      if (claimed) {
        this.recordConflict("turn_execution", record.executionId, "EXECUTION_ATTEMPT_CONFLICT", executionFromRow(claimed), record);
        return false;
      }
    }
    db.prepare(`
      INSERT INTO turn_executions(
        execution_id, attempt_id, idempotency_key, session_id, plan_id, turn_id, provider_id,
        status, execution_phase, send_state, error_json, payload_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(execution_id) DO UPDATE SET
        attempt_id=excluded.attempt_id, idempotency_key=excluded.idempotency_key,
        session_id=excluded.session_id, plan_id=excluded.plan_id, turn_id=excluded.turn_id,
        provider_id=excluded.provider_id, status=excluded.status,
        execution_phase=excluded.execution_phase, send_state=excluded.send_state,
        error_json=excluded.error_json, payload_json=excluded.payload_json,
        created_at=COALESCE(turn_executions.created_at, excluded.created_at), updated_at=excluded.updated_at
    `).run(
      record.executionId, record.attemptId || null, record.idempotencyKey || null,
      record.sessionId, record.planId || null, record.turnId, record.providerId || null,
      record.status || null, record.executionPhase || null, record.sendState || "NOT_SENT",
      json(record.error), json(record), record.createdAt || now, now,
    );
    this.lastError = null;
    return true;
  }

  importExecutions(records = []) {
    if (!this.available || !records.length) return 0;
    return this.transaction(() => {
      let count = 0;
      for (const record of records) count += Number(this.upsertExecution(record));
      return count;
    });
  }

  listExecutions({ sessionId = null, pending = false } = {}) {
    if (!this.available) return [];
    const clauses = [];
    const params = [];
    if (sessionId) { clauses.push("session_id = ?"); params.push(sessionId); }
    if (pending) clauses.push(PENDING_SQL);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.requireDatabase().prepare(`SELECT * FROM turn_executions ${where} ORDER BY updated_at, execution_id`).all(...params).map(executionFromRow);
  }

  upsertPageBinding(record) {
    if (!record?.pageBindingId) return false;
    const now = record.updatedAt || record.lastHeartbeatAt || record.releasedAt || new Date().toISOString();
    const db = this.requireDatabase();
    const existing = db.prepare("SELECT * FROM page_bindings WHERE page_binding_id = ?").get(record.pageBindingId);
    const incomingEpoch = Math.max(1, Number(record.leaseEpoch) || 1);
    if (existing && incomingEpoch < existing.lease_epoch) {
      this.recordConflict("page_binding", record.pageBindingId, "PAGE_BINDING_STALE_EPOCH", bindingFromRow(existing), record);
      return false;
    }
    if (existing && incomingEpoch === existing.lease_epoch) {
      const existingTime = timestamp(existing.updated_at);
      const incomingTime = timestamp(now);
      if (existingTime != null && incomingTime != null && incomingTime < existingTime) {
        this.recordConflict("page_binding", record.pageBindingId, "PAGE_BINDING_STALE_WRITE", bindingFromRow(existing), record);
        return false;
      }
      const identityConflict = differs(existing.provider_id, record.providerId)
        || (existing.target_id && record.targetId && differs(existing.target_id, record.targetId));
      if (identityConflict) {
        this.recordConflict("page_binding", record.pageBindingId, "PAGE_BINDING_EPOCH_CONFLICT", bindingFromRow(existing), record);
        return false;
      }
      const activeOwnerConflict = existing.state === "BUSY"
        && record.state === "BUSY"
        && existing.owner_execution_id
        && record.ownerExecutionId
        && differs(existing.owner_execution_id, record.ownerExecutionId)
        && (timestamp(existing.lease_expires_at) == null || incomingTime < timestamp(existing.lease_expires_at));
      if (activeOwnerConflict) {
        this.recordConflict("page_binding", record.pageBindingId, "PAGE_BINDING_OWNER_CONFLICT", bindingFromRow(existing), record);
        return false;
      }
    }
    db.prepare(`
      INSERT INTO page_bindings(
        page_binding_id, provider_id, session_id, thread_key, browser_context_id, target_id,
        state, lease_epoch, owner_execution_id, url, page_fingerprint, payload_json,
        created_at, last_heartbeat_at, lease_expires_at, released_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_binding_id) DO UPDATE SET
        provider_id=excluded.provider_id, session_id=excluded.session_id, thread_key=excluded.thread_key,
        browser_context_id=excluded.browser_context_id, target_id=excluded.target_id,
        state=excluded.state, lease_epoch=excluded.lease_epoch,
        owner_execution_id=excluded.owner_execution_id, url=excluded.url,
        page_fingerprint=excluded.page_fingerprint, payload_json=excluded.payload_json,
        created_at=COALESCE(page_bindings.created_at, excluded.created_at),
        last_heartbeat_at=excluded.last_heartbeat_at, lease_expires_at=excluded.lease_expires_at,
        released_at=excluded.released_at, updated_at=excluded.updated_at
    `).run(
      record.pageBindingId, record.providerId, record.sessionId || null, record.threadKey || null,
      record.browserContextId || null, record.targetId || null, record.state || "BOUND_IDLE",
      incomingEpoch, record.ownerExecutionId || null,
      record.url || null, record.pageFingerprint || null, json(record), record.createdAt || now,
      record.lastHeartbeatAt || null, record.leaseExpiresAt || null, record.releasedAt || null, now,
    );
    this.lastError = null;
    return true;
  }

  importPageBindings(records = []) {
    if (!this.available || !records.length) return 0;
    return this.transaction(() => {
      let count = 0;
      for (const record of records) count += Number(this.upsertPageBinding(record));
      return count;
    });
  }

  listPageBindings() {
    if (!this.available) return [];
    return this.requireDatabase().prepare("SELECT * FROM page_bindings ORDER BY updated_at, page_binding_id").all().map(bindingFromRow);
  }

  recordConflict(entityType, entityId, conflictCode, existing, incoming) {
    const detectedAt = new Date().toISOString();
    const result = this.requireDatabase().prepare(`
      INSERT INTO control_conflicts(
        entity_type, entity_id, conflict_code, existing_json, incoming_json, detected_at
      ) VALUES(?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, conflictCode, json(existing), json(incoming), detectedAt);
    const conflict = {
      id: Number(result.lastInsertRowid),
      entityType,
      entityId,
      conflictCode,
      existing,
      incoming,
      detectedAt,
    };
    this.conflictCount += 1;
    this.lastConflict = conflict;
    return conflict;
  }

  listConflicts({ entityType = null, limit = 100 } = {}) {
    if (!this.available) return [];
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    if (entityType) {
      return this.requireDatabase().prepare(`
        SELECT * FROM control_conflicts WHERE entity_type = ? ORDER BY id DESC LIMIT ?
      `).all(entityType, safeLimit).map(conflictFromRow);
    }
    return this.requireDatabase().prepare("SELECT * FROM control_conflicts ORDER BY id DESC LIMIT ?").all(safeLimit).map(conflictFromRow);
  }

  markDegraded(error) {
    this.lastError = { code: error?.code || "SQLITE_CONTROL_WRITE_FAILED", message: error?.message || String(error) };
  }

  close() {
    this.database?.close?.();
    this.database = null;
    this.available = false;
  }
}

export { SCHEMA_VERSION };
