$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $repoRoot

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
