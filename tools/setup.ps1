param(
    [switch]$SkipGenerationBuild,
    [switch]$SkipSpriteSync,
    [switch]$SkipGuiDependencies,
    [switch]$SkipGuiPackaging,
    [switch]$PreserveGuiBuildArtifacts,
    [switch]$PreserveGuiNodeModules,
    [switch]$ForceGenerationBuild,
    [switch]$ForceSpriteSync
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$UserBaseDir = Join-Path $env:LOCALAPPDATA 'PokedexChatbot'
$SpriteDir = Join-Path $UserBaseDir 'sprites'
$AppInstallDir = Join-Path $UserBaseDir 'app'
$InstalledGuiDir = Join-Path $AppInstallDir 'win-unpacked'
$InstalledGuiExe = Join-Path $InstalledGuiDir 'Pokedex Desktop.exe'
$VendorDir = Join-Path $UserBaseDir 'vendor'
$PortableDir = Join-Path $UserBaseDir 'portable'
$PortableNodeDir = Join-Path $PortableDir 'node'
$PortableSwiplDir = Join-Path $PortableDir 'swipl'
$PortableNodeExe = Join-Path $PortableNodeDir 'node.exe'
$PortableSwiplExe = Join-Path (Join-Path $PortableSwiplDir 'bin') 'swipl.exe'
$GuiDir = Join-Path $ProjectRoot 'gui'
$DbDir = Join-Path $ProjectRoot 'db'
$CleanGuiScript = Join-Path $PSScriptRoot 'clean_gui_workspace.ps1'
$ScoopNodeExe = Join-Path $env:LOCALAPPDATA 'scoop\apps\nodejs-lts\current\node.exe'
$ScoopNodeNpm = Join-Path $env:LOCALAPPDATA 'scoop\apps\nodejs-lts\current\npm.cmd'
$MinimumNodeVersion = [Version]'22.12.0'
$script:ResolvedNodeCmd = $null
$script:ResolvedSwiplCmd = $null
$script:ResolvedNpmCmd = $null

function Write-Step([string]$Message) {
    Write-Host "[setup] $Message" -ForegroundColor Cyan
}

function Ensure-Scoop {
    if (Get-ScoopCommand) {
        $shimDir = Join-Path $env:LOCALAPPDATA 'scoop\shims'
        if ($env:Path -notlike "*$shimDir*") {
            $env:Path = "$shimDir;$($env:Path)"
        }
        Write-Step 'Scoop ja encontrado.'
        return
    }

    if (-not $env:SCOOP) {
        $env:SCOOP = Join-Path $env:LOCALAPPDATA 'scoop'
    }
    [Environment]::SetEnvironmentVariable('SCOOP', $env:SCOOP, 'User')

    Write-Step "Scoop nao encontrado. Instalando Scoop em '$env:SCOOP' (modo sem instalador grafico)..."
    try {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction Stop
    }
    catch {
        Write-Step 'Aviso: nao foi possivel alterar ExecutionPolicy no usuario atual. Continuando com a sessao atual (Bypass).'
    }
    Invoke-RestMethod -Uri 'https://get.scoop.sh' | Invoke-Expression
}

function Get-ScoopCommand {
    $cmd = Get-Command scoop -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $shim = Join-Path $env:LOCALAPPDATA 'scoop\shims\scoop.cmd'
    if (Test-Path $shim) { return $shim }
    return $null
}

function Invoke-Scoop {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args,
        [switch]$IgnoreErrors
    )

    $scoopCmd = Get-ScoopCommand
    if (-not $scoopCmd) {
        if ($IgnoreErrors) { return $false }
        throw 'Scoop nao encontrado para executar comando.'
    }

    try {
        & $scoopCmd @Args | Out-Host
        $exitCode = $LASTEXITCODE
        if ($null -ne $exitCode -and $exitCode -ne 0) {
            if ($IgnoreErrors) { return $false }
            throw "Scoop retornou codigo $exitCode para: $($Args -join ' ')"
        }
        return $true
    }
    catch {
        if ($IgnoreErrors) { return $false }
        throw
    }
}

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Expand-ZipTo([string]$ZipPath, [string]$Destination) {
    if (Test-Path $Destination) {
        Remove-Item -Recurse -Force $Destination
    }
    Ensure-Dir $Destination

    $tempExtract = Join-Path $env:TEMP ("pkdx_" + [guid]::NewGuid().ToString('N'))
    Ensure-Dir $tempExtract
    try {
        Expand-Archive -Path $ZipPath -DestinationPath $tempExtract -Force
        $entries = Get-ChildItem -Path $tempExtract
        if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
            Copy-Item -Path (Join-Path $entries[0].FullName '*') -Destination $Destination -Recurse -Force
        }
        else {
            Copy-Item -Path (Join-Path $tempExtract '*') -Destination $Destination -Recurse -Force
        }
    }
    finally {
        if (Test-Path $tempExtract) {
            Remove-Item -Recurse -Force $tempExtract
        }
    }
}

function Try-InstallNodeFromVendor {
    $zip = Get-ChildItem -Path $VendorDir -Filter 'node-*-win-x64.zip' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $zip) { return $false }

    Write-Step "Instalando Node portable via arquivo local: $($zip.Name)"
    Expand-ZipTo -ZipPath $zip.FullName -Destination $PortableNodeDir
    return (Test-Path $PortableNodeExe)
}

function Try-InstallSwiplFromVendor {
    $zip = Get-ChildItem -Path $VendorDir -Filter 'swipl-*.zip' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $zip) { return $false }

    Write-Step "Instalando SWI-Prolog portable via arquivo local: $($zip.Name)"
    Expand-ZipTo -ZipPath $zip.FullName -Destination $PortableSwiplDir
    return (Test-Path $PortableSwiplExe)
}

function Resolve-NodeCommand {
    if (Test-Path $ScoopNodeExe) { return $ScoopNodeExe }

    $scoopNode = Join-Path $env:LOCALAPPDATA 'scoop\shims\node.exe'
    if (Test-Path $scoopNode) { return $scoopNode }

    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) {
        if ($cmd.Source) { return $cmd.Source }
        return 'node'
    }
    if (Test-Path $PortableNodeExe) { return $PortableNodeExe }
    return $null
}

function Get-NodeVersion([string]$NodeCmd) {
    if (-not $NodeCmd) { return $null }

    try {
        $rawVersion = (& $NodeCmd -p "process.versions.node" 2>$null)
        if (-not $rawVersion) { return $null }

        $normalized = ($rawVersion -replace '-.*$', '').Trim()
        return [Version]$normalized
    }
    catch {
        return $null
    }
}

function Ensure-NodeVersion([string]$NodeCmd) {
    $nodeVersion = Get-NodeVersion -NodeCmd $NodeCmd
    if ($nodeVersion -and $nodeVersion -ge $MinimumNodeVersion) {
        return $NodeCmd
    }

    if ($nodeVersion) {
        Write-Step "Node encontrado ($nodeVersion) abaixo do minimo recomendado ($MinimumNodeVersion). Tentando atualizar via Scoop..."
    }
    else {
        Write-Step 'Nao foi possivel identificar a versao do Node atual. Tentando provisionar Node LTS via Scoop...'
    }

    Ensure-Scoop
    Invoke-Scoop -Args @('install', 'nodejs-lts') -IgnoreErrors | Out-Null
    Invoke-Scoop -Args @('update', 'nodejs-lts') -IgnoreErrors | Out-Null

    $updatedNodeCmd = Resolve-NodeCommand
    $updatedNodeVersion = Get-NodeVersion -NodeCmd $updatedNodeCmd
    if (-not $updatedNodeVersion -or $updatedNodeVersion -lt $MinimumNodeVersion) {
        throw "Node LTS atualizado nao atende o minimo exigido ($MinimumNodeVersion). Versao detectada: $updatedNodeVersion"
    }

    return $updatedNodeCmd
}

function Resolve-NpmCommand([string]$NodeCmd) {
    if ($NodeCmd -and $NodeCmd -ne 'node') {
        $nodeDir = Split-Path -Parent $NodeCmd
        $nodeSideNpm = Join-Path $nodeDir 'npm.cmd'
        if (Test-Path $nodeSideNpm) {
            return $nodeSideNpm
        }
    }

    if (Test-Path $ScoopNodeNpm) { return $ScoopNodeNpm }

    $scoopNpm = Join-Path $env:LOCALAPPDATA 'scoop\shims\npm.cmd'
    if (Test-Path $scoopNpm) { return $scoopNpm }

    if (Get-Command npm -ErrorAction SilentlyContinue) { return 'npm' }

    return $null
}

function Resolve-SwiplCommand {
    if (Get-Command swipl -ErrorAction SilentlyContinue) { return 'swipl' }
    $scoopSwipl = Join-Path $env:LOCALAPPDATA 'scoop\shims\swipl.exe'
    if (Test-Path $scoopSwipl) { return $scoopSwipl }
    if (Test-Path $PortableSwiplExe) { return $PortableSwiplExe }
    return $null
}

function Ensure-Dependencies {
    Ensure-Dir $UserBaseDir
    Ensure-Dir $AppInstallDir
    Ensure-Dir $PortableDir
    Ensure-Dir $VendorDir

    $nodeCmd = Resolve-NodeCommand
    if (-not $nodeCmd) {
        if (-not (Try-InstallNodeFromVendor)) {
            Write-Step 'Node nao encontrado localmente. Tentando instalacao portable via Scoop...'
            Ensure-Scoop
            Invoke-Scoop -Args @('install', 'nodejs-lts') -IgnoreErrors | Out-Null
        }
        $nodeCmd = Resolve-NodeCommand
    }

    $nodeCmd = Ensure-NodeVersion -NodeCmd $nodeCmd

    $swiplCmd = Resolve-SwiplCommand
    if (-not $swiplCmd) {
        if (-not (Try-InstallSwiplFromVendor)) {
            Write-Step 'SWI-Prolog nao encontrado localmente. Tentando instalacao via Scoop...'
            Ensure-Scoop
            Invoke-Scoop -Args @('bucket', 'add', 'main') -IgnoreErrors | Out-Null
            Invoke-Scoop -Args @('bucket', 'add', 'extras') -IgnoreErrors | Out-Null

            $installed = $false
            foreach ($packageName in @('swi-prolog', 'swipl', 'prolog')) {
                Write-Step "Tentando pacote Scoop: $packageName"
                if (Invoke-Scoop -Args @('install', $packageName) -IgnoreErrors) {
                    $installed = $true
                    break
                }
            }

            if (-not $installed) {
                Write-Step 'Nao foi possivel instalar SWI-Prolog via Scoop neste ambiente.'
            }
        }
        $swiplCmd = Resolve-SwiplCommand
    }

    if (-not $nodeCmd) {
        throw "Node nao disponivel. Coloque um zip portable em '$VendorDir' (ex.: node-v20.x-win-x64.zip) ou libere internet para Scoop."
    }

    if (-not $swiplCmd) {
        throw "SWI-Prolog nao disponivel. Coloque um zip portable em '$VendorDir' (ex.: swipl-*.zip) ou libere internet para Scoop."
    }

    $npmCmd = Resolve-NpmCommand -NodeCmd $nodeCmd
    if (-not $npmCmd) {
        throw "npm nao disponivel. Verifique a instalacao do Node em '$PortableDir' ou no PATH do sistema."
    }

    $script:ResolvedNodeCmd = $nodeCmd
    $script:ResolvedSwiplCmd = $swiplCmd
    $script:ResolvedNpmCmd = $npmCmd

    $nodeVersion = Get-NodeVersion -NodeCmd $nodeCmd

    Write-Step "Node OK: $nodeCmd (versao $nodeVersion)"
    Write-Step "npm OK: $npmCmd"
    Write-Step "SWI-Prolog OK: $swiplCmd"
    Write-Step "Base de usuario: $UserBaseDir"
    Write-Step "Cache de sprites: $SpriteDir"
}

function Ensure-GuiDependencies {
    if (-not (Test-Path (Join-Path $GuiDir 'package.json'))) {
        Write-Step 'GUI nao encontrada (package.json ausente). Pulando instalacao de dependencias da GUI.'
        return
    }

    $npmCmd = $script:ResolvedNpmCmd
    if (-not $npmCmd) {
        $npmCmd = Resolve-NpmCommand -NodeCmd (Resolve-NodeCommand)
    }
    if (-not $npmCmd) {
        throw 'npm nao disponivel para instalar dependencias da GUI.'
    }

    $guiNodeModulesDir = Join-Path $GuiDir 'node_modules'
    if (Test-Path $guiNodeModulesDir) {
        Write-Step 'Dependencias da GUI ja instaladas.'
        return
    }

    Write-Step 'Instalando dependencias da GUI...'
    Push-Location $GuiDir
    try {
        if (Test-Path (Join-Path $GuiDir 'package-lock.json')) {
            & $npmCmd ci
        }
        else {
            & $npmCmd install
        }

        if ($LASTEXITCODE -ne 0) {
            throw 'Falha ao instalar dependencias da GUI.'
        }
    }
    finally {
        Pop-Location
    }
}

function Get-LatestWriteTimeUtc {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$RelativePaths
    )

    $latest = [DateTime]::MinValue

    foreach ($relativePath in $RelativePaths) {
        $fullPath = Join-Path $ProjectRoot $relativePath
        if (-not (Test-Path $fullPath)) {
            continue
        }

        if (Test-Path $fullPath -PathType Leaf) {
            $item = Get-Item $fullPath
            if ($item.LastWriteTimeUtc -gt $latest) {
                $latest = $item.LastWriteTimeUtc
            }
            continue
        }

        $files = Get-ChildItem -Path $fullPath -Recurse -Force -File -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            if ($file.LastWriteTimeUtc -gt $latest) {
                $latest = $file.LastWriteTimeUtc
            }
        }
    }

    return $latest
}

function Get-OldestWriteTimeUtc {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$RelativePaths
    )

    $oldest = [DateTime]::MaxValue
    $found = $false

    foreach ($relativePath in $RelativePaths) {
        $fullPath = Join-Path $ProjectRoot $relativePath
        if (-not (Test-Path $fullPath)) {
            continue
        }

        if (Test-Path $fullPath -PathType Leaf) {
            $item = Get-Item $fullPath
            if ($item.LastWriteTimeUtc -lt $oldest) {
                $oldest = $item.LastWriteTimeUtc
            }
            $found = $true
            continue
        }

        $files = Get-ChildItem -Path $fullPath -Recurse -Force -File -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            if ($file.LastWriteTimeUtc -lt $oldest) {
                $oldest = $file.LastWriteTimeUtc
            }
            $found = $true
        }
    }

    if (-not $found) {
        return [DateTime]::MinValue
    }

    return $oldest
}

function Test-GenerationBuildRequired {
    if ($ForceGenerationBuild) {
        Write-Step 'Forcando geracao de bases locais por parametro do usuario.'
        return $true
    }

    $requiredDbFiles = @('special_forms.pl', 'lore_special_forms.pl')
    for ($generation = 1; $generation -le 9; $generation++) {
        $requiredDbFiles += "generation_$generation.pl"
        $requiredDbFiles += "lore_generation_$generation.pl"
        $requiredDbFiles += "evolution_generation_$generation.pl"
    }

    $missing = $requiredDbFiles | Where-Object {
        -not (Test-Path (Join-Path $DbDir $_))
    }

    if ($missing.Count -gt 0) {
        Write-Step 'Arquivos de geracao ausentes detectados. Geracao completa sera executada.'
        return $true
    }

    $outputPaths = $requiredDbFiles | ForEach-Object { "db/$_" }
    $oldestOutputTimestamp = Get-OldestWriteTimeUtc -RelativePaths $outputPaths
    $latestSourceTimestamp = Get-LatestWriteTimeUtc -RelativePaths @('tools/generate_generation_db.js')

    if ($latestSourceTimestamp -gt $oldestOutputTimestamp) {
        Write-Step 'Script de geracao mais novo que os arquivos locais. Geracao sera executada.'
        return $true
    }

    Write-Step 'Bases de geracao ja estao atualizadas. Pulando geracao.'
    return $false
}

function Get-SpriteSyncMode {
    if ($ForceSpriteSync) {
        Write-Step 'Forcando sincronizacao completa de sprites por parametro do usuario.'
        return 'full'
    }

    $manifestPath = Join-Path $SpriteDir 'sprite_manifest.json'
    if (-not (Test-Path $manifestPath)) {
        Write-Step 'Manifesto de sprites ausente. Sincronizacao completa sera executada.'
        return 'full'
    }

    $latestSourceTimestamp = Get-LatestWriteTimeUtc -RelativePaths @('tools/sync_home_sprites.js')
    $manifestTimestamp = (Get-Item $manifestPath).LastWriteTimeUtc
    if ($latestSourceTimestamp -gt $manifestTimestamp) {
        Write-Step 'Script de sprites mais novo que o manifesto local. Sincronizacao incremental sera executada.'
        return 'incremental'
    }

    try {
        $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step 'Manifesto de sprites invalido. Sincronizacao completa sera executada.'
        return 'full'
    }

    $totalFiles = 0
    $withNormal = 0
    if ($manifest -and $manifest.totals) {
        $totalFiles = [int]$manifest.totals.files
        $withNormal = [int]$manifest.totals.with_normal
    }

    if ($totalFiles -le 0 -or $withNormal -le 0) {
        Write-Step 'Manifesto de sprites incompleto. Sincronizacao completa sera executada.'
        return 'full'
    }

    Write-Step 'Cache de sprites ja esta consistente. Pulando sincronizacao.'
    return 'skip'
}

function Invoke-PostSetupGuiCleanup {
    if ($PreserveGuiBuildArtifacts -and $PreserveGuiNodeModules) {
        Write-Step 'Limpeza automatica da GUI desativada por parametros de preservacao.'
        return
    }

    if (-not (Test-Path $CleanGuiScript)) {
        Write-Step 'Script clean_gui_workspace nao encontrado. Aplicando limpeza interna de fallback.'
        if (-not $PreserveGuiBuildArtifacts) {
            Cleanup-GuiBuildArtifacts
        }
        return
    }

    $cleanupParams = @{}
    if ($PreserveGuiBuildArtifacts) {
        $cleanupParams.SkipBuildArtifacts = $true
    }
    if (-not $PreserveGuiNodeModules) {
        $cleanupParams.RemoveNodeModules = $true
    }

    Write-Step 'Executando limpeza automatica da GUI (clean_gui_workspace) ao final do setup...'
    try {
        & $CleanGuiScript @cleanupParams
    }
    catch {
        Write-Step "Aviso: falha ao executar clean_gui_workspace: $($_.Exception.Message)"
        if (-not $PreserveGuiBuildArtifacts) {
            Cleanup-GuiBuildArtifacts
        }
    }
}

function Test-GuiPackagingRequired {
    if (-not (Test-Path $InstalledGuiExe)) {
        Write-Step 'Executor GUI instalado nao encontrado. Empacotamento sera executado.'
        return $true
    }

    $installedTimestamp = (Get-Item $InstalledGuiExe).LastWriteTimeUtc
    $latestSourceTimestamp = Get-LatestWriteTimeUtc -RelativePaths @(
        'gui/main.js',
        'gui/boot_preload.js',
        'gui/preload.js',
        'gui/prolog_bridge.pl',
        'gui/package.json',
        'gui/package-lock.json',
        'gui/public',
        'prolog',
        'db',
        'engines',
        'tools/sync_home_sprites.js'
    )

    if ($latestSourceTimestamp -gt $installedTimestamp) {
        Write-Step 'Fontes da GUI mais recentes que o app instalado. Empacotamento sera executado.'
        return $true
    }

    Write-Step 'GUI instalada ja esta atualizada. Pulando empacotamento.'
    return $false
}

function Cleanup-GuiBuildArtifacts {
    if (-not (Test-Path $GuiDir)) {
        return
    }

    $artifactDirs = Get-ChildItem -Path $GuiDir -Directory -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'dist' -or
            $_.Name -eq 'dist-latest' -or
            $_.Name -eq 'dist-runtime' -or
            $_.Name -like 'dist-runtime-*'
        }

    foreach ($artifactDir in $artifactDirs) {
        try {
            Remove-Item -LiteralPath $artifactDir.FullName -Recurse -Force
            Write-Step "Artefato GUI removido: $($artifactDir.Name)"
        }
        catch {
            Write-Step "Aviso: nao foi possivel remover artefato GUI '$($artifactDir.Name)': $($_.Exception.Message)"
        }
    }
}

function Build-GuiExecutable {
    if (-not (Test-Path (Join-Path $GuiDir 'package.json'))) {
        Write-Step 'GUI nao encontrada (package.json ausente). Pulando empacotamento da GUI.'
        return
    }

    $npmCmd = $script:ResolvedNpmCmd
    if (-not $npmCmd) {
        $npmCmd = Resolve-NpmCommand -NodeCmd $script:ResolvedNodeCmd
    }
    if (-not $npmCmd) {
        throw 'npm nao disponivel para empacotamento da GUI.'
    }

    $buildOutputDir = Join-Path $env:TEMP ("pkdx-gui-build-" + [guid]::NewGuid().ToString('N'))
    $packagedGuiDir = Join-Path $buildOutputDir 'win-unpacked'
    $packagedGuiExe = Join-Path $packagedGuiDir 'Pokedex Desktop.exe'

    Write-Step 'Empacotando executavel desktop da GUI (win-unpacked) em pasta temporaria...'
    Push-Location $GuiDir
    try {
        & $npmCmd run pack:dir -- "--config.directories.output=$buildOutputDir"
        if ($LASTEXITCODE -ne 0) {
            throw 'Falha ao empacotar GUI com npm run pack:dir.'
        }

        if (-not (Test-Path $packagedGuiExe)) {
            throw "Executavel GUI nao encontrado apos build: $packagedGuiExe"
        }

        if (Test-Path $InstalledGuiDir) {
            Remove-Item -Recurse -Force $InstalledGuiDir
        }

        Copy-Item -Path $packagedGuiDir -Destination $InstalledGuiDir -Recurse -Force

        if (-not (Test-Path $InstalledGuiExe)) {
            throw "Falha ao instalar executavel GUI em: $InstalledGuiExe"
        }

        Write-Step "GUI instalada em: $InstalledGuiExe"
    }
    finally {
        Pop-Location
        if (Test-Path $buildOutputDir) {
            try {
                Remove-Item -LiteralPath $buildOutputDir -Recurse -Force
            }
            catch {
                Write-Step "Aviso: nao foi possivel remover pasta temporaria de build '$buildOutputDir': $($_.Exception.Message)"
            }
        }
    }
}

function Build-AllGenerations {
    $nodeCmd = $script:ResolvedNodeCmd
    if (-not $nodeCmd) {
        $nodeCmd = Resolve-NodeCommand
    }
    if (-not $nodeCmd) {
        throw 'Nao foi possivel localizar Node para gerar as bases.'
    }

    Write-Step 'Gerando arquivos locais das geracoes 1..9...'
    Push-Location $ProjectRoot
    try {
        & $nodeCmd .\tools\generate_generation_db.js all
        if ($LASTEXITCODE -ne 0) {
            Write-Step 'Falha na geracao com TLS padrao. Tentando fallback para rede com inspecao SSL...'
            $env:POKEDEX_INSECURE_TLS = '1'
            & $nodeCmd .\tools\generate_generation_db.js all
            Remove-Item Env:POKEDEX_INSECURE_TLS -ErrorAction SilentlyContinue
            if ($LASTEXITCODE -ne 0) {
                throw 'Falha ao gerar bases locais mesmo com fallback TLS inseguro.'
            }
        }
    }
    finally {
        Remove-Item Env:POKEDEX_INSECURE_TLS -ErrorAction SilentlyContinue
        Pop-Location
    }
}

function Build-SpriteCatalog {
    param(
        [ValidateSet('full', 'incremental')]
        [string]$Mode = 'full'
    )

    $nodeCmd = $script:ResolvedNodeCmd
    if (-not $nodeCmd) {
        $nodeCmd = Resolve-NodeCommand
    }
    if (-not $nodeCmd) {
        throw 'Nao foi possivel localizar Node para sincronizar sprites.'
    }

    $spriteArgs = @('.\tools\sync_home_sprites.js', "--output-dir=$SpriteDir", '--concurrency=12', '--forms-concurrency=16')
    if ($Mode -eq 'full') {
        $spriteArgs += '--force'
        Write-Step 'Sincronizando sprites locais em modo completo (normal + shiny, com refresh forcado)...'
    }
    else {
        $spriteArgs += '--skip-form-scan'
        Write-Step 'Sincronizando sprites locais em modo incremental rapido...'
    }

    Push-Location $ProjectRoot
    try {
        & $nodeCmd @spriteArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Step 'Falha na sincronizacao de sprites com TLS padrao. Tentando fallback para rede com inspecao SSL...'
            $env:POKEDEX_INSECURE_TLS = '1'
            & $nodeCmd @spriteArgs
            Remove-Item Env:POKEDEX_INSECURE_TLS -ErrorAction SilentlyContinue
            if ($LASTEXITCODE -ne 0) {
                throw 'Falha ao sincronizar sprites locais mesmo com fallback TLS inseguro.'
            }
        }
    }
    finally {
        Remove-Item Env:POKEDEX_INSECURE_TLS -ErrorAction SilentlyContinue
        Pop-Location
    }
}

Write-Step 'Iniciando verificacao de dependencias...'
Ensure-Dependencies

$shouldBuildGui = $false
$shouldBuildGenerations = $false
$spriteSyncMode = 'skip'

if (-not $SkipGuiPackaging) {
    $shouldBuildGui = Test-GuiPackagingRequired
}

if ($shouldBuildGui) {
    if (-not $SkipGuiDependencies) {
        Ensure-GuiDependencies
    }

    Build-GuiExecutable
}

if (-not $SkipGenerationBuild) {
    $shouldBuildGenerations = Test-GenerationBuildRequired
}

if ($shouldBuildGenerations) {
    Build-AllGenerations
}

if (-not $SkipSpriteSync) {
    $spriteSyncMode = Get-SpriteSyncMode
}

if ($spriteSyncMode -eq 'full' -or $spriteSyncMode -eq 'incremental') {
    Build-SpriteCatalog -Mode $spriteSyncMode
}

Invoke-PostSetupGuiCleanup

Write-Step 'Setup concluido com sucesso.'
Write-Step 'Para executar o bot: swipl -s prolog/pokedex_bot.pl -g start'
Write-Step "Dependencias portateis em: $PortableDir"
Write-Step "Vendor offline em: $VendorDir"
Write-Step "Executor GUI instalado em: $InstalledGuiExe"
if (-not $PreserveGuiNodeModules) {
    Write-Step 'Workspace GUI mantido leve: node_modules local removido automaticamente.'
}
