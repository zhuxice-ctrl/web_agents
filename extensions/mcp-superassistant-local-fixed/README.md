# MCP SuperAssistant Local Fixed Build

This folder contains an unpacked local-fixed build of MCP SuperAssistant for browser-based AI pages.

Use it when the store extension is unavailable, resets your local changes, or does not include the site permissions you need.

## Install In Edge / Chrome

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable `Developer mode`.
3. Disable the store version of `MCP SuperAssistant` if it is already installed.
4. Click `Load unpacked`.
5. Select this folder:

```text
extensions/mcp-superassistant-local-fixed
```

6. Refresh Gemini / DeepSeek / Zhipu pages.
7. In the extension settings, use:

```text
Connection Type: Server-Sent Events (SSE)
Server URI: http://127.0.0.1:3006/sse
```

Keep your local MCP backend running while using the extension.

## Included Site Permissions

This build includes permissions for common web AI pages, including:

- ChatGPT
- Gemini
- DeepSeek
- BigModel / Zhipu
- Qwen
- Kimi
- GitHub Copilot

## Notes

- This is an unpacked extension. Browsers may show a warning because it is loaded in Developer Mode.
- Do not run the store version and this local version at the same time on the same page.
- If the extension panel shows `SSE error: Failed to fetch`, start or restart the local MCP backend at `http://127.0.0.1:3006/sse`.
- This package should not contain local paths, tokens, accounts, or private data.

## Upstream

MCP SuperAssistant is an open-source project. This folder is provided as a practical local build for this bridge template.
