param(
    [switch]$SkipGenerationBuild,
    [switch]$SkipSpriteSync,
    [switch]$SkipAbilityMarkers,
    [switch]$SkipItemMarkers,
    [switch]$SkipAbilityAutoData,
    [switch]$SkipHeldItemAutoData,
    [switch]$SkipGuiDependencies,
    [switch]$SkipGuiPackaging,
    [switch]$PreserveGuiBuildArtifacts,
    [switch]$PreserveGuiNodeModules,
    [switch]$ForceGenerationBuild,
    [switch]$ForceSpriteSync,
    [switch]$ForceAbilityMarkersBuild,
    [switch]$ForceItemMarkersBuild,
    [switch]$ForceAbilityAutoDataBuild,
    [switch]$ForceHeldItemAutoDataBuild
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
$DbCatalogsDir = Join-Path $DbDir 'catalogs'
$DbGeneratedDir = Join-Path $DbDir 'generated'
$DbGenerationsDir = Join-Path $DbDir 'generations'
$DbGenerationsCoreDir = Join-Path $DbGenerationsDir 'core'
$DbGenerationsLoreDir = Join-Path $DbGenerationsDir 'lore'
$DbGenerationsEvolutionDir = Join-Path $DbGenerationsDir 'evolution'
$DbFormsDir = Join-Path $DbDir 'forms'
$DbRuntimeDir = Join-Path $DbDir 'runtime'
$DbReferencesDir = Join-Path $DbDir 'references'
$DbManualDir = Join-Path $DbDir 'manual'
$CleanGuiScript = Join-Path $PSScriptRoot 'clean_gui_workspace.ps1'
$AbilityMarkersScript = Join-Path $PSScriptRoot 'generate_ability_markers.js'
$ItemMarkersScript = Join-Path $PSScriptRoot 'generate_item_markers.js'
$AbilityAutoDataScript = Join-Path $PSScriptRoot 'generate_ability_data_auto.js'
$HeldItemAutoDataScript = Join-Path $PSScriptRoot 'generate_held_item_data_auto.js'
$AbilityDataAutoFile = Join-Path $DbGeneratedDir 'ability_data_auto.pl'
$HeldItemDataAutoFile = Join-Path $DbGeneratedDir 'held_item_data_auto.pl'
$AbilityCatalogFile = Join-Path $DbCatalogsDir 'abilities_catalog.pl'
$AbilityMarkersFile = Join-Path $DbGeneratedDir 'ability_markers.pl'
$ItemsCatalogFile = Join-Path $DbCatalogsDir 'items_catalog.pl'
$ItemMarkersFile = Join-Path $DbGeneratedDir 'item_markers.pl'
$ItemDescriptionFallbackFile = Join-Path $DbReferencesDir 'item_description_fallbacks.json'
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

    $requiredDbFiles = @('forms/special_forms.pl', 'forms/lore_special_forms.pl')
    for ($generation = 1; $generation -le 9; $generation++) {
        $requiredDbFiles += "generations/core/generation_$generation.pl"
        $requiredDbFiles += "generations/lore/lore_generation_$generation.pl"
        $requiredDbFiles += "generations/evolution/evolution_generation_$generation.pl"
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

function Test-AbilityMarkersBuildRequired {
    if ($ForceAbilityMarkersBuild) {
        Write-Step 'Forcando geracao de marcadores de abilities por parametro do usuario.'
        return $true
    }

    if (-not (Test-Path $AbilityCatalogFile)) {
        Write-Step 'abilities_catalog.pl nao encontrado. Pulando geracao de marcadores de abilities.'
        return $false
    }

    if (-not (Test-Path $AbilityMarkersScript)) {
        Write-Step 'Script generate_ability_markers.js nao encontrado. Pulando geracao de marcadores de abilities.'
        return $false
    }

    if (-not (Test-Path $AbilityMarkersFile)) {
        Write-Step 'Arquivo ability_markers.pl ausente. Geracao sera executada.'
        return $true
    }

    $latestSourceTimestamp = Get-LatestWriteTimeUtc -RelativePaths @(
        'tools/generate_ability_markers.js',
        'db/catalogs/abilities_catalog.pl'
    )
    $markersTimestamp = (Get-Item $AbilityMarkersFile).LastWriteTimeUtc

    if ($latestSourceTimestamp -gt $markersTimestamp) {
        Write-Step 'Catalogo/script de marcadores mais novo que ability_markers.pl. Geracao sera executada.'
        return $true
    }

    Write-Step 'Marcadores de abilities ja estao atualizados. Pulando geracao.'
    return $false
}

function Test-ItemMarkersBuildRequired {
    if ($ForceItemMarkersBuild) {
        Write-Step 'Forcando geracao de marcadores de itens por parametro do usuario.'
        return $true
    }

    if (-not (Test-Path $ItemsCatalogFile)) {
        Write-Step 'items_catalog.pl nao encontrado. Pulando geracao de marcadores de itens.'
        return $false
    }

    if (-not (Test-Path $ItemMarkersScript)) {
        Write-Step 'Script generate_item_markers.js nao encontrado. Pulando geracao de marcadores de itens.'
        return $false
    }

    if (-not (Test-Path $ItemMarkersFile)) {
        Write-Step 'Arquivo item_markers.pl ausente. Geracao sera executada.'
        return $true
    }

    $latestSourceTimestamp = Get-LatestWriteTimeUtc -RelativePaths @(
        'tools/generate_item_markers.js',
        'db/catalogs/items_catalog.pl',
        'db/references/item_description_fallbacks.json'
    )
    $markersTimestamp = (Get-Item $ItemMarkersFile).LastWriteTimeUtc

    if ($latestSourceTimestamp -gt $markersTimestamp) {
        Write-Step 'Catalogo/script de marcadores de itens mais novo que item_markers.pl. Geracao sera executada.'
        return $true
    }

    Write-Step 'Marcadores de itens ja estao atualizados. Pulando geracao.'
    return $false
}

function Test-AbilityAutoDataBuildRequired {
    if ($ForceAbilityAutoDataBuild) {
        Write-Step 'Forcando geracao automatica de ability_data por parametro do usuario.'
        return $true
    }

    if (-not (Test-Path $AbilityAutoDataScript)) {
        Write-Step 'Script generate_ability_data_auto.js nao encontrado. Pulando geracao automatica de ability_data.'
        return $false
    }

    if (-not (Test-Path $AbilityCatalogFile)) {
        Write-Step 'abilities_catalog.pl nao encontrado. Pulando geracao automatica de ability_data.'
        return $false
    }

    if (-not (Test-Path $AbilityMarkersFile)) {
        Write-Step 'ability_markers.pl nao encontrado. Geracao automatica aguardando geracao de marcadores.'
        return $false
    }

    if (-not (Test-Path $AbilityDataAutoFile)) {
        Write-Step 'Arquivo ability_data_auto.pl ausente. Geracao automatica sera executada.'
        return $true
    }

    $latestSourceTimestamp = Get-LatestWriteTimeUtc -RelativePaths @(
        'tools/generate_ability_data_auto.js',
        'db/generated/ability_markers.pl',
        'db/catalogs/abilities_catalog.pl'
    )
    $autoDataTimestamp = (Get-Item $AbilityDataAutoFile).LastWriteTimeUtc

    if ($latestSourceTimestamp -gt $autoDataTimestamp) {
        Write-Step 'Fontes de auto-dados mais novas que ability_data_auto.pl. Geracao automatica sera executada.'
        return $true
    }

    Write-Step 'ability_data_auto.pl ja esta atualizado. Pulando geracao automatica.'
    return $false
}

function Test-HeldItemAutoDataBuildRequired {
    if ($ForceHeldItemAutoDataBuild) {
        Write-Step 'Forcando curadoria automatica de held items por parametro do usuario.'
        return $true
    }

    if (-not (Test-Path $HeldItemAutoDataScript)) {
        Write-Step 'Script generate_held_item_data_auto.js nao encontrado. Pulando curadoria automatica de held items.'
        return $false
    }

    if (-not (Test-Path $ItemsCatalogFile)) {
        Write-Step 'items_catalog.pl nao encontrado. Pulando curadoria automatica de held items.'
        return $false
    }

    if (-not (Test-Path $ItemMarkersFile)) {
        Write-Step 'item_markers.pl nao encontrado. Curadoria automatica de held items aguardando marcadores de itens.'
        return $false
    }

    if (-not (Test-Path $HeldItemDataAutoFile)) {
        Write-Step 'Arquivo held_item_data_auto.pl ausente. Curadoria automatica de held items sera executada.'
        return $true
    }

    $latestSourceTimestamp = Get-LatestWriteTimeUtc -RelativePaths @(
        'tools/generate_held_item_data_auto.js',
        'db/generated/item_markers.pl',
        'db/catalogs/items_catalog.pl',
        'db/references/item_description_fallbacks.json'
    )
    $autoDataTimestamp = (Get-Item $HeldItemDataAutoFile).LastWriteTimeUtc

    if ($latestSourceTimestamp -gt $autoDataTimestamp) {
        Write-Step 'Fontes de held item auto data mais novas que held_item_data_auto.pl. Curadoria sera executada.'
        return $true
    }

    Write-Step 'held_item_data_auto.pl ja esta atualizado. Pulando curadoria automatica de held items.'
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

function Build-AbilityMarkers {
    $nodeCmd = $script:ResolvedNodeCmd
    if (-not $nodeCmd) {
        $nodeCmd = Resolve-NodeCommand
    }
    if (-not $nodeCmd) {
        throw 'Nao foi possivel localizar Node para gerar marcadores de abilities.'
    }

    if (-not (Test-Path $AbilityMarkersScript)) {
        Write-Step 'Script generate_ability_markers.js nao encontrado. Pulando geracao de marcadores.'
        return
    }

    Write-Step 'Gerando marcadores de abilities a partir de abilities_catalog.pl...'
    Push-Location $ProjectRoot
    try {
        & $nodeCmd .\tools\generate_ability_markers.js
        if ($LASTEXITCODE -ne 0) {
            throw 'Falha ao gerar marcadores de abilities.'
        }
    }
    finally {
        Pop-Location
    }
}

function Build-ItemMarkers {
    $nodeCmd = $script:ResolvedNodeCmd
    if (-not $nodeCmd) {
        $nodeCmd = Resolve-NodeCommand
    }
    if (-not $nodeCmd) {
        throw 'Nao foi possivel localizar Node para gerar marcadores de itens.'
    }

    if (-not (Test-Path $ItemMarkersScript)) {
        Write-Step 'Script generate_item_markers.js nao encontrado. Pulando geracao de marcadores de itens.'
        return
    }

    Write-Step 'Gerando marcadores de itens a partir de items_catalog.pl...'
    Push-Location $ProjectRoot
    try {
        & $nodeCmd .\tools\generate_item_markers.js
        if ($LASTEXITCODE -ne 0) {
            throw 'Falha ao gerar marcadores de itens.'
        }
    }
    finally {
        Pop-Location
    }
}

function Build-AbilityAutoData {
    $nodeCmd = $script:ResolvedNodeCmd
    if (-not $nodeCmd) {
        $nodeCmd = Resolve-NodeCommand
    }
    if (-not $nodeCmd) {
        throw 'Nao foi possivel localizar Node para gerar ability_data_auto.'
    }

    if (-not (Test-Path $AbilityAutoDataScript)) {
        Write-Step 'Script generate_ability_data_auto.js nao encontrado. Pulando geracao automatica de ability_data.'
        return
    }

    Write-Step 'Gerando ability_data_auto.pl a partir de ability_markers.pl...'
    Push-Location $ProjectRoot
    try {
        & $nodeCmd .\tools\generate_ability_data_auto.js
        if ($LASTEXITCODE -ne 0) {
            throw 'Falha ao gerar ability_data_auto.pl.'
        }
    }
    finally {
        Pop-Location
    }
}

function Build-HeldItemAutoData {
    $nodeCmd = $script:ResolvedNodeCmd
    if (-not $nodeCmd) {
        $nodeCmd = Resolve-NodeCommand
    }
    if (-not $nodeCmd) {
        throw 'Nao foi possivel localizar Node para gerar held_item_data_auto.'
    }

    if (-not (Test-Path $HeldItemAutoDataScript)) {
        Write-Step 'Script generate_held_item_data_auto.js nao encontrado. Pulando curadoria automatica de held items.'
        return
    }

    Write-Step 'Gerando held_item_data_auto.pl a partir de item_markers.pl...'
    Push-Location $ProjectRoot
    try {
        & $nodeCmd .\tools\generate_held_item_data_auto.js
        if ($LASTEXITCODE -ne 0) {
            throw 'Falha ao gerar held_item_data_auto.pl.'
        }
    }
    finally {
        Pop-Location
    }
}

Write-Step 'Iniciando verificacao de dependencias...'
Ensure-Dependencies

$shouldBuildGui = $false
$shouldBuildGenerations = $false
$shouldBuildAbilityMarkers = $false
$shouldBuildItemMarkers = $false
$shouldBuildAbilityAutoData = $false
$shouldBuildHeldItemAutoData = $false
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

if (-not $SkipAbilityMarkers) {
    $shouldBuildAbilityMarkers = Test-AbilityMarkersBuildRequired
}

if ($shouldBuildAbilityMarkers) {
    Build-AbilityMarkers
}

if (-not $SkipItemMarkers) {
    $shouldBuildItemMarkers = Test-ItemMarkersBuildRequired
}

if ($shouldBuildItemMarkers) {
    Build-ItemMarkers
}

if (-not $SkipAbilityAutoData) {
    $shouldBuildAbilityAutoData = Test-AbilityAutoDataBuildRequired
}

if ($shouldBuildAbilityAutoData) {
    Build-AbilityAutoData
}

if (-not $SkipHeldItemAutoData) {
    $shouldBuildHeldItemAutoData = Test-HeldItemAutoDataBuildRequired
}

if ($shouldBuildHeldItemAutoData) {
    Build-HeldItemAutoData
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
Write-Step "Marcadores de abilities em: $AbilityMarkersFile"
Write-Step "Marcadores de itens em: $ItemMarkersFile"
Write-Step "Fallback de descricoes de itens em: $ItemDescriptionFallbackFile"
Write-Step "Auto ability_data em: $AbilityDataAutoFile"
Write-Step "Auto held_item_data em: $HeldItemDataAutoFile"
if (-not $PreserveGuiNodeModules) {
    Write-Step 'Workspace GUI mantido leve: node_modules local removido automaticamente.'
}
