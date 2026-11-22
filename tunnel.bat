@echo off
title Cloudflare Tunnel - Trade Journal
cd /d "%~dp0"

echo ==============================================================================
echo           MENYALAKAN CLOUDFLARE TUNNEL (PUBLIC ACCESS)
echo ==============================================================================
echo.
echo Pastikan Trade Journal sudah jalan di localhost:3000 terlebih dahulu.
echo.
echo Sedang menghubungkan...
echo Salin (copy) link yang berakhiran: .trycloudflare.com
echo.
echo ==============================================================================
echo Tekan Ctrl+C untuk mematikan tunnel kapan saja.
echo ==============================================================================
echo.

if exist "%~dp0cloudflared.exe" (
    "%~dp0cloudflared.exe" tunnel --url http://localhost:3000
) else (
    echo [INFO] Mendownload cloudflared.exe otomatis...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', '%~dp0cloudflared.exe')"
    "%~dp0cloudflared.exe" tunnel --url http://localhost:3000
)

pause
