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

call npm run start
