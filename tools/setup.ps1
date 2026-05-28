# setup.ps1 - Instala ou atualiza o PokedexChatbot a partir do diretório do projeto.
# Chamado por setup.exe (wrapper C#) com WorkingDirectory = raiz do projeto.
#
# UPDATE  (instalação já existe):
#   - detecta automaticamente se bridge.ts ou fontes GUI mudaram
#   - recompila TypeScript e/ou repacks app.asar quando necessário
#   - sincroniza runtime (dist/, Python, modelos)
#
# INSTALL (primeira vez):
#   - compila TypeScript, empacota Electron, copia tudo para %LOCALAPPDATA%

$ErrorActionPreference = 'Stop'

$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$InstallBase  = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\app\win-unpacked\resources'
$InstalledExe = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\app\win-unpacked\Pokedex Desktop.exe'
$IsInstalled  = Test-Path $InstalledExe

function Write-Step([string]$msg) { Write-Host "[setup] >> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "[setup] OK $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "[setup] AVISO $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host "[setup] ERRO $msg" -ForegroundColor Red }

# -----------------------------------------------------------------------
# Copiar diretório recursivamente via robocopy
# -----------------------------------------------------------------------
function Copy-Dir([string]$src, [string]$dst) {
    if (-not (Test-Path $src)) { Write-Warn "Origem nao encontrada, pulando: $src"; return }
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    $null = robocopy $src $dst /E /IS /IT /NFL /NDL /NJH /NJS /NC /NS /NP 2>$null
    if ($LASTEXITCODE -ge 8) { Write-Warn "robocopy retornou $LASTEXITCODE ao copiar $src" }
}

# -----------------------------------------------------------------------
# Resolver caminho do Node.js (scoop → portable → PATH)
# -----------------------------------------------------------------------
function Get-NodeCmd {
    $scoopNode    = Join-Path $env:LOCALAPPDATA 'scoop\apps\nodejs-lts\current\node.exe'
    $portableNode = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\portable\node\node.exe'
    if (Test-Path $scoopNode)    { return $scoopNode }
    if (Test-Path $portableNode) { return $portableNode }
    if (Get-Command node -ErrorAction SilentlyContinue) { return 'node' }
    return $null
}

# -----------------------------------------------------------------------
# Baixar e instalar Node.js LTS portable se ausente
# -----------------------------------------------------------------------
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
# Detectar: algum .ts em tools/nn/ mais recente que dist/bridge.js?
# -----------------------------------------------------------------------
function Test-TsNeedsCompile {
    $bridgeJs = Join-Path $ProjectRoot 'tools\nn\dist\bridge.js'
    if (-not (Test-Path $bridgeJs)) { return $true }
    $refTime = (Get-Item $bridgeJs).LastWriteTime
    $tsFiles = Get-ChildItem (Join-Path $ProjectRoot 'tools\nn') -Filter '*.ts' -Recurse -File -ErrorAction SilentlyContinue
    foreach ($f in $tsFiles) {
        if ($f.LastWriteTime -gt $refTime) { return $true }
    }
    return $false
}

# -----------------------------------------------------------------------
# Detectar: fontes GUI mais recentes que release/app.asar?
# Espelha o campo "files" de gui/package.json:
#   main.js, boot_preload.js, preload.js, public/**
# -----------------------------------------------------------------------
function Test-AsarNeedsRepack {
    $releaseAsar = Join-Path $ProjectRoot 'release\app.asar'
    # Sem asar de release: sempre repack
    if (-not (Test-Path $releaseAsar)) { return $true }
    $refTime = (Get-Item $releaseAsar).LastWriteTime

    foreach ($name in @('main.js', 'preload.js', 'boot_preload.js')) {
        $f = Join-Path $ProjectRoot "gui\$name"
        if ((Test-Path $f) -and (Get-Item $f).LastWriteTime -gt $refTime) { return $true }
    }
    $pubDir = Join-Path $ProjectRoot 'gui\public'
    if (Test-Path $pubDir) {
        foreach ($f in (Get-ChildItem $pubDir -Recurse -File)) {
            if ($f.LastWriteTime -gt $refTime) { return $true }
        }
    }
    return $false
}

# -----------------------------------------------------------------------
# Repack rápido de app.asar via repack_asar.js (sem rebuild completo)
# Atualiza release/app.asar e o asar instalado.
# -----------------------------------------------------------------------
function Invoke-AsarRepack([string]$NodeCmd) {
    $guiDir       = Join-Path $ProjectRoot 'gui'
    $releaseAsar  = Join-Path $ProjectRoot 'release\app.asar'
    $dstAsar      = Join-Path $InstallBase 'app.asar'
    $repackScript = Join-Path $PSScriptRoot 'scripts\repack_asar.js'

    if (-not (Test-Path $repackScript)) {
        Write-Warn "repack_asar.js nao encontrado em $repackScript - usando build completo"
        return Invoke-FullElectronBuild $NodeCmd
    }

    # Asar de origem: release tem prioridade (já extraído), fallback para instalado
    $srcAsar = if (Test-Path $releaseAsar) { $releaseAsar }
               elseif (Test-Path $dstAsar) { $dstAsar }
               else { '' }

    # 1. Repack → release/app.asar
    New-Item -ItemType Directory -Path (Split-Path $releaseAsar) -Force | Out-Null
    Write-Step "Repacking app.asar (fontes modificadas detectadas)..."
    & $NodeCmd $repackScript $guiDir $srcAsar $releaseAsar
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Repack falhou - usando build completo"
        return Invoke-FullElectronBuild $NodeCmd
    }
    $sizeKB = [math]::Round((Get-Item $releaseAsar).Length / 1KB, 0)
    Write-Ok "release/app.asar atualizado ($sizeKB KB)"

    # 2. Copiar para o local instalado
    Copy-Item $releaseAsar $dstAsar -Force
    Write-Ok "app.asar instalado"
    return $true
}

# -----------------------------------------------------------------------
# Build completo Electron (fallback ou primeira vez)
# -----------------------------------------------------------------------
function Invoke-FullElectronBuild([string]$NodeCmd) {
    Write-Step "Build completo Electron (npm run pack:dir)..."
    Push-Location (Join-Path $ProjectRoot 'gui')

    if (-not (Test-Path 'node_modules')) {
        Write-Step "Instalando dependencias npm (gui)..."
        npm install
        if ($LASTEXITCODE -ne 0) { Write-Err "npm install falhou (gui)"; Pop-Location; return $false }
    }

    npm run pack:dir
    $exitCode = $LASTEXITCODE
    Pop-Location
    if ($exitCode -ne 0) { Write-Err "npm run pack:dir falhou (exit $exitCode)"; return $false }

    $builtAsar   = Join-Path $ProjectRoot 'gui\dist\win-unpacked\resources\app.asar'
    $releaseAsar = Join-Path $ProjectRoot 'release\app.asar'
    $dstAsar     = Join-Path $InstallBase 'app.asar'

    if (-not (Test-Path $builtAsar)) { Write-Err "app.asar nao gerado em $builtAsar"; return $false }

    New-Item -ItemType Directory -Path (Split-Path $releaseAsar) -Force | Out-Null
    Copy-Item $builtAsar $releaseAsar -Force
    Copy-Item $builtAsar $dstAsar     -Force
    $sizeKB = [math]::Round((Get-Item $dstAsar).Length / 1KB, 0)
    Write-Ok "app.asar instalado via build completo ($sizeKB KB)"
    return $true
}

# -----------------------------------------------------------------------
# Compilar TypeScript
# -----------------------------------------------------------------------
function Invoke-TscCompile([string]$NodeCmd) {
    Push-Location (Join-Path $ProjectRoot 'tools\nn')

    if (-not (Test-Path 'node_modules')) {
        Write-Step "Instalando dependencias npm (tools/nn)..."
        npm install
        if ($LASTEXITCODE -ne 0) { Write-Err "npm install falhou (tools/nn)"; Pop-Location; return $false }
    }

    npx tsc
    $exitCode = $LASTEXITCODE
    Pop-Location
    if ($exitCode -ne 0) { Write-Err "Compilacao TypeScript falhou (exit $exitCode)"; return $false }
    Write-Ok "tools/nn/dist/ compilado"
    return $true
}

# =======================================================================
# Modo UPDATE
# =======================================================================
if ($IsInstalled) {
    Write-Host ""
    Write-Host "===============================" -ForegroundColor Cyan
    Write-Host " PokedexChatbot - Atualizacao  " -ForegroundColor Cyan
    Write-Host "===============================" -ForegroundColor Cyan

    # 0. Node.js
    Write-Step "Verificando Node.js..."
    $nodeCmd = Get-NodeCmd
    if (-not $nodeCmd) {
        Write-Warn "Node.js nao encontrado. Instalando automaticamente..."
        $ok = Install-PortableNode
        if (-not $ok) {
            Write-Warn "Node.js nao disponivel - algumas etapas serao puladas"
        } else {
            $nodeCmd = Get-NodeCmd
        }
    }
    if ($nodeCmd) { Write-Ok "Node.js: $nodeCmd" }

    # 1. TypeScript - recompila somente se .ts mais recente que dist/bridge.js
    if ($nodeCmd) {
        if (Test-TsNeedsCompile) {
            Write-Step "Mudancas em .ts detectadas - recompilando bridge..."
            $ok = Invoke-TscCompile $nodeCmd
            if (-not $ok) { Write-Warn "Compilacao falhou - continuando com dist/ existente" }
        } else {
            Write-Ok "TypeScript sem mudancas - dist/ esta atualizado"
        }
    }

    # 2. Bridge + Engine compilados → runtime
    Write-Step "Sincronizando bridge e engine (tools/nn/dist)..."
    $srcDist = Join-Path $ProjectRoot 'tools\nn\dist'
    $dstDist = Join-Path $InstallBase 'runtime\tools\nn\dist'
    Copy-Dir $srcDist $dstDist
    Write-Ok "tools/nn/dist/ sincronizado"

    # 2b. Binario nativo Node (better_sqlite3.node) - so o .node compilado, nao o fonte (67 MB)
    #     Necessario se o Node foi atualizado (ABI mudou). Copia apenas build/Release/.
    Write-Step "Verificando binario nativo better-sqlite3..."
    $srcNode = Join-Path $ProjectRoot 'tools\nn\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
    $dstNode = Join-Path $InstallBase 'runtime\tools\nn\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
    if ((Test-Path $srcNode) -and (Test-Path (Split-Path $dstNode))) {
        $srcVer = (Get-Item $srcNode).LastWriteTime
        $dstVer = if (Test-Path $dstNode) { (Get-Item $dstNode).LastWriteTime } else { [DateTime]::MinValue }
        if ($srcVer -gt $dstVer) {
            Copy-Item $srcNode $dstNode -Force
            Write-Ok "better_sqlite3.node atualizado"
        } else {
            Write-Ok "better_sqlite3.node sem mudancas"
        }
    } else {
        Write-Ok "better_sqlite3.node - sem acao necessaria"
    }

    # 2c. Banco de dados SQLite
    Write-Step "Verificando banco de dados SQLite..."
    $srcSqlite = Join-Path $ProjectRoot '.local_cache\nn_export\pokefiles_nn.sqlite3'
    $dstSqlite = Join-Path $InstallBase 'runtime\.local_cache\nn_export\pokefiles_nn.sqlite3'
    if (Test-Path $srcSqlite) {
        New-Item -ItemType Directory -Path (Split-Path $dstSqlite) -Force | Out-Null
        Copy-Item $srcSqlite $dstSqlite -Force
        $sizeMB = [math]::Round((Get-Item $dstSqlite).Length / 1MB, 1)
        Write-Ok "SQLite sincronizado ($sizeMB MB)"
    } elseif (Test-Path $dstSqlite) {
        Write-Ok "SQLite mantido (nao ha novo no projeto)"
    } else {
        Write-Warn "SQLite nao encontrado em .local_cache\nn_export\pokefiles_nn.sqlite3"
        Write-Warn "O app iniciara sem dados - execute tools/pipeline para gerar o banco"
        Write-Warn "Ou copie manualmente o arquivo pokefiles_nn.sqlite3 para o local acima"
    }

    # 3. app.asar - repack somente se fontes GUI mudaram
    if ($nodeCmd) {
        if (Test-AsarNeedsRepack) {
            $ok = Invoke-AsarRepack $nodeCmd
            if (-not $ok) { Write-Warn "Repack falhou - app.asar nao atualizado" }
        } else {
            # Mesmo sem mudancas nos fontes, o asar instalado pode estar desatualizado
            # (ex: primeiro update apos uma nova versao commitada). Sempre sincronizar.
            $releaseAsar = Join-Path $ProjectRoot 'release\app.asar'
            $dstAsar     = Join-Path $InstallBase 'app.asar'
            if (Test-Path $releaseAsar) {
                $releaseTime  = (Get-Item $releaseAsar).LastWriteTime
                $installedTime = if (Test-Path $dstAsar) { (Get-Item $dstAsar).LastWriteTime } else { [DateTime]::MinValue }
                if ($releaseTime -gt $installedTime) {
                    Copy-Item $releaseAsar $dstAsar -Force
                    Write-Ok "app.asar atualizado (release mais recente)"
                } else {
                    Write-Ok "app.asar esta atualizado"
                }
            }
        }
    } else {
        # Sem node: copiar release/app.asar diretamente se existir
        $releaseAsar = Join-Path $ProjectRoot 'release\app.asar'
        $dstAsar     = Join-Path $InstallBase 'app.asar'
        if (Test-Path $releaseAsar) {
            Copy-Item $releaseAsar $dstAsar -Force
            Write-Ok "app.asar copiado (sem Node.js para repack)"
        } else {
            Write-Warn "release/app.asar nao encontrado e Node.js ausente - execute build_release.ps1 primeiro"
        }
    }

    # 4. Scripts Python (nlu, strategy, shared) - usando robocopy para recursao
    Write-Step "Sincronizando scripts Python de inferencia..."
    $pyDirs = @(
        @{ src = 'tools\nn\train\nlu';      dst = 'runtime\tools\nn\train\nlu' }
        @{ src = 'tools\nn\train\strategy'; dst = 'runtime\tools\nn\train\strategy' }
        @{ src = 'tools\nn\train\shared';   dst = 'runtime\tools\nn\train\shared' }
    )
    foreach ($pair in $pyDirs) {
        $src = Join-Path $ProjectRoot $pair.src
        $dst = Join-Path $InstallBase $pair.dst
        Copy-Dir $src $dst
    }
    Write-Ok "Scripts Python sincronizados"

    # 5. Modelos treinados (preserva os existentes se nenhum novo estiver no projeto)
    Write-Step "Verificando modelos treinados..."
    $srcModels = Join-Path $ProjectRoot '.local_cache\nn_models'
    $dstModels = Join-Path $InstallBase 'runtime\.local_cache\nn_models'
    if (Test-Path $srcModels) {
        Copy-Dir $srcModels $dstModels
        Write-Ok "Modelos sincronizados"
    } else {
        Write-Ok "Modelos mantidos (nenhum novo modelo no projeto)"
    }

    Write-Host ""
    if (-not $nodeCmd) {
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

# =======================================================================
# Modo INSTALL (primeira vez)
# =======================================================================
Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host " PokedexChatbot - Instalacao   " -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan

# Resolver Node.js antes de qualquer build
$nodeCmd = Get-NodeCmd
if (-not $nodeCmd) {
    Write-Warn "Node.js nao encontrado. Instalando automaticamente..."
    $ok = Install-PortableNode
    if (-not $ok) {
        Write-Err "Node.js nao encontrado e instalacao automatica falhou."
        Write-Err "Instale Node.js >= 22 manualmente e rode o setup novamente."
        exit 1
    }
    $nodeCmd = Get-NodeCmd
    $env:PATH = "$env:LOCALAPPDATA\PokedexChatbot\portable\node;$env:PATH"
}
Write-Ok "Node.js: $nodeCmd"

$BuiltRuntime = Join-Path $ProjectRoot 'gui\dist\win-unpacked'
$BuiltExe     = Join-Path $BuiltRuntime 'Pokedex Desktop.exe'

if (-not (Test-Path $BuiltExe)) {
    Write-Step "Build nao encontrado - compilando o app..."

    # TypeScript + node_modules (inclui better-sqlite3)
    $ok = Invoke-TscCompile $nodeCmd
    if (-not $ok) { Write-Err "Compilacao TypeScript falhou. Abortando."; exit 1 }

    # Electron (SQLite nao esta mais em extraResources - copiado separadamente abaixo)
    $ok = Invoke-FullElectronBuild $nodeCmd
    if (-not $ok) { Write-Err "Build Electron falhou. Abortando."; exit 1 }
} else {
    Write-Ok "Build existente encontrado em $BuiltRuntime"
    # Mesmo com build existente, garantir que dist/ esta compilado
    if (Test-TsNeedsCompile) {
        Write-Step "TypeScript desatualizado - recompilando..."
        $ok = Invoke-TscCompile $nodeCmd
        if (-not $ok) { Write-Warn "Compilacao falhou - usando dist/ existente" }
    }
}

Write-Step "Copiando para $env:LOCALAPPDATA\PokedexChatbot..."
$AppInstallDir = Join-Path $env:LOCALAPPDATA 'PokedexChatbot\app'
New-Item -ItemType Directory -Path $AppInstallDir -Force | Out-Null

# Arquivos Electron (exceto resources - tratados separadamente)
Get-ChildItem $BuiltRuntime | Where-Object { $_.Name -ne 'resources' } | ForEach-Object {
    $dst = Join-Path $AppInstallDir "win-unpacked\$($_.Name)"
    Copy-Item $_.FullName $dst -Recurse -Force
}

# Resources: app.asar e default_app.asar
$BuiltResources = Join-Path $BuiltRuntime 'resources'
New-Item -ItemType Directory -Path $InstallBase -Force | Out-Null
Copy-Item (Join-Path $BuiltResources 'app.asar')         (Join-Path $InstallBase 'app.asar')         -Force
Copy-Item (Join-Path $BuiltResources 'default_app.asar') (Join-Path $InstallBase 'default_app.asar') -Force -ErrorAction SilentlyContinue

# Runtime: copiar tudo exceto .local_cache (preserva dados do usuário)
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

# Modulos nativos: so o binario .node (o npm install ja colocou o restante via electron-builder)
Write-Step "Verificando binario nativo better-sqlite3..."
$srcNode = Join-Path $ProjectRoot 'tools\nn\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
$dstNode = Join-Path $InstallBase 'runtime\tools\nn\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
if ((Test-Path $srcNode) -and (Test-Path (Split-Path $dstNode))) {
    Copy-Item $srcNode $dstNode -Force
    Write-Ok "better_sqlite3.node instalado"
} else {
    Write-Ok "better_sqlite3.node - modulo ja esta no pacote Electron"
}

# SQLite - copiar se disponivel no projeto
Write-Step "Verificando banco de dados SQLite..."
$srcSqlite = Join-Path $ProjectRoot '.local_cache\nn_export\pokefiles_nn.sqlite3'
$dstSqlite = Join-Path $InstallBase 'runtime\.local_cache\nn_export\pokefiles_nn.sqlite3'
if (Test-Path $srcSqlite) {
    New-Item -ItemType Directory -Path (Split-Path $dstSqlite) -Force | Out-Null
    Copy-Item $srcSqlite $dstSqlite -Force
    $sizeMB = [math]::Round((Get-Item $dstSqlite).Length / 1MB, 1)
    Write-Ok "SQLite instalado ($sizeMB MB)"
} elseif (Test-Path $dstSqlite) {
    Write-Ok "SQLite existente mantido"
} else {
    Write-Warn "SQLite nao encontrado - o app iniciara sem dados"
    Write-Warn "Copie pokefiles_nn.sqlite3 para: $dstSqlite"
}

# Modelos treinados - copiar se disponivel no projeto
Write-Step "Verificando modelos treinados..."
$srcModels = Join-Path $ProjectRoot '.local_cache\nn_models'
$dstModels = Join-Path $InstallBase 'runtime\.local_cache\nn_models'
if (Test-Path $srcModels) {
    Copy-Dir $srcModels $dstModels
    Write-Ok "Modelos instalados"
} elseif (Test-Path $dstModels) {
    Write-Ok "Modelos existentes mantidos"
} else {
    Write-Ok "Sem modelos - app usa respostas de regras"
}

Write-Host ""
Write-Host "===============================" -ForegroundColor Green
Write-Host " Instalacao concluida!" -ForegroundColor Green
Write-Host " Execute run_gui.exe para abrir." -ForegroundColor Green
Write-Host "===============================" -ForegroundColor Green
Write-Host ""
