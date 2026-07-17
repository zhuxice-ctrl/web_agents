import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";

function loadContentScriptExports(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console }, { filename: filePath });
  return module.exports;
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const enhancer = loadContentScriptExports(path.join(testDir, "../legacy-extension/content/web-agent-result-enhancer.js"));

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

test("parsePermissionMarker extracts structured approval details from tool output", () => {
  const marker = {
    version: 1,
    kind: "web_agent_permission_request",
    requestId: "wapr_123",
    operation: "write_file",
    toolName: "write_file",
    targetPaths: ["C:\\Users\\Lenovo\\Desktop\\note.md"],
    directoriesToApprove: ["C:\\Users\\Lenovo\\Desktop"],
    suggestedApprovalRoot: "C:\\Users\\Lenovo\\Desktop",
    argsHash: "a".repeat(64),
    expiresAt: "2026-07-01T00:00:00.000Z",
    metadata: { nested: { note: "brace } inside string" } },
  };
  const text = [
    "permission required",
    "WEB_AGENT_PERMISSION_REQUEST",
    JSON.stringify(marker),
    "END_WEB_AGENT_PERMISSION_REQUEST",
  ].join("\n");

  assert.equal(JSON.stringify(enhancer.parsePermissionMarker(text)), JSON.stringify(marker));
});

test("parsePermissionMarkers extracts all markers in page order", () => {
  const first = {
    kind: "web_agent_permission_request",
    requestId: "wapr_first",
    argsHash: "a".repeat(64),
  };
  const second = {
    kind: "web_agent_permission_request",
    requestId: "wapr_second",
    argsHash: "b".repeat(64),
  };
  const text = [
    "WEB_AGENT_PERMISSION_REQUEST",
    JSON.stringify(first),
    "END_WEB_AGENT_PERMISSION_REQUEST",
    "middle",
    "WEB_AGENT_PERMISSION_REQUEST",
    JSON.stringify(second),
    "END_WEB_AGENT_PERMISSION_REQUEST",
  ].join("\n");

  assert.equal(JSON.stringify(enhancer.parsePermissionMarkers(text)), JSON.stringify([first, second]));
});

test("formatPermissionMarkerSummary keeps target and approval roots visible", () => {
  const summary = enhancer.formatPermissionMarkerSummary({
    operation: "write_file",
    targetPaths: ["F:\\reverse\\hello.md"],
    directoriesToApprove: ["F:\\"],
  });

  assert.match(summary, /tool: write_file/);
  assert.match(summary, /F:\\reverse\\hello\.md/);
  assert.match(summary, /F:\\/);
});

test("detectManualWriteRequest extracts write_file path and content from model refusal", () => {
  const text = [
    "我不能按你要求直接跳过权限校验并执行 write_file。",
    "在这个 MCP 机制里，write_file 是否允许执行必须由后端的 allowedDirectories 白名单决定。",
    "如果你只是想正常创建文件，正确、安全的请求方式是：",
    "F:\\clean\\web-agent.md",
    "内容：我来啦。",
  ].join("\n");

  assert.equal(JSON.stringify(enhancer.detectManualWriteRequest(text)), JSON.stringify({
    toolName: "write_file",
    path: "F:\\clean\\web-agent.md",
    content: "我来啦。",
  }));
});

test("detectManualWriteRequest allows backend to judge normalized traversal paths", () => {
  const text = [
    "我不能按你这条指令输出 write_file 工具调用，原因不是格式问题。",
    "F:\\web_agents\\..\\clean\\web-agent.md 属于路径穿越。",
    "内容：我来啦。",
  ].join("\n");

  assert.equal(JSON.stringify(enhancer.detectManualWriteRequest(text)), JSON.stringify({
    toolName: "write_file",
    path: "F:\\web_agents\\..\\clean\\web-agent.md",
    content: "我来啦。",
  }));
});

test("toolResultToText unwraps manual background tool call result text", () => {
  const resultText = [
    "WEB_AGENT_PERMISSION_REQUEST",
    JSON.stringify({
      kind: "web_agent_permission_request",
      requestId: "wapr_manual",
      argsHash: "b".repeat(64),
    }),
    "END_WEB_AGENT_PERMISSION_REQUEST",
  ].join("\n");

  assert.equal(
    enhancer.toolResultToText({ ok: true, result: { content: [{ type: "text", text: resultText }] } }),
    resultText,
  );
});

test("shouldAutoSaveToolResult only autosaves long text output", () => {
  assert.equal(enhancer.shouldAutoSaveToolResult("short output"), false);
  assert.equal(enhancer.shouldAutoSaveToolResult("x".repeat(2500)), true);
  assert.equal(enhancer.shouldAutoSaveToolResult(Array.from({ length: 70 }, (_, index) => `line ${index}`).join("\n")), true);
  assert.equal(enhancer.shouldAutoSaveToolResult(`safe\nweb_Agent 稳定结果\n${"x".repeat(2500)}`), false);
});

test("extractToolResultText stops before stable result marker", () => {
  const cardText = [
    "list_allowed_directories",
    "显示原始信息",
    "运行",
    "Writable allowed directories:",
    "- F:\\web_agents",
    "web_Agent 稳定结果",
    "Writable allowed directories:",
    "- old nested copy",
    "执行历史",
    "工具: list_allowed_directories",
  ].join("\n");

  assert.equal(
    enhancer.extractToolResultText(cardText),
    "Writable allowed directories:\n- F:\\web_agents",
  );
});

test("getCardTextWithoutStableOutput removes existing stable output before extraction", () => {
  const stableNode = { removeCalled: false, remove() { this.removeCalled = true; } };
  const fakeCard = {
    cloneNode() {
      return {
        innerText: [
          "list_allowed_directories",
          "显示原始信息",
          "运行",
          "Writable allowed directories:",
          "- F:\\web_agents",
          "执行历史",
          "工具: list_allowed_directories",
        ].join("\n"),
        querySelectorAll(selector) {
          assert.equal(selector, ".web-agent-stable-output");
          return [stableNode];
        },
      };
    },
  };

  assert.equal(
    enhancer.extractToolResultText(enhancer.getCardTextWithoutStableOutput(fakeCard)),
    "Writable allowed directories:\n- F:\\web_agents",
  );
  assert.equal(stableNode.removeCalled, true);
});

test("auto-run clicks only a recognized MCP tool card", () => {
  const toolCard = {
    innerText: [
      "write_file",
      "运行",
      "执行历史",
      "工具: write_file",
    ].join("\n"),
    dataset: {},
    parentElement: null,
  };
  const toolButton = {
    textContent: "运行",
    disabled: false,
    parentElement: toolCard,
    closest() { return null; },
  };
  const unrelatedParent = { innerText: "Run the build", dataset: {}, parentElement: null };
  const unrelatedButton = {
    textContent: "Run",
    disabled: false,
    parentElement: unrelatedParent,
    closest() { return null; },
  };

  assert.equal(enhancer.shouldAutoClickRunButton(toolButton), true);
  assert.equal(enhancer.shouldAutoClickRunButton(unrelatedButton), false);
  toolCard.dataset.webAgentStableResultHash = "already-finished";
  assert.equal(enhancer.shouldAutoClickRunButton(toolButton), false);
});
