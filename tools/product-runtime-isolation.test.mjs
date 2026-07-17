import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startPluginServices } from "../products/plugin/services/start-plugin-services.mjs";
import { startRoundtableServices } from "../products/roundtable/launcher/start-roundtable-services.mjs";

test("plugin and roundtable lifecycles are independent", async (t) => {
  const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-plugin-runtime-"));
  t.after(() => fs.rm(pluginRoot, { recursive: true, force: true }));
  const plugin = await startPluginServices({ productRoot: pluginRoot, filesystemPort: 0, gatewayPort: 0 });
  const roundtable = await startRoundtableServices({
    roundtablePort: 0,
    skipPlaywrightMcp: true,
    requireWorkspaceSelection: false,
  });
  t.after(() => Promise.allSettled([plugin.close(), roundtable.close()]));

  assert.deepEqual(Object.keys(plugin.ports).sort(), ["filesystem", "gateway"]);
  assert.equal("filesystem" in roundtable.ports, false);
  assert.equal("gateway" in roundtable.ports, false);

  await plugin.close();
  assert.equal((await fetch(roundtable.healthUrl)).ok, true);
});

test("roundtable can stop while plugin services remain healthy", async (t) => {
  const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-plugin-runtime-"));
  t.after(() => fs.rm(pluginRoot, { recursive: true, force: true }));
  const plugin = await startPluginServices({ productRoot: pluginRoot, filesystemPort: 0, gatewayPort: 0 });
  const roundtable = await startRoundtableServices({
    roundtablePort: 0,
    skipPlaywrightMcp: true,
    requireWorkspaceSelection: false,
  });
  t.after(() => Promise.allSettled([plugin.close(), roundtable.close()]));

  await roundtable.close();
  const health = await Promise.all([
    fetch(`http://127.0.0.1:${plugin.ports.filesystem}/health`),
    fetch(`http://127.0.0.1:${plugin.ports.gateway}/health`),
  ]);
  assert.equal(health.every((response) => response.ok), true);
});
