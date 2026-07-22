import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PageLeaseRegistry, pageMarker, parsePageMarker } from "./page-lease-registry.mjs";

async function tempRegistry(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roundtable-leases-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new PageLeaseRegistry({ filePath: path.join(root, "page-leases.json") });
  await registry.initialize();
  return registry;
}

test("page lease registry persists epochs and rejects stale owners", async (t) => {
  const registry = await tempRegistry(t);
  const reserved = await registry.reserve({ providerId: "chatgpt", sessionId: "s1", threadKey: "t1", targetId: "target-1" });
  await registry.bind(reserved.pageBindingId, { url: "https://chatgpt.com/" });
  const acquired = await registry.acquire(reserved.pageBindingId, "exec-1");
  assert.equal(acquired.state, "BUSY");
  await assert.rejects(() => registry.assert(reserved.pageBindingId, acquired.leaseEpoch, "exec-old"), /PAGE_LEASE_STALE/);
  await registry.release(reserved.pageBindingId, acquired.leaseEpoch, "exec-1");

  const restored = new PageLeaseRegistry({ filePath: registry.filePath });
  await restored.initialize();
  assert.equal(restored.get(reserved.pageBindingId).leaseEpoch, reserved.leaseEpoch);
  assert.equal(restored.get(reserved.pageBindingId).state, "BOUND_IDLE");

  const reassigned = await restored.reserve({ providerId: "chatgpt", sessionId: "s1", threadKey: "t1", targetId: "target-2" });
  assert.equal(reassigned.pageBindingId, reserved.pageBindingId);
  assert.equal(reassigned.leaseEpoch, reserved.leaseEpoch + 1);
  await assert.rejects(() => restored.assert(reserved.pageBindingId, reserved.leaseEpoch), /PAGE_LEASE_STALE/);
});

test("ambiguous reconciliation never binds a page automatically", async (t) => {
  const registry = await tempRegistry(t);
  const binding = await registry.reserve({ providerId: "chatgpt", threadKey: "thread-a", pageFingerprint: "same" });
  await registry.bind(binding.pageBindingId, { url: "https://chatgpt.com/" });
  const result = await registry.reconcile([
    { providerId: "chatgpt", targetId: "one", pageFingerprint: "same", url: "https://chatgpt.com/" },
    { providerId: "chatgpt", targetId: "two", pageFingerprint: "same", url: "https://chatgpt.com/" },
  ]);
  assert.equal(result.matched.length, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(registry.get(binding.pageBindingId).state, "RECOVERING");
});

test("reconciliation matches target ids and marks missing pages orphaned", async (t) => {
  const registry = await tempRegistry(t);
  const first = await registry.reserve({ providerId: "deepseek", threadKey: "thread-a", targetId: "target-a", pageFingerprint: "fp-a" });
  await registry.bind(first.pageBindingId, { url: "https://chat.deepseek.com/" });
  const second = await registry.reserve({ providerId: "doubao", threadKey: "thread-b", targetId: "target-b", pageFingerprint: "fp-b" });
  await registry.bind(second.pageBindingId, { url: "https://doubao.com/" });
  const result = await registry.reconcile([
    { providerId: "deepseek", targetId: "target-a", url: "https://chat.deepseek.com/", pageFingerprint: "fp-a" },
  ]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.orphaned.length, 1);
  assert.equal(registry.get(second.pageBindingId).state, "ORPHANED");
});

test("page markers are stable and parseable", () => {
  const marker = pageMarker("binding-1", 4);
  assert.deepEqual(parsePageMarker(marker), { pageBindingId: "binding-1", leaseEpoch: 4 });
});
