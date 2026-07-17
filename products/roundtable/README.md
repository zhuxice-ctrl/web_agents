# Web Agents Roundtable

The roundtable is a standalone local workbench. Its default browser path uses a dedicated Chrome profile over CDP and Playwright; the compatibility extension is optional and tested separately.

## Commands

- `npm run start:roundtable` starts the workbench server.
- `npm run test:roundtable` runs the extension-independent roundtable suites.
- `npm --workspace @web-agents/roundtable-product run test:compat` verifies the temporary compatibility extension.
- `start-roundtable.bat` starts the Windows launcher and dedicated browser lifecycle.

Workspace sessions live under `<workspace>/.web-agents`. Product browser state and logs live under `products/roundtable/data` unless a user-local override is supplied.
