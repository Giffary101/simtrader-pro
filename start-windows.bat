@echo off
title SimTrader Pro - Launcher (Golang Backend + TypeScript Frontend)
echo ===============================================================================
echo   SIMTRADER PRO - ALGORITHMIC TRADING SYSTEM LAUNCHER
echo ===============================================================================
echo.

echo [1/2] Menyiapkan dan menjalankan Backend Golang di port 8080...
start "SimTrader Golang Backend" cmd /k "cd /d "%~dp0backend" && go mod tidy && go run main.go"

echo [2/2] Menyiapkan dan menjalankan Frontend React TypeScript di port 5173...
start "SimTrader TS Frontend" cmd /k "cd /d "%~dp0frontend" && npm install && npm run dev"

echo.
echo Server sedang dinyalakan di jendela terminal baru!
echo Silakan buka browser Anda di: http://localhost:5173
echo ===============================================================================
pause
