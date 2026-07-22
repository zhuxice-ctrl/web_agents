import assert from "node:assert/strict";
import test from "node:test";

import { resolveThreadStatus } from "./thread-status-model.mjs";

const thread = { providerId: "doubao", status: "verified", threadKey: "current:doubao:1" };

test("verified thread requires an exact live binding", () => {
  assert.equal(resolveThreadStatus(thread, [{ providerId: "doubao", threadKey: "current:doubao:1", status: "verified", closed: false }]).state, "verified");
  assert.equal(resolveThreadStatus(thread, [{ providerId: "doubao", threadKey: "old:doubao:1", status: "verified", closed: false }]).state, "needs_reconnect");
  assert.equal(resolveThreadStatus(thread, [{ providerId: "doubao", threadKey: "current:doubao:1", status: "verified", closed: true }]).state, "needs_reconnect");
});

test("login and verification states remain actionable without a live binding", () => {
  assert.equal(resolveThreadStatus({ status: "waiting_login", threadKey: "t" }, []).state, "waiting_login");
  assert.equal(resolveThreadStatus({ status: "waiting_verification", threadKey: "t" }, []).state, "waiting_verification");
});
