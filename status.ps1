# status.ps1
# Show PM2 status and run health checks on both services.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

Write-Host "=== Alphamentals — STATUS ===" -ForegroundColor Cyan
Write-Host ""

# ─── PM2 process table ────────────────────────────────────────────────────────
pm2 list

Write-Host ""
Write-Host "─── Health checks ───────────────────────────────────────────" -ForegroundColor Cyan

function Invoke-HealthCheck {
    param([string]$Label, [string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $json = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
            $extra = if ($json.ok -ne $null) { " (ok=$($json.ok))" } else { "" }
            Write-Host "  [OK]  $Label$extra" -ForegroundColor Green
            return $json
        } else {
            Write-Host "  [FAIL] $Label — HTTP $($resp.StatusCode)" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "  [DOWN] $Label — $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

Invoke-HealthCheck "Node API  " "http://localhost:3001/health" | Out-Null

$bridgeHealth = Invoke-HealthCheck "MT5 Bridge" "http://127.0.0.1:8001/health"

if ($bridgeHealth -ne $null) {
    $status = Invoke-HealthCheck "MT5 Status" "http://127.0.0.1:8001/status"
    if ($status -ne $null -and $status.account_info -ne $null) {
        $acct = $status.account_info
        Write-Host "        Account: $($acct.name) | Balance: $($acct.balance) $($acct.currency)" -ForegroundColor Cyan
    } elseif ($status -ne $null -and $status.initialized -eq $false) {
        Write-Host "        MT5 not initialized — open MetaTrader 5 and connect an account." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "─── Quick logs (last 10 lines each) ────────────────────────" -ForegroundColor Cyan
Write-Host "  alphamentals-api:" -ForegroundColor White
pm2 logs alphamentals-api --lines 10 --nostream 2>&1 | Select-Object -Last 12
Write-Host "  mt5-bridge:" -ForegroundColor White
pm2 logs mt5-bridge --lines 10 --nostream 2>&1 | Select-Object -Last 12
