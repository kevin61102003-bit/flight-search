@echo off
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im ngrok.exe >nul 2>&1

start "Flight Search Server" /min "E:\dev\node\node.exe" "E:\dev\flight-search\server.js"
start "ngrok" /min "E:\dev\ngrok\ngrok.exe" http 3000

timeout /t 4 /nobreak >nul

start "" "http://localhost:3000"
start "" "http://localhost:4040"
