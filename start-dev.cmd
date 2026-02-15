@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0"
cd /d "%ROOT%"

start "VBAUT backend" cmd /k "cd /d ""%ROOT%backend"" && npm run dev"
start "VBAUT frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev"
start "HeadlessNotion bot" cmd /k "cd /d ""%ROOT%HeadlessNotion"" && npm start"
