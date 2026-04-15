$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SetupSource = Join-Path $PSScriptRoot 'launchers\setup_launcher.cs'
$RunGuiSource = Join-Path $PSScriptRoot 'launchers\run_gui_launcher.cs'
$SetupExe = Join-Path $ProjectRoot 'setup.exe'
$RunGuiExe = Join-Path $ProjectRoot 'run_gui.exe'

if (-not (Test-Path $SetupSource)) {
    throw "Arquivo fonte nao encontrado: $SetupSource"
}

if (-not (Test-Path $RunGuiSource)) {
    throw "Arquivo fonte nao encontrado: $RunGuiSource"
}

Add-Type -TypeDefinition (Get-Content -Path $SetupSource -Raw) -Language CSharp -OutputAssembly $SetupExe -OutputType ConsoleApplication

Add-Type -TypeDefinition (Get-Content -Path $RunGuiSource -Raw) -Language CSharp -OutputAssembly $RunGuiExe -OutputType WindowsApplication -ReferencedAssemblies @('System.Windows.Forms.dll', 'System.Drawing.dll')

Write-Host "Launchers compilados com sucesso:" -ForegroundColor Green
Write-Host " - $SetupExe"
Write-Host " - $RunGuiExe"
