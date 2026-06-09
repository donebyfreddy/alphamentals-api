# start.ps1
# Build the Node API and start/restart both PM2 processes.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Alphamentals — START ===" -ForegroundColor Cyan
Write-Host ""

# ─── Build Node API ───────────────────────────────────────────────────────────
Write-Host "[1/4] Building Node.js API..." -ForegroundColor Yellow
npm run build:api
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: TypeScript build failed. Fix errors before starting." -ForegroundColor Red
    exit 1
}
Write-Host "  Build OK." -ForegroundColor Green

# ─── Start / restart PM2 apps ────────────────────────────────────────────────
Write-Host "[2/4] Starting PM2 apps..." -ForegroundColor Yellow

$pm2Status = pm2 list 2>&1
if ($pm2Status -match "alphamentals-api") {
    pm2 restart ecosystem.config.js --update-env
} else {
    pm2 start ecosystem.config.js --update-env
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: PM2 start/restart failed." -ForegroundColor Red
    exit 1
}

pm2 save
Write-Host "  PM2 apps running." -ForegroundColor Green

# ─── Health checks ────────────────────────────────────────────────────────────
Write-Host "[3/4] Waiting for services to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "[4/4] Health checks..." -ForegroundColor Yellow

function Invoke-HealthCheck {
    param([string]$Label, [string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        $body = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) {
            Write-Host "  [OK]  $Label — $Url" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  [FAIL] $Label — HTTP $($resp.StatusCode)" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "  [FAIL] $Label — $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

$apiOk     = Invoke-HealthCheck "Node API"   "http://localhost:3001/health"
$bridgeOk  = Invoke-HealthCheck "MT5 Bridge" "http://127.0.0.1:8001/health"

if ($bridgeOk) {
    Invoke-HealthCheck "MT5 Status" "http://127.0.0.1:8001/status" | Out-Null
}

if ($apiOk -and $bridgeOk) {
    Write-Host ""
    Write-Host "  Testing quotes via API..." -ForegroundColor Yellow
    Invoke-HealthCheck "Quotes (XAUUSD)" "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD" | Out-Null
}

Write-Host ""
pm2 list

Write-Host ""
if (-not $apiOk) {
    Write-Host "  WARNING: Node API did not respond. Check logs: pm2 logs alphamentals-api" -ForegroundColor Red
}
if (-not $bridgeOk) {
    Write-Host "  WARNING: MT5 Bridge did not respond. Make sure MetaTrader 5 is open." -ForegroundColor Yellow
    Write-Host "           Check logs: pm2 logs mt5-bridge" -ForegroundColor Yellow
}
if ($apiOk -and $bridgeOk) {
    Write-Host "=== All services healthy ===" -ForegroundColor Green
}
