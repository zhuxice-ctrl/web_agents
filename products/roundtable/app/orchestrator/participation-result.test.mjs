import assert from "node:assert/strict";
import test from "node:test";

import { parseParticipationResult } from "./participation-result.mjs";

test("only an exact pass response becomes private participation", () => {
  assert.deepEqual(parseParticipationResult(" PASS \n"), { kind: "passed", content: null });
  assert.deepEqual(parseParticipationResult("pass"), { kind: "passed", content: null });
  assert.deepEqual(parseParticipationResult("我先 PASS，但补充一点"), {
    kind: "spoken",
    content: "我先 PASS，但补充一点",
  });
  assert.deepEqual(parseParticipationResult("   "), { kind: "invalid", content: null });
});
