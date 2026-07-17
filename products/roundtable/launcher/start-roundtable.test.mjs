import assert from "node:assert/strict";
import syncFs from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const launcherPath = path.join(__dirname, "start-roundtable.ps1");
const browserLauncherPath = path.join(__dirname, "start-browser.ps1");
const rootBatPath = path.join(productRoot, "start-roundtable.bat");
const isWindows = process.platform === "win32";

const fakeChromeSource = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;

public static class Program
{
    public static int Main(string[] args)
    {
        int port = 0;
        foreach (string argument in args)
        {
            const string prefix = "--remote-debugging-port=";
            if (argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                Int32.TryParse(argument.Substring(prefix.Length), out port);
            }
        }

        if (port <= 0)
        {
            return 2;
        }

        string markerPath = Environment.GetEnvironmentVariable("WEB_AGENTS_FAKE_CHROME_MARKER");
        if (!String.IsNullOrEmpty(markerPath))
        {
            File.AppendAllText(
                markerPath,
                Process.GetCurrentProcess().Id + " " + Environment.CommandLine + Environment.NewLine);
        }

        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            listener.Start();
            if (!String.IsNullOrEmpty(markerPath))
            {
                File.AppendAllText(markerPath, "LISTENING" + Environment.NewLine);
            }
        }
        catch (Exception error)
        {
            if (!String.IsNullOrEmpty(markerPath))
            {
                File.AppendAllText(markerPath, "FATAL " + error + Environment.NewLine);
            }
            return 3;
        }

        while (true)
        {
            try
            {
                using (TcpClient client = listener.AcceptTcpClient())
                using (NetworkStream stream = client.GetStream())
                {
                    byte[] request = new byte[4096];
                    stream.Read(request, 0, request.Length);
                    byte[] body = Encoding.UTF8.GetBytes("{\"Browser\":\"Controlled Chrome\",\"Protocol-Version\":\"1.3\"}");
                    byte[] header = Encoding.ASCII.GetBytes(
                        "HTTP/1.1 200 OK\r\n" +
                        "Content-Type: application/json\r\n" +
                        "Content-Length: " + body.Length + "\r\n" +
                        "Connection: close\r\n\r\n");
                    stream.Write(header, 0, header.Length);
                    stream.Write(body, 0, body.Length);
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrEmpty(markerPath))
                {
                    File.AppendAllText(markerPath, "ERROR " + error + Environment.NewLine);
                }
            }
        }
    }
}
`;

function quotePowerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function createControlledChrome() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-controlled-chrome-"));
  const programFiles = path.join(fixtureRoot, "ProgramFiles");
  const chromeDir = path.join(programFiles, "Google", "Chrome", "Application");
  const sourcePath = path.join(fixtureRoot, "controlled-chrome.cs");
  const chromePath = path.join(chromeDir, "chrome.exe");
  const dataRoot = path.join(fixtureRoot, "data");
  const markerPath = path.join(fixtureRoot, "chrome-starts.txt");
  await fs.mkdir(chromeDir, { recursive: true });
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.writeFile(sourcePath, fakeChromeSource, "utf8");

  const compileCommand = [
    `$source = Get-Content -Raw -Encoding UTF8 -LiteralPath ${quotePowerShellLiteral(sourcePath)}`,
    `Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly ${quotePowerShellLiteral(chromePath)} -OutputType WindowsApplication`,
  ].join("; ");
  const compiled = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", compileCommand],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000 }
  );
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);

  return {
    markerPath,
    cleanup: () => fs.rm(fixtureRoot, { recursive: true, force: true }),
    env: {
      ...process.env,
      ProgramFiles: programFiles,
      "ProgramFiles(x86)": path.join(fixtureRoot, "ProgramFilesX86"),
      LOCALAPPDATA: path.join(fixtureRoot, "LocalAppData"),
      WEB_AGENTS_CHROME_PATH: chromePath,
      WEB_AGENTS_DATA_ROOT: dataRoot,
      WEB_AGENTS_FAKE_CHROME_MARKER: markerPath,
    },
  };
}

function runPowerShellScript(scriptPath, args, env, timeout) {
  const captureDir = syncFs.mkdtempSync(path.join(os.tmpdir(), "web-agents-launcher-capture-"));
  const stdoutPath = path.join(captureDir, "stdout.log");
  const stderrPath = path.join(captureDir, "stderr.log");
  const stdoutFd = syncFs.openSync(stdoutPath, "w");
  const stderrFd = syncFs.openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      {
        cwd: repoRoot,
        env,
        encoding: "utf8",
        stdio: ["ignore", stdoutFd, stderrFd],
        timeout,
        windowsHide: true,
      }
    );
  } finally {
    syncFs.closeSync(stdoutFd);
    syncFs.closeSync(stderrFd);
  }
  const output = {
    ...result,
    stdout: syncFs.readFileSync(stdoutPath, "utf8"),
    stderr: syncFs.readFileSync(stderrPath, "utf8"),
  };
  syncFs.rmSync(captureDir, { recursive: true, force: true });
  return output;
}

function runLauncher(args, env = process.env) {
  return runPowerShellScript(launcherPath, args, env, 120_000);
}

function runBrowserLauncher(args, env = process.env) {
  return runPowerShellScript(browserLauncherPath, args, env, 60_000);
}

function getProcessCount() {
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-Command", "(Get-Process).Count"],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 10_000 }
  );
  return Number.parseInt(result.stdout.trim(), 10) || null;
}

async function getFreePort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchFreshJson(url) {
  const response = await fetch(url, { headers: { Connection: "close" } });
  assert.equal(response.ok, true, `${url} returned HTTP ${response.status}`);
  return response.json();
}

test("launcher source is parseable and defaults to the verified CDP service host", { skip: !isWindows }, async () => {
  const source = await fs.readFile(launcherPath, "utf8");
  assert.doesNotMatch(source, /mcp-proxy@latest/i);
  assert.match(source, /start-roundtable-services\.mjs/i);
  assert.match(source, /start-browser\.ps1/i);
  assert.match(source, /Chrome CDP \$CdpPort, Playwright MCP 8931, roundtable \$RoundtablePort/i);
  assert.doesNotMatch(source, /MCP 3006|gateway 3017|local\.filesystem|local\.gateway/i);
  assert.match(source, /\[int\] \$CdpPort = 9223/i);
  assert.match(source, /\[string\] \$BrowserMode = "cdp"/i);
  assert.match(source, /WEB_AGENTS_ROUNDTABLE_PORT/);
  assert.match(source, /Stop-VerifiedProcessTree/);
  assert.match(source, /Normalize-ProcessPathEnvironment/);
  assert.match(source, /CleanupLaunchStatePath/);
  assert.match(source, /native-process\.ps1/i);
  assert.doesNotMatch(source, /Get-CimInstance/i);
  assert.doesNotMatch(source, /Get-NetTCPConnection/i);

  const escapedLauncherPath = launcherPath.replaceAll("'", "''");
  const parse = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('${escapedLauncherPath}',[ref]$null,[ref]$e)|Out-Null; if($e){$e|Out-String|Write-Error; exit 1}`,
    ],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true }
  );
  assert.equal(parse.status, 0, parse.stderr || parse.stdout);
});

test("root BAT uses UTF-8 and forwards arguments to the verified launcher", { skip: !isWindows }, async () => {
  const source = await fs.readFile(rootBatPath, "utf8");

  assert.match(source, /chcp 65001/i);
  assert.match(source, /start-roundtable\.ps1/i);
  assert.match(source, /%\*/);
  assert.match(source, /exit \/b %ERRORLEVEL%/i);
});

test("launcher starts, reuses, identifies, and stops one roundtable process", { skip: !isWindows, timeout: 300_000 }, async (t) => {
  const port = await getFreePort();
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "web-agents-launcher-data-"));
  const env = { ...process.env, WEB_AGENTS_DATA_ROOT: dataRoot };
  t.after(async () => {
    runLauncher(["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-Stop"], env);
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  const processCounts = { before: getProcessCount(), after: null };
  const durations = {};
  const runPhase = (name, args) => {
    const startedAt = performance.now();
    const result = runLauncher(args, env);
    durations[name] = Math.round(performance.now() - startedAt);
    return result;
  };
  const chainStartedAt = performance.now();
  const started = runPhase("start", ["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-NoOpen"]);
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const firstHealth = await fetchFreshJson(healthUrl);
  assert.equal(firstHealth.service, "web-agents-roundtable");
  assert.equal(firstHealth.port, port);
  assert.equal(path.resolve(firstHealth.repoRoot), repoRoot);
  assert.equal(path.resolve(firstHealth.storage.dataRoot), path.resolve(dataRoot));
  assert.equal(firstHealth.browser.mode, "cdp");

  const reused = runPhase("reuse", ["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-NoOpen"]);
  assert.equal(reused.status, 0, reused.stderr || reused.stdout);
  const secondHealth = await fetchFreshJson(healthUrl);
  assert.equal(secondHealth.pid, firstHealth.pid);

  const restarted = runPhase("restart", ["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-NoOpen", "-Restart"]);
  assert.equal(restarted.status, 0, restarted.stderr || restarted.stdout);
  const restartedHealth = await fetchFreshJson(healthUrl);
  assert.notEqual(restartedHealth.pid, firstHealth.pid);

  const stopped = runPhase("stop", ["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-Stop"]);
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  assert.equal(await isReachable(healthUrl), false);
  durations.total = Math.round(performance.now() - chainStartedAt);
  processCounts.after = getProcessCount();
  const diagnostic = JSON.stringify({ durationsMs: durations, processCounts });
  for (const phase of ["start", "reuse", "restart", "stop"]) {
    assert.ok(durations[phase] < 30_000, diagnostic);
  }
  assert.ok(durations.total < 90_000, diagnostic);
});

test("launcher refuses fake health and restart never kills the foreign listener", { skip: !isWindows, timeout: 60_000 }, async (t) => {
  const fakeServer = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      service: "web-agents-roundtable",
      pid: process.pid,
      port: fakeServer.address().port,
      repoRoot,
    }));
  });
  fakeServer.listen(0, "127.0.0.1");
  await once(fakeServer, "listening");
  t.after(async () => {
    fakeServer.close();
    await once(fakeServer, "close");
  });
  const { port } = fakeServer.address();

  const blocked = runLauncher(["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-NoOpen"]);
  assert.equal(blocked.status, 20, blocked.stderr || blocked.stdout);
  const blockedRestart = runLauncher(["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-NoOpen", "-Restart"]);
  assert.equal(blockedRestart.status, 20, blockedRestart.stderr || blockedRestart.stdout);
  const blockedStop = runLauncher(["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-Stop"]);
  assert.equal(blockedStop.status, 20, blockedStop.stderr || blockedStop.stdout);
  assert.equal(await isReachable(`http://127.0.0.1:${port}`), true);
});

test("default CDP startup cleans Chrome started by this run when a foreign roundtable listener blocks startup", { skip: !isWindows, timeout: 180_000 }, async (t) => {
  const fixture = await createControlledChrome();
  const cdpPort = await getFreePort();
  const fakeServer = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  fakeServer.listen(0, "127.0.0.1");
  await once(fakeServer, "listening");
  const { port } = fakeServer.address();

  t.after(async () => {
    runBrowserLauncher(["-CdpPort", String(cdpPort), "-Stop"], fixture.env);
    fakeServer.close();
    await once(fakeServer, "close");
    await fixture.cleanup();
  });

  const blocked = runLauncher(
    ["-RoundtablePort", String(port), "-CdpPort", String(cdpPort), "-NoOpen"],
    fixture.env
  );

  assert.equal(blocked.status, 20, blocked.stderr || blocked.stdout);
  assert.notEqual((await fs.readFile(fixture.markerPath, "utf8")).trim(), "");
  assert.equal(await isReachable(`http://127.0.0.1:${cdpPort}/json/version`), false);
  assert.equal(await isReachable(`http://127.0.0.1:${port}`), true);
});

test("default CDP startup preserves Chrome that was already running when a foreign roundtable listener blocks startup", { skip: !isWindows, timeout: 180_000 }, async (t) => {
  const fixture = await createControlledChrome();
  const cdpPort = await getFreePort();
  t.after(async () => {
    runBrowserLauncher(["-CdpPort", String(cdpPort), "-Stop"], fixture.env);
    await fixture.cleanup();
  });
  const started = runBrowserLauncher(["-CdpPort", String(cdpPort)], fixture.env);
  const startMarker = await fs.readFile(fixture.markerPath, "utf8").catch(() => "marker missing");
  assert.equal(started.status, 0, `${started.stderr || started.stdout}\n${startMarker}`);
  const startsBefore = await fs.readFile(fixture.markerPath, "utf8");

  const fakeServer = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  fakeServer.listen(0, "127.0.0.1");
  await once(fakeServer, "listening");
  const { port } = fakeServer.address();

  t.after(async () => {
    fakeServer.close();
    await once(fakeServer, "close");
  });

  const blocked = runLauncher(
    ["-RoundtablePort", String(port), "-CdpPort", String(cdpPort), "-NoOpen"],
    fixture.env
  );

  const cdpReachable = await isReachable(`http://127.0.0.1:${cdpPort}/json/version`);
  const markerAfter = await fs.readFile(fixture.markerPath, "utf8");
  const foreignReachable = await isReachable(`http://127.0.0.1:${port}`);
  assert.equal(blocked.status, 20, blocked.stderr || blocked.stdout);
  assert.equal(cdpReachable, true);
  assert.equal(markerAfter, startsBefore);
  assert.equal(foreignReachable, true);
});

test("launcher rejects a relative data root before creating a listener", { skip: !isWindows, timeout: 30_000 }, async () => {
  const port = await getFreePort();
  const env = { ...process.env, WEB_AGENTS_DATA_ROOT: "relative-roundtable-data" };
  const result = runLauncher(["-RoundtablePort", String(port), "-BrowserMode", "cdp", "-RoundtableOnly", "-NoOpen"], env);
  assert.equal(result.status, 10, result.stderr || result.stdout);
  assert.equal(await isReachable(`http://127.0.0.1:${port}/api/health`), false);
});

test("launcher rejects a custom port in extension mode", { skip: !isWindows, timeout: 30_000 }, async () => {
  const port = await getFreePort();
  const result = runLauncher(["-RoundtablePort", String(port), "-BrowserMode", "extension", "-NoOpen"]);

  assert.equal(result.status, 10, result.stderr || result.stdout);
  assert.equal(await isReachable(`http://127.0.0.1:${port}/api/health`), false);
});
