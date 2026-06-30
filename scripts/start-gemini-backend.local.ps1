$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$gatewayScript = Join-Path $repoRoot "scripts/web-agent-image-save-gateway.mjs"

Set-Location $repoRoot

function Test-HttpHealth {
  param([string]$Uri)
  try {
    return Invoke-RestMethod -Uri $Uri -TimeoutSec 2
  }
  catch {
    return $null
  }
}

function Test-PortListening {
  param([int]$Port)
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  return $connections.Count -gt 0
}

$mcpAlreadyRunning = Test-PortListening -Port 3006

Write-Host "Starting web_Agent local image save gateway on http://127.0.0.1:3017 ..." -ForegroundColor Cyan
$gatewayHealth = Test-HttpHealth -Uri "http://127.0.0.1:3017/health"

if ($mcpAlreadyRunning -and $gatewayHealth -and $gatewayHealth.ok) {
  Write-Host "MCP filesystem bridge is already running on http://127.0.0.1:3006/sse ." -ForegroundColor Yellow
  Write-Host "web_Agent image save gateway is already running on http://127.0.0.1:3017 ." -ForegroundColor Yellow
  return
}

if ($gatewayHealth -and $gatewayHealth.ok) {
  Write-Host "web_Agent image save gateway is already running; reusing it." -ForegroundColor Yellow
}
else {
  $gatewayJob = Start-Job -ScriptBlock {
    param($ScriptPath)
    node $ScriptPath
  } -ArgumentList $gatewayScript

  Start-Sleep -Milliseconds 700
  if ($gatewayJob.State -ne "Running") {
    Receive-Job $gatewayJob -ErrorAction SilentlyContinue
    throw "web_Agent image save gateway failed to start."
  }
}

try {
  if ($mcpAlreadyRunning) {
    Write-Host "MCP filesystem bridge is already running on http://127.0.0.1:3006/sse ." -ForegroundColor Yellow
    if ($gatewayJob) {
      Write-Host "Image save gateway was started in this window. Keep this window open, or press Ctrl+C to stop it." -ForegroundColor Yellow
      while ($gatewayJob.State -eq "Running") {
        Start-Sleep -Seconds 1
      }
      Receive-Job $gatewayJob -ErrorAction SilentlyContinue
    }
    return
  }

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
