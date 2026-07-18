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

test("roundtable service host starts Playwright MCP with append-only log files", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-roundtable-playwright-logs-"));
  const productRoot = path.join(repoRoot, "roundtable-product");
  const cliPath = path.join(repoRoot, "node_modules", "@playwright", "mcp", "cli.js");
  await fs.mkdir(path.dirname(cliPath), { recursive: true });
  await fs.writeFile(cliPath, [
    "console.log('fake playwright mcp ready');",
    "console.error('fake playwright mcp diagnostics');",
    "setInterval(() => {}, 1000);",
  ].join("\n"), "utf8");

  const services = await startRoundtableServices({
    repoRoot,
    productRoot,
    roundtablePort: 0,
    playwrightMcpPort: 0,
    requireWorkspaceSelection: false,
  });
  t.after(async () => {
    await services.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  assert.ok(services.playwrightProcess?.pid);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(
    await fs.readFile(path.join(productRoot, "data", "logs", "playwright-mcp.out.log"), "utf8"),
    /fake playwright mcp ready/,
  );
});
