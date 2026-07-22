# Legacy Local Fixed Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the current usable `web_Agent` unpacked extension without changing its architecture or touching the new rewrite worktree.

**Architecture:** Keep all changes inside `F:/web_agents` on `codex/legacy-local-fixed-enhancements`. Treat `extensions/mcp-superassistant-local-fixed` as a packaged legacy build: make small targeted edits to docs, manifest permissions, adapter selectors, labels, and prompt strings only. Do not introduce Vite, TypeScript, a new gateway, or source-architecture changes here.

**Tech Stack:** Chrome Manifest V3 extension, bundled JavaScript in `content/index.iife.js`, service worker in `background.js`, local MCP SSE backend at `http://127.0.0.1:3006/sse`, PowerShell verification scripts.

---

### Task 1: Repair Chinese Usage Guide

**Files:**
- Modify: `F:/web_agents/docs/local-fixed-extension.md`
- Modify: `F:/web_agents/extensions/mcp-superassistant-local-fixed/README.md`

- [x] **Step 1: Replace mojibake docs with readable Chinese**

Write a concise Chinese guide covering installation, backend start command, Chrome loading path, DeepSeek/Doubao usage, JSONL tool-call flow, and common failures.

- [x] **Step 2: Add a short README quick-start**

Keep the README bilingual enough for public cloning, but make Chinese the default first path.

- [x] **Step 3: Verify docs are readable**

Run:

```powershell
rg -n "锛|鐨|涓|乱码|SSE|jsonl|DeepSeek|豆包" docs/local-fixed-extension.md extensions/mcp-superassistant-local-fixed/README.md
```

Expected: no mojibake hits; expected technical terms still present.

### Task 2: Stabilize Legacy Site Adapters

**Files:**
- Modify: `F:/web_agents/extensions/mcp-superassistant-local-fixed/manifest.json`
- Modify: `F:/web_agents/extensions/mcp-superassistant-local-fixed/content/index.iife.js`

- [x] **Step 1: Inspect current host coverage**

Run:

```powershell
node -e "const m=require('./extensions/mcp-superassistant-local-fixed/manifest.json'); console.log(m.content_scripts.flatMap(s=>s.matches).join('\n'))"
```

Expected: DeepSeek, Doubao, Qwen, Kimi, Zhipu, Gemini, AI Studio, Grok, and ChatGPT hosts are present.

- [x] **Step 2: Patch selectors only where the legacy adapter already exists**

For existing adapters, add fallback selectors for current chat input containers and send buttons. Do not add a new adapter framework.

- [x] **Step 3: Verify bundled JavaScript syntax**

Run:

```powershell
node --check extensions/mcp-superassistant-local-fixed/content/index.iife.js
node --check extensions/mcp-superassistant-local-fixed/background.js
```

Expected: both commands exit successfully.

### Task 3: Polish Sidebar Copy And Operational Hints

**Files:**
- Modify: `F:/web_agents/extensions/mcp-superassistant-local-fixed/content/index.iife.js`
- Modify: `F:/web_agents/extensions/mcp-superassistant-local-fixed/_locales/zh_CN/messages.json`

- [x] **Step 1: Make visible labels Chinese-first**

Keep protocol identifiers unchanged, but make tabs, empty states, warning text, and connection hints understandable for Chinese users.

- [x] **Step 2: Strengthen tool-call instructions**

Keep the JSONL format exactly as the parser expects:

```jsonl
{"type": "function_call_start", "name": "write_file", "call_id": 1}
{"type": "description", "text": "Create or overwrite a file"}
{"type": "parameter", "key": "path", "value": "F:\\web_agents\\hello.md"}
{"type": "parameter", "key": "content", "value": "hello"}
{"type": "function_call_end", "call_id": 1}
```

- [x] **Step 3: Verify there are no corrupted identifiers**

Run:

```powershell
rg -n "[A-Za-z_][A-Za-z0-9_]*[\u4e00-\u9fff]|[\u4e00-\u9fff][A-Za-z_][A-Za-z0-9_]*" extensions/mcp-superassistant-local-fixed/content/index.iife.js
```

Expected: no mixed Chinese/identifier corruption in JavaScript identifiers.

### Task 4: Document Permission And Path Behavior

**Files:**
- Modify: `F:/web_agents/docs/local-fixed-extension.md`
- Modify: `F:/web_agents/extensions/mcp-superassistant-local-fixed/README.md`

- [x] **Step 1: Explain standard mode**

Document current standard behavior: MCP filesystem tools only operate inside allowed directories reported by `list_allowed_directories`; cross-path writes require backend permission changes, not browser-side guessing.

- [x] **Step 2: Add direct backend verification commands**

Include:

```powershell
.\scripts\mcp-call.local.ps1 tools
.\scripts\mcp-call.local.ps1 call list_allowed_directories '{}'
.\scripts\mcp-call.local.ps1 call write_file '{"path":"F:\\web_agents\\hello-from-mcp.md","content":"MCP 写入测试"}'
```

- [x] **Step 3: Final verification**

Run:

```powershell
node --check extensions/mcp-superassistant-local-fixed/content/index.iife.js
node --check extensions/mcp-superassistant-local-fixed/background.js
.\scripts\mcp-call.local.ps1 tools
git diff --check
```

Expected: syntax checks pass, MCP tools list prints, and `git diff --check` has no whitespace errors.
