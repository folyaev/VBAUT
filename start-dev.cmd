@echo off
setlocal
cd /d "%~dp0"

start "VBAUT backend" cmd /k "cd /d \"%~dp0backend\" && npm run dev"
start "VBAUT frontend" cmd /k "cd /d \"%~dp0frontend\" && npm run dev"
