# Push job board updates to GitHub (uses saved login — no token in this file)
# Usage:
#   .\push.ps1
#   .\push.ps1 "Added 10 more jobs"

param(
    [string]$Message = "Update job board"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Checking for changes..." -ForegroundColor Cyan
$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit. Working tree is clean." -ForegroundColor Yellow
    exit 0
}

git add -A
git commit -m $Message
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "Done. Site updates in 1-2 min at:" -ForegroundColor Green
Write-Host "https://the-diogenes.github.io/get-a-job/" -ForegroundColor Green
