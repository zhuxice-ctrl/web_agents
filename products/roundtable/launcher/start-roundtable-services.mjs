import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { createRoundtableServer } from "../app/server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, "..", "..", "..");
const defaultProductRoot = path.resolve(__dirname, "..");

async function listen(server, port, host) {
  server.listen(port, host);
  await once(server, "listening");
  return server.address();
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  server.closeAllSessions?.();
  server.close();
  await once(server, "close").catch(() => {});
}

function tcpReady(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function httpReady(url, timeoutMs = 1000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

function spawnPlaywrightMcp({ repoRoot, host, port, cdpEndpoint, logDir, outputDir }) {
  const cli = path.join(repoRoot, "node_modules", "@playwright", "mcp", "cli.js");
  if (!fs.existsSync(cli)) throw new Error(`PLAYWRIGHT_MCP_NOT_INSTALLED:${cli}`);
  fs.mkdirSync(logDir, { recursive: true });
  const stdoutFd = fs.openSync(path.join(logDir, "playwright-mcp.out.log"), "a");
  const stderrFd = fs.openSync(path.join(logDir, "playwright-mcp.err.log"), "a");
  try {
    return spawn(process.execPath, [
      cli,
      "--host", host,
      "--port", String(port),
      "--cdp-endpoint", cdpEndpoint,
      "--shared-browser-context",
      "--output-mode", "file",
      "--output-dir", outputDir,
    ], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

export async function startRoundtableServices({
  repoRoot = defaultRepoRoot,
  productRoot = defaultProductRoot,
  host = "127.0.0.1",
  roundtablePort = 3020,
  cdpPort = 9223,
  playwrightMcpPort = 8931,
  skipPlaywrightMcp = false,
  requireWorkspaceSelection = true,
  roundtableOptions = {},
} = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedProductRoot = path.resolve(productRoot);
  const dataDir = path.join(resolvedProductRoot, "data");
  let playwrightProcess = null;
  const ports = { roundtable: roundtablePort, chromeCdp: cdpPort, playwrightMcp: playwrightMcpPort };
  const localServicesProvider = async () => ({
    roundtable: { port: ports.roundtable, healthy: true },
    chromeCdp: { port: ports.chromeCdp, healthy: await httpReady(`http://${host}:${ports.chromeCdp}/json/version`) },
    playwrightMcp: { port: ports.playwrightMcp, healthy: skipPlaywrightMcp ? null : await tcpReady(host, ports.playwrightMcp) },
  });
  const roundtableServer = createRoundtableServer({
    repoRoot: resolvedRoot,
    browserMode: "cdp",
    browserCdpEndpoint: `http://${host}:${cdpPort}`,
    requireWorkspaceSelection,
    localServicesProvider,
    ...roundtableOptions,
  });

  try {
    if (!skipPlaywrightMcp) {
      playwrightProcess = spawnPlaywrightMcp({
        repoRoot: resolvedRoot,
        host,
        port: playwrightMcpPort,
        cdpEndpoint: `http://${host}:${cdpPort}`,
        logDir: path.join(dataDir, "logs"),
        outputDir: path.join(dataDir, "playwright-mcp"),
      });
    }
    const roundtableAddress = await listen(roundtableServer, roundtablePort, host);
    ports.roundtable = roundtableAddress.port;
  } catch (error) {
    if (playwrightProcess && !playwrightProcess.killed) playwrightProcess.kill();
    await closeServer(roundtableServer);
    throw error;
  }

  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    if (playwrightProcess && !playwrightProcess.killed) {
      playwrightProcess.kill();
      await Promise.race([once(playwrightProcess, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]).catch(() => {});
    }
    await closeServer(roundtableServer);
  }

  return {
    repoRoot: resolvedRoot,
    productRoot: resolvedProductRoot,
    host,
    ports,
    healthUrl: `http://${host}:${ports.roundtable}/api/health`,
    roundtableServer,
    get playwrightProcess() { return playwrightProcess; },
    status: localServicesProvider,
    close,
  };
}

if (path.resolve(process.argv[1] || "") === __filename) {
  const repoRoot = process.env.WEB_AGENTS_REPO_ROOT || defaultRepoRoot;
  const host = "127.0.0.1";
  const productRoot = process.env.WEB_AGENTS_ROUNDTABLE_ROOT || defaultProductRoot;
  const services = await startRoundtableServices({
    repoRoot,
    productRoot,
    host,
    roundtablePort: Number(process.env.WEB_AGENTS_ROUNDTABLE_PORT || 3020),
    cdpPort: Number(process.env.WEB_AGENTS_CDP_PORT || 9223),
    playwrightMcpPort: Number(process.env.WEB_AGENTS_PLAYWRIGHT_MCP_PORT || 8931),
    skipPlaywrightMcp: process.env.WEB_AGENTS_SKIP_PLAYWRIGHT_MCP === "1",
    requireWorkspaceSelection: process.env.WEB_AGENTS_REQUIRE_WORKSPACE !== "0",
  });
  const runtimeDir = path.join(productRoot, "data", "runtime");
  await fsp.mkdir(runtimeDir, { recursive: true });
  await fsp.writeFile(path.join(runtimeDir, "services.json"), `${JSON.stringify({
    schema: "web-agents-roundtable-services.v1",
    pid: process.pid,
    repoRoot: path.resolve(repoRoot),
    ports: services.ports,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  console.log(`Web Agents roundtable services ready at ${services.healthUrl}`);
  console.log(`PID ${process.pid}; Chrome CDP ${services.ports.chromeCdp}; Playwright MCP ${services.ports.playwrightMcp}`);
  const shutdown = async () => {
    await services.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export { httpReady, tcpReady };
