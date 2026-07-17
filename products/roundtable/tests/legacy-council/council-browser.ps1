param(
  [string]$Session,

  [int]$Round = 1,

  [string[]]$Models = @(),

  [switch]$Submit,

  [switch]$Collect,

  [switch]$DryRun,

  [switch]$Headless,

  [switch]$KeepOpen,

  [string]$BrowserProfile,

  [string]$Channel = "chrome",

  [int]$TimeoutMs = 30000,

  [int]$ReplyTimeoutMs = 180000,

  [int]$SettleMs = 3000
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")
$scriptPath = Join-Path $PSScriptRoot "council-browser.mjs"

$nodeArgs = @(
  $scriptPath,
  "--root", $repoRoot,
  "--round", "$Round",
  "--channel", $Channel,
  "--timeout-ms", "$TimeoutMs",
  "--reply-timeout-ms", "$ReplyTimeoutMs",
  "--settle-ms", "$SettleMs"
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

if ($Collect) {
  $nodeArgs += "--collect"
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
