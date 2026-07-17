import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startRoundtableServices } from "./start-roundtable-services.mjs";

test("roundtable service host owns no plugin service", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-roundtable-services-"));
  const productRoot = path.join(repoRoot, "roundtable-product");
  const services = await startRoundtableServices({
    repoRoot,
    productRoot,
    roundtablePort: 0,
    skipPlaywrightMcp: true,
    requireWorkspaceSelection: false,
  });
  t.after(async () => {
    await services.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  assert.deepEqual(Object.keys(services.ports).sort(), ["chromeCdp", "playwrightMcp", "roundtable"]);
  const roundtable = await fetch(services.healthUrl).then((response) => response.json());
  assert.equal(roundtable.service, "web-agents-roundtable");
  assert.equal(roundtable.pid, process.pid);
  assert.equal("filesystem" in roundtable.localServices, false);
  assert.equal("gateway" in roundtable.localServices, false);
});

test("roundtable launcher source does not import the plugin product", async () => {
  const source = await fs.readFile(new URL("./start-roundtable-services.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /products[\\/]plugin|plugin[\\/]services|filesystem-http-server|plugin-gateway/i);
});
