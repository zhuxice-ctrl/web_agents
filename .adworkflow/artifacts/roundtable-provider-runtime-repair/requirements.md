# 圆桌旧插件供应商运行时修复

## 已确认故障

- DeepSeek 能精确命中用户指定的 Chrome 标签页，但内容旁路返回 `readiness=unknown`、`canInsert=false`，最终表现为 `COMPOSER_NOT_FOUND`。
- 豆包验证在返回标签页状态前结束为 `EXTENSION_COMMAND_TIMEOUT`；此前页面未发现旧插件 UI，需区分内容旁路未注入与认证探测未结束。

## 实施边界

- 只使用 DOM 是否存在、adapter 是否存在、方法是否可调用、桥是否响应和有限原因码进行诊断。
- 不读取 cookie、token、localStorage、session、认证响应正文或账号身份。
- 不自动登录或处理人机验证。
- 不修改 `content/index.iife.js`，不复制第二套 MCP 或本地文件执行器。
- 不向 DeepSeek、豆包或 ChatGPT 发送提示词；真实验收仅验证绑定状态。

## 预期结果

1. 无 insert 能力时，DeepSeek 旁路可通过旧插件 registry 的公开 hostname 激活入口进行一次有界恢复，并重新检测 adapter。
2. provider 探测和内容消息均有固定截止时间；挂起时返回稳定、无敏感信息的原因码。
3. 豆包内容旁路未注入时可区分并尝试安全恢复，若旧插件主体仍未加载则明确要求用户刷新页面。
4. UI/health 状态能看到有限运行时诊断，不包含页面内容、会话内容或身份数据。
5. 用户重载 unpacked 插件并刷新 DeepSeek/豆包后，只做精确标签页绑定验收。
