# Run once from the project root on the Windows VPS.
# Requires: Run as Administrator, Node.js 20+.

param(
    [switch]$SkipFirewall,
    [switch]$SkipPm2Startup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Alphamentals — INSTALL ===" -ForegroundColor Cyan
Write-Host ""

# [1/5] Node.js
Write-Host "[1/5] Checking Node.js..." -ForegroundColor Yellow

try {
    $nodeVersion = node --version 2>&1
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ERROR: Node.js not found. Install Node.js LTS first:" -ForegroundColor Red
    Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Red
    exit 1
}

# [2/5] npm install
Write-Host "[2/5] Installing Node.js dependencies..." -ForegroundColor Yellow

npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: npm install failed." -ForegroundColor Red
    exit 1
}

Write-Host "  npm install OK." -ForegroundColor Green

# [3/5] PM2
Write-Host "[3/5] Installing PM2..." -ForegroundColor Yellow

npm install -g pm2

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: pm2 install failed." -ForegroundColor Red
    exit 1
}

npm install -g pm2-windows-startup

if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: pm2-windows-startup install failed, continuing." -ForegroundColor Yellow
}

Write-Host "  PM2 installed." -ForegroundColor Green

# [4/5] .env file
Write-Host "[4/5] Checking .env file..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  .env created from .env.example." -ForegroundColor Yellow
        Write-Host "  IMPORTANT: Edit .env before running start.ps1" -ForegroundColor Red
        Write-Host "    notepad .env" -ForegroundColor Red
    }
    else {
        Write-Host "  WARNING: .env.example not found." -ForegroundColor Yellow
    }
}
else {
    Write-Host "  .env already exists." -ForegroundColor Green
}

# [5/5] Windows Firewall — port 3001
if (-not $SkipFirewall) {
    Write-Host "[5/5] Opening Windows Firewall port 3001..." -ForegroundColor Yellow

    $ruleName = "Alphamentals API port 3001"
    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

    if ($existingRule) {
        Write-Host "  Firewall rule already exists." -ForegroundColor Green
    }
    else {
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort 3001 `
            -Action Allow | Out-Null

        Write-Host "  Firewall rule created for port 3001." -ForegroundColor Green
    }
}
else {
    Write-Host "[5/5] Firewall step skipped." -ForegroundColor Yellow
}

# PM2 Windows startup (optional)
if (-not $SkipPm2Startup) {
    Write-Host "Registering PM2 Windows startup..." -ForegroundColor Yellow
    try {
        pm2-startup install
    }
    catch {
        Write-Host "  WARNING: pm2-startup install failed." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== Install complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Edit .env — set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CORS_ORIGINS, etc."
Write-Host "  2. Run: .\start.ps1"
Write-Host "  3. Open MetaTrader 5, attach TradeBridgeEA to a chart, and enable Algo Trading."
Write-Host "  4. In MT5: Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL:"
Write-Host "       http://127.0.0.1:3001"
