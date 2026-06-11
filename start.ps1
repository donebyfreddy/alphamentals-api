# start.ps1
# Build the Node API and start/restart both PM2 processes.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Alphamentals START ===" -ForegroundColor Cyan
Write-Host ""

function Test-PlaywrightInstall {
    try {
        $versionOutput = npx playwright --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [FAIL] Playwright not installed" -ForegroundColor Red
            return
        }

        Write-Host "  [OK] Playwright installed ($versionOutput)" -ForegroundColor Green

        $statusJson = node -e "const fs=require('fs'); (async()=>{ try { const p=await import('playwright'); const result={ chromium: fs.existsSync(p.chromium.executablePath()), firefox: fs.existsSync(p.firefox.executablePath()), webkit: fs.existsSync(p.webkit.executablePath()) }; console.log(JSON.stringify(result)); } catch { console.log(JSON.stringify({ chromium:false, firefox:false, webkit:false })); } })();" 2>$null
        $status = $statusJson | ConvertFrom-Json

        if ($status.chromium) {
            Write-Host "  [OK] Chromium installed" -ForegroundColor Green
        }
        else {
            Write-Host "  [FAIL] Chromium not installed" -ForegroundColor Red
        }

        if ($status.firefox) {
            Write-Host "  [OK] Firefox installed" -ForegroundColor Green
        }

        if ($status.webkit) {
            Write-Host "  [OK] WebKit installed" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  [FAIL] Playwright not installed" -ForegroundColor Red
    }
}

Test-PlaywrightInstall

function Test-PythonDependency {
    param(
        [string]$ModuleName,
        [string]$Label,
        [string]$InstallCommand
    )

    $pythonExe = if (Test-Path "mt5bridge\.venv\Scripts\python.exe") {
        "mt5bridge\.venv\Scripts\python.exe"
    }
    else {
        "py"
    }

    $pythonArgs = if ($pythonExe -eq "py") { @("-3.11", "-c", "import $ModuleName") } else { @("-c", "import $ModuleName") }

    try {
        & $pythonExe @pythonArgs 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] $Label installed" -ForegroundColor Green
        }
        else {
            Write-Host "  [FAIL] $Label missing. Run: $InstallCommand" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  [FAIL] $Label missing. Run: $InstallCommand" -ForegroundColor Red
    }
}

Test-PythonDependency -ModuleName "telethon" -Label "Telethon" -InstallCommand "py -3.11 -m pip install --upgrade telethon"
Test-PythonDependency -ModuleName "telegram" -Label "python-telegram-bot" -InstallCommand "py -3.11 -m pip install --upgrade python-telegram-bot"
Test-PythonDependency -ModuleName "playwright" -Label "Python Playwright" -InstallCommand "py -3.11 -m pip install --upgrade playwright"

function Get-DotEnvValue {
    param(
        [string]$Path,
        [string]$Name
    )

    if (-not (Test-Path $Path)) {
        return $null
    }

    $line = Get-Content $Path | Where-Object {
        $_ -match "^\s*$Name\s*="
    } | Select-Object -First 1

    if (-not $line) {
        return $null
    }

    $value = $line -replace "^\s*$Name\s*=\s*", ""
    $value = $value.Trim()

    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    if ($value.StartsWith("'") -and $value.EndsWith("'")) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    return $value
}

$mt5BridgeApiKey = Get-DotEnvValue ".env" "MT5_BRIDGE_API_KEY"

$authHeaders = @{}

if ($mt5BridgeApiKey) {
    $authHeaders["X-API-Key"] = $mt5BridgeApiKey
    $authHeaders["Authorization"] = "Bearer $mt5BridgeApiKey"
    Write-Host "  MT5_BRIDGE_API_KEY loaded from .env" -ForegroundColor Green
}
else {
    Write-Host "  WARNING: MT5_BRIDGE_API_KEY not found in .env" -ForegroundColor Yellow
    Write-Host "           Protected EA endpoints may return Unauthorized." -ForegroundColor Yellow
}

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
    param(
        [string]$Label,
        [string]$Url,
        [hashtable]$Headers = @{}
    )

    try {
        $resp = Invoke-WebRequest `
            -Uri $Url `
            -UseBasicParsing `
            -TimeoutSec 8 `
            -Headers $Headers `
            -ErrorAction Stop

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

$apiOk = Invoke-HealthCheck `
    "Node API    http://localhost:3001/health" `
    "http://localhost:3001/health"

# Bridge liveness — only checks FastAPI process, not MT5 terminal
$bridgeOk = Invoke-HealthCheck `
    "MT5 Bridge  http://127.0.0.1:8001/health" `
    "http://127.0.0.1:8001/health"

# Terminal health — checks whether MetaTrader 5 is running and reachable
$terminalOk = $false
if ($bridgeOk) {
    try {
        $tResp = Invoke-WebRequest `
            -Uri "http://127.0.0.1:8001/api/v1/terminal/health" `
            -UseBasicParsing `
            -TimeoutSec 10 `
            -ErrorAction Stop

        $tJson = $tResp.Content | ConvertFrom-Json

        if ($tJson.ok -eq $true) {
            Write-Host "  [OK]   MT5 Terminal http://127.0.0.1:8001/api/v1/terminal/health" -ForegroundColor Green
            $terminalOk = $true
        }
        else {
            Write-Host "  [WARN] MT5 Bridge is online, but MetaTrader 5 terminal is not reachable." -ForegroundColor Yellow
            Write-Host "         Code: $($tJson.code)  Message: $($tJson.message)" -ForegroundColor Yellow
            Write-Host "         Make sure MetaTrader 5 is open on this machine." -ForegroundColor Yellow
            if ($null -ne $tJson.details) {
                Write-Host "         Details: $($tJson.details | ConvertTo-Json -Depth 2 -Compress)" -ForegroundColor Yellow
            }
        }
    }
    catch {
        Write-Host "  [WARN] MT5 Terminal http://127.0.0.1:8001/api/v1/terminal/health - $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # Full diagnostics (informational — never fails the startup)
    try {
        $diagResp = Invoke-WebRequest `
            -Uri "http://127.0.0.1:8001/api/v1/diagnostics" `
            -UseBasicParsing `
            -TimeoutSec 8 `
            -ErrorAction Stop

        $diagJson = $diagResp.Content | ConvertFrom-Json
        $terminalPath = $diagJson.mt5.terminalPath
        $terminalExists = $diagJson.mt5.terminalPathExists

        if ($null -ne $terminalPath) {
            $pathStatus = if ($terminalExists -eq $true) { "[EXISTS]" } elseif ($terminalExists -eq $false) { "[NOT FOUND]" } else { "[not configured]" }
            Write-Host "         Terminal path: $terminalPath $pathStatus" -ForegroundColor Cyan
        }
    }
    catch {}
}

$eaTicksOk = $false
$quotePriceOk = $false

if ($apiOk) {
    Invoke-HealthCheck `
        "EA Status   http://localhost:3001/ea/status" `
        "http://localhost:3001/ea/status" `
        $authHeaders | Out-Null

    Invoke-HealthCheck `
        "Playwright  http://localhost:3001/api/system/playwright-status" `
        "http://localhost:3001/api/system/playwright-status" | Out-Null

    # Check /ea/ticks using MT5_BRIDGE_API_KEY
    try {
        $tickResp = Invoke-WebRequest `
            -Uri "http://localhost:3001/ea/ticks" `
            -UseBasicParsing `
            -TimeoutSec 8 `
            -Headers $authHeaders `
            -ErrorAction Stop

        $tickJson = $tickResp.Content | ConvertFrom-Json

        $tickCount = 0

        if ($null -ne $tickJson.tickCount) {
            $tickCount = [int]$tickJson.tickCount
        }
        elseif ($null -ne $tickJson.ticks) {
            $tickCount = ($tickJson.ticks.PSObject.Properties | Measure-Object).Count
        }

        if ($tickCount -gt 0) {
            Write-Host "  [OK]   EA Ticks    http://localhost:3001/ea/ticks ($tickCount symbol(s) received)" -ForegroundColor Green
            $eaTicksOk = $true
        }
        else {
            Write-Host "  [WARN] EA Ticks    http://localhost:3001/ea/ticks - no ticks yet (EA not connected?)" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "  [FAIL] EA Ticks    http://localhost:3001/ea/ticks - $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "         This endpoint may require MT5_BRIDGE_API_KEY from .env." -ForegroundColor Yellow
    }

    # Check quotes endpoint and warn if price is null.
    try {
        $qResp = Invoke-WebRequest `
            -Uri "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD" `
            -UseBasicParsing `
            -TimeoutSec 8 `
            -Headers $authHeaders `
            -ErrorAction Stop

        $qJson = $qResp.Content | ConvertFrom-Json
        $xauPrice = $qJson.data.XAUUSD.price

        if ($null -ne $xauPrice) {
            Write-Host "  [OK]   Quotes      http://localhost:3001/api/market-data/quotes?symbols=XAUUSD (XAUUSD=$xauPrice)" -ForegroundColor Green
            $quotePriceOk = $true
        }
        else {
            Write-Host "  [WARN] Quotes      XAUUSD price is null - API is online but no EA tick received yet." -ForegroundColor Yellow
            Write-Host "         Check MT5 Expert Advisors log and run:" -ForegroundColor Yellow
            Write-Host "         Invoke-WebRequest http://localhost:3001/ea/ticks -Headers @{ 'X-API-Key' = 'YOUR_KEY' }" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "  [FAIL] Quotes      http://localhost:3001/api/market-data/quotes?symbols=XAUUSD - $($_.Exception.Message)" -ForegroundColor Red
    }
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
    Write-Host "           Check logs: pm2 logs mt5-bridge" -ForegroundColor Yellow
    Write-Host "           Verify venv: dir mt5bridge\.venv\Scripts\python.exe" -ForegroundColor Yellow
}

if ($bridgeOk -and -not $terminalOk) {
    Write-Host "  WARNING: MT5 Bridge is online, but MetaTrader 5 terminal is not reachable." -ForegroundColor Yellow
    Write-Host "           Open MetaTrader 5 on this machine, or check MT5_TERMINAL_PATH in .env." -ForegroundColor Yellow
    Write-Host "           Diagnostics: Invoke-WebRequest http://127.0.0.1:8001/api/v1/diagnostics | ConvertFrom-Json" -ForegroundColor Cyan
}

if ($apiOk -and -not $eaTicksOk) {
    Write-Host "  NOTE:    No EA ticks yet. Once MT5 EA is running you can verify with:" -ForegroundColor Cyan

    if ($mt5BridgeApiKey) {
        Write-Host "             Invoke-WebRequest http://localhost:3001/ea/ticks -Headers @{ 'X-API-Key' = '$mt5BridgeApiKey' } | ConvertFrom-Json" -ForegroundColor Cyan
    }
    else {
        Write-Host "             Invoke-WebRequest http://localhost:3001/ea/ticks -Headers @{ 'X-API-Key' = 'YOUR_MT5_BRIDGE_API_KEY' } | ConvertFrom-Json" -ForegroundColor Cyan
    }

    Write-Host "           Make sure http://127.0.0.1:3001 is allowed in MT5 Options -> Expert Advisors." -ForegroundColor Cyan
}

if ($apiOk -and $bridgeOk -and $terminalOk -and $eaTicksOk -and $quotePriceOk) {
    Write-Host "=== All services healthy and receiving live prices ===" -ForegroundColor Green
}
elseif ($apiOk -and $bridgeOk -and $terminalOk) {
    Write-Host "=== Services started - MT5 terminal connected, waiting for EA ===" -ForegroundColor Yellow
}
elseif ($apiOk -and $bridgeOk) {
    Write-Host "=== Bridge online - MetaTrader 5 terminal not detected ===" -ForegroundColor Yellow
}
else {
    Write-Host "=== Startup completed with warnings ===" -ForegroundColor Yellow
}
