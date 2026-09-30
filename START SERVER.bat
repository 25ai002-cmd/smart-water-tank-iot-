@echo off
title Smart Water Tank Monitor — Server
color 1F
cls

echo.
echo  ====================================================
echo    💧  Smart Water Tank Monitor
echo    IoT Dashboard Server — Semester 3 Project
echo  ====================================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 4F
    echo  [ERROR] Node.js is NOT installed.
    echo.
    echo  Please install Node.js from:  https://nodejs.org
    echo  Download the LTS version and run the installer.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  Node.js found: %NODE_VER%
echo.

:: Install packages inside backend/ folder if not already done
if not exist "backend\node_modules" (
    echo  Installing packages - first-time setup...
    echo  Please wait — this takes about 1 minute.
    echo.
    cd backend
    call npm install
    if %errorlevel% neq 0 (
        color 4F
        echo.
        echo  [ERROR] npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
    cd ..
    echo.
    echo  Setup complete!
    echo.
)

:: Get the WiFi IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set RAW_IP=%%a
)
:: Trim leading space
for /f "tokens=1" %%b in ("%RAW_IP%") do set LOCAL_IP=%%b

:: Free port 3000 if already occupied by an old instance
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)

:: Start server
echo  Starting server...
echo.
echo  ====================================================
echo   LOCAL  (this PC)       :  http://localhost:3000
echo   NETWORK (Same WiFi)    :  http://%LOCAL_IP%:3000
echo  ====================================================
echo.
echo   📱 OPEN ON PHONE (Same WiFi):
echo      http://%LOCAL_IP%:3000
echo.
echo   🌐 WORLDWIDE REMOTE ACCESS (4G / 5G / Outside WiFi):
echo      The server will generate a secure public HTTPS link below!
echo.
echo   🔧 HARDWARE SYNC URL for NodeMCU .ino file:
echo      http://%LOCAL_IP%:3000/api/sensor
echo.
echo  ====================================================
echo   Press Ctrl+C to stop the server.
echo  ====================================================
echo.

node backend\server.js

:: If server exits
echo.
color 4F
echo  Server stopped.
pause
