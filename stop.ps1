# Stop and optionally delete PM2 processes.
# Usage:
#   .\stop.ps1           — stop alphamentals-api (can be restarted)
#   .\stop.ps1 -Delete   — delete alphamentals-api from PM2 and clean up mt5-bridge if present

param([switch]$Delete)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

Write-Host "=== Alphamentals STOP ===" -ForegroundColor Cyan
Write-Host ""

# Always remove stale mt5-bridge from PM2 if it was left over from a previous setup
try { pm2 delete mt5-bridge 2>$null } catch {}

if ($Delete) {
    Write-Host "Deleting alphamentals-api from PM2..." -ForegroundColor Yellow
    pm2 delete alphamentals-api 2>$null
    Write-Host "  Done. Run .\start.ps1 to start again." -ForegroundColor Green
}
else {
    Write-Host "Stopping alphamentals-api..." -ForegroundColor Yellow
    pm2 stop alphamentals-api 2>$null
    Write-Host "  Stopped. Run .\start.ps1 to restart." -ForegroundColor Green
}

pm2 save --force
pm2 list
