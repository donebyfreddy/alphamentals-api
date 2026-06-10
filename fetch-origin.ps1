# refresh.ps1
# WARNING: Deletes ALL local changes.

$ErrorActionPreference = "Stop"

Write-Host "=== Refreshing repository from origin ===" -ForegroundColor Cyan

$branch = git rev-parse --abbrev-ref HEAD

if (-not $branch) {
    Write-Host "ERROR: Could not determine current branch." -ForegroundColor Red
    exit 1
}

Write-Host "Current branch: $branch" -ForegroundColor Yellow

git fetch origin

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git fetch failed." -ForegroundColor Red
    exit 1
}

git reset --hard "origin/$branch"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git reset failed." -ForegroundColor Red
    exit 1
}

git clean -fd

Write-Host ""
Write-Host "Repository synchronized with origin/$branch" -ForegroundColor Green
Write-Host ""

git status