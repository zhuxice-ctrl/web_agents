import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS, coerceSettings } from "../core/providers.mjs";
import { estimatePromptTokens, estimateTextTokens } from "./context-token-estimator.mjs";

test("context token estimator handles empty, CJK, ASCII, and structured text deterministically", () => {
  assert.equal(estimateTextTokens(""), 0);
  assert.equal(estimateTextTokens("圆桌上下文"), 5);
  assert.equal(estimateTextTokens("abcdefghijkl"), 3);

  const structured = JSON.stringify({ command: "write_file", path: "a.txt" });
  assert.ok(estimateTextTokens(structured) > 5);
  assert.equal(estimateTextTokens(structured), estimateTextTokens(structured));
  assert.equal(estimatePromptTokens("圆桌上下文"), estimateTextTokens("圆桌上下文") + 32);
});

test("roundtable settings expose the approved 128K compression budget", () => {
  assert.equal(DEFAULT_SETTINGS.contextWindowTokens, 131072);
  assert.equal(DEFAULT_SETTINGS.compressionTriggerPercent, 80);
  assert.equal(DEFAULT_SETTINGS.compressionTargetPercent, 20);
  assert.equal(DEFAULT_SETTINGS.recentRawTokenBudget, 16384);

  const settings = coerceSettings({
    contextWindowTokens: 200000,
    compressionTriggerPercent: 99,
    compressionTargetPercent: 2,
    recentRawTokenBudget: 999999,
  });
  assert.equal(settings.contextWindowTokens, 200000);
  assert.equal(settings.compressionTriggerPercent, 95);
  assert.equal(settings.compressionTargetPercent, 10);
  assert.equal(settings.recentRawTokenBudget, 20000);
});
