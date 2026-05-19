@echo off
title AI-HR Academy
echo.
echo  AI-HR Academy - Iniciando...
echo.
start "AI-HR Servidor" cmd /k "cd /d C:\Users\nicol\ai-hr-academy && node server.js"
timeout /t 3 /nobreak >nul
start "AI-HR Tunnel" powershell -NoExit -Command "& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://localhost:3000"
echo.
echo  Servidor: http://localhost:3000
echo  Aguarde a URL publica na janela AI-HR Tunnel
echo.
pause
