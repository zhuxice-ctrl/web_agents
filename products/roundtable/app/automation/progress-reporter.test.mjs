import assert from "node:assert/strict";
import test from "node:test";

import { createProgressReporter, normalizeProgressText } from "./progress-reporter.mjs";

test("progress reporter preserves markdown and throttles changed snapshots", async () => {
  let now = 0;
  const snapshots = [];
  const reporter = createProgressReporter({
    onProgress: async (snapshot) => snapshots.push(snapshot),
    now: () => now,
    throttleMs: 400,
  });

  assert.equal(normalizeProgressText("# 标题  \r\n\r\n\r\n正文  "), "# 标题\n\n正文");
  assert.equal(await reporter.report({ text: "x" }), false);
  assert.equal(await reporter.report({ text: "# 部分\n\n- A" }), true);
  assert.equal(await reporter.report({ text: "# 部分\n\n- A" }), false);
  now = 200;
  assert.equal(await reporter.report({ text: "# 完整\n\n- A\n- B" }), false);
  now = 400;
  assert.equal(await reporter.report({ text: "# 完整\n\n- A\n- B" }), true);

  assert.deepEqual(snapshots.map((snapshot) => snapshot.text), ["# 部分\n\n- A", "# 完整\n\n- A\n- B"]);
});

test("a failing progress callback never escapes into response capture", async () => {
  const reporter = createProgressReporter({
    onProgress: async () => { throw new Error("UI disconnected"); },
    now: () => 1000,
  });

  await assert.doesNotReject(() => reporter.report({ text: "仍然生成最终结果" }));
  assert.equal(await reporter.report({ text: "仍然生成最终结果" }), false);
});
