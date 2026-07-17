import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_MODELS = ["gpt", "deepseek", "doubao", "gemini"];

export function getProviderConfigs() {
  return {
    gpt: {
      id: "gpt",
      displayName: "ChatGPT",
      url: "https://chatgpt.com/",
      inputSelectors: [
        "#prompt-textarea",
        "textarea[name='prompt-textarea']",
        "[data-testid='composer'] [contenteditable='true']",
        "div[contenteditable='true']",
        "textarea",
      ],
      submitSelectors: [
        "[data-testid='send-button']",
        "button[data-testid='composer-send-button']",
        "button[aria-label*='Send']",
        "button[aria-label*='发送']",
        "button[type='submit']",
      ],
      responseSelectors: [
        "[data-message-author-role='assistant']",
        "article[data-testid^='conversation-turn-']",
        "article",
      ],
      busySelectors: [
        "[data-testid='stop-button']",
        "button[aria-label*='Stop']",
        "button[aria-label*='停止']",
      ],
    },
    deepseek: {
      id: "deepseek",
      displayName: "DeepSeek",
      url: "https://chat.deepseek.com/",
      inputSelectors: [
        "textarea",
        "div[contenteditable='true']",
        "[contenteditable='true']",
      ],
      submitSelectors: [
        "button[type='submit']",
        "button[aria-label*='Send']",
        "button[aria-label*='发送']",
        "button[class*='send']",
        "button:has-text('发送')",
      ],
      responseSelectors: [
        ".ds-markdown",
        "[class*='markdown']",
        "[class*='message']",
        "[class*='answer']",
      ],
      busySelectors: [
        "button[aria-label*='Stop']",
        "button[aria-label*='停止']",
        "button[class*='stop']",
      ],
    },
    doubao: {
      id: "doubao",
      displayName: "Doubao",
      url: "https://www.doubao.com/",
      inputSelectors: [
        "textarea",
        "div[contenteditable='true']",
        "[contenteditable='true']",
      ],
      submitSelectors: [
        "button[class*='g-send-msg-btn']",
        "button[aria-label*='Send']",
        "button[aria-label*='发送']",
        "button[class*='send']",
        "button:has-text('发送')",
      ],
      responseSelectors: [
        "[data-testid*='message']",
        "[class*='markdown']",
        "[class*='message']",
        "[class*='answer']",
      ],
      busySelectors: [
        "button[aria-label*='Stop']",
        "button[aria-label*='停止']",
        "button[class*='stop']",
      ],
    },
    gemini: {
      id: "gemini",
      displayName: "Gemini",
      url: "https://gemini.google.com/app",
      inputSelectors: [
        "rich-textarea [contenteditable='true']",
        ".ql-editor",
        "div[contenteditable='true']",
        "textarea",
      ],
      submitSelectors: [
        "button[aria-label*='Send']",
        "button[aria-label*='发送']",
        "button[mattooltip*='Send']",
        "button[mattooltip*='发送']",
        "button[type='submit']",
      ],
      responseSelectors: [
        "message-content",
        ".model-response-text",
        ".markdown",
        "[class*='response']",
        "[class*='message']",
      ],
      busySelectors: [
        "button[aria-label*='Stop']",
        "button[aria-label*='停止']",
        "button[mattooltip*='Stop']",
      ],
    },
  };
}

export function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    session: null,
    round: 1,
    models: [],
    submit: false,
    collect: false,
    dryRun: false,
    headless: false,
    keepOpen: false,
    channel: "chrome",
    profile: null,
    timeoutMs: 30000,
    replyTimeoutMs: 180000,
    settleMs: 3000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    if (arg === "--root") options.root = next();
    else if (arg === "--session") options.session = next();
    else if (arg === "--round") options.round = Number.parseInt(next(), 10);
    else if (arg === "--models") options.models = splitModels(next());
    else if (arg === "--submit") options.submit = true;
    else if (arg === "--collect") options.collect = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--headless") options.headless = true;
    else if (arg === "--keep-open") options.keepOpen = true;
    else if (arg === "--channel") options.channel = next();
    else if (arg === "--profile") options.profile = next();
    else if (arg === "--timeout-ms") options.timeoutMs = Number.parseInt(next(), 10);
    else if (arg === "--reply-timeout-ms") options.replyTimeoutMs = Number.parseInt(next(), 10);
    else if (arg === "--settle-ms") options.settleMs = Number.parseInt(next(), 10);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.round) || options.round < 1) {
    throw new Error("--round must be a positive integer");
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be at least 1000");
  }

  if (!Number.isInteger(options.replyTimeoutMs) || options.replyTimeoutMs < 1000) {
    throw new Error("--reply-timeout-ms must be at least 1000");
  }

  if (!Number.isInteger(options.settleMs) || options.settleMs < 500) {
    throw new Error("--settle-ms must be at least 500");
  }

  return options;
}

function splitModels(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function roundPrefix(round) {
  return `round-${String(round).padStart(2, "0")}`;
}

export function resolveSessionPath(root, session) {
  if (session) {
    return path.resolve(root, session);
  }

  const sessionRoot = path.join(root, "agent-sessions");
  if (!fs.existsSync(sessionRoot)) {
    throw new Error(`No agent-sessions directory found under ${root}`);
  }

  const sessions = fs
    .readdirSync(sessionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(sessionRoot, entry.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (sessions.length === 0) {
    throw new Error(`No council sessions found under ${sessionRoot}`);
  }

  return sessions[0].fullPath;
}

export function buildDispatchPlan(options, providers = getProviderConfigs()) {
  const root = path.resolve(options.root || process.cwd());
  const sessionPath = resolveSessionPath(root, options.session);
  const promptsPath = path.join(sessionPath, "prompts");
  const models = options.models.length > 0 ? options.models : DEFAULT_MODELS;
  const prefix = roundPrefix(options.round);

  if (!fs.existsSync(promptsPath)) {
    throw new Error(`Missing prompts directory: ${promptsPath}`);
  }

  return models.map((model) => {
    const provider = providers[model];
    if (!provider) {
      throw new Error(`Unsupported model '${model}'. Supported: ${Object.keys(providers).join(", ")}`);
    }

    const promptPath = path.join(promptsPath, `${prefix}-${model}.md`);
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Missing prompt for ${model}: ${promptPath}`);
    }

    const prompt = fs.readFileSync(promptPath, "utf8");
    const replyPath = path.join(sessionPath, "replies", `${prefix}-${model}.md`);
    const errorPath = path.join(sessionPath, "replies", `${prefix}-${model}.error.md`);
    return {
      model,
      provider,
      sessionPath,
      promptPath,
      replyPath,
      errorPath,
      transcriptPath: path.join(sessionPath, "transcript.md"),
      prompt,
      promptLength: prompt.length,
      round: options.round,
    };
  });
}

export async function runDispatch(options) {
  const plan = buildDispatchPlan(options);
  printPlan(plan, options);

  if (options.dryRun) {
    return { plan, dispatched: false };
  }

  const playwright = await loadPlaywright();
  const profile = path.resolve(
    options.profile || path.join(options.root || process.cwd(), ".webagents-browser-profile"),
  );

  const context = await playwright.chromium.launchPersistentContext(profile, {
    headless: options.headless,
    channel: options.channel || undefined,
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const failures = [];
    for (const item of plan) {
      try {
        await dispatchPrompt(context, item, options);
      } catch (error) {
        failures.push({ item, error });
        console.error(`${item.provider.displayName} failed: ${error.message}`);
        if (options.collect) {
          saveCollectError(item, error);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} provider task(s) failed. Check replies/*.error.md for details.`);
    }

    if (options.keepOpen) {
      console.log("Browser remains open. Press Ctrl+C in this terminal when finished.");
      await new Promise(() => {});
    }
  } finally {
    if (!options.keepOpen) {
      await context.close();
    }
  }

  return { plan, dispatched: true };
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const message = [
      "Playwright is required for live browser automation.",
      "Install it in this repository with: npm install -D playwright",
      "Then run this command again.",
      `Original error: ${error.message}`,
    ].join(os.EOL);
    throw new Error(message);
  }
}

function printPlan(plan, options) {
  console.log("webAgents browser dispatch plan:");
  console.log(`  session: ${plan[0]?.sessionPath || "(none)"}`);
  console.log(`  round: ${options.round}`);
  console.log(`  submit: ${options.submit ? "yes" : "no"}`);
  console.log(`  collect: ${options.collect ? "yes" : "no"}`);
  console.log(`  dryRun: ${options.dryRun ? "yes" : "no"}`);
  for (const item of plan) {
    console.log(`  - ${item.provider.displayName}: ${item.promptLength} chars -> ${item.provider.url}`);
  }
}

async function dispatchPrompt(context, item, options) {
  const page = await context.newPage();
  console.log(`Opening ${item.provider.displayName}: ${item.provider.url}`);
  await page.goto(item.provider.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

  const input = await findFirstVisible(page, item.provider.inputSelectors, options.timeoutMs);
  const baselineCandidates = options.collect
    ? await collectResponseCandidates(page, item.provider.responseSelectors)
    : [];
  await insertText(page, input, item.prompt);
  console.log(`Inserted prompt for ${item.provider.displayName}`);

  if (options.submit) {
    const clicked = await clickFirstVisible(page, item.provider.submitSelectors, 8000);
    if (!clicked) {
      await page.keyboard.press("Enter");
      console.log(`No submit button matched for ${item.provider.displayName}; pressed Enter fallback.`);
    } else {
      console.log(`Submitted prompt for ${item.provider.displayName}`);
    }
  }

  if (options.collect) {
    if (!options.submit) {
      console.log(`Collecting current visible reply for ${item.provider.displayName} without submitting.`);
    } else {
      console.log(`Waiting for reply from ${item.provider.displayName}...`);
    }

    const reply = await waitForCollectedReply(page, item, options, baselineCandidates);
    saveCollectedReply(item, reply);
    appendTranscriptEntry(item, reply);
    console.log(`Saved ${item.provider.displayName} reply: ${item.replyPath}`);
  }
}

async function findFirstVisible(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      try {
        if ((await locator.count()) > 0 && (await locator.isVisible())) {
          return locator;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(300);
  }

  throw new Error(`Could not find a visible input selector. Last error: ${lastError?.message || "none"}`);
}

async function clickFirstVisible(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      try {
        if ((await locator.count()) > 0 && (await locator.isVisible()) && (await locator.isEnabled())) {
          await locator.click();
          return true;
        }
      } catch {
        // Try the next selector. Provider pages change often.
      }
    }
    await page.waitForTimeout(250);
  }

  return false;
}

async function insertText(page, locator, text) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ timeout: 5000 });
  await locator.evaluate((element) => {
    element.focus();
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      element.textContent = "";
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
    }
  });
  await page.keyboard.insertText(text);
}

export function normalizeCollectedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function selectBestResponseCandidate(candidates, baselineCandidates = []) {
  const baseline = new Set(
    baselineCandidates
      .map((candidate) => normalizeCollectedText(candidate.text))
      .filter(Boolean),
  );

  const normalized = candidates
    .map((candidate) => ({
      ...candidate,
      text: normalizeCollectedText(candidate.text),
    }))
    .filter((candidate) => candidate.text.length >= 20);

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const candidate = normalized[index];
    if (!baseline.has(candidate.text)) {
      return candidate;
    }
  }

  return normalized.at(-1) || null;
}

async function collectResponseCandidates(page, selectors = []) {
  const candidates = [];
  const seen = new Set();

  for (const selector of selectors) {
    const locator = page.locator(selector);
    let count = 0;
    try {
      count = Math.min(await locator.count(), 30);
    } catch {
      continue;
    }

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      try {
        if (!(await item.isVisible())) {
          continue;
        }
        const text = normalizeCollectedText(await item.innerText({ timeout: 1000 }));
        if (!text || seen.has(text)) {
          continue;
        }
        seen.add(text);
        candidates.push({ selector, index, text });
      } catch {
        // Provider pages often detach streaming nodes. Try the next candidate.
      }
    }
  }

  return candidates;
}

async function isAnyVisible(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return true;
      }
    } catch {
      // Try the next selector.
    }
  }
  return false;
}

async function waitForCollectedReply(page, item, options, baselineCandidates) {
  const deadline = Date.now() + options.replyTimeoutMs;
  let lastCandidate = null;
  let lastText = "";
  let lastChangedAt = 0;

  while (Date.now() < deadline) {
    const candidates = await collectResponseCandidates(page, item.provider.responseSelectors);
    const best = selectBestResponseCandidate(candidates, baselineCandidates);

    if (best && best.text !== lastText) {
      lastCandidate = best;
      lastText = best.text;
      lastChangedAt = Date.now();
    }

    const busy = await isAnyVisible(page, item.provider.busySelectors);
    if (lastCandidate && !busy && Date.now() - lastChangedAt >= options.settleMs) {
      return lastCandidate.text;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`Timed out waiting for ${item.provider.displayName} reply after ${options.replyTimeoutMs}ms`);
}

export function formatCollectedReply(item, replyText, collectedAt = new Date()) {
  return [
    `# ${item.provider.displayName} Reply`,
    "",
    `Model: ${item.model}`,
    `Round: ${item.round}`,
    `Collected: ${collectedAt.toISOString()}`,
    `Prompt: ${path.relative(item.sessionPath, item.promptPath).replaceAll("\\", "/")}`,
    "",
    "---",
    "",
    normalizeCollectedText(replyText),
    "",
  ].join("\n");
}

export function saveCollectedReply(item, replyText) {
  fs.mkdirSync(path.dirname(item.replyPath), { recursive: true });
  fs.writeFileSync(item.replyPath, formatCollectedReply(item, replyText), "utf8");
}

export function saveCollectError(item, error, collectedAt = new Date()) {
  fs.mkdirSync(path.dirname(item.errorPath), { recursive: true });
  const content = [
    `# ${item.provider.displayName} Collection Error`,
    "",
    `Model: ${item.model}`,
    `Round: ${item.round}`,
    `Collected: ${collectedAt.toISOString()}`,
    "",
    "```text",
    error?.stack || error?.message || String(error),
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(item.errorPath, content, "utf8");
}

export function appendTranscriptEntry(item, replyText, collectedAt = new Date()) {
  const preview = normalizeCollectedText(replyText).slice(0, 700);
  const relativeReplyPath = path.relative(item.sessionPath, item.replyPath).replaceAll("\\", "/");
  const content = [
    "",
    `## Browser Collect - Round ${item.round} - ${item.provider.displayName}`,
    "",
    `Collected: ${collectedAt.toISOString()}`,
    `Saved: ${relativeReplyPath}`,
    "",
    "Preview:",
    "",
    preview,
    "",
  ].join("\n");
  fs.appendFileSync(item.transcriptPath, content, "utf8");
}

export function usage() {
  return `
Usage:
  node scripts/council-browser.mjs [options]

Options:
  --session <path>      Council session path. Defaults to latest agent-sessions directory.
  --round <n>           Round number. Defaults to 1.
  --models <list>       Comma list: gpt,deepseek,doubao,gemini.
  --submit              Click send after inserting prompts.
  --collect             Wait for visible model replies and save them to replies/.
  --dry-run             Print dispatch plan without opening browser.
  --headless            Run browser headlessly.
  --keep-open           Keep browser open after dispatch.
  --profile <path>      Persistent browser profile path.
  --channel <name>      Playwright browser channel. Defaults to chrome.
  --timeout-ms <n>      Page/input timeout. Defaults to 30000.
  --reply-timeout-ms <n> Reply collection timeout. Defaults to 180000.
  --settle-ms <n>       Required stable reply time before saving. Defaults to 3000.
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  await runDispatch(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
