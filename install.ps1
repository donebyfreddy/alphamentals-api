# Run once from the project root on the Windows VPS.
# Requires: Run as Administrator, Node.js 20+, Python 3.11.

param(
    [switch]$SkipFirewall,
    [switch]$SkipPm2Startup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Alphamentals - INSTALL ===" -ForegroundColor Cyan
Write-Host ""

# [1/7] Node.js
Write-Host "[1/7] Checking Node.js..." -ForegroundColor Yellow

try {
    $nodeVersion = node --version 2>&1
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ERROR: Node.js not found. Install Node.js LTS first:" -ForegroundColor Red
    Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Red
    exit 1
}

# [2/7] Python 3.11 venv
Write-Host "[2/7] Checking Python 3.11..." -ForegroundColor Yellow

$py311 = $null

try {
    $ver = py -3.11 --version 2>&1
    if ($ver -match "Python 3\.11") {
        $py311 = "py -3.11"
        Write-Host "  Found: $ver (via py -3.11)" -ForegroundColor Green
    }
}
catch {}

if (-not $py311) {
    foreach ($candidate in @("python3.11", "python")) {
        try {
            $ver = & $candidate --version 2>&1
            if ($ver -match "Python 3\.11") {
                $py311 = $candidate
                Write-Host "  Found: $ver (via $candidate)" -ForegroundColor Green
                break
            }
        }
        catch {}
    }
}

if (-not $py311) {
    Write-Host "  ERROR: Python 3.11 not found." -ForegroundColor Red
    Write-Host "         The MT5 Bridge requires Python 3.11 (MetaTrader5 package)." -ForegroundColor Red
    Write-Host "         Install it with:" -ForegroundColor Red
    Write-Host "           winget install -e --id Python.Python.3.11" -ForegroundColor Red
    exit 1
}

Write-Host "[2/7] Creating Python 3.11 venv at mt5bridge\.venv..." -ForegroundColor Yellow

if (Test-Path "mt5bridge\.venv") {
    Write-Host "  venv already exists, skipping creation." -ForegroundColor Green
}
else {
    if ($py311 -eq "py -3.11") {
        py -3.11 -m venv mt5bridge\.venv
    }
    else {
        & $py311 -m venv mt5bridge\.venv
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Failed to create venv." -ForegroundColor Red
        exit 1
    }

    Write-Host "  venv created." -ForegroundColor Green
}

Write-Host "[2/7] Installing Python requirements..." -ForegroundColor Yellow

if (-not (Test-Path "mt5bridge\requirements.txt")) {
    Write-Host "  ERROR: mt5bridge\requirements.txt not found." -ForegroundColor Red
    exit 1
}

& "mt5bridge\.venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: pip upgrade failed." -ForegroundColor Red
    exit 1
}

& "mt5bridge\.venv\Scripts\python.exe" -m pip install -r mt5bridge\requirements.txt --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: pip install failed." -ForegroundColor Red
    exit 1
}

Write-Host "  Python requirements installed." -ForegroundColor Green

# [3/7] npm install
Write-Host "[3/7] Installing Node.js dependencies..." -ForegroundColor Yellow

npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: npm install failed." -ForegroundColor Red
    exit 1
}

Write-Host "  npm install OK." -ForegroundColor Green

# [4/7] PM2
Write-Host "[4/7] Installing PM2..." -ForegroundColor Yellow

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

# [5/7] Build Node API
Write-Host "[5/7] Building Node.js API..." -ForegroundColor Yellow

npm run build:api

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: TypeScript build failed." -ForegroundColor Red
    exit 1
}

Write-Host "  Build OK." -ForegroundColor Green

# [6/7] .env files
Write-Host "[6/7] Checking .env files..." -ForegroundColor Yellow

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

if (-not (Test-Path "mt5bridge\.env")) {
    if (Test-Path "mt5bridge\.env.example") {
        Copy-Item "mt5bridge\.env.example" "mt5bridge\.env"
        Write-Host "  mt5bridge\.env created from .env.example." -ForegroundColor Yellow
        Write-Host "  IMPORTANT: Set MT5_API_KEY in mt5bridge\.env" -ForegroundColor Red
    }
    else {
        Write-Host "  mt5bridge\.env.example not found, skipping." -ForegroundColor Yellow
    }
}
else {
    Write-Host "  mt5bridge\.env already exists." -ForegroundColor Green
}

# [7/7] Windows Firewall - port 3001 only (port 8001 stays loopback-only)
if (-not $SkipFirewall) {
    Write-Host "[7/7] Opening Windows Firewall port 3001..." -ForegroundColor Yellow

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

    Write-Host "  Port 8001 is NOT opened - bridge stays on 127.0.0.1 only." -ForegroundColor Cyan
}
else {
    Write-Host "[7/7] Firewall step skipped." -ForegroundColor Yellow
}

# PM2 Windows startup
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
Write-Host "  1. Edit .env and set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, etc."
Write-Host "  2. Edit mt5bridge\.env and set MT5_API_KEY matching MT5_BRIDGE_API_KEY in .env"
Write-Host "  3. Open MetaTrader 5 and log into your account"
Write-Host "  4. Run: .\start.ps1"
Write-Host "  5. In MT5: Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL:"
Write-Host "       http://127.0.0.1:3001"
