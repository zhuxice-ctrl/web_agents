$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$env:WEB_AGENTS_ROOT = $repoRoot

node "$PSScriptRoot\web-agents-gateway.mjs"
