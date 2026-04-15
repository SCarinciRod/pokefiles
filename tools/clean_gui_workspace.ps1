param(
    [switch]$RemoveNodeModules,
    [switch]$SkipBuildArtifacts,
    [int]$MaxRemoveAttempts = 6,
    [int]$RetryDelayMilliseconds = 600,
    [switch]$ScheduleLockedDeletionOnReboot = $true
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$GuiDir = Join-Path $ProjectRoot 'gui'

function Write-Step([string]$Message) {
    Write-Host "[clean-gui] $Message" -ForegroundColor Cyan
}

function Get-DirSizeBytes([string]$Path) {
    if (-not (Test-Path $Path)) {
        return 0
    }

    $bytes = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum

    if (-not $bytes) {
        $bytes = 0
    }

    return [double]$bytes
}

function Format-Size([double]$Bytes) {
    if ($Bytes -ge 1GB) {
        return ('{0:N2} GB' -f ($Bytes / 1GB))
    }

    if ($Bytes -ge 1MB) {
        return ('{0:N2} MB' -f ($Bytes / 1MB))
    }

    if ($Bytes -ge 1KB) {
        return ('{0:N2} KB' -f ($Bytes / 1KB))
    }

    return ('{0:N0} B' -f $Bytes)
}

function Ensure-MoveFileExInterop {
    if ('PokedexChatbot.NativeMethods' -as [type]) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace PokedexChatbot {
    public static class NativeMethods {
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, int dwFlags);
    }
}
"@
}

function Queue-DeleteOnReboot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not $ScheduleLockedDeletionOnReboot) {
        return [PSCustomObject]@{
            Queued = $false
            Message = ''
        }
    }

    if (-not (Test-Path $Path)) {
        return [PSCustomObject]@{
            Queued = $false
            Message = ''
        }
    }

    Ensure-MoveFileExInterop

    $queuedAny = $false
    $errors = New-Object System.Collections.Generic.List[string]
    $moveFileExDelayUntilReboot = 0x4

    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } -Descending)
    foreach ($file in $files) {
        $queued = [PokedexChatbot.NativeMethods]::MoveFileEx($file.FullName, $null, $moveFileExDelayUntilReboot)
        if ($queued) {
            $queuedAny = $true
        }
        else {
            $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            $errors.Add("$($file.FullName) (Win32=$errorCode)") | Out-Null
        }
    }

    $directories = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } -Descending)
    $rootDir = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($rootDir) {
        $directories += $rootDir
    }

    foreach ($directory in $directories) {
        $queued = [PokedexChatbot.NativeMethods]::MoveFileEx($directory.FullName, $null, $moveFileExDelayUntilReboot)
        if ($queued) {
            $queuedAny = $true
        }
        else {
            $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            if ($errorCode -ne 2) {
                $errors.Add("$($directory.FullName) (Win32=$errorCode)") | Out-Null
            }
        }
    }

    if ($queuedAny -and $errors.Count -eq 0) {
        return [PSCustomObject]@{
            Queued = $true
            Message = "$Label foi agendado para exclusao no proximo boot."
        }
    }

    if ($queuedAny -and $errors.Count -gt 0) {
        return [PSCustomObject]@{
            Queued = $true
            Message = "$Label foi parcialmente agendado para exclusao no boot. Pendencias: $($errors.Count)"
        }
    }

    return [PSCustomObject]@{
        Queued = $false
        Message = "Nao foi possivel agendar exclusao no reboot para $Label."
    }
}

function Register-UserRunOnceCleanup {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Paths,
        [string]$RunOnceName = 'PokedexChatbotGuiCleanup'
    )

    $uniquePaths = $Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
    if (-not $uniquePaths -or $uniquePaths.Count -eq 0) {
        return [PSCustomObject]@{
            Registered = $false
            Message = ''
        }
    }

    try {
        $localAppData = $env:LOCALAPPDATA
        if (-not $localAppData) {
            throw 'LOCALAPPDATA nao disponivel para configurar fallback RunOnce.'
        }

        $cleanupDir = Join-Path (Join-Path $localAppData 'PokedexChatbot') 'cleanup'
        New-Item -ItemType Directory -Path $cleanupDir -Force | Out-Null

        $cleanupScript = Join-Path $cleanupDir 'clean_gui_locked.ps1'
        $pathLiterals = $uniquePaths | ForEach-Object {
            $escaped = $_ -replace "'", "''"
            "    '$escaped'"
        }

        $cleanupScriptLines = @(
            '$ErrorActionPreference = ''SilentlyContinue'''
            '$targets = @('
        ) + $pathLiterals + @(
            ')'
            ''
            'foreach ($target in $targets) {'
            '    if (Test-Path -LiteralPath $target) {'
            '        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue'
            '    }'
            '}'
        )

        Set-Content -LiteralPath $cleanupScript -Value $cleanupScriptLines -Encoding UTF8

        $runOnceKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
        $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$cleanupScript`""

        New-Item -Path $runOnceKey -Force | Out-Null
        Set-ItemProperty -Path $runOnceKey -Name $RunOnceName -Value $command

        return [PSCustomObject]@{
            Registered = $true
            Message = "fallback RunOnce configurado para remover residuos no proximo logon (script: $cleanupScript)."
        }
    }
    catch {
        return [PSCustomObject]@{
            Registered = $false
            Message = $_.Exception.Message
        }
    }
}

function Remove-PathWithRetry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not (Test-Path $Path)) {
        return [PSCustomObject]@{
            Removed = $false
            Missing = $true
            Message = ''
        }
    }

    $lastError = ''
    for ($attempt = 1; $attempt -le $MaxRemoveAttempts; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force
            return [PSCustomObject]@{
                Removed = $true
                Missing = $false
                Message = ''
            }
        }
        catch {
            $lastError = $_.Exception.Message
            if ($attempt -lt $MaxRemoveAttempts) {
                Start-Sleep -Milliseconds $RetryDelayMilliseconds
            }
        }
    }

    return [PSCustomObject]@{
        Removed = $false
        Missing = $false
        Message = $lastError
    }
}

if (-not (Test-Path $GuiDir)) {
    throw "Diretorio GUI nao encontrado: $GuiDir"
}

$beforeBytes = Get-DirSizeBytes -Path $GuiDir
Write-Step "Tamanho da GUI antes da limpeza: $(Format-Size $beforeBytes)"

$removed = New-Object System.Collections.Generic.List[string]
$failed = New-Object System.Collections.Generic.List[string]
$queued = New-Object System.Collections.Generic.List[string]
$runOnceTargets = New-Object System.Collections.Generic.List[pscustomobject]

if (-not $SkipBuildArtifacts) {
    $artifactDirs = Get-ChildItem -Path $GuiDir -Directory -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'dist' -or
            $_.Name -eq 'dist-latest' -or
            $_.Name -eq 'dist-runtime' -or
            $_.Name -like 'dist-runtime-*'
        }

    foreach ($artifact in $artifactDirs) {
        $result = Remove-PathWithRetry -Path $artifact.FullName -Label $artifact.Name
        if ($result.Removed) {
            $removed.Add($artifact.Name) | Out-Null
        }
        elseif (-not $result.Missing) {
            $queueResult = Queue-DeleteOnReboot -Path $artifact.FullName -Label $artifact.Name
            if ($queueResult.Queued) {
                $queued.Add("$($artifact.Name): $($queueResult.Message)") | Out-Null
            }
            else {
                $runOnceTargets.Add([PSCustomObject]@{
                    Label = $artifact.Name
                    Path = $artifact.FullName
                    Failure = $result.Message
                    QueueFailure = $queueResult.Message
                }) | Out-Null
            }
        }
    }
}

if ($RemoveNodeModules) {
    $nodeModulesDir = Join-Path $GuiDir 'node_modules'
    $result = Remove-PathWithRetry -Path $nodeModulesDir -Label 'node_modules'
    if ($result.Removed) {
        $removed.Add('node_modules') | Out-Null
    }
    elseif (-not $result.Missing) {
        $queueResult = Queue-DeleteOnReboot -Path $nodeModulesDir -Label 'node_modules'
        if ($queueResult.Queued) {
            $queued.Add("node_modules: $($queueResult.Message)") | Out-Null
        }
        else {
            $runOnceTargets.Add([PSCustomObject]@{
                Label = 'node_modules'
                Path = $nodeModulesDir
                Failure = $result.Message
                QueueFailure = $queueResult.Message
            }) | Out-Null
        }
    }
}

if ($runOnceTargets.Count -gt 0) {
    $runOnceResult = Register-UserRunOnceCleanup -Paths ($runOnceTargets | ForEach-Object { $_.Path })
    if ($runOnceResult.Registered) {
        foreach ($target in $runOnceTargets) {
            $queued.Add("$($target.Label): $($runOnceResult.Message)") | Out-Null
        }
    }
    else {
        foreach ($target in $runOnceTargets) {
            $failed.Add("$($target.Label): $($target.Failure) | $($target.QueueFailure) | fallback RunOnce falhou: $($runOnceResult.Message)") | Out-Null
        }
    }
}

$afterBytes = Get-DirSizeBytes -Path $GuiDir
$freedBytes = [math]::Max(0, $beforeBytes - $afterBytes)

if ($removed.Count -gt 0) {
    Write-Step "Itens removidos: $($removed -join ', ')"
}
else {
    Write-Step 'Nenhum artefato para remover.'
}

if ($failed.Count -gt 0) {
    Write-Step 'Itens nao removidos (provavel arquivo em uso):'
    foreach ($failure in $failed) {
        Write-Step " - $failure"
    }
}

if ($queued.Count -gt 0) {
    Write-Step 'Itens agendados para exclusao no proximo boot:'
    foreach ($entry in $queued) {
        Write-Step " - $entry"
    }
}

Write-Step "Tamanho da GUI depois da limpeza: $(Format-Size $afterBytes)"
Write-Step "Espaco liberado: $(Format-Size $freedBytes)"
