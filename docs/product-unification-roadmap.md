# Web Agents 产品合并与路线建议

## 当前 MVP 运行时决定（2026-07-16）

- 唯一插件加载路径：`F:\web_agents\products\plugin\extension`
- 不再保留第二套插件重构工程或 `dist` 构建入口。
- 圆桌通过专用 Chrome CDP/Playwright 独立完成标签页绑定、发送和回复捕获。
- 普通插件继续通过 MCP、JSONL、权限确认和结果卡片完成单网页本地文件操作。
- 默认实机验收只使用 DeepSeek、豆包的新会话；未经当次明确授权，不操作 ChatGPT 标签页。

## 1. 当前两个工作区

### F:\web_agents

定位：当前可用的本地 Web AI + MCP 工作区。

主要内容：

- 正式插件：`products/plugin/extension`
- 本地 MCP 文件系统后端：`scripts/web-agent-filesystem-server.mjs`
- 本地启动脚本：`scripts/start-gemini-backend.local.ps1`
- 本地网关：`scripts/web-agent-image-save-gateway.mjs`
- 多网页模型脚本协作：`scripts/council.ps1`、`scripts/council-browser.ps1`
- 文档、测试、审计和生成结果目录

当前价值：

- 已经能跑起来。
- 已经能让网页模型通过插件调用本地文件工具。
- 已经支持本地信任写入模式。
- 适合继续承担“可用产品入口”和“后端能力基座”。

主要问题：

- 当前插件是大 bundle 增强，长期修改需要谨慎测试。
- 网页 DOM 注入和按钮增强容易受页面变化影响。
- 插件 UI 和后端能力边界仍有历史遗留。

### 已终止的插件重构

React + TypeScript + Vite 插件重构未达到 `0.6.7` 的实机功能等价，已于 2026-07-18 删除。后续不会从该实现恢复 popup、多模型看板或 `dist` 构建入口；需要的新能力应分别进入正式插件或独立 Roundtable 产品。

## 2. 产品类型判断

建议不要把产品定义成“一个浏览器插件”。

更准确的产品类型是：

> 本地 Web AI 协作工作台，连接多个网页模型和本地文件系统，让用户用网页模型完成本地读写、讨论、评审和任务落地。

浏览器插件只是其中一种入口，不是产品本体。

产品本体应该包含四层：

1. 本地后端能力层
   - MCP filesystem server
   - 本地写入、读取、搜索、移动、目录树
   - 审计、回撤、权限策略
   - 结果保存和图片保存

2. 网页模型连接层
   - ChatGPT、DeepSeek、Gemini、Qwen、Kimi、豆包、GLM 等网页模型
   - 页面识别、输入框插入、回复捕获、工具调用识别

3. 协作编排层
   - 单模型本地读写
   - 多模型圆桌
   - 共享上下文 ledger
   - 任务状态、回合、总结、产物沉淀

4. 用户入口层
   - 正式插件入口
   - Roundtable 工作台入口
   - 启动器脚本
   - 自制圆桌页面

## 3. 两种入口的定位

### 入口 A：网页版插件直接实现本地读写

定位：轻量、就地、即时可用。

适合场景：

- 用户已经在 ChatGPT / DeepSeek / Gemini 页面里。
- 只想让当前模型读写本地文件。
- 希望保留原网页模型的上下文、账号、模型选择和发送体验。
- 不需要多个模型同时协作。

优势：

- 上手快。
- 不改变用户习惯。
- 不需要新页面承载完整交互。
- 可以继续利用现有网页模型 UI。

劣势：

- 依赖网页 DOM，容易被站点改版影响。
- 多模型协作体验分散在多个标签页。
- 工具调用、结果插入、错误恢复会受页面限制。
- 很难做出完整的任务状态和圆桌总控体验。

产品角色：

> 插件是“网页模型本地工具通道”。

它应该保持轻，不要承载所有编排逻辑。

### 入口 B：启动器脚本 + 自制圆桌页面

定位：主控、编排、长期主产品入口。

适合场景：

- 用户希望多个网页模型围绕同一个任务讨论。
- 需要看见每个模型的状态、发言、回合和最终结论。
- 需要统一保存本地文件、审计写入和回撤。
- 需要从“问模型”升级为“组织模型完成任务”。

建议形态：

```text
启动器脚本
  -> 启动本地 MCP 后端
  -> 启动本地网关
  -> 启动本地 Web UI
  -> 打开浏览器控制台页面
  -> 可选打开/绑定 ChatGPT、DeepSeek、Gemini 等网页模型标签页
```

自制页面负责：

- 创建圆桌任务
- 维护共享上下文 ledger
- 展示模型卡片
- 展示每一轮发言和状态
- 控制发送、捕获、下一轮、总结
- 调用本地文件工具
- 显示写入审计和回撤入口

网页模型页面负责：

- 保持各自账号登录态
- 使用各自官方网页完成模型推理
- 接收插入的 prompt
- 产生回复

优势：

- 产品心智清晰：一个总控台管理多个模型。
- 可以沉淀任务、会话、文件产物和审计。
- 可以逐步加入自动发送、自动捕获、自动总结。
- 不需要把所有复杂状态塞进插件 popup。

劣势：

- 工程量更大。
- 需要处理多个网页标签页、登录态、DOM 变化。
- 需要明确哪些动作自动化，哪些必须用户手动确认。

产品角色：

> 启动器 + 自制页面是“本地 Web AI 圆桌工作台”。

它应该成为长期主产品。

## 4. 推荐路线

### 结论

建议采用“双入口、单内核”路线：

```text
同一个本地后端内核
  -> 插件入口：当前网页模型直接读写本地文件
  -> 圆桌入口：多个网页模型汇聚到自制页面协作
```

不要再次建立两套互相竞争的普通插件实现。

真正要统一的是：

- 同一个 MCP 后端
- 同一套工具协议
- 同一套写入审计
- 同一套回撤机制
- 同一套 provider adapter
- 同一套 session/ledger 数据模型

## 5. 文件合并建议

短期不要做大规模代码合并。

建议先把两个工作区合并为一个“产品决策文件”和一个“模块迁移清单”。

当前文件就是第一份统一文件：

```text
docs/product-unification-roadmap.md
```

后续建议再补：

```text
docs/module-migration-map.md
```

迁移关系建议：

| 能力 | 当前来源 | 未来归属 |
|---|---|---|
| 本地 MCP 文件读写 | `F:\web_agents\scripts` | 保留在主仓库后端层 |
| 写入审计/回撤 | `F:\web_agents\scripts` | 后端核心能力 |
| 插件网页工具执行 | `products/plugin/extension` | 正式插件入口 |
| provider 自动化 | `products/roundtable/app/automation` | Roundtable 浏览器连接层 |
| roundtable session | `products/roundtable/app` | Roundtable 协作编排层 |
| 自制圆桌页面 | 新增 | 长期主产品 UI |
| council 脚本 | `F:\web_agents\scripts/council*` | 启动器/自动化原型 |

## 6. 建议的产品架构

```text
web_agents
  apps/
    launcher/                 # 启动器脚本或未来桌面壳
    roundtable-web/            # 自制圆桌页面
  products/
    plugin/
      extension/                # 唯一正式插件，可直接加载
      services/                 # MCP 3006 与网关 3017
    roundtable/                 # 独立 Roundtable 产品
  packages/
    provider-adapters/         # 统一网页模型适配层
    tool-protocol/             # 工具调用 jsonl / MCP 映射
    session-ledger/            # 圆桌共享上下文与回合模型
  scripts/
    web-agent-filesystem-server.mjs
    web-agent-image-save-gateway.mjs
    start-web-agents.ps1
  generated/
    audit/
    sessions/
    tool-results/
```

现阶段不一定要马上调整目录，但产品设计应按这个方向收敛。

## 7. 第一阶段 MVP 建议

当前第一阶段 MVP 是一个可自动执行的“圆桌启动器”：

1. 一个 PowerShell 启动命令：

```powershell
.\scripts\start-web-agents-roundtable.ps1
```

2. 启动内容：

- MCP 文件系统服务 `3006`
- 本地网关 `3017`
- 本地圆桌页面，例如 `http://127.0.0.1:3020`

3. 圆桌页面第一版只做：

- 新建任务
- 选择模型：ChatGPT / DeepSeek / 豆包
- 发现并精确绑定用户原 Chrome 中已登录的网页标签页
- 共享上下文 ledger
- 通过当前插件 adapter 插入并发送 prompt
- 只捕获经过角色确认的 assistant 回复
- 支持讨论模式、传递模式、重试、跳过和人工接管
- 生成最终总结
- 调用本地文件工具写入总结

4. 暂不做：

- 复杂权限中心
- 账号托管
- 替代网页模型原 UI
- 自动登录、人机验证或验证码绕过
- 在圆桌旁路中重复实现 MCP/JSONL 执行器

## 8. 插件和圆桌页面如何共存

插件继续解决：

- 当前网页模型直接调用本地工具。
- 当前页面上显示 Run 按钮。
- 当前网页结果保存、插入、附件等小能力。

圆桌页面解决：

- 多模型任务编排。
- 共享上下文和多轮讨论。
- 统一任务状态。
- 统一本地写入与结果沉淀。

两者共享：

- 本地 MCP 后端。
- 工具调用协议。
- provider adapter。
- session ledger。
- 审计与回撤。

## 9. 我的建议

产品主名建议定为：

```text
Web Agents Local Workspace
```

中文可以叫：

```text
Web Agents 本地协作工作台
```

产品一句话：

> 一个把 ChatGPT、DeepSeek、Gemini、Qwen 等网页模型组织成圆桌，并安全连接本地文件系统的本地 AI 工作台。

阶段性定位：

- 正式插件：唯一插件入口，同时保持独立手动模式。
- 启动器 + 自制页面：长期主控台。
- MCP 后端：核心资产。

最终不要把产品卖点放在“插件”上，而要放在：

- 多网页模型圆桌
- 本地文件读写
- 可审计可回撤
- 用户掌控的本地 AI 工作流

## 10. 下一步建议

优先级建议：

1. 固定一个统一产品名和目录规划。
2. 维护正式插件的 provider 适配，并保持 MCP 手动模式无回归。
3. 用 `apps/roundtable-web` 承担讨论、传递、共享上下文和恢复控制，不把圆桌总控塞进 popup。
4. 跑通 DeepSeek、豆包真实新会话的发送、assistant 捕获、落盘和回撤验收。
5. 后续按实际复用需求抽取 provider adapter 和协议共享包，避免同时重写两条稳定链路。

最终目标：

```text
一个本地启动器
一个自制圆桌页面
一个可选浏览器插件
一套本地 MCP 文件工具
一套可审计可回撤的任务产物系统
```
