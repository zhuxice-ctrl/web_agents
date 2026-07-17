import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResponseText, selectNewResponseCandidate } from "./completion-detector.mjs";
import { ChatGptAdapter } from "./adapters/chatgpt.mjs";

test("completion detector normalizes streaming whitespace", () => {
  assert.equal(normalizeResponseText("  hello  \n\n\n world \r\n"), "hello\n\n world");
});

test("completion detector returns the newest response absent from baseline", () => {
  const baseline = [{ selector: ".reply", index: 0, identity: "reply-1", text: "old reply" }];
  const current = [
    { selector: ".reply", index: 0, identity: "reply-1", text: "old reply" },
    { selector: ".reply", index: 1, identity: "reply-2", text: "new reply" },
  ];
  assert.equal(selectNewResponseCandidate(current, baseline).text, "new reply");
});

test("completion detector accepts an identical reply from a new message node", () => {
  const baseline = [{ selector: ".reply", index: 0, identity: "reply-1", text: "EXACT_TOKEN" }];
  const current = [
    { selector: ".reply", index: 0, identity: "reply-1", text: "EXACT_TOKEN" },
    { selector: ".reply", index: 1, identity: "reply-2", text: "EXACT_TOKEN" },
  ];
  assert.equal(selectNewResponseCandidate(current, baseline).identity, "reply-2");
});

test("ChatGPT adapter recognizes the current OpenAI login origin", () => {
  const adapter = new ChatGptAdapter();

  assert.equal(adapter.urlMatchesLogin({ url: () => "https://auth.openai.com/log-in-or-create-account" }), true);
  assert.equal(adapter.urlMatchesLogin({ url: () => "https://chatgpt.com/" }), false);
});
