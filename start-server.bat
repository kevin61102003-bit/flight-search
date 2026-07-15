@echo off
taskkill /f /im node.exe >nul 2>&1

start "Flight Search Server" /min "E:\dev\node\node.exe" "E:\dev\flight-search\server.js"

timeout /t 3 /nobreak >nul

start "" "http://localhost:3000"
