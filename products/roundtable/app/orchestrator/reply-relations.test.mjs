import assert from "node:assert/strict";
import test from "node:test";

import { extractReplyRelations } from "./reply-relations.mjs";

const participants = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "doubao", label: "豆包" },
];
const events = [
  { id: "ds-1", type: "reply", providerId: "deepseek", commandId: "plan-1", content: "DS 原文" },
  { id: "db-1", type: "reply", providerId: "doubao", commandId: "plan-1", content: "豆包原文" },
];

test("explicit names create message-scoped relations without stance", () => {
  assert.deepEqual(extractReplyRelations({
    content: "DeepSeek 的大方向我同意，但豆包关于时间投入的判断有问题。",
    sourceProviderId: "chatgpt",
    commandId: "plan-1",
    participants,
    events,
  }), [
    { providerId: "deepseek", eventId: "ds-1", extraction: "explicit_name" },
    { providerId: "doubao", eventId: "db-1", extraction: "explicit_name" },
  ]);
});

test("implicit references and self mentions do not create guessed relations", () => {
  assert.deepEqual(extractReplyRelations({
    content: "另外两位的看法都值得继续观察，ChatGPT 先保留意见。",
    sourceProviderId: "chatgpt",
    commandId: "plan-1",
    participants,
    events,
  }), []);
});
