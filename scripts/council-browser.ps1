param(
  [string]$Session,

  [int]$Round = 1,

  [string[]]$Models = @(),

  [switch]$Submit,

  [switch]$DryRun,

  [switch]$Headless,

  [switch]$KeepOpen,

  [string]$BrowserProfile,

  [string]$Channel = "chrome",

  [int]$TimeoutMs = 30000
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$scriptPath = Join-Path $PSScriptRoot "council-browser.mjs"

$nodeArgs = @(
  $scriptPath,
  "--root", $repoRoot,
  "--round", "$Round",
  "--channel", $Channel,
  "--timeout-ms", "$TimeoutMs"
)

if ($Session) {
  $nodeArgs += @("--session", $Session)
}

if ($Models.Count -gt 0) {
  $nodeArgs += @("--models", ($Models -join ","))
}

if ($BrowserProfile) {
  $nodeArgs += @("--profile", $BrowserProfile)
}

if ($Submit) {
  $nodeArgs += "--submit"
}

if ($DryRun) {
  $nodeArgs += "--dry-run"
}

if ($Headless) {
  $nodeArgs += "--headless"
}

if ($KeepOpen) {
  $nodeArgs += "--keep-open"
}

& node @nodeArgs
