# setup.ps1 - Instala ou atualiza o PokedexChatbot a partir do diretorio do projeto.
# Chamado por setup.exe (wrapper C#) com WorkingDirectory = raiz do projeto.
#
# UPDATE  (instalacao ja existe): copia app.asar + tools/nn/dist/ atualizados.
# INSTALL (primeira vez)        : requer o runtime completo (build ou zip).

$ErrorActionPreference = 'Stop'

$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$InstallBase  = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\app\win-unpacked\resources'
$InstalledExe = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\app\win-unpacked\Pokedex Desktop.exe'
$IsInstalled  = Test-Path $InstalledExe

function Write-Step([string]$msg) { Write-Host "[setup] >> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "[setup] OK $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "[setup] AVISO $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host "[setup] ERRO $msg" -ForegroundColor Red }

function Copy-Dir([string]$src, [string]$dst) {
    if (-not (Test-Path $src)) { Write-Warn "Origem nao encontrada, pulando: $src"; return }
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
}

# -----------------------------------------------------------------------
# Modo UPDATE
# -----------------------------------------------------------------------
if ($IsInstalled) {
    Write-Host ""
    Write-Host "===============================" -ForegroundColor Cyan
    Write-Host " PokedexChatbot - Atualizacao  " -ForegroundColor Cyan
    Write-Host "===============================" -ForegroundColor Cyan

    # 1. Frontend Electron (app.asar)
    Write-Step "Atualizando frontend (app.asar)..."
    $srcAsar = Join-Path $ProjectRoot 'release\app.asar'
    $dstAsar = Join-Path $InstallBase 'app.asar'
    if (Test-Path $srcAsar) {
        Copy-Item $srcAsar $dstAsar -Force
        $sizeKB = [math]::Round((Get-Item $srcAsar).Length / 1KB, 0)
        Write-Ok "app.asar atualizado ($sizeKB KB)"
    } else {
        Write-Warn "release\app.asar nao encontrado - execute build_release.ps1 primeiro"
    }

    # 2. Bridge + Engine compilados (tools/nn/dist/)
    Write-Step "Atualizando bridge e engine (tools/nn/dist)..."
    $srcDist = Join-Path $ProjectRoot 'tools\nn\dist'
    $dstDist = Join-Path $InstallBase 'runtime\tools\nn\dist'
    Copy-Dir $srcDist $dstDist
    Write-Ok "tools/nn/dist/ atualizado"

    # 3. Modelos (apenas se .local_cache/nn_models existir no projeto)
    Write-Step "Verificando modelos treinados..."
    $srcModels = Join-Path $ProjectRoot '.local_cache\nn_models'
    $dstModels = Join-Path $InstallBase 'runtime\.local_cache\nn_models'
    if (Test-Path $srcModels) {
        Copy-Dir $srcModels $dstModels
        Write-Ok "Modelos atualizados"
    } else {
        Write-Ok "Modelos mantidos (nenhum novo modelo no projeto)"
    }

    Write-Host ""
    Write-Host "===============================" -ForegroundColor Green
    Write-Host " Atualizacao concluida!" -ForegroundColor Green
    Write-Host " Execute run_gui.exe para abrir." -ForegroundColor Green
    Write-Host "===============================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# -----------------------------------------------------------------------
# Modo INSTALL (primeira vez)
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host " PokedexChatbot - Instalacao   " -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan

$BuiltRuntime = Join-Path $ProjectRoot 'gui\dist\win-unpacked'
$BuiltExe     = Join-Path $BuiltRuntime 'Pokedex Desktop.exe'

if (-not (Test-Path $BuiltExe)) {
    Write-Step "Build nao encontrado - compilando o app..."

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Err "Node.js nao encontrado. Instale Node.js >= 22 antes de continuar."
        exit 1
    }

    Write-Step "Compilando TypeScript (tools/nn)..."
    Push-Location (Join-Path $ProjectRoot 'tools\nn')
    npx tsc
    Pop-Location
    Write-Ok "TypeScript compilado"

    Write-Step "Empacotando Electron (gui)..."
    Push-Location (Join-Path $ProjectRoot 'gui')
    npm run pack:dir
    Pop-Location
    Write-Ok "Electron empacotado"
}

Write-Step "Copiando para $env:LOCALAPPDATA\PokedexChatbot..."
$AppInstallDir = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\app'
New-Item -ItemType Directory -Path $AppInstallDir -Force | Out-Null

# Copiar arquivos do Electron (exceto resources)
Get-ChildItem $BuiltRuntime | Where-Object { $_.Name -ne 'resources' } | ForEach-Object {
    $dst = Join-Path $AppInstallDir "win-unpacked\$($_.Name)"
    Copy-Item $_.FullName $dst -Recurse -Force
}

# Copiar resources
$BuiltResources = Join-Path $BuiltRuntime 'resources'
New-Item -ItemType Directory -Path $InstallBase -Force | Out-Null
Copy-Item (Join-Path $BuiltResources 'app.asar')         (Join-Path $InstallBase 'app.asar')         -Force
Copy-Item (Join-Path $BuiltResources 'default_app.asar') (Join-Path $InstallBase 'default_app.asar') -Force -ErrorAction SilentlyContinue

# Runtime: copiar tudo exceto .local_cache se ja existir (preserva dados do usuario)
$BuiltRuntimeRes = Join-Path $BuiltResources 'runtime'
$LocalCache      = Join-Path $InstallBase 'runtime\.local_cache'

if (Test-Path $BuiltRuntimeRes) {
    New-Item -ItemType Directory -Path (Join-Path $InstallBase 'runtime') -Force | Out-Null
    Get-ChildItem $BuiltRuntimeRes | Where-Object { $_.Name -ne '.local_cache' } | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $InstallBase "runtime\$($_.Name)") -Recurse -Force
    }
    $srcCache = Join-Path $BuiltRuntimeRes '.local_cache'
    if ((Test-Path $srcCache) -and -not (Test-Path $LocalCache)) {
        Copy-Item $srcCache (Join-Path $InstallBase 'runtime\.local_cache') -Recurse -Force
        Write-Ok ".local_cache copiado (dados iniciais)"
    } elseif (Test-Path $LocalCache) {
        Write-Ok ".local_cache mantido (dados do usuario preservados)"
    }
}

Write-Host ""
Write-Host "===============================" -ForegroundColor Green
Write-Host " Instalacao concluida!" -ForegroundColor Green
Write-Host " Execute run_gui.exe para abrir." -ForegroundColor Green
Write-Host "===============================" -ForegroundColor Green
Write-Host ""
