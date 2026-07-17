import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startLocalServices } from "./start-roundtable-services.mjs";

test("local service host owns filesystem, gateway, and roundtable health endpoints", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-services-"));
  const services = await startLocalServices({
    repoRoot,
    filesystemPort: 0,
    gatewayPort: 0,
    roundtablePort: 0,
    skipPlaywrightMcp: true,
    requireWorkspaceSelection: false,
  });
  t.after(async () => {
    await services.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  const filesystem = await fetch(`http://127.0.0.1:${services.ports.filesystem}/health`).then((response) => response.json());
  const gateway = await fetch(`http://127.0.0.1:${services.ports.gateway}/health`).then((response) => response.json());
  const roundtable = await fetch(`http://127.0.0.1:${services.ports.roundtable}/api/health`).then((response) => response.json());
  assert.equal(filesystem.service, "web-agents-filesystem-mcp");
  assert.equal(gateway.service, "web-agents-plugin-gateway");
  assert.equal(roundtable.service, "web-agents-roundtable");
  assert.equal(filesystem.pid, process.pid);
  assert.equal(gateway.pid, process.pid);
  assert.equal(roundtable.pid, process.pid);
  assert.equal(roundtable.localServices.filesystem.healthy, true);
  assert.equal(roundtable.localServices.gateway.healthy, true);
});
