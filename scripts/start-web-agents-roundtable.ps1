param(
  [switch] $Restart,
  [switch] $Stop,
  [switch] $NoOpen,
  [switch] $RoundtableOnly,
  [ValidateRange(1, 65535)]
  [int] $RoundtablePort = 3020,
  [ValidateRange(1, 65535)]
  [int] $CdpPort = 9223,
  [ValidateSet("extension", "cdp")]
  [string] $BrowserMode = "cdp"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "web-agents-native-process.ps1")

function Normalize-ProcessPathEnvironment {
  $processPath = $env:PATH
  if (-not $processPath) { return }
  [Environment]::SetEnvironmentVariable("PATH", $null, [EnvironmentVariableTarget]::Process)
  [Environment]::SetEnvironmentVariable("Path", $processPath, [EnvironmentVariableTarget]::Process)
}

Normalize-ProcessPathEnvironment

$ExitPreflight = 10
$ExitPortConflict = 20
$ExitStartup = 30
$ServiceId = "web-agents-roundtable"
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$roundtableScript = Join-Path $repoRoot "apps/roundtable-web/server.mjs"
$serviceHostScript = Join-Path $repoRoot "scripts/start-web-agents-local-services.mjs"
$browserLauncher = Join-Path $repoRoot "scripts/start-web-agents-browser.ps1"
$launchScript = if ($RoundtableOnly -or $BrowserMode -eq "extension") { $roundtableScript } else { $serviceHostScript }
$logDir = Join-Path $repoRoot "generated/logs"
$roundtableUrl = "http://127.0.0.1:$RoundtablePort"
$healthUrl = "$roundtableUrl/api/health"
$startedProcess = $null
$stderrLog = $null
$browserLaunchStatePath = $null
$browserLaunchState = $null
$launcherMutex = $null
$mutexHeld = $false

Set-Location $repoRoot

function Throw-LauncherError {
  param(
    [string] $Message,
    [int] $ExitCode
  )
  $exception = [InvalidOperationException]::new($Message)
  $exception.Data["ExitCode"] = $ExitCode
  throw $exception
}

function Test-SamePath {
  param([string] $First, [string] $Second)
  if (-not $First -or -not $Second) { return $false }
  try {
    $left = [IO.Path]::GetFullPath($First).TrimEnd('\', '/')
    $right = [IO.Path]::GetFullPath($Second).TrimEnd('\', '/')
    return [StringComparer]::OrdinalIgnoreCase.Equals($left, $right)
  }
  catch {
    return $false
  }
}

function Get-PortOwnerIds {
  param([int] $Port)
  return @(Get-WebAgentsTcpListenerOwnerIds -Port $Port)
}

function Get-HealthPayload {
  param([string] $Uri)
  try {
    return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 2
  }
  catch {
    return $null
  }
}

function Get-RoundtableIdentity {
  param([int] $Port)

  $owners = @(Get-PortOwnerIds -Port $Port)
  if ($owners.Count -eq 0) {
    return [pscustomobject]@{ State = "free"; Compatible = $false; Pid = $null; Reason = "port is free" }
  }
  if ($owners.Count -ne 1) {
    return [pscustomobject]@{ State = "occupied"; Compatible = $false; Pid = $null; Reason = "multiple listener owners" }
  }

  $ownerPid = [int]$owners[0]
  $processInfo = Get-WebAgentsProcessInfo -ProcessId $ownerPid
  $health = Get-HealthPayload -Uri "http://127.0.0.1:$Port/api/health"
  if (-not $health) {
    return [pscustomobject]@{ State = "occupied"; Compatible = $false; Pid = $ownerPid; Reason = "health check failed"; Process = $processInfo }
  }

  $expectedScript = $launchScript.Replace('/', '\')
  $commandLine = [string]$processInfo.CommandLine
  $matches =
    $health.ok -eq $true -and
    [string]$health.service -eq $ServiceId -and
    [int]$health.pid -eq $ownerPid -and
    [int]$health.port -eq $Port -and
    [string]$health.browser.mode -eq $BrowserMode -and
    (Test-SamePath -First ([string]$health.repoRoot) -Second $repoRoot) -and
    $commandLine.IndexOf($expectedScript, [StringComparison]::OrdinalIgnoreCase) -ge 0

  if ($matches -and -not $RoundtableOnly -and $BrowserMode -eq "cdp") {
    $local = $health.localServices
    $matches =
      $local -and
      $local.filesystem.healthy -eq $true -and
      $local.gateway.healthy -eq $true -and
      $local.chromeCdp.healthy -eq $true -and
      $local.playwrightMcp.healthy -eq $true -and
      [int]$local.filesystem.port -eq 3006 -and
      [int]$local.gateway.port -eq 3017 -and
      [int]$local.chromeCdp.port -eq $CdpPort -and
      [int]$local.playwrightMcp.port -eq 8931
  }

  return [pscustomobject]@{
    State = "occupied"
    Compatible = [bool]$matches
    Pid = $ownerPid
    Reason = if ($matches) { "verified roundtable service" } else { "listener identity mismatch" }
    Process = $processInfo
    Health = $health
  }
}

function Get-DescendantProcessIds {
  param([int] $RootPid)
  $processes = @(Get-WebAgentsProcessSnapshot)
  $descendants = [Collections.Generic.List[int]]::new()
  $queue = [Collections.Generic.Queue[int]]::new()
  $queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($child in $processes | Where-Object { [int]$_.ParentProcessId -eq $parent }) {
      $childPid = [int]$child.ProcessId
      $descendants.Add($childPid)
      $queue.Enqueue($childPid)
    }
  }
  return @($descendants)
}

function Stop-VerifiedProcessTree {
  param([int] $RootPid)
  $descendants = @(Get-DescendantProcessIds -RootPid $RootPid)
  [array]::Reverse($descendants)
  foreach ($processId in $descendants) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue
}

function Wait-PortFree {
  param([int] $Port, [int] $TimeoutSeconds = 10)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ((Get-PortOwnerIds -Port $Port).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Stop-CompatibleRoundtable {
  param([int] $Port)
  $identity = Get-RoundtableIdentity -Port $Port
  if ($identity.State -eq "free") {
    Write-Host "Roundtable is not running on port $Port." -ForegroundColor Yellow
    return
  }
  if (-not $identity.Compatible) {
    $commandLine = if ($identity.Process) { [string]$identity.Process.CommandLine } else { "unavailable" }
    Throw-LauncherError -ExitCode $ExitPortConflict -Message "Refusing to stop PID $($identity.Pid) on port ${Port}: $($identity.Reason). Command: $commandLine"
  }
  Write-Host "Stopping verified roundtable PID $($identity.Pid) ..." -ForegroundColor Yellow
  Stop-VerifiedProcessTree -RootPid $identity.Pid
  if (-not (Wait-PortFree -Port $Port)) {
    Throw-LauncherError -ExitCode $ExitStartup -Message "Verified roundtable PID $($identity.Pid) did not release port $Port."
  }
}

function Invoke-BrowserLauncher {
  param(
    [switch] $StopBrowser,
    [string] $CleanupLaunchStatePath
  )
  if ($RoundtableOnly -or $BrowserMode -ne "cdp") { return }
  if (-not (Test-Path -LiteralPath $browserLauncher -PathType Leaf)) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "Dedicated browser launcher is missing: $browserLauncher"
  }
  $arguments = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $browserLauncher,
    "-CdpPort", [string]$CdpPort
  )
  $isLaunch = -not $StopBrowser -and -not $CleanupLaunchStatePath
  if ($StopBrowser) {
    $arguments += "-Stop"
  }
  elseif ($CleanupLaunchStatePath) {
    $arguments += @("-CleanupLaunchStatePath", "`"$CleanupLaunchStatePath`"")
  }
  else {
    $script:browserLaunchStatePath = Join-Path (
      [IO.Path]::GetTempPath()
    ) "web-agents-browser-launch-$PID-$([guid]::NewGuid().ToString('N')).json"
    $arguments += @("-LaunchStatePath", "`"$script:browserLaunchStatePath`"")
  }

  $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    Throw-LauncherError -ExitCode $process.ExitCode -Message "Dedicated Chrome launcher failed with exit code $($process.ExitCode)."
  }
  if (-not $isLaunch) { return }

  try {
    $state = Get-Content -LiteralPath $script:browserLaunchStatePath -Encoding UTF8 -Raw | ConvertFrom-Json
  }
  catch {
    Throw-LauncherError -ExitCode $ExitStartup -Message "Dedicated Chrome launcher did not return a valid launch receipt."
  }
  $propertyNames = @($state.PSObject.Properties.Name)
  if ([int]$state.Version -ne 1 -or
      [int]$state.CdpPort -ne $CdpPort -or
      [int]$state.Pid -le 0 -or
      -not ($propertyNames -contains "StartedByInvocation") -or
      ($state.StartedByInvocation -eq $true -and -not [string]$state.OwnershipToken)) {
    Throw-LauncherError -ExitCode $ExitStartup -Message "Dedicated Chrome launcher returned an invalid launch receipt."
  }
  $script:browserLaunchState = $state
}

function Resolve-CommandPath {
  param([string] $Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "$Name was not found in PATH."
  }
  return $command.Source
}

function Resolve-ChromePath {
  $candidates = @(
    $env:WEB_AGENTS_CHROME_PATH,
    (Join-Path $env:ProgramFiles "Google/Chrome/Application/chrome.exe"),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Google/Chrome/Application/chrome.exe" }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Google/Chrome/Application/chrome.exe" })
  ) | Where-Object { $_ }
  $chromeCommand = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($chromeCommand) { $candidates += $chromeCommand.Source }
  $chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $chromePath) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "Google Chrome was not found. Install Chrome before starting browser automation."
  }
  return [IO.Path]::GetFullPath($chromePath)
}

function Resolve-DataRoot {
  $configPath = Join-Path $repoRoot "config/data-root.local.txt"
  if ($env:WEB_AGENTS_DATA_ROOT) {
    $candidate = $env:WEB_AGENTS_DATA_ROOT.Trim()
  }
  elseif (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $candidate = (Get-Content -LiteralPath $configPath -Encoding UTF8 -Raw).Trim([char]0xFEFF).Trim()
  }
  else {
    $candidate = Join-Path $repoRoot "generated/roundtable-data"
  }

  if (-not $candidate -or -not [IO.Path]::IsPathRooted($candidate)) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "The roundtable data root must be a non-empty absolute path."
  }
  $resolved = [IO.Path]::GetFullPath($candidate)
  if (Test-Path -LiteralPath $resolved -PathType Leaf) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "The roundtable data root points to a file: $resolved"
  }
  New-Item -ItemType Directory -Path $resolved -Force | Out-Null
  $probe = Join-Path $resolved ".launcher-write-$([guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($probe, "ok", [Text.UTF8Encoding]::new($false))
  }
  catch {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "The roundtable data root is not writable: $resolved"
  }
  finally {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  }
  return $resolved
}

function Invoke-Preflight {
  $nodePath = Resolve-CommandPath -Name "node.exe"
  $null = Resolve-CommandPath -Name "npm.cmd"
  if (-not (Test-Path -LiteralPath $launchScript -PathType Leaf)) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "Roundtable service host is missing: $launchScript"
  }

  $versionText = (& $nodePath --version 2>$null).Trim()
  if ($versionText -notmatch '^v(?<major>\d+)\.') {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "Could not parse Node.js version: $versionText"
  }
  if ([int]$Matches.major -lt 24) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "Node.js 24 or newer is required; found $versionText."
  }

  & $nodePath --input-type=module -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Throw-LauncherError -ExitCode $ExitPreflight -Message "Playwright is unavailable. Run npm.cmd ci in $repoRoot."
  }
  if (-not $RoundtableOnly -and $BrowserMode -eq "cdp") {
    $playwrightMcpCli = Join-Path $repoRoot "node_modules/@playwright/mcp/cli.js"
    if (-not (Test-Path -LiteralPath $playwrightMcpCli -PathType Leaf)) {
      Throw-LauncherError -ExitCode $ExitPreflight -Message "Playwright MCP is unavailable. Run npm.cmd ci in $repoRoot."
    }
  }

  $chromePath = Resolve-ChromePath
  $dataRoot = Resolve-DataRoot
  return [pscustomobject]@{ NodePath = $nodePath; ChromePath = $chromePath; DataRoot = $dataRoot }
}

function Wait-RoundtableHealthy {
  param([int] $Port, [Diagnostics.Process] $Process, [int] $TimeoutSeconds = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) { return $null }
    $identity = Get-RoundtableIdentity -Port $Port
    if ($identity.Compatible -and $identity.Pid -eq $Process.Id) { return $identity }
    Start-Sleep -Milliseconds 300
  }
  return $null
}

function Start-Roundtable {
  param([pscustomobject] $Preflight, [int] $Port)
  $runId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  $stdoutLog = Join-Path $logDir "roundtable-$runId.out.log"
  $script:stderrLog = Join-Path $logDir "roundtable-$runId.err.log"
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null

  $priorPort = $env:WEB_AGENTS_ROUNDTABLE_PORT
  $priorHost = $env:WEB_AGENTS_ROUNDTABLE_HOST
  $priorDataRoot = $env:WEB_AGENTS_DATA_ROOT
  $priorBrowserMode = $env:WEB_AGENTS_BROWSER_MODE
  $priorCdpPort = $env:WEB_AGENTS_CDP_PORT
  $priorRequireWorkspace = $env:WEB_AGENTS_REQUIRE_WORKSPACE
  $priorSkipPlaywright = $env:WEB_AGENTS_SKIP_PLAYWRIGHT_MCP
  try {
    $env:WEB_AGENTS_ROUNDTABLE_PORT = [string]$Port
    $env:WEB_AGENTS_ROUNDTABLE_HOST = "127.0.0.1"
    $env:WEB_AGENTS_DATA_ROOT = $Preflight.DataRoot
    $env:WEB_AGENTS_BROWSER_MODE = $BrowserMode
    $env:WEB_AGENTS_CDP_PORT = [string]$CdpPort
    $env:WEB_AGENTS_REQUIRE_WORKSPACE = if ($RoundtableOnly) { "0" } else { "1" }
    $env:WEB_AGENTS_SKIP_PLAYWRIGHT_MCP = if ($RoundtableOnly) { "1" } else { "0" }
    $script:startedProcess = Start-Process -FilePath $Preflight.NodePath `
      -ArgumentList @("`"$launchScript`"") `
      -WorkingDirectory $repoRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $script:stderrLog `
      -PassThru
  }
  finally {
    $env:WEB_AGENTS_ROUNDTABLE_PORT = $priorPort
    $env:WEB_AGENTS_ROUNDTABLE_HOST = $priorHost
    $env:WEB_AGENTS_DATA_ROOT = $priorDataRoot
    $env:WEB_AGENTS_BROWSER_MODE = $priorBrowserMode
    $env:WEB_AGENTS_CDP_PORT = $priorCdpPort
    $env:WEB_AGENTS_REQUIRE_WORKSPACE = $priorRequireWorkspace
    $env:WEB_AGENTS_SKIP_PLAYWRIGHT_MCP = $priorSkipPlaywright
  }

  $identity = Wait-RoundtableHealthy -Port $Port -Process $script:startedProcess
  if (-not $identity) {
    Throw-LauncherError -ExitCode $ExitStartup -Message "Roundtable failed its identity health check. Logs: $stdoutLog / $script:stderrLog"
  }
  Write-Host "Roundtable started on port $Port. PID: $($identity.Pid)" -ForegroundColor Green
  Write-Host "Logs: $stdoutLog / $script:stderrLog"
  return $identity
}

function Acquire-LauncherMutex {
  $keyBytes = [Text.Encoding]::UTF8.GetBytes("$repoRoot|$RoundtablePort")
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($keyBytes)
  $name = "Local\WebAgentsRoundtableLauncher-$([BitConverter]::ToString($hash).Replace('-', '').Substring(0, 24))"
  $script:launcherMutex = [Threading.Mutex]::new($false, $name)
  try {
    $script:mutexHeld = $script:launcherMutex.WaitOne(0)
  }
  catch [Threading.AbandonedMutexException] {
    $script:mutexHeld = $true
  }
  if (-not $script:mutexHeld) {
    Throw-LauncherError -ExitCode $ExitStartup -Message "Another launcher operation is already active for port $RoundtablePort."
  }
}

$exitCode = 0
try {
  Acquire-LauncherMutex

  if ($Stop) {
    Stop-CompatibleRoundtable -Port $RoundtablePort
    Invoke-BrowserLauncher -StopBrowser
    Write-Host "Roundtable stop check completed." -ForegroundColor Green
  }
  else {
    if ($BrowserMode -eq "extension" -and $RoundtablePort -ne 3020) {
      Throw-LauncherError -ExitCode $ExitPreflight -Message "Extension mode requires port 3020 because the Chrome bridge uses a fixed trusted origin. Use -BrowserMode cdp for a custom port."
    }
    $preflight = Invoke-Preflight
    Write-Host "Preflight passed: Node, npm, Playwright, Chrome, and data root are ready." -ForegroundColor DarkGray
    Invoke-BrowserLauncher

    $identity = Get-RoundtableIdentity -Port $RoundtablePort
    if ($identity.State -eq "occupied") {
      if (-not $identity.Compatible) {
        $commandLine = if ($identity.Process) { [string]$identity.Process.CommandLine } else { "unavailable" }
        Throw-LauncherError -ExitCode $ExitPortConflict -Message "Port $RoundtablePort belongs to PID $($identity.Pid), not this verified roundtable. Command: $commandLine"
      }
      if ($Restart) {
        Stop-CompatibleRoundtable -Port $RoundtablePort
        $identity = Start-Roundtable -Preflight $preflight -Port $RoundtablePort
      }
      else {
        Write-Host "Reusing verified roundtable PID $($identity.Pid) on port $RoundtablePort." -ForegroundColor Yellow
      }
    }
    else {
      $identity = Start-Roundtable -Preflight $preflight -Port $RoundtablePort
    }

    $confirmed = Get-RoundtableIdentity -Port $RoundtablePort
    if (-not $confirmed.Compatible) {
      Throw-LauncherError -ExitCode $ExitStartup -Message "Final roundtable identity check failed."
    }
    Write-Host "Web Agents roundtable is ready: $roundtableUrl" -ForegroundColor Cyan
    Write-Host "Browser mode: $BrowserMode"
    if ($RoundtableOnly) {
      Write-Host "Data root: $($confirmed.Health.storage.dataRoot)"
    }
    else {
      Write-Host "Workspace: select or resume it in the roundtable page."
      Write-Host "Services: MCP 3006, gateway 3017, Chrome CDP $CdpPort, Playwright MCP 8931, roundtable $RoundtablePort"
    }
    if (-not $NoOpen) { Start-Process -FilePath $roundtableUrl }
  }
}
catch {
  $requestedCode = $_.Exception.Data["ExitCode"]
  $exitCode = if ($requestedCode) { [int]$requestedCode } else { $ExitStartup }
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  if ($startedProcess -and -not $startedProcess.HasExited) {
    Write-Host "Cleaning up PID $($startedProcess.Id) started by this launcher ..." -ForegroundColor Yellow
    Stop-VerifiedProcessTree -RootPid $startedProcess.Id
    $null = Wait-PortFree -Port $RoundtablePort -TimeoutSeconds 10
  }
  if ($browserLaunchState -and
      $browserLaunchState.StartedByInvocation -eq $true -and
      $browserLaunchStatePath -and
      (Test-Path -LiteralPath $browserLaunchStatePath -PathType Leaf)) {
    Write-Host "Checking whether Chrome was started by this launcher ..." -ForegroundColor Yellow
    try {
      Invoke-BrowserLauncher -CleanupLaunchStatePath $browserLaunchStatePath
    }
    catch {
      Write-Host "WARNING: Owned Chrome cleanup was refused or failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
  }
  if ($stderrLog -and (Test-Path -LiteralPath $stderrLog -PathType Leaf)) {
    $tail = @(Get-Content -LiteralPath $stderrLog -Encoding UTF8 -Tail 20 -ErrorAction SilentlyContinue)
    if ($tail.Count -gt 0) {
      Write-Host "--- stderr tail ---" -ForegroundColor DarkYellow
      $tail | ForEach-Object { Write-Host $_ }
    }
  }
}
finally {
  if ($browserLaunchStatePath) {
    Remove-Item -LiteralPath $browserLaunchStatePath -Force -ErrorAction SilentlyContinue
  }
  if ($mutexHeld -and $launcherMutex) {
    try { $launcherMutex.ReleaseMutex() } catch { }
  }
  if ($launcherMutex) { $launcherMutex.Dispose() }
}

exit $exitCode
