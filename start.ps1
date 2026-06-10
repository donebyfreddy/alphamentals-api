# Build the Node API and start/restart both PM2 processes.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Alphamentals START ===" -ForegroundColor Cyan
Write-Host ""

# [1/3] Build Node API
Write-Host "[1/3] Building Node.js API..." -ForegroundColor Yellow

npm run build:api

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: TypeScript build failed. Fix errors before starting." -ForegroundColor Red
    exit 1
}

Write-Host "  Build OK." -ForegroundColor Green

# [2/3] PM2 - stop, delete, then start both services fresh
Write-Host "[2/3] Starting PM2 apps..." -ForegroundColor Yellow

try {
    pm2 stop alphamentals-api 2>$null
}
catch {}

try {
    pm2 stop mt5-bridge 2>$null
}
catch {}

try {
    pm2 delete alphamentals-api 2>$null
}
catch {}

try {
    pm2 delete mt5-bridge 2>$null
}
catch {}

pm2 start ecosystem.config.js --update-env

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: PM2 start failed." -ForegroundColor Red
    exit 1
}

pm2 save --force

Write-Host "  PM2 apps started." -ForegroundColor Green

# Health check helper
function Invoke-HealthCheck {
    param([string]$Label, [string]$Url)

    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop

        if ($resp.StatusCode -eq 200) {
            Write-Host "  [OK]   $Label" -ForegroundColor Green
            return $true
        }
        else {
            Write-Host "  [FAIL] $Label - HTTP $($resp.StatusCode)" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "  [FAIL] $Label - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# [3/3] Health checks
Write-Host "[3/3] Waiting for services to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

$apiOk    = Invoke-HealthCheck "Node API    http://localhost:3001/health"       "http://localhost:3001/health"
$bridgeOk = Invoke-HealthCheck "MT5 Bridge  http://127.0.0.1:8001/health"      "http://127.0.0.1:8001/health"

if ($bridgeOk) {
    Invoke-HealthCheck "MT5 Status  http://127.0.0.1:8001/status" "http://127.0.0.1:8001/status" | Out-Null
}

if ($apiOk) {
    Invoke-HealthCheck "EA Status   http://localhost:3001/ea/status"                              "http://localhost:3001/ea/status" | Out-Null
    Invoke-HealthCheck "Quotes      http://localhost:3001/api/market-data/quotes?symbols=XAUUSD"  "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD" | Out-Null
}

Write-Host ""
pm2 list

Write-Host ""

if (-not $apiOk) {
    Write-Host "  WARNING: Node API did not respond." -ForegroundColor Red
    Write-Host "           Check logs: pm2 logs alphamentals-api" -ForegroundColor Red
}

if (-not $bridgeOk) {
    Write-Host "  WARNING: MT5 Bridge did not respond." -ForegroundColor Yellow
    Write-Host "           Ensure MetaTrader 5 is open and logged in." -ForegroundColor Yellow
    Write-Host "           Check logs: pm2 logs mt5-bridge" -ForegroundColor Yellow
    Write-Host "           Verify venv: dir mt5bridge\.venv\Scripts\python.exe" -ForegroundColor Yellow
}

if ($apiOk -and $bridgeOk) {
    Write-Host "=== All services healthy ===" -ForegroundColor Green
}
else {
    Write-Host "=== Startup completed with warnings ===" -ForegroundColor Yellow
}
