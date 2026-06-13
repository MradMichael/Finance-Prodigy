@echo off
title ESSA API Server — localhost:4000
cd /d "%~dp0"
echo.
echo  Starting ESSA API server on http://localhost:4000
echo  Press Ctrl+C to stop.
echo.
node node_modules\ts-node-dev\lib\bin.js --transpile-only --respawn src/index.ts
pause
