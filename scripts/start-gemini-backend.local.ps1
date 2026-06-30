$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$gatewayScript = Join-Path $repoRoot "scripts/web-agent-image-save-gateway.mjs"

Set-Location $repoRoot

Write-Host "Starting web_Agent local image save gateway on http://127.0.0.1:3017 ..." -ForegroundColor Cyan
$gatewayJob = Start-Job -ScriptBlock {
  param($ScriptPath)
  node $ScriptPath
} -ArgumentList $gatewayScript

Start-Sleep -Milliseconds 700
if ($gatewayJob.State -ne "Running") {
  Receive-Job $gatewayJob -ErrorAction SilentlyContinue
  throw "web_Agent image save gateway failed to start."
}

try {
  Write-Host "Starting MCP filesystem bridge on http://127.0.0.1:3006/sse ..." -ForegroundColor Cyan
  npx -y mcp-proxy@latest `
    --port 3006 `
    --host 127.0.0.1 `
    --sseEndpoint /sse `
    --streamEndpoint /mcp `
    --shell `
    -- `
    npx.cmd `
    -y `
    @modelcontextprotocol/server-filesystem@latest `
    F:\web_agents
}
finally {
  if ($gatewayJob) {
    Stop-Job $gatewayJob -ErrorAction SilentlyContinue
    Receive-Job $gatewayJob -ErrorAction SilentlyContinue
    Remove-Job $gatewayJob -Force -ErrorAction SilentlyContinue
  }
}
