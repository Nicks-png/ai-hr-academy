@echo off
title AI-HR Academy
echo.
echo  ==========================================
echo   AI-HR Academy — Iniciando...
echo  ==========================================
echo.

:: Inicia o servidor Node em janela separada
start "Servidor AI-HR" cmd /k "cd /d %~dp0 && node server.js"

:: Aguarda 3 segundos para o servidor subir
timeout /t 3 /nobreak >nul

:: Inicia o tunel Cloudflare em janela separada
start "Tunel Cloudflare" cmd /k "\"C:\Program Files (x86)\cloudflared\cloudflared.exe\" tunnel --url http://localhost:3000"

echo  Servidor:  http://localhost:3000
echo  Aguarde a URL publica aparecer na janela do Cloudflare...
echo.
echo  Pressione qualquer tecla para fechar esta janela.
pause >nul
