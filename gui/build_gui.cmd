@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao encontrado no PATH.
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias da GUI...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Gerando executavel desktop (win-unpacked) com PowerShell -NoProfile -ExecutionPolicy Bypass...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '%~dp0'; npm run pack:dir"
