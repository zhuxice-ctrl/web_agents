param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Path
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$allowedDirectoriesFile = Join-Path $repoRoot "config/allowed-directories.local.txt"
$configDir = Split-Path -Parent $allowedDirectoriesFile

if (-not (Test-Path -LiteralPath $configDir)) {
  New-Item -ItemType Directory -Path $configDir | Out-Null
}

if (-not (Test-Path -LiteralPath $allowedDirectoriesFile)) {
  @(
    "# One allowed directory per line. Blank lines and lines starting with # are ignored."
    "# Changes take effect after restarting the MCP filesystem bridge."
    $repoRoot
  ) | Set-Content -LiteralPath $allowedDirectoriesFile -Encoding UTF8
}

$resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).ProviderPath
$item = Get-Item -LiteralPath $resolved -ErrorAction Stop
if (-not $item.PSIsContainer) {
  throw "Allowed path must be a directory: $resolved"
}

$currentLines = @(Get-Content -LiteralPath $allowedDirectoriesFile -ErrorAction SilentlyContinue)
$currentDirectories = $currentLines |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith("#") } |
  ForEach-Object {
    try {
      (Resolve-Path -LiteralPath ([Environment]::ExpandEnvironmentVariables($_)) -ErrorAction Stop).ProviderPath
    }
    catch {
      $_
    }
  }

$alreadyExists = $false
foreach ($directory in $currentDirectories) {
  if ([string]::Equals($directory, $resolved, [System.StringComparison]::OrdinalIgnoreCase)) {
    $alreadyExists = $true
    break
  }
}

if ($alreadyExists) {
  Write-Host "Allowed directory already exists: $resolved" -ForegroundColor Yellow
}
else {
  Add-Content -LiteralPath $allowedDirectoriesFile -Value $resolved -Encoding UTF8
  Write-Host "Added allowed directory: $resolved" -ForegroundColor Green
}

Write-Host "Restart the MCP filesystem bridge for the new whitelist to take effect." -ForegroundColor Yellow
