@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo   Family Kanban  -  development mode
echo ==========================================================
echo  API   : http://localhost:12333
echo  Web   : http://localhost:5173   (hot reload, proxies /api)
echo ==========================================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found in PATH.
    pause
    exit /b 1
)

if not exist "node_modules" (
    call npm install --no-audit --no-fund
    if errorlevel 1 goto fail
)
if not exist "server\node_modules" (
    call npm --prefix server install --no-audit --no-fund
    if errorlevel 1 goto fail
)
if not exist "web\node_modules" (
    call npm --prefix web install --no-audit --no-fund
    if errorlevel 1 goto fail
)

call npm run dev
goto end

:fail
echo.
echo [ERROR] Setup failed. Check the messages above.
pause
exit /b 1

:end
pause
