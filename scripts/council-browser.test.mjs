import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDispatchPlan,
  parseArgs,
  resolveSessionPath,
} from "./council-browser.mjs";

function makeSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "webagents-browser-test-"));
  const sessionPath = path.join(root, "agent-sessions", "20260701-000000-test-council");
  const promptsPath = path.join(sessionPath, "prompts");
  fs.mkdirSync(promptsPath, { recursive: true });
  for (const model of ["gpt", "deepseek", "doubao", "gemini"]) {
    fs.writeFileSync(path.join(promptsPath, `round-01-${model}.md`), `prompt for ${model}`, "utf8");
  }
  return { root, sessionPath };
}

test("parseArgs handles browser dispatch options", () => {
  const options = parseArgs([
    "--session",
    "agent-sessions/demo",
    "--round",
    "2",
    "--models",
    "gpt,deepseek",
    "--submit",
    "--dry-run",
    "--channel",
    "chrome",
  ]);

  assert.equal(options.session, "agent-sessions/demo");
  assert.equal(options.round, 2);
  assert.deepEqual(options.models, ["gpt", "deepseek"]);
  assert.equal(options.submit, true);
  assert.equal(options.dryRun, true);
  assert.equal(options.channel, "chrome");
});

test("resolveSessionPath finds the latest session when omitted", () => {
  const { root, sessionPath } = makeSession();
  assert.equal(resolveSessionPath(root, null), sessionPath);
});

test("buildDispatchPlan maps selected models to prompt files and provider urls", () => {
  const { root, sessionPath } = makeSession();
  const plan = buildDispatchPlan({
    root,
    session: null,
    round: 1,
    models: ["gpt", "gemini"],
  });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].provider.displayName, "ChatGPT");
  assert.equal(plan[1].provider.displayName, "Gemini");
  assert.equal(plan[0].sessionPath, sessionPath);
  assert.equal(plan[0].prompt, "prompt for gpt");
  assert.match(plan[1].promptPath, /round-01-gemini\.md$/);
});

test("buildDispatchPlan rejects unsupported models before browser launch", () => {
  const { root } = makeSession();
  assert.throws(
    () => buildDispatchPlan({ root, session: null, round: 1, models: ["unknown"] }),
    /Unsupported model 'unknown'/,
  );
});
