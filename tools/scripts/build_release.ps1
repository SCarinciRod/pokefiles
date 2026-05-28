# build_release.ps1 — Compila e empacota os artefatos de release.
# Execute após modificar código (bridge.ts, renderer.js, main.js, etc.)
# e antes de git add + commit + push.
#
# O que faz:
#   1. npx tsc           → recompila tools/nn/dist/
#   2. npm run pack:dir  → reconstrói app.asar (frontend Electron)
#   3. Copia app.asar    → release/app.asar  (rastreado pelo git)
#
# Depois de rodar:
#   git add tools/nn/dist/ release/app.asar
#   git commit -m "release: ..."

$ErrorActionPreference = 'Stop'

$ToolsDir    = Split-Path -Parent $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ToolsDir

function Write-Step([string]$msg) { Write-Host "[build] >> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "[build] OK $msg" -ForegroundColor Green }
function Write-Err([string]$msg)  { Write-Host "[build] ERRO $msg" -ForegroundColor Red; exit 1 }

# -----------------------------------------------------------------------
# 1. TypeScript
# -----------------------------------------------------------------------
Write-Step "Compilando TypeScript (tools/nn)..."
Push-Location (Join-Path $ProjectRoot 'tools\nn')

if (-not (Test-Path 'node_modules')) {
    Write-Step "node_modules ausente — executando npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "npm install falhou (tools/nn)" }
}

npx tsc
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "Compilacao TypeScript falhou" }
Pop-Location
Write-Ok "tools/nn/dist/ atualizado"

# -----------------------------------------------------------------------
# 2. Electron
# -----------------------------------------------------------------------
Write-Step "Empacotando Electron (gui)..."
Push-Location (Join-Path $ProjectRoot 'gui')

if (-not (Test-Path 'node_modules')) {
    Write-Step "node_modules ausente — executando npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "npm install falhou (gui)" }
}

npm run pack:dir
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "npm run pack:dir falhou" }
Pop-Location
Write-Ok "gui/dist/ gerado"

# -----------------------------------------------------------------------
# 3. Copiar app.asar para release/
# -----------------------------------------------------------------------
Write-Step "Copiando app.asar para release/..."
$srcAsar = Join-Path $ProjectRoot 'gui\dist\win-unpacked\resources\app.asar'
$dstAsar = Join-Path $ProjectRoot 'release\app.asar'

if (-not (Test-Path $srcAsar)) {
    Write-Err "app.asar nao encontrado em $srcAsar — verifique o build do Electron"
}

New-Item -ItemType Directory -Path (Split-Path $dstAsar) -Force | Out-Null
Copy-Item $srcAsar $dstAsar -Force
$sizeKB = [math]::Round((Get-Item $dstAsar).Length / 1KB, 0)
Write-Ok "release/app.asar atualizado ($sizeKB KB)"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Release gerado! Proximos passos:" -ForegroundColor Green
Write-Host ""
Write-Host "   git add tools/nn/dist/ release/app.asar" -ForegroundColor White
Write-Host "   git commit -m ""release: atualiza artefatos compilados""" -ForegroundColor White
Write-Host "   git push" -ForegroundColor White
Write-Host ""
Write-Host " O colega roda: git pull && setup.exe" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
