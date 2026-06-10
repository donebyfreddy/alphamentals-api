# Build the Node API and start/restart the PM2 process.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Alphamentals START ===" -ForegroundColor Cyan
Write-Host ""

# Build Node API
Write-Host "[1/3] Building Node.js API..." -ForegroundColor Yellow

npm run build:api

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: TypeScript build failed. Fix errors before starting." -ForegroundColor Red
    exit 1
}

Write-Host "  Build OK." -ForegroundColor Green

# Start / restart PM2 app
Write-Host "[2/3] Starting PM2..." -ForegroundColor Yellow

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

Write-Host "  PM2 started." -ForegroundColor Green

# Health check helper
function Invoke-HealthCheck {
    param(
        [string]$Label,
        [string]$Url
    )

    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop

        if ($resp.StatusCode -eq 200) {
            Write-Host "  [OK] $Label - $Url" -ForegroundColor Green
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

# Health checks
Write-Host "[3/3] Waiting for service to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$apiOk = Invoke-HealthCheck "Node API" "http://localhost:3001/health"

if ($apiOk) {
    Invoke-HealthCheck "EA Status" "http://localhost:3001/ea/status" | Out-Null
    Invoke-HealthCheck "Quotes XAUUSD" "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD" | Out-Null
}

Write-Host ""
pm2 list

Write-Host ""

if (-not $apiOk) {
    Write-Host "  WARNING: Node API did not respond. Check logs: pm2 logs alphamentals-api" -ForegroundColor Red
    Write-Host "=== Startup completed with warnings ===" -ForegroundColor Yellow
}
else {
    Write-Host "  NOTE: Open MetaTrader 5 and attach the EA to a chart to start receiving data." -ForegroundColor Cyan
    Write-Host "=== alphamentals-api online ===" -ForegroundColor Green
}
