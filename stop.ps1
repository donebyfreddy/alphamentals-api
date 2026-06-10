# stop.ps1
# Stop all PM2 processes and optionally delete them.

param(
    [switch]$Delete
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

Write-Host "=== Alphamentals STOP ===" -ForegroundColor Cyan
Write-Host ""

if ($Delete) {
    Write-Host "Deleting PM2 apps..." -ForegroundColor Yellow

    pm2 delete alphamentals-api 2>$null
    pm2 delete mt5-bridge 2>$null

    Write-Host "  Processes deleted." -ForegroundColor Green
}
else {
    Write-Host "Stopping PM2 apps..." -ForegroundColor Yellow

    pm2 stop alphamentals-api 2>$null
    pm2 stop mt5-bridge 2>$null

    Write-Host "  Processes stopped. Run .\start.ps1 to restart." -ForegroundColor Green
}

pm2 save --force
pm2 list

