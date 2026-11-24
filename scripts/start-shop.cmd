@echo off
cd /d "%~dp0.."
set "NEXT_TELEMETRY_DISABLED=1"
echo Open http://127.0.0.1:3000 after the server reports Ready.
echo Keep this window open while using the application. Press Ctrl+C to stop.
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" scripts\start.mjs
) else (
  node scripts\start.mjs
)
pause
