import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { createRoundtableServer } from "../app/server.mjs";
import { createFilesystemHttpServer } from "../../plugin/services/filesystem-http-server.mjs";
import { createPluginGatewayServer } from "../../plugin/services/plugin-gateway.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, "..", "..", "..");

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

function spawnPlaywrightMcp({ repoRoot, host, port, cdpEndpoint, logDir }) {
  const cli = path.join(repoRoot, "node_modules", "@playwright", "mcp", "cli.js");
  if (!fs.existsSync(cli)) throw new Error(`PLAYWRIGHT_MCP_NOT_INSTALLED:${cli}`);
  fs.mkdirSync(logDir, { recursive: true });
  const stdout = fs.createWriteStream(path.join(logDir, "playwright-mcp.out.log"), { flags: "a" });
  const stderr = fs.createWriteStream(path.join(logDir, "playwright-mcp.err.log"), { flags: "a" });
  const child = spawn(process.execPath, [
    cli,
    "--host", host,
    "--port", String(port),
    "--cdp-endpoint", cdpEndpoint,
    "--shared-browser-context",
    "--output-mode", "file",
    "--output-dir", path.join(repoRoot, "generated", "playwright-mcp"),
  ], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
  child.once("exit", () => { stdout.end(); stderr.end(); });
  return child;
}

export async function startLocalServices({
  repoRoot = defaultRepoRoot,
  host = "127.0.0.1",
  filesystemPort = 3006,
  gatewayPort = 3017,
  roundtablePort = 3020,
  cdpPort = 9223,
  playwrightMcpPort = 8931,
  skipPlaywrightMcp = false,
  requireWorkspaceSelection = true,
  gatewayServer = null,
  roundtableOptions = {},
} = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const pluginRoot = path.join(resolvedRoot, "products", "plugin");
  const filesystemServer = createFilesystemHttpServer({
    productRoot: pluginRoot,
    host,
    port: filesystemPort,
  });
  const activeGatewayServer = gatewayServer || createPluginGatewayServer({ productRoot: pluginRoot });
  let playwrightProcess = null;
  const ports = { filesystem: filesystemPort, gateway: gatewayPort, roundtable: roundtablePort, cdp: cdpPort, playwrightMcp: playwrightMcpPort };
  const localServicesProvider = async () => ({
    filesystem: { port: ports.filesystem, healthy: await httpReady(`http://${host}:${ports.filesystem}/health`) },
    gateway: { port: ports.gateway, healthy: await httpReady(`http://${host}:${ports.gateway}/health`) },
    chromeCdp: { port: ports.cdp, healthy: await httpReady(`http://${host}:${ports.cdp}/json/version`) },
    playwrightMcp: { port: ports.playwrightMcp, healthy: skipPlaywrightMcp ? null : await tcpReady(host, ports.playwrightMcp) },
    roundtable: { port: ports.roundtable, healthy: true },
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
    const filesystemAddress = await listen(filesystemServer, filesystemPort, host);
    ports.filesystem = filesystemAddress.port;
    const gatewayAddress = await listen(activeGatewayServer, gatewayPort, host);
    ports.gateway = gatewayAddress.port;
    if (!skipPlaywrightMcp) {
      playwrightProcess = spawnPlaywrightMcp({
        repoRoot: resolvedRoot,
        host,
        port: playwrightMcpPort,
        cdpEndpoint: `http://${host}:${cdpPort}`,
        logDir: path.join(resolvedRoot, "generated", "logs"),
      });
    }
    const roundtableAddress = await listen(roundtableServer, roundtablePort, host);
    ports.roundtable = roundtableAddress.port;
  } catch (error) {
    if (playwrightProcess && !playwrightProcess.killed) playwrightProcess.kill();
    await Promise.allSettled([closeServer(roundtableServer), closeServer(activeGatewayServer), closeServer(filesystemServer)]);
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
    await Promise.allSettled([closeServer(roundtableServer), closeServer(activeGatewayServer), closeServer(filesystemServer)]);
  }

  return {
    repoRoot: resolvedRoot,
    host,
    ports,
    filesystemServer,
    gatewayServer: activeGatewayServer,
    roundtableServer,
    get playwrightProcess() { return playwrightProcess; },
    status: localServicesProvider,
    close,
  };
}

if (path.resolve(process.argv[1] || "") === __filename) {
  const repoRoot = process.env.WEB_AGENTS_REPO_ROOT || defaultRepoRoot;
  const host = "127.0.0.1";
  const services = await startLocalServices({
    repoRoot,
    host,
    filesystemPort: Number(process.env.WEB_AGENTS_FILESYSTEM_PORT || 3006),
    gatewayPort: Number(process.env.WEB_AGENT_IMAGE_SAVE_PORT || 3017),
    roundtablePort: Number(process.env.WEB_AGENTS_ROUNDTABLE_PORT || 3020),
    cdpPort: Number(process.env.WEB_AGENTS_CDP_PORT || 9223),
    playwrightMcpPort: Number(process.env.WEB_AGENTS_PLAYWRIGHT_MCP_PORT || 8931),
    skipPlaywrightMcp: process.env.WEB_AGENTS_SKIP_PLAYWRIGHT_MCP === "1",
    requireWorkspaceSelection: process.env.WEB_AGENTS_REQUIRE_WORKSPACE !== "0",
  });
  await fsp.mkdir(path.join(repoRoot, "generated", "runtime"), { recursive: true });
  await fsp.writeFile(path.join(repoRoot, "generated", "runtime", "services.json"), `${JSON.stringify({
    schema: "web-agents-local-services.v1",
    pid: process.pid,
    repoRoot: path.resolve(repoRoot),
    ports: services.ports,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  console.log(`Web Agents local services ready at http://${host}:${services.ports.roundtable}`);
  console.log(`PID ${process.pid}; MCP ${services.ports.filesystem}; gateway ${services.ports.gateway}; Playwright MCP ${services.ports.playwrightMcp}`);
  const shutdown = async () => {
    await services.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export { httpReady, tcpReady };
