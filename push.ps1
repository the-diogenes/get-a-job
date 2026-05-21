# Push job board updates to GitHub (uses saved login — no token in this file)
# Usage:
#   .\push.ps1
#   .\push.ps1 "Added 10 more jobs"

param(
    [string]$Message = "Update job board"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Git identity for this repo only (no global config)
$env:GIT_AUTHOR_NAME = "the-diogenes"
$env:GIT_AUTHOR_EMAIL = "the-diogenes@users.noreply.github.com"
$env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME
$env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL

Write-Host "Checking for changes..." -ForegroundColor Cyan
$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit. Working tree is clean." -ForegroundColor Yellow
    Write-Host "Pushing anyway in case local commits are ahead..." -ForegroundColor Yellow
} else {
    git add -A
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Commit failed. See error above." -ForegroundColor Red
        exit 1
    }
    Write-Host "Committed." -ForegroundColor Green
}

function Get-GitHubToken {
    $envPath = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPath) {
        foreach ($line in Get-Content $envPath) {
            if ($line -match '^\s*GITHUB_TOKEN\s*=\s*"?([^"#]+)"?\s*$') {
                return $matches[1].Trim()
            }
        }
    }
    if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN.Trim() }
    return $null
}

Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
$token = Get-GitHubToken
if ($token) {
    $env:GIT_TERMINAL_PROMPT = "0"
    git push "https://the-diogenes:$token@github.com/the-diogenes/get-a-job.git" HEAD:main
} else {
    git push
}
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push FAILED." -ForegroundColor Red
    Write-Host "Username: the-diogenes" -ForegroundColor Yellow
    Write-Host "Password: paste your ghp_ token (not GitHub password)" -ForegroundColor Yellow
    Write-Host "Or clear bad saved password: Credential Manager -> remove github.com entries" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Done. Site updates in 1-2 min at:" -ForegroundColor Green
Write-Host "https://the-diogenes.github.io/get-a-job/" -ForegroundColor Green
