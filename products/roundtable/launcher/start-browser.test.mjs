import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const launcherPath = path.join(__dirname, "start-browser.ps1");
const processHelperPath = path.join(__dirname, "native-process.ps1");
const rootBatPath = path.join(__dirname, "start-browser.bat");
const roundtableLauncherPath = path.join(__dirname, "start-roundtable.ps1");
const isWindows = process.platform === "win32";

test("manual browser launcher is parseable and never contains provider navigation", { skip: !isWindows }, async () => {
  const source = await fs.readFile(launcherPath, "utf8");
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/i);
  assert.match(source, /--remote-debugging-port=\$CdpPort/i);
  assert.match(source, /data\\browser-profile/i);
  assert.match(source, /current CDP listener does not match this launch receipt/i);
  assert.match(source, /\[string\]\s+\$LaunchStatePath/i);
  assert.match(source, /\[string\]\s+\$CleanupLaunchStatePath/i);
  assert.match(source, /OwnershipToken/i);
  assert.match(source, /native-process\.ps1/i);
  assert.doesNotMatch(source, /Get-CimInstance/i);
  assert.doesNotMatch(source, /Get-NetTCPConnection/i);
  assert.doesNotMatch(source, /chatgpt\.com|chat\.deepseek\.com|doubao\.com/i);
  assert.doesNotMatch(source, /--enable-automation|--disable-extensions/i);

  const escaped = launcherPath.replaceAll("'", "''");
  const parsed = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    `$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$null,[ref]$e)|Out-Null; if($e){$e|Out-String|Write-Error; exit 1}`,
  ], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
});

test("roundtable opens its URL through the dedicated CDP browser, never the system default browser", async () => {
  const [browserSource, roundtableSource] = await Promise.all([
    fs.readFile(launcherPath, "utf8"),
    fs.readFile(roundtableLauncherPath, "utf8"),
  ]);
  assert.match(browserSource, /\[string\]\s+\$OpenUrl/i);
  assert.match(browserSource, /OpenUrl/);
  assert.match(browserSource, /\/json\/list/);
  assert.match(browserSource, /\/json\/activate\//);
  assert.match(browserSource, /\/json\/new\?/);
  assert.match(browserSource, /-Method\s+Put/i);
  assert.match(roundtableSource, /-OpenUrl/);
  assert.doesNotMatch(roundtableSource, /Start-Process\s+-FilePath\s+\$roundtableUrl/i);
  assert.match(roundtableSource, /Get-RoundtableIdentity\s+-Port\s+\$Port\s+-AllowDegradedLocalServices/i);
});

test("native process helper returns bounded process and TCP listener metadata", { skip: !isWindows }, async () => {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const escaped = processHelperPath.replaceAll("'", "''");
  try {
    const probe = spawnSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        `. '${escaped}'`,
        "$info = Get-WebAgentsProcessInfo -ProcessId $PID",
        "if (-not $info -or $info.ProcessId -ne $PID -or $info.ParentProcessId -le 0) { exit 2 }",
        "if (-not $info.CommandLine -or $info.Name -notmatch '^powershell(\\.exe)?$') { exit 3 }",
        "$snapshot = @(Get-WebAgentsProcessSnapshot)",
        "$selfSnapshot = $snapshot | Where-Object { $_.ProcessId -eq $PID } | Select-Object -First 1",
        "if (-not $selfSnapshot) { exit 4 }",
        "if ($selfSnapshot.CommandLine) { exit 6 }",
        `$owners = @(Get-WebAgentsTcpListenerOwnerIds -Port ${port})`,
        `if (-not ($owners -contains ${process.pid})) { exit 5 }`,
      ].join("; "),
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("manual browser BAT uses UTF-8 and forwards user arguments", { skip: !isWindows }, async () => {
  const source = await fs.readFile(rootBatPath, "utf8");
  assert.match(source, /chcp 65001/i);
  assert.match(source, /start-browser\.ps1/i);
  assert.match(source, /%\*/);
  assert.match(source, /exit \/b %ERRORLEVEL%/i);
});
