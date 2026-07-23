# Three-Branch Bilingual READMEs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish detailed Chinese-first README documentation with complete English mirrors on `main`, `webagent`, and `tablellm`.

**Architecture:** Each formal branch owns a Chinese `README.md` and an English `README.en.md`. The two files share the same section order, commands, versions, ports, security boundaries, and reciprocal language navigation, while their product-specific content remains isolated to that branch.

**Tech Stack:** GitHub Flavored Markdown, PowerShell validation, Node.js 24, existing npm test scripts.

---

## File Map

- `F:\web-agents-local-core-v1\README.md`: Chinese repository overview and Local Core manual.
- `F:\web-agents-local-core-v1\README.en.md`: Complete English mirror of the repository overview and Local Core manual.
- `F:\webagent-v1\README.md`: Chinese plugin product guide.
- `F:\webagent-v1\README.en.md`: Complete English plugin product guide.
- `F:\tablellm-v1\README.md`: Chinese roundtable product guide.
- `F:\tablellm-v1\README.en.md`: Complete English roundtable product guide.

No product source, package metadata, runtime configuration, or release tag changes are part of this work.

### Task 1: Verify Facts Before Writing

**Files:**
- Read: `F:\web-agents-local-core-v1\package.json`
- Read: `F:\web-agents-local-core-v1\CHANGELOG.md`
- Read: `F:\webagent-v1\package.json`
- Read: `F:\webagent-v1\products\plugin\package.json`
- Read: `F:\webagent-v1\products\plugin\start-plugin.bat`
- Read: `F:\tablellm-v1\package.json`
- Read: `F:\tablellm-v1\products\roundtable\package.json`
- Read: `F:\tablellm-v1\products\roundtable\start-roundtable.bat`

- [ ] **Step 1: Record formal branch tips and package versions**

Run:

```powershell
git ls-remote --heads origin main webagent tablellm
git show main:package.json
git show origin/webagent:package.json
git show origin/tablellm:package.json
```

Expected: exactly three remote branch records; Core `1.0.1`, web_Agent `1.0.2`, and TableLLM `1.0.1`.

- [ ] **Step 2: Confirm public commands and ports from source**

Run:

```powershell
rg -n 'start:|test|build|3006|3017|3020|8931|9223' package.json products -g 'package.json' -g '*.mjs' -g '*.bat'
```

Expected: every command and port used in the new README files has a matching source declaration.

### Task 2: Write the main/Core Bilingual Entry

**Files:**
- Modify: `F:\web-agents-local-core-v1\README.md`
- Create: `F:\web-agents-local-core-v1\README.en.md`

- [ ] **Step 1: Replace the Chinese Core entry with the approved structure**

The first lines must be:

```markdown
**简体中文** | [English](README.en.md)

# Web Agents
```

Use these headings in order:

```markdown
## 仓库结构
## 如何选择分支
## 版本兼容
## Local Core
## 安装
## 公开模块
## 安全边界
## 测试
## 发布与开发规则
## 许可证
```

The branch table must describe only `main`, `webagent`, and `tablellm`. The compatibility table must state Core `1.0.1`, web_Agent `1.0.2` using Core `1.0.1`, and TableLLM `1.0.1` using Core `1.0.0`. Installation must pin `local-core-v1.0.1`, and the security section must explicitly exclude browser UI, HTTP transport, provider adapters, and recursive directory deletion from Core.

- [ ] **Step 2: Create the complete English mirror**

The first lines must be:

```markdown
[简体中文](README.md) | **English**

# Web Agents
```

Use these headings in the same order:

```markdown
## Repository Structure
## Choosing a Branch
## Version Compatibility
## Local Core
## Installation
## Public Modules
## Security Boundary
## Testing
## Release and Development Rules
## License
```

Translate every Chinese section completely. Preserve commands, package names, tags, versions, table rows, and links exactly.

- [ ] **Step 3: Validate navigation, facts, and Core tests**

Run:

```powershell
$cn = Get-Content -Raw -Encoding utf8 README.md
$en = Get-Content -Raw -Encoding utf8 README.en.md
if ($cn -notmatch '\[English\]\(README\.en\.md\)') { throw 'CN_EN_LINK_MISSING' }
if ($en -notmatch '\[简体中文\]\(README\.md\)') { throw 'EN_CN_LINK_MISSING' }
if ($cn -notmatch 'local-core-v1\.0\.1' -or $en -notmatch 'local-core-v1\.0\.1') { throw 'CORE_VERSION_MISSING' }
npm test
```

Expected: both navigation checks succeed and all Core tests pass.

- [ ] **Step 4: Commit the main documentation**

```powershell
git add README.md README.en.md
git diff --cached --check
git commit -m "docs(core): add bilingual repository guide"
```

### Task 3: Write the webagent Bilingual Product Guide

**Files:**
- Modify: `F:\webagent-v1\README.md`
- Create: `F:\webagent-v1\README.en.md`

- [ ] **Step 1: Replace the Chinese plugin README with the approved structure**

The first lines must be:

```markdown
**简体中文** | [English](README.en.md)

# web_Agent
```

Use these headings in order:

```markdown
## 产品定位
## 支持范围
## 工作原理
## 主要能力
## 目录结构
## 环境要求
## 安装与启动
## 加载浏览器扩展
## 权限与删除规则
## 本地数据与隐私
## 测试与构建
## 常见问题
## 版本与分支
## 许可证
```

Document the currently adapted provider pages, the extension-to-MCP-to-Core data flow, sequential multi-step tool execution, prompt insertion, result return, explicit user path intent, scoped persistent directory approval, one-time approval, audit records, and safe single-file deletion. Use only ports `3006` and `3017`; warn against loading store and local extension copies together.

- [ ] **Step 2: Create the complete English plugin mirror**

Use `[简体中文](README.md) | **English**` and the headings below:

```markdown
## Product Scope
## Supported Scope
## How It Works
## Key Capabilities
## Repository Layout
## Requirements
## Install and Start
## Load the Browser Extension
## Permissions and Deletion
## Local Data and Privacy
## Testing and Build
## Troubleshooting
## Versions and Branches
## License
```

Translate every operational instruction and security rule completely. Keep `@web-agents/local-core@1.0.1`, commands, paths, ports, and provider names identical to the Chinese file.

- [ ] **Step 3: Validate navigation, boundaries, tests, and unpacked extension**

Run from `F:\webagent-v1`:

```powershell
$cn = Get-Content -Raw -Encoding utf8 README.md
$en = Get-Content -Raw -Encoding utf8 README.en.md
if ($cn -notmatch '\[English\]\(README\.en\.md\)') { throw 'CN_EN_LINK_MISSING' }
if ($en -notmatch '\[简体中文\]\(README\.md\)') { throw 'EN_CN_LINK_MISSING' }
if ($cn -notmatch '3006' -or $cn -notmatch '3017') { throw 'PLUGIN_PORTS_MISSING' }
if ($en -notmatch '3006' -or $en -notmatch '3017') { throw 'PLUGIN_PORTS_MISSING_EN' }
npm test
```

Expected: navigation and port checks succeed, all plugin tests pass, and the unpacked extension build verifies all runtime files.

- [ ] **Step 4: Commit the webagent documentation**

```powershell
git add README.md README.en.md
git diff --cached --check
git commit -m "docs(webagent): add bilingual product guide"
```

### Task 4: Write the tablellm Bilingual Product Guide

**Files:**
- Modify: `F:\tablellm-v1\README.md`
- Create: `F:\tablellm-v1\README.en.md`

- [ ] **Step 1: Replace the Chinese roundtable README with the approved structure**

The first lines must be:

```markdown
**简体中文** | [English](README.en.md)

# TableLLM
```

Use these headings in order:

```markdown
## 产品定位
## 圆桌如何讨论
## 两种运行模式
## 工作台能力
## 系统组成
## 环境要求
## 安装与启动
## 浏览器与模型连接
## 工作区、文件与权限
## 本地端口和数据
## 测试
## 常见问题
## 版本与分支
## 许可证
```

Explain independent first-cycle snapshots, subsequent public context, `PASS` listening behavior, explicit reply relations without permanent camps, east-host closure, discussion versus relay mode, queued interventions, role overrides, scroll preservation during generation, and the manual scroll-to-latest control after completion. Document ports `3020`, `9223`, and `8931`, the dedicated Chrome profile, optional compatibility extension, workspace data under `.web-agents`, transaction rollback, and the pinned Core `1.0.0` dependency.

- [ ] **Step 2: Create the complete English roundtable mirror**

Use `[简体中文](README.md) | **English**` and the headings below:

```markdown
## Product Scope
## How the Roundtable Discusses
## Two Execution Modes
## Workbench Capabilities
## System Components
## Requirements
## Install and Start
## Browser and Model Connections
## Workspaces, Files, and Permissions
## Local Ports and Data
## Testing
## Troubleshooting
## Versions and Branches
## License
```

Translate all discussion semantics, setup instructions, safety boundaries, commands, versions, ports, and paths completely.

- [ ] **Step 3: Validate navigation, ports, boundaries, and full tests**

Run from `F:\tablellm-v1`:

```powershell
$cn = Get-Content -Raw -Encoding utf8 README.md
$en = Get-Content -Raw -Encoding utf8 README.en.md
if ($cn -notmatch '\[English\]\(README\.en\.md\)') { throw 'CN_EN_LINK_MISSING' }
if ($en -notmatch '\[简体中文\]\(README\.md\)') { throw 'EN_CN_LINK_MISSING' }
foreach ($port in @('3020', '9223', '8931')) {
  if ($cn -notmatch $port -or $en -notmatch $port) { throw "ROUNDTABLE_PORT_MISSING:$port" }
}
npm test
```

Expected: navigation and port checks succeed; boundary, Core, browser, launcher, and compatibility tests pass.

- [ ] **Step 4: Commit the tablellm documentation**

```powershell
git add README.md README.en.md
git diff --cached --check
git commit -m "docs(tablellm): add bilingual product guide"
```

### Task 5: Cross-Branch Review and Atomic Publication

**Files:**
- Review: `F:\web-agents-local-core-v1\README.md`
- Review: `F:\web-agents-local-core-v1\README.en.md`
- Review: `F:\webagent-v1\README.md`
- Review: `F:\webagent-v1\README.en.md`
- Review: `F:\tablellm-v1\README.md`
- Review: `F:\tablellm-v1\README.en.md`

- [ ] **Step 1: Check UTF-8, headings, language links, and forbidden version branches**

Run in each worktree:

```powershell
Get-Content -Encoding utf8 README.md | Select-Object -First 8
Get-Content -Encoding utf8 README.en.md | Select-Object -First 8
rg -n '^## ' README.md README.en.md
rg -n 'webagent-v1|tablellm-v1|local-core-v1 branch' README.md README.en.md
git diff --check HEAD~1..HEAD
```

Expected: readable UTF-8, reciprocal links, matching section counts, no permanent version-branch instructions, and no whitespace errors.

- [ ] **Step 2: Confirm only three remote branches remain**

```powershell
$heads = git ls-remote --heads origin
$heads
if ($heads.Count -ne 3) { throw "UNEXPECTED_REMOTE_BRANCH_COUNT:$($heads.Count)" }
```

Expected: only `main`, `webagent`, and `tablellm`.

- [ ] **Step 3: Push the three documentation commits atomically**

Run from the shared repository:

```powershell
git push --atomic origin `
  refs/heads/main:refs/heads/main `
  refs/heads/webagent-v1:refs/heads/webagent `
  refs/heads/tablellm-v1:refs/heads/tablellm
```

Expected: all three formal branches advance together; no `*-v1` remote branch is created.

- [ ] **Step 4: Fetch and verify published README files**

```powershell
git fetch origin --prune
git show origin/main:README.en.md | Select-Object -First 8
git show origin/webagent:README.en.md | Select-Object -First 8
git show origin/tablellm:README.en.md | Select-Object -First 8
git ls-remote --symref origin HEAD
```

Expected: all English files are present and `HEAD` still points to `refs/heads/main`.
