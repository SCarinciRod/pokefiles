param(
    [switch]$SkipGenerationBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$UserBaseDir = Join-Path $env:LOCALAPPDATA 'PokedexChatbot'
$VendorDir = Join-Path $UserBaseDir 'vendor'
$PortableDir = Join-Path $UserBaseDir 'portable'
$PortableNodeDir = Join-Path $PortableDir 'node'
$PortableSwiplDir = Join-Path $PortableDir 'swipl'
$PortableNodeExe = Join-Path $PortableNodeDir 'node.exe'
$PortableSwiplExe = Join-Path (Join-Path $PortableSwiplDir 'bin') 'swipl.exe'

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
    if (Get-Command node -ErrorAction SilentlyContinue) { return 'node' }
    $scoopNode = Join-Path $env:LOCALAPPDATA 'scoop\shims\node.exe'
    if (Test-Path $scoopNode) { return $scoopNode }
    if (Test-Path $PortableNodeExe) { return $PortableNodeExe }
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
    Ensure-Dir $PortableDir
    Ensure-Dir $VendorDir

    $nodeCmd = Resolve-NodeCommand
    if (-not $nodeCmd) {
        if (-not (Try-InstallNodeFromVendor)) {
            Write-Step 'Node nao encontrado localmente. Tentando instalacao portable via Scoop...'
            Ensure-Scoop
            scoop install nodejs-lts
        }
        $nodeCmd = Resolve-NodeCommand
    }

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

    Write-Step "Node OK: $nodeCmd"
    Write-Step "SWI-Prolog OK: $swiplCmd"
    Write-Step "Base de usuario: $UserBaseDir"
}

function Build-AllGenerations {
    $nodeCmd = Resolve-NodeCommand
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

Write-Step 'Iniciando verificacao de dependencias...'
Ensure-Dependencies

if (-not $SkipGenerationBuild) {
    Build-AllGenerations
}

Write-Step 'Setup concluido com sucesso.'
Write-Step 'Para executar o bot: swipl -s pokedex_bot.pl -g start'
Write-Step "Dependencias portateis em: $PortableDir"
Write-Step "Vendor offline em: $VendorDir"
