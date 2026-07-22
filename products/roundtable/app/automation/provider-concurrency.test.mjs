import assert from "node:assert/strict";
import test from "node:test";

import { ProviderConcurrency } from "./provider-concurrency.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("same browser thread is serial while different threads share the provider limit", async () => {
  const guard = new ProviderConcurrency({ defaultLimit: 2 });
  let active = 0;
  let maxActive = 0;
  const order = [];
  const operation = (label, thread, wait) => guard.run("deepseek", thread, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`${label}:start`);
    await sleep(wait);
    order.push(`${label}:end`);
    active -= 1;
  });

  await Promise.all([
    operation("a1", "thread-a", 30),
    operation("a2", "thread-a", 1),
    operation("b1", "thread-b", 10),
    operation("c1", "thread-c", 1),
  ]);

  assert.equal(maxActive, 2);
  assert.ok(order.indexOf("a2:start") > order.indexOf("a1:end"));
  assert.equal(guard.stats()[0].active, 0);
});

test("default provider concurrency is single-channel across different thread keys", async () => {
  const guard = new ProviderConcurrency();
  let active = 0;
  let maxActive = 0;
  const operation = (thread, wait) => guard.run("chatgpt", thread, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(wait);
    active -= 1;
  });

  await Promise.all([
    operation("round-1", 20),
    operation("round-2", 1),
  ]);

  assert.equal(maxActive, 1);
  assert.equal(guard.stats()[0].limit, 1);
});

test("provider congestion creates bounded adaptive backoff", () => {
  const guard = new ProviderConcurrency({ baseBackoffMs: 10, maxBackoffMs: 25 });
  assert.equal(guard.reportSignal("doubao", "OTHER"), null);
  assert.equal(guard.reportSignal("doubao", "RATE_LIMITED").delayMs, 10);
  assert.equal(guard.reportSignal("doubao", "INPUT_BUSY").delayMs, 20);
  assert.equal(guard.reportSignal("doubao", "PROVIDER_BUSY").delayMs, 25);
  guard.clearBackoff("doubao");
  assert.equal(guard.backoffs.has("doubao"), false);
});
