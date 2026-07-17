# Web Agents 插件与圆桌双产品隔离设计

状态：已批准，等待实施计划。

日期：2026-07-18

## 1. 决策摘要

Web Agents 在同一个 Git 仓库中维护两个独立产品：

1. 正常插件：面向单个模型网页的输入增强、附件、侧栏、配置、MCP 和权限操作。
2. 圆桌：面向多模型协作的独立本地工作台，使用内置浏览器自动化完成调度。

两个产品不得共享 UI、浏览器权限、运行入口、配置、数据目录、发布包或产品测试。它们只允许依赖一个无 UI、无端口、无产品状态的本地安全核心，用于复用路径、权限、事务、回撤和审计规则。

本规范优先于此前将旧插件描述为圆桌浏览器连接器的设计。正常插件不再承担圆桌连接器职责；圆桌扩展桥降级为圆桌产品内部的临时兼容组件。

## 2. 目标与非目标

### 2.1 目标

- 让正常插件可以独立安装、启动、开发、测试和发布。
- 让圆桌可以在未安装正常插件时完整运行。
- 保留正常插件当前的网页内嵌使用体验。
- 保留昨天确认的圆桌工作台页面和交互模型。
- 消除插件 manifest、background、版本和权限被圆桌功能污染的问题。
- 消除一个产品的测试或启动器故障阻塞另一个产品开发的问题。
- 复用已经审查过的安全关键能力，避免分叉后产生两套不一致的权限实现。

### 2.2 非目标

- 本次隔离不重新设计正常插件 UI。
- 本次隔离不重新设计圆桌页面。
- 本次隔离不同时重写全部旧插件打包代码。
- 本次隔离不改变工作区外写入必须确认的安全策略。
- 本次隔离不自动操作登录、验证码、账户恢复或用户私人会话。
- 本次隔离不要求两个产品在同一进程中运行。

## 3. 目标仓库结构

```text
web_agents/
|-- products/
|   |-- plugin/
|   |   |-- extension/          # 可维护的正常插件源码
|   |   |-- legacy-extension/   # 旧打包插件过渡版本
|   |   |-- services/           # 插件专用 MCP 和权限网关入口
|   |   |-- scripts/            # 插件启动、构建和打包脚本
|   |   |-- tests/              # 插件产品测试
|   |   `-- package.json
|   |
|   `-- roundtable/
|       |-- app/                # 独立圆桌 Web 工作台
|       |-- automation/         # CDP/Playwright 内置自动化
|       |-- launcher/           # 专用 Chrome 与本地运行入口
|       |-- compat-extension/   # 临时扩展桥，不进入正常插件
|       |-- tests/              # 圆桌产品测试
|       `-- package.json
|
|-- packages/
|   `-- local-core/             # 无 UI、无端口的共享安全核心
|
|-- package.json                # 仅提供聚合命令
`-- package-lock.json
```

目录名称是产品所有权边界。`products/plugin` 不得导入 `products/roundtable`；`products/roundtable` 不得导入 `products/plugin`。两个产品只能通过 `packages/local-core` 的公开导出复用代码。

## 4. 正常插件产品

### 4.1 产品体验

正常插件保留当前网页输入区旁的轻量增强体验：

- 快速模式、专家模式和识图模式。
- 插入、附件、侧栏和配置。
- MCP 连接、工具结果卡片和权限批准。
- 原生模型输入框增强，而不是独立圆桌工作台。

插件中不得出现圆桌席位、东家、讨论模式、传递模式、会话调度、共享 ledger 或多模型执行计划。

### 4.2 实现路线

`products/plugin/extension` 以现有 `extensions/web-agents-extension` 源码工程为基础，逐步实现当前插件体验。`products/plugin/legacy-extension` 暂时保留 `extensions/mcp-superassistant-local-fixed`，直到源码工程达到功能等价并通过真实浏览器验收。

迁移期间只允许修补旧插件的正常插件能力，不再向旧打包文件增加圆桌逻辑。

### 4.3 Manifest 边界

正常插件发布物必须满足：

- 不包含 `roundtable-*.js`。
- background 不导入 `roundtable-background.js`。
- 不为圆桌申请 localhost 全域权限。
- 不因圆桌增加 `tabs` 或 `scripting` 权限。
- 不连接圆桌的 `3020` relay API。
- manifest 版本只随正常插件功能发布。

正常插件自身确实需要的新权限必须由插件需求单独论证和测试，不能沿用圆桌曾经添加的权限作为默认理由。

### 4.4 插件本地服务

正常插件拥有自己的服务入口：

```text
网页插件
  -> 插件权限网关 3017
  -> 插件文件 MCP 3006
  -> packages/local-core
```

端口是插件适配层的配置，不得写入共享核心。插件服务不可读取圆桌会话、圆桌工作区状态或圆桌浏览器 Profile。

## 5. 圆桌产品

### 5.1 产品体验

圆桌继续使用已确认的独立工作台页面，包括：

- 工作区和圆桌会话。
- 模型席位、自由节点和东家吸附。
- 讨论模式和传递模式。
- 共享上下文、模型线程和执行计划。
- 文件、审计、事务、回撤和恢复。
- 后台任务、暂停、终止和错误恢复。

圆桌页面不复用插件的输入框浮层、侧栏菜单或插件配置页。

### 5.2 默认运行方式

圆桌以本地控制器和内置自动化为正式运行路径：

```text
圆桌工作台 3020
  -> 圆桌调度器
  -> 圆桌本地工具执行器
  -> packages/local-core
  -> Playwright/CDP
  -> 专用 Chrome Profile 9223
  -> 各模型网页
```

圆桌默认启动专用 Chrome Profile。连接用户已经打开的浏览器只作为显式备用方式，必须由用户主动绑定，并继续遵守页面身份、登录状态和操作前确认规则。

### 5.3 不依赖正常插件

未安装或未启用正常插件时，圆桌仍必须能够：

- 创建和恢复工作区会话。
- 绑定模型线程。
- 插入并发送提示。
- 等待和捕获模型回复。
- 执行本地工具调用。
- 请求权限确认并恢复原执行。
- 写入事务、审计和回撤记录。

圆桌不得调用正常插件的 background、storage、manifest 或私有消息协议。

### 5.4 兼容扩展退出路径

现有圆桌 page bridge、content bridge、background sidecar 和 extension relay 移入 `products/roundtable/compat-extension`。该目录拥有独立 manifest、版本和测试，不进入正常插件构建产物。

兼容扩展只用于内置自动化尚未覆盖的临时场景。满足以下条件后删除：

1. 所有正式支持的模型均通过 CDP/Playwright 完成发送、捕获和状态识别。
2. 专用 Chrome 重启和会话恢复通过真实验收。
3. 圆桌本地工具闭环不再调用扩展 relay。
4. 连续两个圆桌版本没有兼容扩展专属使用场景。

## 6. 共享本地安全核心

### 6.1 允许共享的能力

`packages/local-core` 只包含可由两个产品独立调用的纯能力：

- Windows 和跨平台路径规范化。
- 工作区边界与真实路径解析。
- symlink/junction/reparse point 策略。
- 工具权限元数据和路径参数提取。
- 权限请求、一次性授权和任务级授权规则。
- 路径锁、事务、备份、回撤和冲突恢复。
- 原子文件替换。
- 审计事件结构与敏感字段清理。

### 6.2 禁止进入共享核心的内容

- Chrome extension API。
- DOM selector 或网页适配器。
- 圆桌 session、seat、host、relay 或 scheduler。
- HTTP 路由、固定端口或服务启动逻辑。
- 产品 UI 文案和状态。
- 浏览器 Profile、tabId 或 provider 页面状态。
- 插件 storage key 或圆桌数据目录。

### 6.3 公共 API 规则

共享核心通过显式 package exports 暴露 API。产品不得从其内部文件路径深层导入。任何公共类型变更必须先通过 `local-core` 合同测试，再分别运行插件和圆桌测试。

## 7. 配置、数据与运行隔离

| 项目 | 正常插件 | 圆桌 |
|---|---|---|
| 用户界面 | 模型网页内嵌控件 | 独立圆桌工作台 |
| 主入口 | 插件 manifest | 圆桌 launcher/BAT |
| 本地服务 | 3006、3017 | 3020、9223、8931 |
| 浏览器状态 | 用户正常浏览器 | 默认专用 Chrome Profile |
| 产品配置 | `products/plugin/config` | `products/roundtable/config` |
| 产品数据 | 插件 storage 与插件审计目录 | `<workspace>/.web-agents` |
| 日志 | 插件服务日志 | 圆桌运行和自动化日志 |
| 版本 | 插件版本 | 圆桌版本 |

圆桌文件工具默认在圆桌控制器进程内调用共享核心，不依赖插件的 3006/3017 服务。这样两个产品可以同时运行，也可以分别停止。

任何跨产品数据导入必须通过显式导入/导出格式完成，禁止直接读取对方私有数据目录。

## 8. 错误边界与生命周期

- 插件崩溃或被重载不能终止圆桌任务。
- 圆桌服务停止不能让正常插件的输入增强失效。
- 插件端口被占用只影响插件服务。
- 圆桌端口或专用 Chrome 异常只影响圆桌。
- 共享核心返回结构化错误，由各产品翻译成自己的 UI 状态。
- 两个产品均不得通过杀进程方式处理身份不明的端口占用者。
- 聚合测试失败时必须标明 `core`、`plugin` 或 `roundtable`，不得只返回模糊的全链路失败。

## 9. 测试与发布边界

根命令定义为：

```text
npm run test:core
npm run test:plugin
npm run test:roundtable
npm run test:all
```

### 9.1 `test:core`

覆盖路径、权限、事务、回撤、锁、原子写和审计清理。不得启动浏览器或产品服务。

### 9.2 `test:plugin`

覆盖 manifest、background、网页注入、MCP 结果卡、权限批准、gateway 和真实 unpacked extension 冒烟。测试必须断言正常插件发布包中不存在圆桌文件、圆桌权限和圆桌网络调用。

### 9.3 `test:roundtable`

覆盖工作区、会话、调度、工具闭环、恢复、UI、内置浏览器 E2E、专用 Chrome 和 launcher。默认验收不得加载正常插件或兼容扩展。

### 9.4 `test:all`

只用于 CI 和发布前聚合验证。日常开发插件时，圆桌测试失败不得阻止运行 `test:plugin`；开发圆桌时同理。

两个产品分别生成版本、变更日志、构建产物和验收记录。不得继续使用一个 manifest 版本同时代表插件和圆桌状态。

## 10. 现有代码迁移映射

| 当前路径 | 目标归属 |
|---|---|
| `extensions/web-agents-extension` | `products/plugin/extension` |
| `extensions/mcp-superassistant-local-fixed` 正常功能 | `products/plugin/legacy-extension` |
| 旧插件中的 `roundtable-*` sidecar | `products/roundtable/compat-extension` |
| `apps/roundtable-web` | `products/roundtable/app` |
| 圆桌 browser manager/worker | `products/roundtable/automation` |
| `start-web-agents*.bat/ps1` 圆桌部分 | `products/roundtable/launcher` |
| 文件权限、路径、事务公共逻辑 | `packages/local-core` |
| 插件 filesystem/gateway HTTP 入口 | `products/plugin/services` |

迁移必须保留 Git 历史和现有用户数据。已跟踪文件使用 `git mv`；当前未跟踪的大型实现先建立明确基线提交，再进行目录移动，避免在一次提交中混合“新增实现”和“架构搬迁”。

## 11. 分阶段实施

### 阶段 0：建立可恢复基线

- 记录当前插件、圆桌和共享安全测试结果。
- 将现有未跟踪产品实现按原路径形成独立基线提交。
- 不把本地配置、凭据、生成数据或浏览器 Profile 提交到 Git。
- 修复失效的 `F:\web_agents-new-plugin-rewrite` worktree 记录，保留其分支引用，不把它继续作为日常开发入口。

### 阶段 1：立即解除运行耦合

- 从正常插件 background 移除圆桌 sidecar import。
- 从正常插件 manifest 移除圆桌 content scripts、圆桌 localhost 权限和圆桌专属权限。
- 将圆桌 sidecar 复制到独立兼容扩展后再删除原位置，先验证后切换。
- 拆分 `test:plugin` 与 `test:roundtable`。

### 阶段 2：形成产品目录

- 建立 `products/plugin` 和 `products/roundtable`。
- 移动插件源码、圆桌应用、自动化和 launcher。
- 建立各自 package、README、配置样例和版本入口。
- 根 package 只保留 workspace 与聚合命令。

### 阶段 3：提取共享核心

- 从现有文件服务、权限 broker 和 transaction manager 中提取纯能力。
- 保持产品适配器负责 HTTP、UI 和状态转换。
- 加入禁止跨产品导入的静态测试。

### 阶段 4：圆桌内置自动化收口

- 将 CDP/Playwright 设为唯一默认路径。
- 完成专用 Chrome 的启动、复用、重启、停止和恢复验收。
- 验证圆桌未加载任何扩展时的完整工具闭环。
- 达到退出标准后删除兼容扩展。

### 阶段 5：正常插件源码化收口

- 在源码插件中达到现有网页内嵌 UI 和 MCP 功能等价。
- 完成主流模型网页真实验收。
- 停止发布旧打包插件，并提供一次性迁移说明。

## 12. 验收标准

隔离完成必须同时满足：

1. 正常插件构建产物不含任何圆桌脚本、协议或权限。
2. 正常插件在圆桌未运行时可以完整使用。
3. 圆桌在正常插件未安装时可以完成一次真实多模型运行和本地工具事务。
4. 两个产品可以同时运行，不争用端口、配置、数据目录或浏览器 Profile。
5. 两个产品分别通过自己的测试命令和真实浏览器验收。
6. 共享核心没有 UI、端口或产品状态依赖。
7. 跨产品深层导入由自动化检查拒绝。
8. 插件升级和圆桌升级拥有独立版本与回退路径。
9. 兼容扩展不进入正常插件发布物，并有明确删除条件。
10. Git 中不存在依赖失效 worktree 才能构建或测试的路径。

## 13. 已确认决策

- 使用一个仓库，不再以两个日常工作目录管理两个产品。
- 仓库内建立两个一级产品目录。
- 正常插件保持网页内嵌 UI，不承载圆桌 UI。
- 圆桌保持独立工作台页面。
- 圆桌最终抛弃插件依赖，使用内置 CDP/Playwright 自动化。
- 圆桌默认使用专用 Chrome Profile。
- 两个产品允许共享无 UI 的本地安全核心。
- 两个产品的入口、配置、数据、测试、版本和发布相互独立。
