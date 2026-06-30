# Provider Adapter Foundation Design

## 背景

新插件重构分支的核心工程是 `extensions/web-agents-extension`。当前工程已经有 React、TypeScript、Vite、MV3 manifest、background、content、MCP、permissions、sessions 和 UI 面板雏形。

现有问题是 provider 定义重复存在于 `src/adapters/providers.ts` 和 `src/content/index.ts`，content script 里同时承担了 provider catalog、输入框查找、插入、回复捕获和消息处理。随着 Grok、Google AI Studio、千问、豆包等站点继续加入，这种结构会让每个站点适配都扩散到多个文件。

第一阶段目标是先建立 provider adapter 底座，让后续新增站点只需要扩展 catalog 和少量 adapter 规则。

## 目标

- 建立唯一 provider catalog，作为 provider id、展示名、域名、默认 URL、content script matches、输入选择器和回复选择器的事实源。
- 支持第一批 provider：ChatGPT、Gemini、DeepSeek、Kimi、GLM/Zhipu、Qwen、Doubao、Grok、Google AI Studio。
- 拆分 content script 内部职责，让消息处理、provider 检测、输入查找、文本插入、回复捕获各自有清晰边界。
- 保持默认行为为 insert-only，不自动发送。
- 为 provider host 匹配、输入选择器合并、adapter 状态判断和文本插入辅助函数建立测试基线。
- 更新文档，明确新分支是 source-based Web Agents extension rewrite 的主线。

## 非目标

- 本阶段不实现自动发送。
- 本阶段不承诺所有新 provider 的真实网页都已人工验证。
- 本阶段不做完整 Chrome Side Panel 迁移。
- 本阶段不重写 MCP client 或权限网关，只保持现有接口能继续编译。
- 本阶段不从旧插件 minified bundle 复制实现代码，只参考已经跑通过的 provider 权限和行为经验。

## 推荐方案

采用 Adapter-first 方案。

原因：

- 当前最大结构债是 provider 定义重复和 content script 职责过大。
- UI 看板和权限网关后续都依赖稳定的 provider id、tab 状态和 adapter 状态。
- 先统一 adapter contract 后，新增 Grok、Google AI Studio、千问等站点可以小步提交，并保留验证记录。

## 模块设计

### Provider Catalog

新增 `src/providers/catalog.ts`，定义：

- `ProviderCatalogEntry`
- `PROVIDER_CATALOG`
- `getProviderById(providerId)`
- `detectProviderByHostname(hostname)`
- `getProviderContentMatches()`
- `getDefaultParticipants()`

`ProviderCatalogEntry` 包含：

- `id`
- `label`
- `hostnames`
- `defaultUrl`
- `contentMatches`
- `inputSelectors`
- `fallbackInputSelectors`
- `responseSelectors`
- `capabilities`
- `verification`

`verification` 用来区分：

- `known_working`: 已有实机或旧插件经验支撑。
- `needs_manual_verification`: 已配置基础规则但还需要网页验证。
- `blocked`: 当前明确无法稳定适配。

### Adapter Core

新增 `src/adapters/dom.ts`，负责纯 DOM 操作：

- 可见性判断。
- 可写输入元素判断。
- active element 优先。
- provider selectors 与 fallback selectors 合并。
- textarea/input 原生 value setter 写入。
- contenteditable 文本替换。
- 最新回复候选元素提取。

新增 `src/adapters/runtime.ts`，负责页面级 adapter：

- 根据 `window.location.hostname` 检测 provider。
- 返回 `AdapterStatus`。
- 执行 `insertText(text)`。
- 执行 `captureLatestResponse()`。

保留 `src/adapters/types.ts` 作为 adapter 类型出口，但补充更明确的接口和能力字段。

### Content Script

精简 `src/content/index.ts`：

- 创建 runtime adapter。
- 接收 `tab:detect`、`tab:insert-text`、`tab:capture-latest`。
- 不再维护 provider 列表。
- 不再直接实现 DOM 插入细节。

### Background 与 UI

`src/background/index.ts` 使用 catalog 打开 provider 默认页面。

`src/shared/defaults.ts` 使用 catalog 生成默认 participants。

`src/ui` 当前组件结构保留，只需要适配 provider id 新增项。

### Manifest

短期继续手动维护 `public/manifest.json`，但 matches 与 host permissions 必须和 catalog 对齐。本阶段会把 Grok 与 Google AI Studio 加入 manifest。

后续可以增加 manifest 生成脚本，但不放入第一阶段，避免扩大变更面。

## Provider 首批范围

| Provider | id | 默认状态 |
| --- | --- | --- |
| ChatGPT | `chatgpt` | known_working |
| Gemini | `gemini` | known_working |
| DeepSeek | `deepseek` | known_working |
| Kimi | `kimi` | known_working |
| GLM/Zhipu | `glm` | known_working |
| Qwen | `qwen` | known_working |
| Doubao | `doubao` | needs_manual_verification |
| Grok | `grok` | needs_manual_verification |
| Google AI Studio | `google-ai-studio` | needs_manual_verification |

## 数据流

### 当前页面检测

1. UI 发送 `tab:detect`。
2. background 转发给当前 tab。
3. content runtime 根据 hostname 从 catalog 识别 provider。
4. DOM adapter 查找 active input 或 selector 命中的可写输入。
5. content 返回 `AdapterStatus`，包含 provider、label、readiness、canInsert、matchedSelector、reason。

### 文本插入

1. UI 发送 `tab:insert-text`。
2. content runtime 再次查找当前可写输入。
3. textarea/input 使用原生 value setter 和 input/change event。
4. contenteditable 使用 selection + `execCommand("insertText")`，失败时回退到 `textContent`。
5. content 返回 `InsertResult`，仍提示用户手动发送。

### 最新回复快照

1. UI 发送 `tab:capture-latest`。
2. runtime 使用 provider response selectors 和通用 selectors 找可见文本块。
3. 过滤过短文本。
4. 返回最后一个候选作为任务级快照。
5. 如果没有候选，返回明确错误，不影响原网页历史。

## 错误处理

- 未识别 provider：`readiness = "unsupported"`，提示当前页面暂未配置站点适配器。
- 识别 provider 但无输入框：`readiness = "no_input"`，提示用户先打开或聚焦网页输入栏。
- 插入失败：返回 provider id 和中文 message，不抛出未处理异常。
- 捕获失败：返回“暂未找到可捕获的最新回复快照”。
- background 转发失败：继续使用现有“目标页面暂不可操作”错误，并保留底层错误详情。

## 测试策略

新增轻量测试基线，优先覆盖不依赖 Chrome API 的逻辑：

- provider host 匹配：主域名和子域名都能命中。
- unknown fallback：未知域名返回 `unknown`。
- catalog 完整性：每个 provider 有 id、label、defaultUrl、至少一个 hostname、至少一个 content match。
- selector 合并：provider selectors 先于 fallback selectors，重复项去重。
- risk-free DOM helper：在 jsdom 中验证 textarea/input 写入和 contenteditable 写入。

测试工具使用 Vitest + jsdom，因为项目已经是 Vite + TypeScript，集成成本低。

## 文档更新

- 更新 `docs/ARCH-web-agents-extension.md` 的分期说明，把新插件重构分支标记为当前 source-based rewrite 主线。
- 更新 `extensions/web-agents-extension/README.md`，说明第一阶段 adapter foundation 的范围和验证命令。

## 验收标准

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm test` 通过。
- `src/content/index.ts` 不再包含硬编码 provider 列表。
- provider 列表只在 catalog 中维护。
- manifest 包含 Grok 和 Google AI Studio 的 host permissions 与 content script matches。
- UI 多模型看板能列出新增 provider。
- 默认仍不自动发送。
