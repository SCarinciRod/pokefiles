@echo off
setlocal

chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "PORTABLE_SWIPL=%LOCALAPPDATA%\PokedexChatbot\portable\swipl\bin\swipl.exe"
set "LEGACY_PORTABLE_SWIPL=%SCRIPT_DIR%.portable\swipl\bin\swipl.exe"

if exist "%PORTABLE_SWIPL%" (
  "%PORTABLE_SWIPL%" -s "%SCRIPT_DIR%pokedex_bot.pl" -g start
) else if exist "%LEGACY_PORTABLE_SWIPL%" (
  "%LEGACY_PORTABLE_SWIPL%" -s "%SCRIPT_DIR%pokedex_bot.pl" -g start
) else (
  swipl -s "%SCRIPT_DIR%pokedex_bot.pl" -g start
)

endlocal
