param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Task,

  [string[]]$Models = @("gpt", "deepseek", "doubao", "gemini"),

  [int]$Rounds = 5,

  [string]$Coordinator = "codex"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$candidateRoots = @()

if ($env:CODEX_HOME) {
  $candidateRoots += (Join-Path $env:CODEX_HOME "skills\webagents")
}

$candidateRoots += @(
  "F:\CodexHome\skills\webagents",
  (Join-Path $env:USERPROFILE ".agents\skills\webagents"),
  (Join-Path $env:USERPROFILE ".codex\skills\webagents")
)

$skillScript = $null
foreach ($candidateRoot in $candidateRoots) {
  $candidateScript = Join-Path $candidateRoot "scripts\new-council-session.ps1"
  if (Test-Path $candidateScript) {
    $skillScript = $candidateScript
    break
  }
}

if (-not $skillScript) {
  throw "webagents skill was not found. Expected scripts/new-council-session.ps1 under CODEX_HOME\skills\webagents or F:\CodexHome\skills\webagents."
}

& $skillScript `
  -Task $Task `
  -Root $repoRoot `
  -Models $Models `
  -Rounds $Rounds `
  -Coordinator $Coordinator
