import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const enhancer = require("../extensions/mcp-superassistant-local-fixed/content/web-agent-result-enhancer.js");

test("extractToolResultText returns text between Run and execution history", () => {
  const cardText = [
    "list_directory",
    "显示原始信息",
    "运行",
    "[FILE] a.txt",
    "[DIR] docs",
    "插入",
    "附加最多20张图片到 GPT",
    "附加 File",
    "执行历史",
    "工具: list_directory",
    "上次执行: 2026/7/1 02:50:57",
    "重新运行",
  ].join("\n");

  assert.equal(enhancer.extractToolResultText(cardText), "[FILE] a.txt\n[DIR] docs");
});

test("extractToolResultText keeps permission instructions intact", () => {
  const cardText = [
    "write_file",
    "显示原始信息",
    "运行",
    "需要手动授权后才能执行本次本地文件写入/修改操作。",
    "",
    "工具: write_file",
    "请在 F:\\web_agents 的 PowerShell 里运行:",
    "powershell -ExecutionPolicy Bypass -File .\\scripts\\add-allowed-directory.local.ps1 \"C:\\Users\\Lenovo\\Desktop\"",
    "授权后回到网页工具卡片点击“重新运行 / Run again”即可继续本次执行。",
    "插入",
    "执行历史",
    "工具: write_file",
  ].join("\n");

  const result = enhancer.extractToolResultText(cardText);
  assert.match(result, /需要手动授权/);
  assert.match(result, /add-allowed-directory\.local\.ps1/);
  assert.match(result, /Run again/);
});

test("shouldAutoSaveToolResult only autosaves long text output", () => {
  assert.equal(enhancer.shouldAutoSaveToolResult("short output"), false);
  assert.equal(enhancer.shouldAutoSaveToolResult("x".repeat(2500)), true);
  assert.equal(enhancer.shouldAutoSaveToolResult(Array.from({ length: 70 }, (_, index) => `line ${index}`).join("\n")), true);
});
