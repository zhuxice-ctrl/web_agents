import assert from "node:assert/strict";
import test from "node:test";

import {
  REPLY_SCHEMA,
  normalizeRoundtableReply,
  validateRoundtableReply,
} from "./reply-contract.mjs";

test("normalizes a fenced JSON roundtable reply into the stable schema", () => {
  const result = normalizeRoundtableReply(`前置说明\n\n\`\`\`json\n${JSON.stringify({
    schema: REPLY_SCHEMA,
    summary: "先验证输入通道，再执行发送。",
    claims: ["网页 DOM 会动态变化"],
    evidence: ["豆包当前页面没有命中输入框探测"],
    risks: ["重复创建标签页会丢失上下文"],
    disagreements: [],
    actions: ["增加 provider readiness 探测"],
    missingEvidence: [],
    confidence: "candidate",
  })}\n\`\`\``);

  assert.equal(result.status, "valid");
  assert.equal(result.value.schema, REPLY_SCHEMA);
  assert.equal(result.value.summary, "先验证输入通道，再执行发送。");
  assert.deepEqual(result.value.actions, ["增加 provider readiness 探测"]);
  assert.deepEqual(validateRoundtableReply(result.value), { valid: true, errors: [] });
});

test("recovers common markdown sections while marking the structure as recovered", () => {
  const result = normalizeRoundtableReply([
    "核心判断：先锁定单模型并发。",
    "",
    "主要风险",
    "- 同一标签页被两个轮次同时写入。",
    "",
    "下一步",
    "1. 为模型增加队列。",
  ].join("\n"));

  assert.equal(result.status, "recovered");
  assert.equal(result.value.summary, "先锁定单模型并发。");
  assert.deepEqual(result.value.risks, ["同一标签页被两个轮次同时写入。"]);
  assert.deepEqual(result.value.actions, ["为模型增加队列。"]);
});

test("marks unstructured text invalid instead of treating it as a verified reply", () => {
  const result = normalizeRoundtableReply("这是一段没有结论、依据或行动项的自由文本。");

  assert.equal(result.status, "invalid");
  assert.equal(result.value.summary, "这是一段没有结论、依据或行动项的自由文本。");
  assert.equal(result.value.structureConfidence, "low");
  assert.equal(validateRoundtableReply(result.value).valid, false);
});

test("rejects JSON that omits required structural arrays", () => {
  const result = normalizeRoundtableReply(JSON.stringify({
    schema: REPLY_SCHEMA,
    summary: "只有结论，没有完整字段。",
  }));

  assert.equal(result.status, "invalid");
  assert.equal(result.value.structureConfidence, "low");
});

test("recovers model JSON with unescaped quotation marks as low-confidence structure", () => {
  const raw = '{"schema":"web-agents-roundtable.reply.v1","summary":"核心是"可逆闭环"。","claims":["强调"回退能力"。"],"evidence":[],"risks":[],"disagreements":[],"actions":["建立回滚预案"],"missingEvidence":[],"confidence":"candidate"}';
  const result = normalizeRoundtableReply(raw);

  assert.equal(result.status, "recovered");
  assert.equal(result.value.summary, '核心是"可逆闭环"。');
  assert.deepEqual(result.value.claims, ['强调"回退能力"。']);
  assert.equal(result.value.structureConfidence, "medium");
  assert.ok(result.errors.includes("reply contained repaired unescaped quotation marks"));
});
