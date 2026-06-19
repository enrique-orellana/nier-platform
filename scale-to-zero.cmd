@echo off
setlocal

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%scripts\scale-to-zero.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

endlocal & exit /b %EXIT_CODE%
