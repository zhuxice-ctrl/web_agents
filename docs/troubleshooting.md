# Troubleshooting

## ChatGPT 报 Invalid Host

通常是 ChatGPT 还在连接旧的临时域名。

解决：

- 更新 MCP URL
- 如果界面不能修改 URL，删除旧连接后重新添加
- 长期使用固定域名

## DevSpace 返回 502

通常是本地 DevSpace 服务或隧道没有正常工作。

检查：

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 7676
```

## Gemini 显示 Server Connected 但没有工具

可能是：

- 后端没有返回工具
- MCP SuperAssistant UI 兼容问题
- 工具 schema 字段不兼容

检查本地服务是否能列出工具。

## ngrok 页面显示 warning

如果访问固定 ngrok 域名时返回 warning HTML，而不是 MCP JSON / SSE 响应，ChatGPT 可能无法使用。

建议改用自己的域名。

## 不要提交个人信息

提交前搜索：

```powershell
rg "Users|AppData|trycloudflare|ngrok-free|TOKEN|authtoken|secret"
```
