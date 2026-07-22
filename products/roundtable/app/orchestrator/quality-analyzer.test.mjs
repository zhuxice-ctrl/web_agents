import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeReplyQuality,
  technicalFailureForResult,
} from "./quality-analyzer.mjs";

test("quality analysis keeps raw content and emits non-blocking confidence flags", () => {
  const content = [
    "[ROUND_TABLE_TASK_BEGIN]",
    "我是 ChatGPT，建议优先使用我。",
    "局部损坏：���",
    "[ROUND_TABLE_TASK_END]",
  ].join("\n");
  const analysis = analyzeReplyQuality(content, {
    capture: { truncated: true },
    previousReplies: [content],
    originalTask: "比较不同方案并给出证据",
  });

  const codes = analysis.flags.map((flag) => flag.code);
  assert.equal(analysis.rawContent, content);
  assert.equal(analysis.blocking, false);
  assert.equal(analysis.canContinue, true);
  assert.equal(analysis.sideEffectsAllowed, false);
  assert.ok(codes.includes("prompt_echo"));
  assert.ok(codes.includes("self_promotion"));
  assert.ok(codes.includes("mojibake"));
  assert.ok(codes.includes("duplicate_content"));
  assert.ok(codes.includes("truncated"));
});

test("technical failure classification covers empty, capture failure, and complete truncation", () => {
  assert.equal(technicalFailureForResult({ text: "" }).code, "EMPTY_REPLY");
  assert.equal(technicalFailureForResult({ text: "partial", capture: { failed: true } }).code, "CAPTURE_FAILED");
  assert.equal(
    technicalFailureForResult({ text: "partial", capture: { truncated: true, complete: false } }).code,
    "REPLY_TRUNCATED",
  );
  assert.equal(technicalFailureForResult({ text: "完整回答", capture: { truncated: false } }), null);
});

test("missing derived structure does not lower natural reply quality", () => {
  const analysis = analyzeReplyQuality("这是一段正常的自由讨论。", { structureStatus: "invalid" });

  assert.equal(analysis.structureStatus, "invalid");
  assert.equal(analysis.confidence, "candidate");
  assert.equal(analysis.sideEffectsAllowed, true);
  assert.doesNotMatch(analysis.flagCodes.join(","), /invalid_structure|recovered_structure/);
});
