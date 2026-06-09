```powershell
# start_bridge.ps1
# Run whenever you want to build/restart the API.

Write-Host "=== Alphamentals API - START ===" -ForegroundColor Cyan

Write-Host "`n[1/6] Building backend..." -ForegroundColor Yellow
npm run build:api

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: TypeScript build failed. PM2 will not start." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "dist-api\backend\server\index.js")) {
    Write-Host "  ERROR: dist-api\backend\server\index.js not found." -ForegroundColor Red
    exit 1
}

Write-Host "  Build OK." -ForegroundColor Green

Write-Host "`n[2/6] Removing old PM2 process..." -ForegroundColor Yellow
try { pm2 stop alphamentals-api 2>$null } catch {}
try { pm2 delete alphamentals-api 2>$null } catch {}

Write-Host "`n[3/6] Starting API with PM2..." -ForegroundColor Yellow
pm2 start ecosystem.config.js --update-env

Start-Sleep -Seconds 2

Write-Host "`n[4/6] PM2 status..." -ForegroundColor Yellow
pm2 list

Write-Host "`n[5/6] Checking if process is online..." -ForegroundColor Yellow
$statusJson = pm2 jlist | ConvertFrom-Json
$app = $statusJson | Where-Object { $_.name -eq "alphamentals-api" } | Select-Object -First 1

if (-not $app) {
    Write-Host "  ERROR: alphamentals-api was not found in PM2." -ForegroundColor Red
    exit 1
}

if ($app.pm2_env.status -ne "online") {
    Write-Host "  ERROR: alphamentals-api is not online. Current status: $($app.pm2_env.status)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Recent logs:" -ForegroundColor Yellow
    pm2 logs alphamentals-api --lines 80 --nostream
    exit 1
}

pm2 save --force

Write-Host "`n[6/6] Health checks..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/health" -TimeoutSec 5
    Write-Host "  /health OK  ok=$($r.ok)" -ForegroundColor Green
}
catch {
    Write-Host "  /health FAILED: $($_.Exception.Message)" -ForegroundColor Red
    pm2 logs alphamentals-api --lines 80 --nostream
    exit 1
}

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/api/mt5/status" -TimeoutSec 5
    Write-Host "  /api/mt5/status OK" -ForegroundColor Green
}
catch {
    Write-Host "  /api/mt5/status FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== API is online ===" -ForegroundColor Green
Write-Host "Logs: pm2 logs alphamentals-api"
Write-Host "Restart: pm2 restart alphamentals-api --update-env"
```
