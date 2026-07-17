@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-web-agents-roundtable.ps1" %*
exit /b %ERRORLEVEL%
