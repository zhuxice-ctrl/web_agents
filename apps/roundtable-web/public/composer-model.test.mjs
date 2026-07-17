import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptSuggestion,
  buildSendPreview,
  getComposerSuggestions,
} from "./composer-model.mjs";

const providers = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "doubao", label: "豆包" },
];

test("aliases only propose candidates until the user explicitly accepts one", () => {
  const text = "豆包你参考 gpt 的建议";
  const result = getComposerSuggestions({ text: "豆包", cursor: 2, participants: providers, providers });
  assert.equal(result.suggestions[0].id, "doubao");

  const untouched = buildSendPreview({ tokens: [{ id: "all", label: "全体" }], participants: providers, providers, text, conversationMode: "discussion", rounds: 3 });
  assert.deepEqual(untouched.targets, ["chatgpt", "deepseek", "doubao"]);
  assert.deepEqual(untouched.references, []);
});

test("confirmed Doubao token routes only Doubao while gpt remains a reference", () => {
  const accepted = acceptSuggestion({
    text: "@豆包，你参考 gpt 的建议",
    range: { start: 0, end: 3 },
    suggestion: { id: "doubao", label: "豆包", kind: "provider" },
    tokens: [],
  });
  const preview = buildSendPreview({
    tokens: accepted.tokens,
    participants: providers,
    providers,
    text: accepted.text,
    conversationMode: "discussion",
    rounds: 3,
  });
  assert.deepEqual(preview.targets, ["doubao"]);
  assert.deepEqual(preview.references, ["chatgpt"]);
  assert.equal(preview.mode, "单独回复");
  assert.equal(preview.rounds, 1);
});

test("at sign opens current-seat suggestions including all", () => {
  const result = getComposerSuggestions({ text: "@d", cursor: 2, participants: providers, providers });
  assert.deepEqual(result.suggestions.map((item) => item.id), ["deepseek", "doubao"]);
  const all = getComposerSuggestions({ text: "@", cursor: 1, participants: providers, providers });
  assert.equal(all.suggestions[0].id, "all");
});
