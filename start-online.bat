@echo off
REM Online mode: server(3000) + ngrok tunnel for external access.
REM For local-only use, run start-server.bat instead.
REM NOTE: keep this file ASCII-only. cmd reads .bat in the system codepage,
REM so non-ASCII comments/echoes get garbled and break parsing.
setlocal
title Flight Search - ONLINE (ngrok)

set NODE=E:\dev\node\node.exe
set NGROK=E:\dev\ngrok\ngrok.exe

echo [1/3] Stopping old node / ngrok...
taskkill /f /im node.exe  >nul 2>&1
taskkill /f /im ngrok.exe >nul 2>&1

echo [2/3] Starting server on port 3000...
start "Flight Search Server" /min "%NODE%" "%~dp0server.js"
timeout /t 3 /nobreak >nul

REM Fixed domain: put it on the first line of .ngrok-domain
REM (e.g. my-flight.ngrok-free.app). No file = random URL.
set DOMAIN=
if exist "%~dp0.ngrok-domain" set /p DOMAIN=<"%~dp0.ngrok-domain"

echo [3/3] Starting ngrok tunnel...
if defined DOMAIN (
  echo      Public URL: https://%DOMAIN%
  start "ngrok" cmd /k "%NGROK% http 3000 --url=%DOMAIN%"
) else (
  echo      No fixed domain set. Using random URL, see http://localhost:4040
  start "ngrok" cmd /k "%NGROK% http 3000"
)
timeout /t 4 /nobreak >nul

echo Opening ngrok console + local UI...
start "" "http://localhost:4040"
start "" "http://localhost:3000"

echo.
echo Done. External visitors need the password (.viewer-password). localhost is free.
echo The "ngrok" window shows Session Status: online = tunnel is UP.
echo Close that ngrok window = tunnel goes DOWN.
endlocal
