import assert from "node:assert/strict";
import test from "node:test";
import {
  createConversationScrollController,
  isConversationAtBottom,
} from "./conversation-scroll-controller.mjs";

function createFixture({ scrollTop = 0, scrollHeight = 500, clientHeight = 200 } = {}) {
  const listeners = new Map();
  const scroller = {
    scrollTop,
    scrollHeight,
    clientHeight,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    scrollTo(options) {
      this.lastScroll = options;
      this.scrollTop = options.top;
    },
  };
  const button = {
    hidden: false,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  return { button, listeners, scroller };
}

test("bottom detection tolerates a small remaining distance", () => {
  assert.equal(isConversationAtBottom({ scrollHeight: 500, clientHeight: 200, scrollTop: 276 }), true);
  assert.equal(isConversationAtBottom({ scrollHeight: 500, clientHeight: 200, scrollTop: 250 }), false);
});

test("stream renders preserve the user-controlled conversation position", () => {
  const { button, scroller } = createFixture({ scrollTop: 120 });
  const controller = createConversationScrollController({ scroller, button });

  controller.preserveScroll(() => {
    scroller.scrollHeight = 900;
    scroller.scrollTop = 400;
  });

  assert.equal(scroller.scrollTop, 120);
});

test("the bottom button is hidden while generating and appears after completion", () => {
  const { button, listeners, scroller } = createFixture({ scrollTop: 80 });
  const controller = createConversationScrollController({ scroller, button, reducedMotion: false });

  controller.setState({ generating: true, hasContent: true });
  assert.equal(button.hidden, true);

  controller.setState({ generating: false, hasContent: true });
  assert.equal(button.hidden, false);

  listeners.get("click")();
  assert.deepEqual(scroller.lastScroll, { top: 500, behavior: "smooth" });
  assert.equal(button.hidden, true);

  scroller.scrollTop = 250;
  listeners.get("scroll")();
  assert.equal(button.hidden, true);
});

test("manual scrolling updates the completed-state button", () => {
  const { button, listeners, scroller } = createFixture({ scrollTop: 80 });
  const controller = createConversationScrollController({ scroller, button });
  controller.setState({ generating: false, hasContent: true });
  assert.equal(button.hidden, false);

  scroller.scrollTop = 300;
  listeners.get("scroll")();
  assert.equal(button.hidden, true);
});
