import assert from "node:assert/strict";
import test from "node:test";

import {
  hardenRenderedLinks,
  markdownForEvent,
  renderSafeMarkdown,
} from "./conversation-renderer.mjs";

const rawEvent = {
  content: "# 模型原文\n\n这是实际回复。",
  metadata: {
    structureStatus: "valid",
    structuredReply: {
      summary: "程序派生摘要",
      claims: ["派生主张"],
    },
  },
};

test("event markdown always uses authoritative raw content", () => {
  assert.equal(markdownForEvent(rawEvent), rawEvent.content);
  assert.doesNotMatch(markdownForEvent(rawEvent), /程序派生摘要|派生主张/);
  assert.equal(markdownForEvent({ content: "# 原始标题", metadata: {} }), "# 原始标题");
});

test("safe markdown rendering always parses before sanitizing", () => {
  const calls = [];
  const html = renderSafeMarkdown("# 标题", {
    parse(source, options) {
      calls.push(["parse", source, options.gfm]);
      return "<h1>标题</h1><script>x()</script>";
    },
    sanitize(value, options) {
      calls.push(["sanitize", value, options.FORBID_TAGS]);
      return value.replace(/<script.*?<\/script>/s, "");
    },
  });

  assert.equal(html, "<h1>标题</h1>");
  assert.deepEqual(calls[0], ["parse", "# 标题", true]);
  assert.equal(calls[1][0], "sanitize");
  assert.ok(calls[1][2].includes("script"));
});

test("renderer falls back to escaped plain text when parsing fails", () => {
  const html = renderSafeMarkdown("<img src=x onerror=alert(1)>\nnext", {
    parse() { throw new Error("broken parser"); },
    sanitize(value) { return value; },
  });

  assert.equal(html, "<p class=\"markdown-fallback\">&lt;img src=x onerror=alert(1)&gt;<br>next</p>");
});

test("rendered links reject dangerous protocols and harden external targets", () => {
  const anchors = [
    fakeAnchor("javascript:alert(1)"),
    fakeAnchor("https://example.com/path"),
    fakeAnchor("/local/path"),
    fakeAnchor("mailto:test@example.com"),
  ];
  hardenRenderedLinks({ querySelectorAll: () => anchors }, { origin: "http://127.0.0.1:3020" });

  assert.equal(anchors[0].getAttribute("href"), null);
  assert.equal(anchors[1].getAttribute("target"), "_blank");
  assert.equal(anchors[1].getAttribute("rel"), "noopener noreferrer");
  assert.equal(anchors[2].getAttribute("target"), null);
  assert.equal(anchors[3].getAttribute("target"), "_blank");
});

function fakeAnchor(href) {
  const attributes = new Map([["href", href]]);
  return {
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
  };
}
