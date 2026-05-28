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

function Install-PortableNode {
    $portableDir = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\portable\node'
    Write-Step "Baixando Node.js LTS (portable)..."
    try {
        $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
        $lts   = $index | Where-Object { $_.lts } | Select-Object -First 1
        $ver   = $lts.version
        $url   = "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip"
        Write-Step "Versao LTS: $ver"

        $tmpZip     = Join-Path $env:TEMP 'node_portable.zip'
        $tmpExtract = Join-Path $env:TEMP 'node_portable_extract'

        Write-Step "Baixando $url ..."
        Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing

        if (Test-Path $tmpExtract) { Remove-Item $tmpExtract -Recurse -Force }
        Write-Step "Extraindo..."
        Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force

        $extracted = Get-ChildItem $tmpExtract -Directory | Select-Object -First 1
        if (-not $extracted) { throw "Pasta extraida nao encontrada em $tmpExtract" }

        if (Test-Path $portableDir) { Remove-Item $portableDir -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path $portableDir) -Force | Out-Null
        Move-Item $extracted.FullName $portableDir -Force

        Remove-Item $tmpZip     -Force -ErrorAction SilentlyContinue
        Remove-Item $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue

        Write-Ok "Node.js $ver instalado em $portableDir"
        return $true
    } catch {
        Write-Err "Falha ao instalar Node.js: $_"
        Write-Warn "Instale manualmente: https://nodejs.org/en/download"
        Write-Warn "Ou via Scoop: scoop install nodejs-lts"
        return $false
    }
}

# -----------------------------------------------------------------------
# Modo UPDATE
# -----------------------------------------------------------------------
if ($IsInstalled) {
    Write-Host ""
    Write-Host "===============================" -ForegroundColor Cyan
    Write-Host " PokedexChatbot - Atualizacao  " -ForegroundColor Cyan
    Write-Host "===============================" -ForegroundColor Cyan

    # 0. Verificar Node.js (necessario para o bridge rodar)
    Write-Step "Verificando Node.js..."
    $nodeFound = $false
    $scoopNode    = Join-Path $env:LOCALAPPDATA 'scoop\apps\nodejs-lts\current\node.exe'
    $portableNode = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\portable\node\node.exe'
    if (Test-Path $scoopNode)        { $nodeFound = $true; Write-Ok "Node.js encontrado (scoop)" }
    elseif (Test-Path $portableNode) { $nodeFound = $true; Write-Ok "Node.js encontrado (portable)" }
    elseif (Get-Command node -ErrorAction SilentlyContinue) { $nodeFound = $true; Write-Ok "Node.js encontrado (PATH)" }
    else {
        Write-Warn "Node.js nao encontrado. Instalando automaticamente..."
        $nodeFound = Install-PortableNode
    }

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

    # 3. Scripts Python de inferencia (infer_nlu.py, infer_strategy.py)
    Write-Step "Atualizando scripts Python de inferencia..."
    $pyDirs = @(
        @{ src = 'tools\nn\train\nlu';      dst = 'runtime\tools\nn\train\nlu';      filter = '*.py' }
        @{ src = 'tools\nn\train\strategy'; dst = 'runtime\tools\nn\train\strategy'; filter = '*.py' }
        @{ src = 'tools\nn\train\shared';   dst = 'runtime\tools\nn\train\shared';   filter = '*.py' }
    )
    foreach ($pair in $pyDirs) {
        $src = Join-Path $ProjectRoot $pair.src
        $dst = Join-Path $InstallBase $pair.dst
        if (Test-Path $src) {
            New-Item -ItemType Directory -Path $dst -Force | Out-Null
            Get-ChildItem $src -Filter $pair.filter | ForEach-Object {
                Copy-Item $_.FullName $dst -Force
            }
        }
    }
    Write-Ok "Scripts Python atualizados"

    # 4. Modelos (apenas se .local_cache/nn_models existir no projeto)
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
    if (-not $nodeFound) {
        Write-Host "===============================" -ForegroundColor Yellow
        Write-Host " AVISO: Instale o Node.js!" -ForegroundColor Yellow
        Write-Host " O app nao vai funcionar sem ele." -ForegroundColor Yellow
        Write-Host " https://nodejs.org" -ForegroundColor Yellow
        Write-Host "===============================" -ForegroundColor Yellow
    } else {
        Write-Host "===============================" -ForegroundColor Green
        Write-Host " Atualizacao concluida!" -ForegroundColor Green
        Write-Host " Execute run_gui.exe para abrir." -ForegroundColor Green
        Write-Host "===============================" -ForegroundColor Green
    }
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
        $portableNode = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\portable\node\node.exe'
        if (-not (Test-Path $portableNode)) {
            $ok = Install-PortableNode
            if (-not $ok) {
                Write-Err "Node.js nao encontrado e instalacao automatica falhou."
                Write-Err "Instale Node.js >= 22 manualmente e rode o setup novamente."
                exit 1
            }
        }
        $env:PATH = "$env:LOCALAPPDATA\PokedexChatbot\portable\node;$env:PATH"
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
