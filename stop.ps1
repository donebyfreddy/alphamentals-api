# Stop and optionally delete PM2 processes.
# Usage:
#   .\stop.ps1           -- stop both services (can be restarted with .\start.ps1)
#   .\stop.ps1 -Delete   -- delete both services from PM2

param([switch]$Delete)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

Write-Host "=== Alphamentals STOP ===" -ForegroundColor Cyan
Write-Host ""

if ($Delete) {
    Write-Host "Deleting PM2 apps..." -ForegroundColor Yellow

    try {
        pm2 delete alphamentals-api 2>$null
    }
    catch {}

    try {
        pm2 delete mt5-bridge 2>$null
    }
    catch {}

    Write-Host "  Done. Run .\start.ps1 to start again." -ForegroundColor Green
}
else {
    Write-Host "Stopping PM2 apps..." -ForegroundColor Yellow

    try {
        pm2 stop alphamentals-api 2>$null
    }
    catch {}

    try {
        pm2 stop mt5-bridge 2>$null
    }
    catch {}

    Write-Host "  Stopped. Run .\start.ps1 to restart." -ForegroundColor Green
}

pm2 save --force
pm2 list
