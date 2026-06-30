import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { saveToolResult, sanitizeToolName } from "./web-agent-image-save-gateway.mjs";

test("sanitizeToolName produces a filesystem-safe name", () => {
  assert.equal(sanitizeToolName("list directory:*?"), "list-directory");
  assert.equal(sanitizeToolName("   "), "tool-result");
});

test("saveToolResult writes markdown under generated/tool-results", async () => {
  const result = await saveToolResult({
    toolName: "list_directory",
    fileName: `test-tool-result-${Date.now()}.md`,
    text: "[FILE] demo.txt\n[DIR] docs",
  });

  try {
    assert.match(result.filePath, /generated[\\/]tool-results[\\/]/);
    const saved = await fs.readFile(result.filePath, "utf8");
    assert.match(saved, /# web_Agent 工具结果/);
    assert.match(saved, /Tool: list_directory/);
    assert.match(saved, /\[FILE\] demo\.txt/);
    assert.equal(path.extname(result.filePath), ".md");
  } finally {
    await fs.rm(result.filePath, { force: true });
  }
});
