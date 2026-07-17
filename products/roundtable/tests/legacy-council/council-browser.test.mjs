import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendTranscriptEntry,
  buildDispatchPlan,
  formatCollectedReply,
  normalizeCollectedText,
  parseArgs,
  resolveSessionPath,
  saveCollectedReply,
  selectBestResponseCandidate,
} from "./council-browser.mjs";

function makeSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "webagents-browser-test-"));
  const sessionPath = path.join(root, "agent-sessions", "20260701-000000-test-council");
  const promptsPath = path.join(sessionPath, "prompts");
  const repliesPath = path.join(sessionPath, "replies");
  fs.mkdirSync(promptsPath, { recursive: true });
  fs.mkdirSync(repliesPath, { recursive: true });
  fs.writeFileSync(path.join(sessionPath, "transcript.md"), "# Transcript\n", "utf8");
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
    "--collect",
    "--dry-run",
    "--channel",
    "chrome",
    "--reply-timeout-ms",
    "90000",
    "--settle-ms",
    "1500",
  ]);

  assert.equal(options.session, "agent-sessions/demo");
  assert.equal(options.round, 2);
  assert.deepEqual(options.models, ["gpt", "deepseek"]);
  assert.equal(options.submit, true);
  assert.equal(options.collect, true);
  assert.equal(options.dryRun, true);
  assert.equal(options.channel, "chrome");
  assert.equal(options.replyTimeoutMs, 90000);
  assert.equal(options.settleMs, 1500);
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
  assert.match(plan[0].replyPath, /replies[\\/]+round-01-gpt\.md$/);
  assert.match(plan[0].errorPath, /replies[\\/]+round-01-gpt\.error\.md$/);
});

test("buildDispatchPlan rejects unsupported models before browser launch", () => {
  const { root } = makeSession();
  assert.throws(
    () => buildDispatchPlan({ root, session: null, round: 1, models: ["unknown"] }),
    /Unsupported model 'unknown'/,
  );
});

test("selectBestResponseCandidate skips baseline replies and returns the newest new reply", () => {
  const baseline = [{ text: "old answer" }];
  const candidates = [
    { selector: "article", text: "old answer" },
    { selector: "article", text: "new answer with enough useful content" },
  ];

  assert.equal(
    selectBestResponseCandidate(candidates, baseline).text,
    "new answer with enough useful content",
  );
});

test("normalizeCollectedText trims whitespace and repeated blank lines", () => {
  assert.equal(normalizeCollectedText("  hello  \r\n\n\nworld\t\n  "), "hello\n\nworld");
});

test("saveCollectedReply and appendTranscriptEntry write session files", () => {
  const { root } = makeSession();
  const [item] = buildDispatchPlan({
    root,
    session: null,
    round: 1,
    models: ["gpt"],
  });

  saveCollectedReply(item, "This is a collected GPT answer with enough text.");
  appendTranscriptEntry(item, "This is a collected GPT answer with enough text.");

  const reply = fs.readFileSync(item.replyPath, "utf8");
  const transcript = fs.readFileSync(item.transcriptPath, "utf8");

  assert.match(reply, /# ChatGPT Reply/);
  assert.match(reply, /This is a collected GPT answer/);
  assert.match(transcript, /Browser Collect - Round 1 - ChatGPT/);
  assert.match(transcript, /Saved: replies\/round-01-gpt\.md/);
});

test("formatCollectedReply includes round metadata and prompt path", () => {
  const { root } = makeSession();
  const [item] = buildDispatchPlan({
    root,
    session: null,
    round: 1,
    models: ["deepseek"],
  });
  const content = formatCollectedReply(
    item,
    "DeepSeek reply body with enough collected text.",
    new Date("2026-07-01T00:00:00.000Z"),
  );

  assert.match(content, /# DeepSeek Reply/);
  assert.match(content, /Collected: 2026-07-01T00:00:00.000Z/);
  assert.match(content, /Prompt: prompts\/round-01-deepseek\.md/);
});
