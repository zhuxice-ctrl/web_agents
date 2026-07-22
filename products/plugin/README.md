# Web Agents Plugin

The plugin product contains the directly loadable web_Agent 0.6.7 browser extension and its local filesystem and permission gateway services. It does not start or package the roundtable workbench.

## Commands

- Load `products/plugin/extension` directly from `chrome://extensions` as an unpacked extension.
- `npm run test:plugin` runs extension, service, and release-boundary tests.
- `start-plugin.bat` starts only the filesystem MCP on port `3006` and the plugin gateway on port `3017`.

Plugin-local configuration lives under `products/plugin/config`; runtime audit, permission, image, and tool-result data lives under `products/plugin/data`. Local files in both locations are ignored by Git.
