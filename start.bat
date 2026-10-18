@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo   Family Kanban  -  local start (no Docker required)
echo ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH.
    echo         Install Node.js 20 or newer, then run this file again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found in PATH.
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo [1/3] Installing server dependencies ...
    call npm --prefix server install --no-audit --no-fund
    if errorlevel 1 goto fail
) else (
    echo [1/3] Server dependencies OK
)

if not exist "web\node_modules" (
    echo [2/3] Installing web dependencies ...
    call npm --prefix web install --no-audit --no-fund
    if errorlevel 1 goto fail
) else (
    echo [2/3] Web dependencies OK
)

if not exist "web\dist\index.html" (
    echo [3/3] Building frontend ...
    call npm --prefix web run build
    if errorlevel 1 goto fail
) else (
    echo [3/3] Frontend already built
)

echo.
echo ----------------------------------------------------------
echo  Starting server on port 12333
echo  This PC     : http://localhost:12333
echo  Tablet      : http://THIS-PC-LAN-IP:12333   (see the IP printed below)
echo  Stop        : press Ctrl+C
echo ----------------------------------------------------------
echo.

node server\src\index.js
goto end

:fail
echo.
echo [ERROR] Setup failed. Check the messages above.
pause
exit /b 1

:end
echo.
echo Server stopped.
pause
