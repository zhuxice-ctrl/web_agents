param(
  [switch] $Restart
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$gatewayScript = Join-Path $repoRoot "scripts/web-agent-image-save-gateway.mjs"
$filesystemServerScript = Join-Path $repoRoot "scripts/web-agent-filesystem-server.mjs"
$allowedDirectoriesFile = Join-Path $repoRoot "config/allowed-directories.local.txt"

Set-Location $repoRoot

function Initialize-AllowedDirectoriesFile {
  $configDir = Split-Path -Parent $allowedDirectoriesFile
  if (-not (Test-Path -LiteralPath $configDir)) {
    New-Item -ItemType Directory -Path $configDir | Out-Null
  }

  if (-not (Test-Path -LiteralPath $allowedDirectoriesFile)) {
    @(
      "# One writable directory per line. Blank lines and lines starting with # are ignored."
      "# Changes take effect immediately; no MCP bridge restart is required."
      $repoRoot
    ) | Set-Content -LiteralPath $allowedDirectoriesFile -Encoding UTF8
  }
}

function Get-AllowedDirectories {
  Initialize-AllowedDirectoriesFile

  $seen = New-Object "System.Collections.Generic.HashSet[string]" ([StringComparer]::OrdinalIgnoreCase)
  $directories = New-Object "System.Collections.Generic.List[string]"

  $repoPath = (Resolve-Path -LiteralPath $repoRoot).ProviderPath
  [void]$seen.Add($repoPath)
  [void]$directories.Add($repoPath)

  $lines = Get-Content -LiteralPath $allowedDirectoriesFile -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $expanded = [Environment]::ExpandEnvironmentVariables($trimmed)
    try {
      $resolved = (Resolve-Path -LiteralPath $expanded -ErrorAction Stop).ProviderPath
      $item = Get-Item -LiteralPath $resolved -ErrorAction Stop
      if (-not $item.PSIsContainer) {
        Write-Warning "Allowed path is not a directory and will be skipped: $resolved"
        continue
      }
      if ($seen.Add($resolved)) {
        [void]$directories.Add($resolved)
      }
    }
    catch {
      Write-Warning "Allowed directory does not exist and will be skipped: $expanded"
    }
  }

  return @($directories.ToArray())
}

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

function Stop-ListeningPort {
  param([int]$Port)
  $processIds = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne 0 })

  foreach ($processId in $processIds) {
    Write-Host "Stopping process $processId on port $Port ..." -ForegroundColor Yellow
    Stop-Process -Id $processId -Force -ErrorAction Stop
  }
}

$allowedDirectories = Get-AllowedDirectories

if ($Restart) {
  Stop-ListeningPort -Port 3006
  Stop-ListeningPort -Port 3017
  Start-Sleep -Milliseconds 800
}

$mcpAlreadyRunning = Test-PortListening -Port 3006

Write-Host "Starting web_Agent local image save gateway on http://127.0.0.1:3017 ..." -ForegroundColor Cyan
$gatewayHealth = Test-HttpHealth -Uri "http://127.0.0.1:3017/health"

if ($gatewayHealth -and $gatewayHealth.ok -and -not $gatewayHealth.features.saveToolResult) {
  Write-Host "Existing image save gateway is missing tool-result save support; restarting port 3017 ..." -ForegroundColor Yellow
  Stop-ListeningPort -Port 3017
  Start-Sleep -Milliseconds 800
  $gatewayHealth = $null
}

if ($mcpAlreadyRunning -and $gatewayHealth -and $gatewayHealth.ok) {
  Write-Host "MCP filesystem bridge is already running on http://127.0.0.1:3006/sse ." -ForegroundColor Yellow
  Write-Host "web_Agent image save gateway is already running on http://127.0.0.1:3017 ." -ForegroundColor Yellow
  Write-Host "Local trust mode is enabled: write/edit/create/move can target any local path." -ForegroundColor Yellow
  Write-Host "Write operations are audited at generated/audit/writes.jsonl." -ForegroundColor Yellow
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
    Write-Host "Local trust mode is enabled: write/edit/create/move can target any local path." -ForegroundColor Yellow
    Write-Host "Write operations are audited at generated/audit/writes.jsonl." -ForegroundColor Yellow
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
  Write-Host "Local trust mode enabled: write/edit/create/move can target any local path." -ForegroundColor Cyan
  Write-Host "Write operations are audited at generated/audit/writes.jsonl." -ForegroundColor Cyan
  Write-Host "Legacy allowed directories file entries (informational only):" -ForegroundColor Cyan
  foreach ($directory in $allowedDirectories) {
    Write-Host "  - $directory"
  }

  $mcpProxyArgs = @(
    "-y"
    "mcp-proxy@latest"
    "--port"
    "3006"
    "--host"
    "127.0.0.1"
    "--sseEndpoint"
    "/sse"
    "--streamEndpoint"
    "/mcp"
    "--shell"
    "--"
    "node"
    $filesystemServerScript
  )

  & npx.cmd @mcpProxyArgs
}
finally {
  if ($gatewayJob) {
    Stop-Job $gatewayJob -ErrorAction SilentlyContinue
    Receive-Job $gatewayJob -ErrorAction SilentlyContinue
    Remove-Job $gatewayJob -Force -ErrorAction SilentlyContinue
  }
}
