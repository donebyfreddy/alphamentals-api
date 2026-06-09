```powershell
# install_bridge.ps1
# Run once from the alphamentals-api directory.
# Requires: Run as Administrator + Node.js 20+

Write-Host "=== Alphamentals API - INSTALL ===" -ForegroundColor Cyan

Write-Host "`n[1/7] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ERROR: Node.js not found. Install Node.js LTS and re-run." -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/7] Installing PM2 globally..." -ForegroundColor Yellow
npm install -g pm2
if ($LASTEXITCODE -ne 0) { exit 1 }

npm install -g pm2-windows-startup
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "`n[3/7] Installing project dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: npm install failed." -ForegroundColor Red
    exit 1
}

Write-Host "`n[4/7] Checking .env file..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  .env created from .env.example." -ForegroundColor Yellow
        Write-Host "  Edit .env before running start_bridge.ps1." -ForegroundColor Red
    }
    else {
        Write-Host "  WARNING: .env.example not found. Create .env manually." -ForegroundColor Red
    }
}
else {
    Write-Host "  .env already exists." -ForegroundColor Green
}

Write-Host "`n[5/7] Opening Windows Firewall port 3001..." -ForegroundColor Yellow
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

    Write-Host "  Firewall rule created." -ForegroundColor Green
}

Write-Host "`n[6/7] Registering PM2 Windows startup..." -ForegroundColor Yellow
pm2-startup install

Write-Host "`n[7/7] Install complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Fix the Express '*' route crash."
Write-Host "  2. Check .env values."
Write-Host "  3. Run: .\start_bridge.ps1"
```
