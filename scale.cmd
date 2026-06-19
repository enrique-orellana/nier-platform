@echo off
setlocal

if "%~1"=="" (
    echo Usage: scale.cmd ^<up^|down^>
    exit /b 1
)

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%scripts\scale.ps1" -Action "%~1" %2 %3 %4 %5 %6 %7 %8 %9
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

endlocal & exit /b %EXIT_CODE%
