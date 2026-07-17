import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPathLockKeys,
  canonicalizeWindowsPath,
  PathLockManager,
  sourceTargetLockKeys,
} from "./path-lock-manager.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("Windows paths canonicalize case, separators, dot segments, and extended prefixes", () => {
  const expected = canonicalizeWindowsPath("C:\\work\\result.txt");
  assert.equal(canonicalizeWindowsPath("c:/WORK/folder/../result.txt/"), expected);
  assert.equal(canonicalizeWindowsPath("\\\\?\\C:\\WORK\\result.txt"), expected);
  assert.equal(
    canonicalizeWindowsPath("child\\..\\result.txt", { cwd: "C:\\WORK" }),
    expected
  );
});

test("multi-path and move lock keys are deduplicated in stable order", () => {
  const keys = buildPathLockKeys([
    "C:\\work\\b.txt",
    "c:/WORK/a.txt",
    "C:\\WORK\\b.txt",
  ]);
  assert.deepEqual(keys, [...new Set(keys)].sort());
  assert.equal(keys.length, 2);

  const moveKeys = sourceTargetLockKeys({
    source: "C:\\work\\source.txt",
    destination: "C:\\work\\target.txt",
  });
  assert.equal(moveKeys.length, 2);
  assert.deepEqual(moveKeys, [...moveKeys].sort());
});

test("same canonical path serializes while unrelated paths run concurrently", async () => {
  const manager = new PathLockManager({ cwd: "C:\\work", isolated: true });
  const releaseFirst = deferred();
  const firstStarted = deferred();
  const events = [];

  const first = manager.withLocks("C:\\work\\same.txt", async () => {
    events.push("first-start");
    firstStarted.resolve();
    await releaseFirst.promise;
    events.push("first-end");
  });
  await firstStarted.promise;

  const second = manager.withLocks("c:/WORK/same.txt", async () => {
    events.push("second-start");
  });
  const unrelated = manager.withLocks("C:\\work\\other.txt", async () => {
    events.push("other-start");
  });
  await nextTurn();
  assert.deepEqual(events, ["first-start", "other-start"]);

  releaseFirst.resolve();
  await Promise.all([first, second, unrelated]);
  assert.deepEqual(events, ["first-start", "other-start", "first-end", "second-start"]);
});

test("subtree locks block descendants but not sibling exact files", async () => {
  const manager = new PathLockManager({ cwd: "C:\\work", isolated: true });
  const releaseTree = deferred();
  const treeStarted = deferred();
  let childStarted = false;
  let siblingStarted = false;

  const tree = manager.withLocks({ path: "C:\\work\\folder", subtree: true }, async () => {
    treeStarted.resolve();
    await releaseTree.promise;
  });
  await treeStarted.promise;
  const child = manager.withLocks("C:\\work\\folder\\child.txt", async () => {
    childStarted = true;
  });
  const sibling = manager.withLocks("C:\\work\\sibling.txt", async () => {
    siblingStarted = true;
  });
  await nextTurn();
  assert.equal(childStarted, false);
  assert.equal(siblingStarted, true);

  releaseTree.resolve();
  await Promise.all([tree, child, sibling]);
  assert.equal(childStarted, true);
});

test("opposite multi-path requests do not deadlock", async () => {
  const manager = new PathLockManager({ cwd: "C:\\work", isolated: true });
  const gate = deferred();
  const started = deferred();
  const order = [];
  const first = manager.withLocks(["C:\\work\\a", "C:\\work\\b"], async () => {
    order.push("first");
    started.resolve();
    await gate.promise;
  });
  await started.promise;
  const second = manager.withLocks(["C:\\work\\b", "C:\\work\\a"], async () => {
    order.push("second");
  });
  await nextTurn();
  assert.deepEqual(order, ["first"]);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
});
