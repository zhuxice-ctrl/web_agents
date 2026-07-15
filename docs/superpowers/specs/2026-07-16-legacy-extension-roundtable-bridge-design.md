# 旧插件圆桌桥接设计

日期：2026-07-16
状态：设计已批准，待规格确认
适用项目：`F:\web_agents`

## 1. 背景

网页圆桌 MVP 已具备本地调度、共享上下文、讨论/传递模式、SSE 状态、本地会话存储和普通 Chrome 桥接，但新扩展重复实现了模型页面的输入、发送、回复识别和 MCP 工具执行。真实验收中，这套重复实现先后出现了用户提示词误捕获、用户消息中的 JSONL 示例被误扫描、DeepSeek 新发送控件无法点击等问题。

`extensions/mcp-superassistant-local-fixed` 已经具备长期实机使用的站点适配、MCP 连接、工具调用、结果回填、权限确认和手动模式。MVP 应以它作为唯一浏览器执行运行时，在其旁边增加最小圆桌桥接，而不是继续维护第二套网页执行器。

## 2. 核心决策

1. 唯一需要加载的扩展是：

   ```text
   F:\web_agents\extensions\mcp-superassistant-local-fixed
   ```

2. 旧插件继续独占以下职责：
   - 模型站点输入框定位与文本插入。
   - 模型站点发送动作。
   - MCP 连接、工具列表和工具执行。
   - 工具结果卡片、自动插入、自动发送和权限确认。
   - 原有侧栏和独立手动使用方式。

3. 圆桌旁路代码只负责：
   - 本地圆桌网页与扩展之间的受限消息桥。
   - 模型标签页发现、精确绑定、聚焦和登录状态探测。
   - 调用旧插件当前激活 adapter 的插入与发送能力。
   - 捕获明确归属于 assistant 的普通文本回复。

4. 圆桌旁路代码不得：
   - 解析或执行 `function_call`。
   - 建立第二条 MCP 连接。
   - 修改旧插件的工具卡片、权限决策或自动化状态。
   - 读取或传输 Cookie、Token、localStorage、账号身份或认证响应正文。

5. `extensions/web-agents-extension` 不再作为 MVP 浏览器运行时。它可以保留为隔离的重构试验代码，但文档、启动器和验收不得要求用户同时加载两个扩展。

## 3. 方案选择

### 3.1 采用：旧插件旁路桥接

在旧插件中增加独立、可测试的圆桌桥接文件，不修改 1.4 MB 的 `content/index.iife.js` 主体。旁路脚本复用它暴露的当前 adapter，并通过单独的消息协议接入本地圆桌。

优点：改动范围小、保留稳定能力、回撤简单、不会出现双扫描器。

### 3.2 不采用：把旧内容整体复制进新扩展

旧 `index.iife.js` 依赖旧 `background.js` 的 MCP、存储和消息协议。只复制 content 会失效；同时合并两个后台则会扩大改动面并造成状态冲突。

### 3.3 不采用：两个扩展同时运行

不同扩展会各自在模型页面注入内容脚本，可能重复扫描、重复发送或重复执行工具。该模式不满足唯一执行器原则。

## 4. 组件设计

### 4.1 `roundtable-page-bridge.js`

注入范围仅限：

```text
http://127.0.0.1:3020/*
http://localhost:3020/*
```

职责：
- 向圆桌网页发布扩展就绪状态和扩展版本。
- 接收圆桌网页发出的白名单请求，并转给旧插件后台。
- 对错误递归脱敏后返回网页。
- 校验 `event.source`、精确 origin、消息方向和请求结构。

不得支持自定义端口；扩展模式固定使用 `3020`。自定义端口仍只属于 CDP 调试模式。

### 4.2 `roundtable-background.js`

由旧 `background.js` 以模块方式加载，增加独立消息监听器。职责：
- 查询、打开、聚焦受支持模型标签页。
- 保存 provider 到精确 `tabId` 的绑定。
- 使用 MAIN world 登录探针，只返回脱敏布尔状态。
- 把受允许的标签页命令路由到绑定的 content script。
- 拒绝 provider 漂移、关闭标签页、登录失效和验证码页面。

允许的圆桌命令只有：

```text
tabs:discover-providers
tabs:open-provider
tabs:probe-provider
tabs:focus-provider
tab:auth-probe
tab:detect
tab:insert-text
tab:auto-send-text
tab:capture-latest
tab:capture-recent
```

旧插件原有 `mcp:*`、权限和手动工具消息继续由旧后台处理，圆桌桥接不代理这些消息。

### 4.3 `roundtable-content-bridge.js`

在模型站点中位于旧 `content/index.iife.js` 之后加载，与旧主内容脚本处于同一扩展隔离世界。

职责：
- 等待旧插件 adapter 激活。
- 优先通过 `window.getCurrentAdapter()` 获取 adapter，回退到 `window.mcpAdapter`。
- `tab:insert-text` 调用 adapter 的 `insertText` 或兼容插入方法。
- `tab:auto-send-text` 先确认输入框没有用户草稿，再调用 adapter 插入和 `submitForm`。
- `tab:capture-*` 只读取 provider 明确声明的 assistant 回复节点。
- 返回 provider、speaker、正文、捕获时间和非敏感来源标记。

本脚本不监听或解析 JSONL 工具调用，不调用 MCP，不创建工具卡片。

### 4.4 Provider 契约

每个 MVP provider 声明：
- 允许的 hostname。
- 默认打开地址。
- assistant 回复选择器。
- 用户消息排除规则。
- 登录探针。
- 验证码识别规则。

MVP provider 为 ChatGPT、DeepSeek、豆包。产品保留 ChatGPT 支持，但开发和实机验收默认只使用 DeepSeek、豆包；未经用户单独许可，不得操作 ChatGPT 标签页。

## 5. 数据流

### 5.1 页面发现与绑定

```text
圆桌网页
-> roundtable-page-bridge
-> roundtable-background
-> 查询普通 Chrome 标签页
-> MAIN world 登录探针 + content readiness
-> 返回脱敏状态
-> 圆桌服务保存精确 tabId 绑定
```

发现标签页不会读取页面消息正文。只有执行真实 turn 时才读取绑定页的 assistant 回复。

### 5.2 自动发送

```text
圆桌调度器生成 prompt
-> 本地网页桥
-> 旧插件后台精确路由 tabId
-> roundtable-content-bridge
-> 旧插件当前 adapter.insertText
-> 旧插件当前 adapter.submitForm
```

旁路脚本不自行猜测发送按钮。adapter 不可用、输入框已有草稿或提交失败时，返回明确错误并保留用户页面状态。

### 5.3 回复捕获

```text
发送前记录 assistant 基线
-> 发送 prompt
-> 轮询明确的 assistant 节点
-> 排除 user/unknown、旧基线和未稳定流式内容
-> 写入圆桌共享账本
```

服务端只接受 `speaker: assistant` 的捕获结果。`user`、`unknown` 或 provider 不一致的结果一律拒绝。

### 5.4 MCP 工具调用

模型输出 JSONL 后，由旧插件原有 renderer、后台 MCP 客户端、权限系统和结果回填流程处理。圆桌只等待网页最终 assistant 输出，不介入工具执行。

## 6. 提示词安全

圆桌固定头仍包含：
- web_Agent 工作约束。
- 逆向任务的证据优先约束。
- `fixed-io-encoding` 固定技能。
- 当前圆桌角色、轮次、目标和共享上下文。

固定头不得包含可被解析器直接执行的完整 JSONL 调用。圆桌 prompt builder 自动加入不可执行的字段说明、非完整伪结构和工具名清单，不依赖用户预先操作旧插件侧栏。旧插件侧栏中的完整使用说明继续服务于独立手动模式。无论 provider 页面如何渲染用户消息，用户 prompt 都不能形成一个完整可执行调用。

## 7. 原有手动模式兼容

以下行为必须保持不变：
- 旧插件侧栏可独立打开和关闭。
- 用户可手动插入使用说明。
- 自动插入、自动发送和自动执行开关继续生效。
- 权限弹窗、允许/拒绝、授权重试继续生效。
- 结果卡片、复制、保存和手动插入继续生效。
- 关闭圆桌网页后，旧插件仍可独立工作。

圆桌桥接不得改写旧插件的存储键、MCP 地址或用户偏好。

## 8. 错误与恢复

圆桌必须区分并显示：
- `EXTENSION_BRIDGE_UNAVAILABLE`：旧插件桥未连接。
- `PROVIDER_TAB_NOT_FOUND`：模型页未打开。
- `LOGIN_REQUIRED`：用户需要手动登录。
- `HUMAN_VERIFICATION_REQUIRED`：用户需要手动完成人机验证。
- `ADAPTER_NOT_READY`：旧插件站点 adapter 尚未激活。
- `INPUT_BUSY`：输入框有用户草稿，不允许覆盖。
- `SUBMIT_FAILED`：旧 adapter 无法完成提交。
- `PROVIDER_RESPONSE_TIMEOUT`：未捕获到稳定的新 assistant 回复。
- `PROVIDER_URL_MISMATCH`：绑定标签页已漂移到其他 provider。

失败后保留重试、跳过和人工回复。不得关闭用户标签页、清空用户草稿或自动绕过验证码。

## 9. 隐私与安全

- 本地桥只信任 `127.0.0.1:3020` 与 `localhost:3020`。
- 所有命令使用严格白名单和按类型 schema。
- 认证探针只返回 `authenticated`、`reason`、`verificationRequired` 等状态。
- URL 只保留受支持 provider 路径所需信息，错误输出递归移除查询参数、hash 和凭证字段。
- 不跨桥传递 Cookie、Token、账号标识、localStorage 值或 session JSON 正文。
- 精确绑定的 `tabId` 在执行期间保持不变；provider 漂移立即失效。
- 只有旧插件原有 MCP 系统可以执行本地工具。

## 10. 迁移与回撤

迁移步骤：
1. 在旧插件中增加三个旁路模块和 manifest 条目。
2. 复用当前圆桌的脱敏协议、登录探针和服务端 extension relay。
3. 将启动文档和 UI 加载路径改为旧插件目录。
4. 在圆桌 UI 显示旧插件版本和 bridge revision。
5. 禁止同时加载 `web-agents-extension` 作为 MVP 运行时。

回撤只需删除新增旁路 manifest 条目和旁路文件；旧 `index.iife.js`、旧后台 MCP 主逻辑和用户配置保持原样。

## 11. 验证策略

### 11.1 自动化测试

- 页面桥 origin、消息方向、schema 和错误脱敏。
- 后台精确标签页绑定、provider 漂移和敏感 URL 清理。
- adapter 未就绪、输入忙、提交失败和验证码状态。
- assistant/user 分类、基线去重、流式稳定判断。
- 用户消息中的完整/不完整 JSONL 都不会被圆桌旁路执行。
- 服务端只接受 `speaker: assistant`。
- 旧插件原有权限和结果增强测试保持通过。

### 11.2 真实 Chrome 验收

1. 只加载旧插件目录，确认圆桌显示正确扩展版本和 bridge revision。
2. 验证 DeepSeek 单模型自动发送、assistant 捕获和本地落盘。
3. 验证豆包单模型自动发送、assistant 捕获和本地落盘。
4. 验证 DeepSeek + 豆包一轮讨论共享上下文。
5. 验证传递模式按席位顺序执行并回到东家总结。
6. 验证一次只读 MCP 调用和一次需权限确认的临时写入/回撤。
7. 验证关闭圆桌后旧插件手动侧栏仍可使用。

ChatGPT 不属于默认开发验收对象，只有用户在当次任务中明确授权后才能测试，并且必须使用专门的新会话。

## 12. MVP 验收标准

- 用户只需加载旧插件一个目录。
- 圆桌能够发现并绑定普通 Chrome 中已登录的 DeepSeek 和豆包页面。
- 单模型 turn 能自动发送并只捕获真实 assistant 回复。
- 讨论和传递模式使用本地共享上下文正确执行。
- MCP 工具仍由旧插件稳定链路执行，且没有第二执行器。
- 本地会话、计划、账本和审计记录持久化成功。
- 登录失效、验证码、用户草稿和页面漂移都进入可恢复状态。
- 旧插件原有手动模式无回归。
- 无 Cookie、Token、账号身份或认证正文跨桥或落盘。
