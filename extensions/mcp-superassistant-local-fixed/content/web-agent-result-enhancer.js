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

  function install() {
    if (typeof document === "undefined" || !document.documentElement) {
      return;
    }
    injectStyles();
    enhanceAllCards();
    const observer = new MutationObserver(() => {
      window.clearTimeout(install.pendingTimer);
      install.pendingTimer = window.setTimeout(enhanceAllCards, 250);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
  }

  const api = {
    extractToolResultText,
    shouldAutoSaveToolResult,
    hashText,
    getCardTextWithoutStableOutput,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.webAgentResultEnhancer = api;
    install();
  }
})();
