(function () {
  "use strict";

  const saveEndpoint = "http://127.0.0.1:3017/save-tool-result";
  const autoSaveLength = 2000;
  const autoSaveLines = 40;
  const actionLabels = new Set([
    "显示原始信息",
    "运行",
    "插入",
    "附加 File",
    "附加文件",
    "附加最多20张图片到 GPT",
    "Attach File",
    "Run",
    "Insert",
    "Show raw",
    "Copy",
    "复制",
    "保存到本地",
    "展开完整结果",
    "收起结果",
  ]);
  const stableResultMarker = "web_Agent 稳定结果";

  function normalizeLine(line) {
    return String(line || "").replace(/\u00a0/g, " ").trim();
  }

  function trimBlankEdges(lines) {
    const result = [...lines];
    while (result.length && !result[0].trim()) {
      result.shift();
    }
    while (result.length && !result[result.length - 1].trim()) {
      result.pop();
    }
    return result;
  }

  function extractToolResultText(cardText) {
    const rawLines = String(cardText || "").replace(/\r/g, "").split("\n");
    const normalized = rawLines.map(normalizeLine);

    let start = normalized.findIndex((line) => line === "运行" || line === "Run");
    if (start < 0) {
      return "";
    }
    start += 1;

    let end = normalized.findIndex((line, index) => index > start && (
      line === "执行历史" ||
      line === "Execution history" ||
      line === stableResultMarker
    ));
    if (end < 0) {
      end = normalized.length;
    }

    const lines = trimBlankEdges(
      rawLines.slice(start, end).filter((line) => !actionLabels.has(normalizeLine(line)))
    );
    return lines.join("\n").trim();
  }

  function getCardTextWithoutStableOutput(card) {
    if (!card || !card.cloneNode) {
      return card && card.innerText ? card.innerText : "";
    }
    const clone = card.cloneNode(true);
    clone.querySelectorAll(".web-agent-stable-output").forEach((node) => node.remove());
    return clone.innerText || clone.textContent || "";
  }

  function shouldAutoSaveToolResult(text) {
    const value = String(text || "");
    if (!value.trim()) {
      return false;
    }
    if (value.includes(stableResultMarker)) {
      return false;
    }
    return value.length > autoSaveLength || value.split(/\r?\n/).length > autoSaveLines;
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function parsePermissionMarker(text) {
    const value = String(text || "");
    const startMarker = "WEB_AGENT_PERMISSION_REQUEST";
    const endMarker = "END_WEB_AGENT_PERMISSION_REQUEST";
    const start = value.indexOf(startMarker);
    if (start < 0) {
      return null;
    }
    const end = value.indexOf(endMarker, start + startMarker.length);
    if (end < 0) {
      return null;
    }
    const jsonText = value.slice(start + startMarker.length, end).trim();
    try {
      const marker = JSON.parse(jsonText);
      if (marker && marker.kind === "web_agent_permission_request" && marker.requestId && marker.argsHash) {
        return marker;
      }
    } catch {
      return null;
    }
    return null;
  }

  function stripWrappingQuotes(value) {
    return String(value || "")
      .trim()
      .replace(/^[\s"'`\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]+/u, "")
      .replace(/[\s"'`\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]+$/u, "")
      .trim();
  }

  function detectManualWriteRequest(text) {
    const value = String(text || "");
    if (!value.includes("write_file")) {
      return null;
    }

    const hasRefusalSignal = [
      "allowedDirectories",
      "\u4e0d\u80fd",
      "\u65e0\u6cd5",
      "\u62d2\u7edd",
      "\u767d\u540d\u5355",
      "\u6743\u9650",
      "\u8def\u5f84\u7a7f\u8d8a",
      "\u76ee\u5f55\u9650\u5236",
    ].some((indicator) => value.includes(indicator));
    if (!hasRefusalSignal) {
      return null;
    }

    const pathMatch =
      value.match(/[A-Za-z]:\\[^\r\n"'`<>|\uFF0C,\u3002\uFF1B;]*?\.[A-Za-z0-9]{1,16}/u) ||
      value.match(/[A-Za-z]:\\[^\s"'`<>|\uFF0C,\u3002\uFF1B;]+/u);
    if (!pathMatch) {
      return null;
    }

    const contentMatch = value.match(/(?:\u5185\u5bb9|content|text)\s*[\uFF1A:]\s*([^\r\n]+)/iu);
    if (!contentMatch) {
      return null;
    }

    const path = stripWrappingQuotes(pathMatch[0]).replace(/[\uFF0C,\u3002\uFF1B;]+$/u, "");
    const content = stripWrappingQuotes(contentMatch[1]);
    if (!path || !content) {
      return null;
    }

    return { toolName: "write_file", path, content };
  }

  function toolResultToText(result) {
    if (result == null) {
      return "";
    }
    if (typeof result === "string") {
      return result;
    }
    if (result && Object.prototype.hasOwnProperty.call(result, "result") && !Array.isArray(result.content)) {
      return toolResultToText(result.result);
    }
    if (Array.isArray(result.content)) {
      const textItems = result.content.map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.text === "string") {
          return item.text;
        }
        return JSON.stringify(item);
      });
      return textItems.join("\n").trim();
    }
    if (typeof result.text === "string") {
      return result.text;
    }
    return JSON.stringify(result, null, 2);
  }

  function getToolName(card) {
    const text = card && card.innerText ? card.innerText : "";
    const historyMatch = text.match(/工具:\s*([^\n]+)/);
    if (historyMatch) {
      return historyMatch[1].trim();
    }
    const firstLine = text.split(/\r?\n/).map(normalizeLine).find(Boolean);
    return firstLine || "tool-result";
  }

  function injectStyles() {
    if (document.getElementById("web-agent-result-enhancer-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "web-agent-result-enhancer-styles";
    style.textContent = `
.web-agent-result-card {
  white-space: pre-wrap !important;
}
.web-agent-result-card button,
.web-agent-result-card [role="button"] {
  white-space: nowrap !important;
}
.web-agent-stable-output {
  margin: 12px 0 8px 0 !important;
  padding: 12px !important;
  border: 1px solid rgba(148, 163, 184, 0.45) !important;
  border-radius: 8px !important;
  background: rgba(15, 23, 42, 0.20) !important;
  color: inherit !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace !important;
  font-size: 13px !important;
  line-height: 1.6 !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
}
.web-agent-stable-output[data-collapsed="true"] .web-agent-stable-text {
  max-height: 220px !important;
  overflow: auto !important;
}
.web-agent-stable-title {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 8px !important;
  margin-bottom: 8px !important;
  font-family: ui-sans-serif, system-ui, sans-serif !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  color: #93c5fd !important;
}
.web-agent-stable-actions {
  display: flex !important;
  align-items: center !important;
  flex-wrap: wrap !important;
  gap: 8px !important;
  margin-top: 10px !important;
  font-family: ui-sans-serif, system-ui, sans-serif !important;
}
.web-agent-stable-actions button {
  border: 1px solid rgba(147, 197, 253, 0.55) !important;
  border-radius: 7px !important;
  padding: 6px 10px !important;
  background: rgba(96, 165, 250, 0.16) !important;
  color: #bfdbfe !important;
  cursor: pointer !important;
  font-size: 12px !important;
}
.web-agent-stable-status {
  font-family: ui-sans-serif, system-ui, sans-serif !important;
  font-size: 12px !important;
  color: #cbd5e1 !important;
}
.web-agent-manual-write {
  border-color: rgba(251, 191, 36, 0.65) !important;
  background: rgba(120, 53, 15, 0.24) !important;
}
.web-agent-manual-write-summary {
  margin-top: 8px !important;
  color: inherit !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace !important;
  font-size: 12px !important;
  line-height: 1.55 !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
}
`;
    document.documentElement.appendChild(style);
  }

  function copyText(text, status) {
    return navigator.clipboard.writeText(text).then(
      () => {
        status.textContent = "已复制";
      },
      () => {
        status.textContent = "复制失败";
      }
    );
  }

  function downloadFallback(text, toolName) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${toolName || "tool-result"}-${Date.now()}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function saveToolResult(text, toolName) {
    const response = await fetch(saveEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName, text }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function createButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void onClick();
    });
    return button;
  }

  function sendPermissionMessage(command, marker) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error("EXTENSION_RUNTIME_UNAVAILABLE"));
        return;
      }
      chrome.runtime.sendMessage({ command, payload: marker }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || String(error)));
          return;
        }
        if (!response || response.success === false) {
          reject(new Error(response && response.error ? response.error : "PERMISSION_REQUEST_FAILED"));
          return;
        }
        resolve(response);
      });
    });
  }

  function sendManualToolCall(request) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error("EXTENSION_RUNTIME_UNAVAILABLE"));
        return;
      }
      chrome.runtime.sendMessage({
        command: "webAgentManualToolCall",
        payload: {
          toolName: "write_file",
          args: {
            path: request.path,
            content: request.content,
          },
        },
      }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || String(error)));
          return;
        }
        if (!response || response.success === false) {
          reject(new Error(response && response.error ? response.error : "MANUAL_TOOL_CALL_FAILED"));
          return;
        }
        resolve(response);
      });
    });
  }

  function createStableOutput(card, resultText, toolName) {
    const panel = document.createElement("div");
    panel.className = "web-agent-stable-output";
    panel.dataset.collapsed = shouldAutoSaveToolResult(resultText) ? "true" : "false";

    const title = document.createElement("div");
    title.className = "web-agent-stable-title";
    title.textContent = "web_Agent 稳定结果";

    const text = document.createElement("div");
    text.className = "web-agent-stable-text";
    text.textContent = resultText;

    const actions = document.createElement("div");
    actions.className = "web-agent-stable-actions";

    const status = document.createElement("span");
    status.className = "web-agent-stable-status";

    actions.appendChild(createButton("复制结果", () => copyText(resultText, status)));
    actions.appendChild(createButton("保存到本地", async () => {
      status.textContent = "保存中...";
      try {
        const result = await saveToolResult(resultText, toolName);
        status.textContent = result && result.filePath ? `已保存: ${result.filePath}` : "已保存";
      } catch {
        downloadFallback(resultText, toolName);
        status.textContent = "本地服务不可用，已走浏览器下载";
      }
    }));

    const permissionMarker = parsePermissionMarker(resultText);
    if (permissionMarker) {
      actions.appendChild(createButton("批准并重试", async () => {
        status.textContent = "正在批准...";
        try {
          const response = await sendPermissionMessage("webAgentPermissionApprove", permissionMarker);
          status.textContent = response && response.result && response.result.retry ? "已批准，重试完成" : "已批准，正在重试";
        } catch (error) {
          status.textContent = `批准失败: ${error instanceof Error ? error.message : String(error)}`;
        }
      }));
      actions.appendChild(createButton("拒绝", async () => {
        status.textContent = "正在拒绝...";
        try {
          await sendPermissionMessage("webAgentPermissionReject", permissionMarker);
          status.textContent = "已拒绝";
        } catch (error) {
          status.textContent = `拒绝失败: ${error instanceof Error ? error.message : String(error)}`;
        }
      }));
    }

    if (shouldAutoSaveToolResult(resultText)) {
      const toggleButton = createButton("展开完整结果", () => {
        const collapsed = panel.dataset.collapsed === "true";
        panel.dataset.collapsed = collapsed ? "false" : "true";
        toggleButton.textContent = collapsed ? "收起结果" : "展开完整结果";
      });
      actions.appendChild(toggleButton);
    }

    actions.appendChild(status);
    panel.appendChild(title);
    panel.appendChild(text);
    panel.appendChild(actions);

    const historyNode = findHistoryNode(card);
    if (historyNode && historyNode.parentElement) {
      historyNode.parentElement.insertBefore(panel, historyNode);
    } else {
      card.appendChild(panel);
    }

    if (shouldAutoSaveToolResult(resultText)) {
      void saveToolResult(resultText, toolName).then(
        (result) => {
          status.textContent = result && result.filePath ? `已自动保存: ${result.filePath}` : "已自动保存";
        },
        () => {
          status.textContent = "长结果未自动保存，可手动保存";
        }
      );
    }

    return panel;
  }

  function setManualButtonsDisabled(buttons, disabled) {
    for (const button of buttons) {
      button.disabled = disabled;
    }
  }

  function createManualWritePanel(host, request) {
    const panel = document.createElement("div");
    panel.className = "web-agent-stable-output web-agent-manual-write";

    const title = document.createElement("div");
    title.className = "web-agent-stable-title";
    title.textContent = "web_Agent \u68c0\u6d4b\u5230\u6a21\u578b\u62d2\u7edd write_file";

    const summary = document.createElement("div");
    summary.className = "web-agent-manual-write-summary";
    summary.textContent = `path: ${request.path}\ncontent: ${request.content}`;

    const actions = document.createElement("div");
    actions.className = "web-agent-stable-actions";

    const status = document.createElement("span");
    status.className = "web-agent-stable-status";

    const buttons = [];
    const rejectButton = createButton("\u62d2\u7edd", () => {
      setManualButtonsDisabled(buttons, true);
      status.textContent = "\u5df2\u62d2\u7edd";
    });
    const allowButton = createButton("\u5141\u8bb8\u6267\u884c", async () => {
      setManualButtonsDisabled(buttons, true);
      status.textContent = "\u6b63\u5728\u53d1\u9001\u5230\u672c\u5730\u540e\u7aef...";
      try {
        const response = await sendManualToolCall(request);
        const resultText = toolResultToText(response && response.result);
        status.textContent = "\u672c\u5730\u540e\u7aef\u5df2\u8fd4\u56de\u7ed3\u679c";
        createStableOutput(panel, resultText || JSON.stringify(response, null, 2), "write_file");
      } catch (error) {
        setManualButtonsDisabled(buttons, false);
        status.textContent = `\u6267\u884c\u5931\u8d25: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    buttons.push(rejectButton, allowButton);

    actions.appendChild(rejectButton);
    actions.appendChild(allowButton);
    actions.appendChild(status);
    panel.appendChild(title);
    panel.appendChild(summary);
    panel.appendChild(actions);
    host.appendChild(panel);
    return panel;
  }

  function findHistoryNode(card) {
    const elements = Array.from(card.querySelectorAll("div, section, aside"));
    return elements.find((element) => {
      const text = normalizeLine(element.textContent || "");
      return text.startsWith("执行历史") || text.startsWith("Execution history");
    });
  }

  function findToolCard(runButton) {
    let node = runButton.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = node.innerText || "";
      if ((text.includes("执行历史") || text.includes("Execution history")) && extractToolResultText(text)) {
        return node;
      }
    }
    return null;
  }

  function enhanceCard(card) {
    const existing = card.querySelector(":scope > .web-agent-stable-output");
    const resultText = extractToolResultText(getCardTextWithoutStableOutput(card));
    if (!resultText) {
      return;
    }

    const resultHash = hashText(resultText);
    if (card.dataset.webAgentStableResultHash === resultHash) {
      return;
    }
    card.dataset.webAgentStableResultHash = resultHash;
    card.classList.add("web-agent-result-card");

    if (existing) {
      existing.remove();
    }

    createStableOutput(card, resultText, getToolName(card));
  }

  function hasManualWriteHashInAncestors(node, hash) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.dataset && parent.dataset.webAgentManualWriteHash === hash) {
        return true;
      }
    }
    return false;
  }

  function enhanceManualWriteRequests() {
    if (typeof document === "undefined") {
      return;
    }
    const selector = [
      '[data-message-author-role="assistant"]',
      "article",
      '[class*="assistant"]',
      '[class*="message"]',
    ].join(",");
    const candidates = Array.from(document.querySelectorAll(selector));
    const seen = new Set();
    for (const host of candidates) {
      if (!host || seen.has(host) || host.closest(".web-agent-manual-write")) {
        continue;
      }
      seen.add(host);
      const text = host.innerText || host.textContent || "";
      if (text.length < 20 || text.length > 20000) {
        continue;
      }
      const request = detectManualWriteRequest(text);
      if (!request) {
        continue;
      }
      const hash = hashText(`${request.path}\n${request.content}`);
      if (
        host.dataset.webAgentManualWriteHash === hash ||
        hasManualWriteHashInAncestors(host, hash) ||
        host.querySelector(`[data-web-agent-manual-write-hash="${hash}"]`)
      ) {
        continue;
      }
      host.dataset.webAgentManualWriteHash = hash;
      const panel = createManualWritePanel(host, request);
      panel.dataset.webAgentManualWriteHash = hash;
    }
  }

  function enhanceAllCards() {
    injectStyles();
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const button of buttons) {
      if (normalizeLine(button.textContent) !== "运行" && normalizeLine(button.textContent) !== "Run") {
        continue;
      }
      const card = findToolCard(button);
      if (card) {
        enhanceCard(card);
      }
    }
  }

  function enhanceAll() {
    injectStyles();
    enhanceAllCards();
    enhanceManualWriteRequests();
  }

  function install() {
    if (typeof document === "undefined" || !document.documentElement) {
      return;
    }
    enhanceAll();
    const observer = new MutationObserver(() => {
      window.clearTimeout(install.pendingTimer);
      install.pendingTimer = window.setTimeout(enhanceAll, 250);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
  }

  const api = {
    extractToolResultText,
    shouldAutoSaveToolResult,
    hashText,
    getCardTextWithoutStableOutput,
    parsePermissionMarker,
    detectManualWriteRequest,
    toolResultToText,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.webAgentResultEnhancer = api;
    install();
  }
})();
