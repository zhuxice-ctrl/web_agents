import assert from "node:assert/strict";
import test from "node:test";
import { captureProgressView, restoreProgressView } from "./progress-disclosure-controller.mjs";

function createNode({ open = true, scrollTop = 0, scrollHeight = 200, clientHeight = 20 } = {}) {
  const details = { open };
  const scroller = { scrollTop, scrollHeight, clientHeight };
  return {
    details,
    scroller,
    querySelector(selector) {
      return selector === "details" ? details : selector === "[data-progress-scroll]" ? scroller : null;
    },
  };
}

test("captureProgressView tracks expansion and near-bottom follow state", () => {
  const nodeAtBottom = createNode({ scrollTop: 180 });
  assert.deepEqual(captureProgressView(nodeAtBottom), { open: true, follow: true, scrollTop: 180 });
  const nodeScrolledUp = createNode({ scrollTop: 20 });
  assert.deepEqual(captureProgressView(nodeScrolledUp), { open: true, follow: false, scrollTop: 20 });
});

test("restoreProgressView preserves collapsed and user-controlled scroll state", () => {
  const collapsed = createNode({ scrollTop: 0 });
  restoreProgressView(collapsed, { open: false, follow: false, scrollTop: 20 });
  assert.equal(collapsed.details.open, false);
  assert.equal(collapsed.scroller.scrollTop, 0);

  const scrolledUp = createNode({ scrollTop: 0 });
  restoreProgressView(scrolledUp, { open: true, follow: false, scrollTop: 20 });
  assert.equal(scrolledUp.scroller.scrollTop, 20);

  const following = createNode({ scrollTop: 0 });
  restoreProgressView(following, { open: true, follow: true, scrollTop: 20 });
  assert.equal(following.scroller.scrollTop, following.scroller.scrollHeight);
});
