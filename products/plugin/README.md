# Web Agents Plugin

The plugin product contains the normal browser extension experience and its local filesystem and permission gateway services. It does not start or package the roundtable workbench.

## Commands

- `npm run test:plugin` runs extension, service, and release-boundary tests.
- `npm run build:plugin` verifies the unpacked extension at `extensions/mcp-superassistant-local-fixed`, including every manifest-declared runtime file.
- `start-plugin.bat` starts only the filesystem MCP on port `3006` and the plugin gateway on port `3017`.

Load `extensions/mcp-superassistant-local-fixed` as the unpacked browser extension. The rejected popup rewrite formerly stored at `products/plugin/extension` is intentionally not part of this product.

Plugin-local configuration lives under `products/plugin/config`; runtime audit, permission, image, and tool-result data lives under `products/plugin/data`. Local files in both locations are ignored by Git.
