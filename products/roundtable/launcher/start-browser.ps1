param(
  [switch] $Stop,
  [string] $LaunchStatePath,
  [string] $CleanupLaunchStatePath,
  [string] $OpenUrl,
  [ValidateRange(1, 65535)]
  [int] $CdpPort = 9223
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "native-process.ps1")

$ExitPreflight = 10
$ExitPortConflict = 20
$ExitStartup = 30
$productRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
$profileDir = if ($env:WEB_AGENTS_ROUNDTABLE_PROFILE_DIR) {
  [IO.Path]::GetFullPath($env:WEB_AGENTS_ROUNDTABLE_PROFILE_DIR)
} else {
  [IO.Path]::GetFullPath((Join-Path $productRoot "data\browser-profile"))
}
$cdpEndpoint = "http://127.0.0.1:$CdpPort"

function Throw-BrowserLauncherError {
  param([string] $Message, [int] $ExitCode)
  $exception = [InvalidOperationException]::new($Message)
  $exception.Data["ExitCode"] = $ExitCode
  throw $exception
}

function Resolve-ChromePath {
  $candidates = @(
    $env:WEB_AGENTS_CHROME_PATH,
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  ) | Where-Object { $_ }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }
  Throw-BrowserLauncherError -ExitCode $ExitPreflight -Message "Google Chrome was not found."
}

function Open-UrlInDedicatedBrowser {
  param([string] $Url)
  if (-not $Url) { return }
  if ($Url -notmatch '^https?://127\.0\.0\.1(?::\d+)?(?:/|$)') {
    Throw-BrowserLauncherError -ExitCode $ExitPreflight -Message "Only loopback Web Agents URLs may be opened by the dedicated browser launcher."
  }
  $pages = @(Invoke-RestMethod -Uri "$cdpEndpoint/json/list" -Method Get -TimeoutSec 2)
  $existing = $pages | Where-Object { $_.type -eq "page" -and $_.url -eq $Url } | Select-Object -First 1
  if ($existing) {
    Invoke-RestMethod -Uri "$cdpEndpoint/json/activate/$($existing.id)" -Method Get -TimeoutSec 2 | Out-Null
    return
  }
  $encodedUrl = [Uri]::EscapeDataString($Url)
  Invoke-RestMethod -Uri "$cdpEndpoint/json/new?$encodedUrl" -Method Put -TimeoutSec 2 | Out-Null
}

function Test-SamePath {
  param([string] $First, [string] $Second)
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
  return @(Get-WebAgentsTcpListenerOwnerIds -Port $CdpPort)
}

function Get-CdpVersion {
  try {
    return Invoke-RestMethod -Uri "$cdpEndpoint/json/version" -Method Get -TimeoutSec 2
  }
  catch {
    return $null
  }
}

function Get-ManualBrowserIdentity {
  param([string] $OwnershipToken)
  $owners = @(Get-PortOwnerIds)
  if ($owners.Count -eq 0) {
    return [pscustomobject]@{ State = "free"; Compatible = $false; Pid = $null; Reason = "port is free" }
  }
  if ($owners.Count -ne 1) {
    return [pscustomobject]@{ State = "occupied"; Compatible = $false; Pid = $null; Reason = "multiple listener owners" }
  }
  $ownerPid = [int]$owners[0]
  $processInfo = Get-WebAgentsProcessInfo -ProcessId $ownerPid
  $commandLine = [string]$processInfo.CommandLine
  $profileFlag = "--user-data-dir=$profileDir"
  $profileFlagQuoted = "--user-data-dir=`"$profileDir`""
  $hasExpectedName = $processInfo -and [string]$processInfo.Name -ieq "chrome.exe"
  $hasPortFlag = $commandLine.IndexOf("--remote-debugging-port=$CdpPort", [StringComparison]::OrdinalIgnoreCase) -ge 0
  $hasProfileFlag =
    $commandLine.IndexOf($profileFlag, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $commandLine.IndexOf($profileFlagQuoted, [StringComparison]::OrdinalIgnoreCase) -ge 0
  $hasOwnershipToken = -not $OwnershipToken -or
    $commandLine.IndexOf("--web-agents-launch-token=$OwnershipToken", [StringComparison]::OrdinalIgnoreCase) -ge 0
  $hasCdpVersion = [bool](Get-CdpVersion)
  $matches = $hasExpectedName -and $hasPortFlag -and $hasProfileFlag -and $hasOwnershipToken -and $hasCdpVersion
  $reason = if (-not $hasExpectedName) { "listener identity mismatch: executable" }
    elseif (-not $hasPortFlag) { "listener identity mismatch: CDP port flag" }
    elseif (-not $hasProfileFlag) { "listener identity mismatch: profile flag" }
    elseif (-not $hasOwnershipToken) { "listener identity mismatch: ownership token" }
    elseif (-not $hasCdpVersion) { "listener identity mismatch: CDP version endpoint" }
    else { "verified manual browser" }
  return [pscustomobject]@{
    State = "occupied"
    Compatible = [bool]$matches
    Pid = $ownerPid
    Reason = $reason
    Process = $processInfo
  }
}

function Wait-ManualBrowser {
  param([string] $OwnershipToken, [int] $TimeoutSeconds = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-CdpVersion)) {
      $script:lastManualBrowserIdentity = [pscustomobject]@{
        State = "starting"
        Compatible = $false
        Pid = $null
        Reason = "CDP version endpoint unavailable"
      }
      Start-Sleep -Milliseconds 300
      continue
    }
    $identity = Get-ManualBrowserIdentity -OwnershipToken $OwnershipToken
    $script:lastManualBrowserIdentity = $identity
    if ($identity.Compatible) { return $identity }
    Start-Sleep -Milliseconds 300
  }
  return $null
}

function Get-ProcessCreationUtcTicks {
  param($ProcessInfo)
  if (-not $ProcessInfo) { return [long]0 }
  try {
    return [long]$ProcessInfo.CreationUtcTicks
  }
  catch {
    return [long]0
  }
}

function Wait-CdpPortFree {
  param([int] $TimeoutSeconds = 10)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ((Get-PortOwnerIds).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Write-BrowserLaunchState {
  param(
    [string] $Path,
    [pscustomobject] $Identity,
    [bool] $StartedByInvocation,
    [string] $OwnershipToken
  )
  if (-not $Path) { return }

  $resolvedPath = [IO.Path]::GetFullPath($Path)
  $parent = Split-Path -Parent $resolvedPath
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $temporaryPath = "$resolvedPath.$PID.tmp"
  $state = [ordered]@{
    Version = 1
    StartedByInvocation = $StartedByInvocation
    Pid = [int]$Identity.Pid
    ProcessCreationUtcTicks = Get-ProcessCreationUtcTicks -ProcessInfo $Identity.Process
    CdpPort = $CdpPort
    ProfileDir = $profileDir
    OwnershipToken = if ($StartedByInvocation) { $OwnershipToken } else { $null }
  }
  try {
    [IO.File]::WriteAllText(
      $temporaryPath,
      ($state | ConvertTo-Json -Compress),
      [Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $temporaryPath -Destination $resolvedPath -Force
  }
  finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-OwnedBrowserCleanup {
  param([string] $StatePath)
  if (-not $StatePath -or -not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
    Throw-BrowserLauncherError -ExitCode $ExitPreflight -Message "Browser launch state is missing."
  }

  try {
    $state = Get-Content -LiteralPath $StatePath -Encoding UTF8 -Raw | ConvertFrom-Json
  }
  catch {
    Throw-BrowserLauncherError -ExitCode $ExitPreflight -Message "Browser launch state is invalid: $StatePath"
  }

  if ([int]$state.Version -ne 1 -or [int]$state.CdpPort -ne $CdpPort -or
      -not (Test-SamePath -First ([string]$state.ProfileDir) -Second $profileDir)) {
    Throw-BrowserLauncherError -ExitCode $ExitPortConflict -Message "Browser launch state does not match this CDP launcher."
  }
  if ($state.StartedByInvocation -ne $true) {
    Write-Host "Browser launch state records a reused Chrome; cleanup skipped." -ForegroundColor Yellow
    return
  }

  $expectedPid = [int]$state.Pid
  $ownershipToken = [string]$state.OwnershipToken
  if ($expectedPid -le 0 -or -not $ownershipToken) {
    Throw-BrowserLauncherError -ExitCode $ExitPortConflict -Message "Browser launch state has no valid ownership identity."
  }

  $identity = Get-ManualBrowserIdentity -OwnershipToken $ownershipToken
  if ($identity.State -eq "free") {
    Write-Host "Chrome started by this launcher is already stopped." -ForegroundColor Yellow
    return
  }
  if (-not $identity.Compatible -or [int]$identity.Pid -ne $expectedPid) {
    Throw-BrowserLauncherError -ExitCode $ExitPortConflict -Message "Refusing cleanup because the current CDP listener does not match this launch receipt."
  }

  $expectedCreationTicks = [long]$state.ProcessCreationUtcTicks
  $actualCreationTicks = Get-ProcessCreationUtcTicks -ProcessInfo $identity.Process
  if ($expectedCreationTicks -gt 0 -and $actualCreationTicks -ne $expectedCreationTicks) {
    Throw-BrowserLauncherError -ExitCode $ExitPortConflict -Message "Refusing cleanup because the Chrome PID was reused."
  }

  Stop-Process -Id $identity.Pid -Force -ErrorAction SilentlyContinue
  if (-not (Wait-CdpPortFree)) {
    Throw-BrowserLauncherError -ExitCode $ExitStartup -Message "Owned Chrome PID $($identity.Pid) did not release CDP port $CdpPort."
  }
  Write-Host "Stopped Chrome PID $($identity.Pid) started by this launcher." -ForegroundColor Green
}

$exitCode = 0
$startedProcess = $null
$startedOwnershipToken = $null
try {
  if ($LaunchStatePath -and ($Stop -or $CleanupLaunchStatePath)) {
    Throw-BrowserLauncherError -ExitCode $ExitPreflight -Message "LaunchStatePath cannot be combined with a stop operation."
  }
  if ($Stop -and $CleanupLaunchStatePath) {
    Throw-BrowserLauncherError -ExitCode $ExitPreflight -Message "Stop cannot be combined with CleanupLaunchStatePath."
  }
  if ($LaunchStatePath) {
    Remove-Item -LiteralPath $LaunchStatePath -Force -ErrorAction SilentlyContinue
  }

  if ($CleanupLaunchStatePath) {
    Invoke-OwnedBrowserCleanup -StatePath $CleanupLaunchStatePath
  }
  else {
    $identity = Get-ManualBrowserIdentity
    if ($Stop) {
    if ($identity.State -eq "free") {
      Write-Host "Manual Web Agents browser is not running."
    }
    elseif (-not $identity.Compatible) {
      Throw-BrowserLauncherError -ExitCode $ExitPortConflict -Message "CDP port $CdpPort belongs to an unverified process."
    }
    else {
      Stop-Process -Id $identity.Pid -Force
      $null = Wait-CdpPortFree
      Write-Host "Stopped verified manual browser PID $($identity.Pid)." -ForegroundColor Green
    }
    }
    else {
      if ($identity.State -eq "occupied") {
        if (-not $identity.Compatible) {
          Throw-BrowserLauncherError -ExitCode $ExitPortConflict -Message "CDP port $CdpPort belongs to an unverified process."
        }
        Write-BrowserLaunchState -Path $LaunchStatePath -Identity $identity -StartedByInvocation $false
        Write-Host "Reusing manual Web Agents browser PID $($identity.Pid)." -ForegroundColor Yellow
      }
      else {
        $chromePath = Resolve-ChromePath
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
        $startedOwnershipToken = [guid]::NewGuid().ToString("N")
        $arguments = @(
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=$CdpPort",
          "--user-data-dir=`"$profileDir`"",
          "--web-agents-launch-token=$startedOwnershipToken",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-session-crashed-bubble"
        )
        $startedProcess = Start-Process -FilePath $chromePath -ArgumentList $arguments -WorkingDirectory $repoRoot -PassThru
        $identity = Wait-ManualBrowser -OwnershipToken $startedOwnershipToken
        if (-not $identity) {
          $lastIdentity = $script:lastManualBrowserIdentity
          if (-not $lastIdentity) { $lastIdentity = Get-ManualBrowserIdentity -OwnershipToken $startedOwnershipToken }
          Throw-BrowserLauncherError -ExitCode $ExitStartup -Message "Chrome started but its verified loopback CDP endpoint did not become ready ($($lastIdentity.Reason)). Close any Chrome window using this dedicated profile and retry."
        }
        Write-BrowserLaunchState -Path $LaunchStatePath -Identity $identity -StartedByInvocation $true -OwnershipToken $startedOwnershipToken
        Write-Host "Manual Web Agents browser started. PID: $($identity.Pid)" -ForegroundColor Green
      }
      if ($OpenUrl) {
        Open-UrlInDedicatedBrowser -Url $OpenUrl
        Write-Host "Opened $OpenUrl in the dedicated Web Agents Chrome profile." -ForegroundColor Cyan
      }
      Write-Host "Profile: $profileDir"
      Write-Host "CDP: $cdpEndpoint"
      Write-Host "Open provider pages, sign in, and complete verification manually. The launcher does not navigate to any provider."
    }
  }
}
catch {
  $requestedCode = $_.Exception.Data["ExitCode"]
  $exitCode = if ($requestedCode) { [int]$requestedCode } else { $ExitStartup }
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  if ($startedOwnershipToken) {
    $ownedIdentity = Get-ManualBrowserIdentity -OwnershipToken $startedOwnershipToken
    if ($ownedIdentity.Compatible) {
      Stop-Process -Id $ownedIdentity.Pid -Force -ErrorAction SilentlyContinue
    }
  }
  if ($startedProcess) {
    Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($LaunchStatePath) {
    Remove-Item -LiteralPath $LaunchStatePath -Force -ErrorAction SilentlyContinue
  }
}

exit $exitCode
