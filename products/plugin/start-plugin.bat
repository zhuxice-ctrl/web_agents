@echo off
setlocal
chcp 65001 >nul
set "PRODUCT_ROOT=%~dp0"
pushd "%PRODUCT_ROOT%" >nul
node "%PRODUCT_ROOT%services\start-plugin-services.mjs"
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul
exit /b %EXIT_CODE%
