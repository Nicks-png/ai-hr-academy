@echo off
title AI-HR Academy
chcp 65001 >nul
color 0A

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║         AI-HR Academy  —  Iniciando      ║
echo  ╚══════════════════════════════════════════╝
echo.

:: Verifica se o Node está instalado
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] Node.js nao encontrado. Instale em nodejs.org
    pause
    exit /b 1
)

:: Verifica se o cloudflared está instalado
if not exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" (
    echo  [ERRO] Cloudflared nao encontrado em C:\Program Files (x86)\cloudflared\
    pause
    exit /b 1
)

echo  [1/2] Iniciando servidor...
start "AI-HR — Servidor" cmd /k "cd /d %~dp0 && node server.js"

timeout /t 4 /nobreak >nul

echo  [2/2] Abrindo acesso remoto (Cloudflare Tunnel)...
echo.
echo  ┌─────────────────────────────────────────────────────────────┐
echo  │  Aguarde o link publico aparecer na janela "AI-HR Tunnel"   │
echo  │  O link começa com: https://...trycloudflare.com            │
echo  │                                                             │
echo  │  Copie e envie esse link para a cliente acessar.            │
echo  └─────────────────────────────────────────────────────────────┘
echo.

start "AI-HR — Tunnel" powershell -NoExit -Command ^
  "Write-Host '' ; Write-Host '  Aguarde o link abaixo...' -ForegroundColor Cyan ; Write-Host '' ; & 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://localhost:3000"

echo.
echo  Servidor local:  http://localhost:3000
echo.
echo  Para encerrar tudo, feche as janelas 'AI-HR Servidor' e 'AI-HR Tunnel'.
echo.
pause >nul
