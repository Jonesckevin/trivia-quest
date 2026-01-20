# Start local HTTP server for Question Webapp
# Usage: .\start-server.ps1 [port]

param(
    [int]$Port = 8080
)

$Host.UI.RawUI.WindowTitle = "Question Webapp Server"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║       Question Webapp Server         ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Starting server on port $Port..." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Open in browser:" -ForegroundColor Yellow
Write-Host "  → http://localhost:$Port" -ForegroundColor Green
Write-Host ""
Write-Host "  Press Ctrl+C to stop the server" -ForegroundColor DarkGray
Write-Host ""

# Try Python 3 first, then Python
$pythonCmd = $null
if (Get-Command python3 -ErrorAction SilentlyContinue) {
    $pythonCmd = "python3"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCmd = "python"
} else {
    Write-Host "  ERROR: Python is not installed or not in PATH" -ForegroundColor Red
    Write-Host "  Please install Python from https://python.org" -ForegroundColor Red
    exit 1
}

# Change to app directory and start the HTTP server
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $scriptDir "app"
Push-Location $appDir
try {
    & $pythonCmd -m http.server $Port
} finally {
    Pop-Location
}
