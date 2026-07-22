# Requirement Translation: 手动浏览器 URL 绑定

## Problem Observed

由 Playwright 自动启动并导航到消费级模型登录页，容易触发登录失效和人机验证。重复打开、重试或重启浏览器会让用户反复完成验证，违背“登录与验证完全由用户掌控”的产品边界。

## User Impact

- 用户无法稳定完成 ChatGPT 登录，真实圆桌验收被外部风控阻断。
- 自动打开登录页会让用户误以为程序能够接管凭证或处理验证码。
- 仅粘贴普通浏览器 URL 并不能传递 Cookie 或登录态；如果不明确这一点，状态检查会产生假阳性。

## Expected Behavior

1. 用户通过独立脚本手动启动 Web Agents 专用 Chrome，并自行访问模型页面、登录及完成人机验证。
2. Web 程序不得自动打开、导航或重试任何登录页。
3. 用户将登录后的模型页面 URL 粘贴到圆桌控制页。
4. 服务仅连接本机回环 CDP 浏览器，在该浏览器的现有标签页中查找粘贴 URL；找不到时拒绝绑定，不创建标签页、不导航。
5. 绑定前同时验证 provider 域名、非登录 URL、无人机验证页面和可用输入框。URL 的 query/hash 不写入日志或持久化状态。
6. 绑定成功后，模型调用只复用对应标签页。登录或验证状态再次失效时立即暂停该 provider，不自动重试。
7. Playwright 自动启动模式仅保留给本地 fake-provider 测试，不作为生产默认模式。

## Scope

- `apps/roundtable-web/automation/browser-manager.mjs`
- `apps/roundtable-web/automation/worker.mjs`
- `apps/roundtable-web/server.mjs`
- `apps/roundtable-web/public/*`
- `scripts/start-web-agents-browser.ps1`
- `start-web-agents-browser.bat`
- 对应测试、ADworkflo 证据和用户文档

## Non-goals

- 不复制、导入或读取用户普通 Chrome 的 Cookie、密码、LocalStorage 或凭证。
- 不通过修改浏览器指纹、隐藏自动化特征或其他方式绕过人机验证。
- 不认为 URL 本身能够证明登录；必须在同一个已连接浏览器标签页中验证。
- 本任务不切换到模型官方 API。

## Acceptance Criteria

- 圆桌服务启动后不会启动 Chrome，也不会自动导航 provider 页面。
- 手动 Chrome 未启动时，连接 API 返回明确的 `MANUAL_BROWSER_UNAVAILABLE`。
- 粘贴 URL 必须命中已连接浏览器中的现有 provider 标签页；错误域名、登录页、含验证页或无输入框均拒绝。
- 三个 provider 可分别显示“未绑定、已验证、需重新验证”状态。
- 已绑定 turn 不导航页面；失效后进入人工恢复，不自动打开或重试。
- fake-provider E2E、服务器 API、启动脚本和完整本地测试全部通过。

## Verification Plan

1. BrowserManager 单元/集成测试覆盖 CDP 连接、URL 规范化、现有标签页匹配和无导航保证。
2. Server API 测试覆盖连接、绑定、错误 URL、登录状态和脱敏输出。
3. 手动 Chrome 脚本静态与进程复用测试覆盖固定 loopback CDP 端口、专用 profile 和不带 provider URL。
4. UI 桌面/移动测试覆盖 URL 输入、绑定状态和登录失效恢复提示。
5. 用户在专用 Chrome 中手动登录后，执行一次真实 URL 绑定和单模型调用验收。
