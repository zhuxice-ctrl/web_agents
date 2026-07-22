import assert from "node:assert/strict";
import test from "node:test";

import {
  clampConversationPercent,
  createWorkspaceSplitController,
  WORKSPACE_SPLIT_STORAGE_KEY,
} from "./workspace-split-controller.mjs";

function fakeElement({ width = 1000, left = 0 } = {}) {
  const attributes = new Map();
  const listeners = new Map();
  const properties = new Map();
  return {
    hidden: false,
    tabIndex: 0,
    captured: null,
    style: {
      setProperty(name, value) { properties.set(name, String(value)); },
      getPropertyValue(name) { return properties.get(name) || ""; },
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    getBoundingClientRect() { return { left, right: left + width, width }; },
    setPointerCapture(pointerId) { this.captured = pointerId; },
    releasePointerCapture(pointerId) { if (this.captured === pointerId) this.captured = null; },
  };
}

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function fakeMediaQuery(matches = false) {
  const listeners = [];
  return {
    matches,
    addEventListener(_type, listener) { listeners.push(listener); },
    setMatches(value) {
      this.matches = value;
      listeners.forEach((listener) => listener({ matches: value }));
    },
  };
}

test("conversation width clamps to both workspace minimums", () => {
  assert.equal(clampConversationPercent(80, { width: 1000 }), 63.2);
  assert.equal(clampConversationPercent(10, { width: 1000 }), 34);
  assert.equal(clampConversationPercent(45, { width: 1000 }), 45);
});

test("split controller restores, drags, persists, and supports keyboard adjustment", () => {
  const workspace = fakeElement({ width: 1000, left: 100 });
  const separator = fakeElement();
  const storage = fakeStorage({ [WORKSPACE_SPLIT_STORAGE_KEY]: "45" });
  const mediaQuery = fakeMediaQuery(false);
  const controller = createWorkspaceSplitController({ workspace, separator, storage, mediaQuery });

  controller.initialize();
  assert.equal(workspace.style.getPropertyValue("--conversation-width"), "45%");
  assert.equal(separator.getAttribute("aria-valuenow"), "45");

  separator.dispatch("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(workspace.style.getPropertyValue("--conversation-width"), "47%");
  assert.equal(storage.getItem(WORKSPACE_SPLIT_STORAGE_KEY), "47");
  separator.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(workspace.style.getPropertyValue("--conversation-width"), "45%");

  separator.dispatch("pointerdown", { pointerId: 7, clientX: 550, preventDefault() {} });
  separator.dispatch("pointermove", { pointerId: 7, clientX: 700, preventDefault() {} });
  assert.equal(workspace.style.getPropertyValue("--conversation-width"), "40%");
  separator.dispatch("pointerup", { pointerId: 7 });
  assert.equal(storage.getItem(WORKSPACE_SPLIT_STORAGE_KEY), "40");
  assert.equal(separator.captured, null);

  separator.dispatch("keydown", { key: "Home", preventDefault() {} });
  assert.equal(workspace.style.getPropertyValue("--conversation-width"), "34%");
  separator.dispatch("keydown", { key: "End", preventDefault() {} });
  assert.equal(workspace.style.getPropertyValue("--conversation-width"), "63.2%");
});

test("split controller disables the separator in the stacked layout", () => {
  const workspace = fakeElement();
  const separator = fakeElement();
  const mediaQuery = fakeMediaQuery(true);
  const controller = createWorkspaceSplitController({ workspace, separator, storage: fakeStorage(), mediaQuery });

  controller.initialize();
  assert.equal(separator.getAttribute("aria-disabled"), "true");
  assert.equal(separator.tabIndex, -1);
  mediaQuery.setMatches(false);
  assert.equal(separator.getAttribute("aria-disabled"), "false");
  assert.equal(separator.tabIndex, 0);
});
