import assert from "node:assert/strict";
import test from "node:test";

import { PROVIDERS, coerceSettings } from "../core/providers.mjs";
import {
  parseLegacyRoundtableCommand,
  parseRoundtableCommand,
  suggestProviderMentions,
} from "./command-parser.mjs";

function createSession() {
  return {
    hostId: "chatgpt",
    participants: ["chatgpt", "deepseek", "doubao"].map((id) => ({
      ...PROVIDERS.find((provider) => provider.id === id),
      status: "ready",
    })),
    routing: { targets: ["doubao"] },
    settings: coerceSettings({ defaultRounds: 3 }),
  };
}

test("structured targets route while ordinary provider names remain references", () => {
  const parsed = parseRoundtableCommand({
    text: "请让 gpt 参考豆包的结论，再由 DeepSeek 给出判断",
    targets: ["deepseek"],
    mentionTokens: [],
  }, createSession());

  assert.deepEqual(parsed.targets, ["deepseek"]);
  assert.deepEqual(parsed.references, ["chatgpt", "doubao", "deepseek"]);
  assert.equal(parsed.routingSource, "targets");
});

test("confirmed mention tokens route in token order and all expands to current seats", () => {
  const session = createSession();
  const pair = parseRoundtableCommand({
    text: "豆包先说，随后 GPT 检查",
    mentionTokens: [
      { providerId: "doubao", label: "豆包" },
      { value: "gpt", label: "GPT" },
    ],
  }, session);
  assert.deepEqual(pair.targets, ["doubao", "chatgpt"]);
  assert.equal(pair.routingSource, "mention_tokens");

  const all = parseRoundtableCommand({
    text: "全体各自判断",
    mentionTokens: [{ value: "全体", label: "全体" }],
  }, session);
  assert.deepEqual(all.targets, ["chatgpt", "deepseek", "doubao"]);
});

test("an explicit empty token envelope does not promote unconfirmed @ text into routing", () => {
  const parsed = parseRoundtableCommand({
    text: "@ds 请参考 gpt，但这两个候选都没有确认",
    mentionTokens: [],
  }, createSession());

  assert.deepEqual(parsed.targets, ["doubao"]);
  assert.deepEqual(parsed.references, ["deepseek", "chatgpt"]);
  assert.equal(parsed.routingSource, "session_default");
});

test("legacy text entry remains explicit and preserves confirmed-at-sign compatibility", () => {
  const session = createSession();
  const legacy = parseLegacyRoundtableCommand("@ds 参考 gpt 的建议", session);
  const compatibility = parseRoundtableCommand("@ds 参考 gpt 的建议", session);

  assert.deepEqual(legacy.targets, ["deepseek"]);
  assert.deepEqual(compatibility.targets, legacy.targets);
  assert.deepEqual(legacy.references, ["chatgpt"]);
  assert.equal(legacy.routingSource, "legacy_mentions");
});

test("alias suggestions are candidates only and stay scoped to current seats", () => {
  const suggestions = suggestProviderMentions("ds", createSession());
  assert.deepEqual(suggestions.map((suggestion) => suggestion.providerId), ["deepseek"]);
  assert.equal(suggestions[0].alias, "ds");
});
