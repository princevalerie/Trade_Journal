@echo off
REM ==============================================================================
REM Trade Journal Windows Launcher
REM Usage: journal [command] or double click to open menu
REM ==============================================================================

cd /d "%~dp0"
node journal.js %*
