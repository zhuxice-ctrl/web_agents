$ErrorActionPreference = "Stop"

Write-Host "Example only." -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Start DevSpace Local on http://127.0.0.1:7676/mcp."
Write-Host "2. Expose it with an HTTPS tunnel or fixed domain."
Write-Host ""
Write-Host "Cloudflare Tunnel example:"
Write-Host "  cloudflared tunnel --protocol http2 --url http://127.0.0.1:7676 --no-autoupdate"
Write-Host ""
Write-Host "Use the printed https://.../mcp URL in ChatGPT."
