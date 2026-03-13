@echo off
echo Killing existing process on port 3002...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3002') do taskkill /f /pid %%a 2>nul
timeout /t 1 >nul
cd /d "%~dp0"
echo Starting server...
set PORT=3002
start "" http://localhost:3002
"C:\Program Files\nodejs\node.exe" app.js
pause
