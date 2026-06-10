# Build the Node API and start the alphamentals-api PM2 process.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Alphamentals START ===" -ForegroundColor Cyan
Write-Host ""

# [1/3] Build
Write-Host "[1/3] Building Node.js API..." -ForegroundColor Yellow

npm run build:api

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: TypeScript build failed. Fix errors before starting." -ForegroundColor Red
    exit 1
}

Write-Host "  Build OK." -ForegroundColor Green

# [2/3] PM2 - clean up any stale processes then start fresh
Write-Host "[2/3] Starting PM2..." -ForegroundColor Yellow

# Remove old mt5-bridge from PM2 if it was left over from a previous setup
try {
    pm2 delete mt5-bridge 2>$null
}
catch {}

try {
    pm2 stop alphamentals-api 2>$null
}
catch {}

try {
    pm2 delete alphamentals-api 2>$null
}
catch {}

pm2 start ecosystem.config.js --update-env

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: PM2 start failed." -ForegroundColor Red
    exit 1
}

pm2 save --force

Write-Host "  alphamentals-api started." -ForegroundColor Green

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
Write-Host "[3/3] Waiting for API to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$apiOk = Invoke-HealthCheck "Health    http://localhost:3001/health" "http://localhost:3001/health"

if ($apiOk) {
    Invoke-HealthCheck "EA status  http://localhost:3001/ea/status" "http://localhost:3001/ea/status" | Out-Null
    Invoke-HealthCheck "Quotes     http://localhost:3001/api/market-data/quotes?symbols=XAUUSD" "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD" | Out-Null
}

Write-Host ""
pm2 list

Write-Host ""

if ($apiOk) {
    Write-Host "=== alphamentals-api online ===" -ForegroundColor Green
    Write-Host "  Open MetaTrader 5, attach TradeBridgeEA to a chart, and enable Algo Trading." -ForegroundColor Cyan
}
else {
    Write-Host "  WARNING: Node API did not respond. Check logs: pm2 logs alphamentals-api" -ForegroundColor Red
    Write-Host "=== Startup completed with warnings ===" -ForegroundColor Yellow
}
