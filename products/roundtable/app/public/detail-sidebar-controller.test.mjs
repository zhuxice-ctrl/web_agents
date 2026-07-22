import assert from "node:assert/strict";
import test from "node:test";

import {
  createDetailSidebarController,
  DETAIL_SIDEBAR_STORAGE_KEY,
} from "./detail-sidebar-controller.mjs";

function fakeElement() {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();
  return {
    hidden: false,
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    click() { listeners.get("click")?.(); },
  };
}

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("detail sidebar controller persists collapse and restores the whole panel", () => {
  const workspace = fakeElement();
  const sidebar = fakeElement();
  const collapseButton = fakeElement();
  const restoreButton = fakeElement();
  const storage = fakeStorage();
  const controller = createDetailSidebarController({ workspace, sidebar, collapseButton, restoreButton, storage });

  controller.initialize();
  assert.equal(workspace.classList.contains("is-detail-collapsed"), false);
  assert.equal(sidebar.hidden, false);
  assert.equal(restoreButton.hidden, true);

  collapseButton.click();
  assert.equal(workspace.classList.contains("is-detail-collapsed"), true);
  assert.equal(sidebar.hidden, true);
  assert.equal(restoreButton.hidden, false);
  assert.equal(collapseButton.getAttribute("aria-expanded"), "false");
  assert.equal(storage.getItem(DETAIL_SIDEBAR_STORAGE_KEY), "true");

  restoreButton.click();
  assert.equal(workspace.classList.contains("is-detail-collapsed"), false);
  assert.equal(sidebar.hidden, false);
  assert.equal(restoreButton.hidden, true);
  assert.equal(collapseButton.getAttribute("aria-expanded"), "true");
  assert.equal(storage.getItem(DETAIL_SIDEBAR_STORAGE_KEY), "false");
});

test("detail sidebar controller restores a saved collapsed preference", () => {
  const workspace = fakeElement();
  const sidebar = fakeElement();
  const collapseButton = fakeElement();
  const restoreButton = fakeElement();
  const controller = createDetailSidebarController({
    workspace,
    sidebar,
    collapseButton,
    restoreButton,
    storage: fakeStorage({ [DETAIL_SIDEBAR_STORAGE_KEY]: "true" }),
  });

  controller.initialize();

  assert.equal(workspace.classList.contains("is-detail-collapsed"), true);
  assert.equal(sidebar.hidden, true);
  assert.equal(restoreButton.hidden, false);
});
