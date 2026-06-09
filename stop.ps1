# stop.ps1
# Stop all PM2 processes and optionally delete them.

param(
    [switch]$Delete  # pass -Delete to remove from PM2 list entirely
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

Write-Host "=== Alphamentals — STOP ===" -ForegroundColor Cyan
Write-Host ""

if ($Delete) {
    Write-Host "Deleting PM2 apps..." -ForegroundColor Yellow
    pm2 delete alphamentals-api 2>&1 | Out-Null
    pm2 delete mt5-bridge 2>&1 | Out-Null
    Write-Host "  Processes deleted." -ForegroundColor Green
} else {
    Write-Host "Stopping PM2 apps..." -ForegroundColor Yellow
    pm2 stop alphamentals-api 2>&1 | Out-Null
    pm2 stop mt5-bridge 2>&1 | Out-Null
    Write-Host "  Processes stopped (run .\start.ps1 to restart)." -ForegroundColor Green
}

pm2 save
pm2 list
