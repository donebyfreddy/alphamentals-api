# setup_bridge.ps1
# Run from the alphamentals-api directory on the Windows VPS.
# Requires: elevated PowerShell (Run as Administrator) + Node.js 20+

Write-Host "=== Alphamentals API - Windows VPS Setup ===" -ForegroundColor Cyan

# 0. Check Node.js
Write-Host "`n[0/9] Checking Node.js..." -ForegroundColor Yellow

try {
    $nodeVersion = node --version 2>&1
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ERROR: Node.js not found. Install it from https://nodejs.org (LTS) and re-run." -ForegroundColor Red
    exit 1
}

# 1. Install PM2 globally
Write-Host "`n[1/9] Installing PM2 globally..." -ForegroundColor Yellow

npm install -g pm2
npm install -g pm2-windows-startup

# 2. Stop and remove any old PM2 processes
Write-Host "`n[2/9] Removing old PM2 processes..." -ForegroundColor Yellow

foreach ($name in @("alphamentals-mt5-bridge", "alphamentals-api")) {
    try {
        pm2 stop $name 2>$null
    }
    catch {}

    try {
        pm2 delete $name 2>$null
    }
    catch {}
}

try {
    pm2 save --force 2>$null
}
catch {}

# 3. Install Node dependencies
Write-Host "`n[3/9] Installing dependencies..." -ForegroundColor Yellow

npm install

# 4. Build the backend
Write-Host "`n[4/9] Building backend (dist-api/backend/server/index.js)..." -ForegroundColor Yellow

npm run build:api

if (-not (Test-Path "dist-api\backend\server\index.js")) {
    Write-Host "  ERROR: Build output not found. Check TypeScript errors above." -ForegroundColor Red
    exit 1
}

Write-Host "  Build output OK." -ForegroundColor Green

# 5. Create .env if missing
Write-Host "`n[5/9] Checking .env file..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"

    Write-Host ""
    Write-Host "  .env created from .env.example." -ForegroundColor Red
    Write-Host "  Edit it now - minimum required values:" -ForegroundColor Red
    Write-Host ""
    Write-Host "    MT5_BRIDGE_URL=http://127.0.0.1:8001" -ForegroundColor White
    Write-Host "    MT5_BRIDGE_API_KEY=your-secret-key" -ForegroundColor White
    Write-Host ""

    Read-Host "  Press Enter after editing .env to continue"
}
else {
    Write-Host "  .env already exists." -ForegroundColor Green
}

# 6. Windows Firewall - open port 3001
Write-Host "`n[6/9] Opening Windows Firewall port 3001..." -ForegroundColor Yellow

$ruleName = "Alphamentals API port 3001"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($existingRule) {
    Write-Host "  Firewall rule already exists." -ForegroundColor Green
}
else {
    try {
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort 3001 `
            -Action Allow | Out-Null

        Write-Host "  Firewall rule created." -ForegroundColor Green
    }
    catch {
        Write-Host "  WARNING: Could not create firewall rule. Run this script as Administrator." -ForegroundColor Red
    }
}

# 7. Register PM2 Windows startup service
Write-Host "`n[7/9] Registering PM2 Windows startup service..." -ForegroundColor Yellow

try {
    pm2-startup install 2>$null
}
catch {}

# 8. Start with PM2
Write-Host "`n[8/9] Starting alphamentals-api with PM2..." -ForegroundColor Yellow

pm2 start ecosystem.config.js --update-env
pm2 save --force

Write-Host ""
pm2 list

# 9. Health checks
Write-Host "`n[9/9] Running health checks (waiting 3 seconds for server to boot)..." -ForegroundColor Yellow

Start-Sleep -Seconds 3

Write-Host "`n  -- /health --" -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/health" -TimeoutSec 5
    Write-Host "  OK  ok=$($r.ok)  service=$($r.service)  port=$($r.port)" -ForegroundColor Green
}
catch {
    Write-Host "  FAIL  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Check logs: pm2 logs alphamentals-api" -ForegroundColor Red
}

Write-Host "`n  -- /api/mt5/status --" -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/api/mt5/status" -TimeoutSec 5
    Write-Host "  OK  ok=$($r.ok)  status=$($r.data.status)" -ForegroundColor Green
}
catch {
    Write-Host "  FAIL  $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n  -- /api/market-data/quotes?symbols=XAUUSD --" -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD" -TimeoutSec 5
    Write-Host "  OK  ok=$($r.ok)" -ForegroundColor Green
}
catch {
    Write-Host "  FAIL  $($_.Exception.Message)" -ForegroundColor Red
}

# Summary
Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Manage the server:" -ForegroundColor Yellow
Write-Host "  pm2 status"
Write-Host "  pm2 logs alphamentals-api"
Write-Host "  pm2 restart alphamentals-api --update-env"
Write-Host "  pm2 stop alphamentals-api"
Write-Host "  pm2 monit"

Write-Host ""
Write-Host "Local tests:" -ForegroundColor Yellow
Write-Host '  curl.exe http://localhost:3001/health'
Write-Host '  curl.exe "http://localhost:3001/api/health"'
Write-Host '  curl.exe "http://localhost:3001/api/mt5/status"'
Write-Host '  curl.exe "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD,EURUSD,GBPUSD"'
Write-Host '  curl.exe "http://localhost:3001/api/market-data/candles?symbol=XAUUSD&timeframe=M15&limit=100"'

Write-Host ""
Write-Host "External tests (run from another machine):" -ForegroundColor Yellow
Write-Host '  curl.exe http://217.71.203.77:3001/health'
Write-Host '  curl.exe "http://217.71.203.77:3001/api/market-data/quotes?symbols=XAUUSD"'
```
