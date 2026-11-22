@echo off
REM ==============================================================================
REM Trade Journal Windows Launcher (CLI & Interactive Menu)
REM ==============================================================================
REM Usage:
REM   Double click to open Interactive Menu
REM   journal start       - Run server in background
REM   journal update      - Auto-pull from GitHub + rebuild + restart
REM   journal stop        - Stop server
REM   journal status      - Check status
REM   journal logs        - View realtime logs
REM ==============================================================================

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terinstall di Windows ini.
    echo Silakan download dan install Node.js 22 LTS dari https://nodejs.org
    pause
    exit /b 1
)

node journal.js %*

if "%~1"=="" (
    rem If double-clicked without arguments, pause before closing
    rem pause
)
