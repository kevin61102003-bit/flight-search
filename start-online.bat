@echo off
REM 掛著給外網用：開 server(3000) + ngrok 通道。本機純內網請用 start-server.bat。
setlocal enabledelayedexpansion

set NODE=E:\dev\node\node.exe
set NGROK=E:\dev\ngrok\ngrok.exe

REM 關掉舊的 node，避免佔用 3000
taskkill /f /im node.exe >nul 2>&1

echo [1/3] 啟動 server...
start "Flight Search Server" /min "%NODE%" "%~dp0server.js"
timeout /t 3 /nobreak >nul

REM 固定網域：把網域寫在 .ngrok-domain 第一行（例：my-flight.ngrok-free.app）。
REM 沒有這個檔就退回隨機網址。
set DOMAIN=
if exist "%~dp0.ngrok-domain" set /p DOMAIN=<"%~dp0.ngrok-domain"

echo [2/3] 啟動 ngrok...
if defined DOMAIN (
  start "ngrok" "%NGROK%" http 3000 --url=!DOMAIN!
  echo     外網網址: https://!DOMAIN!
) else (
  start "ngrok" "%NGROK%" http 3000
  echo     未設固定網域，改用隨機網址，請到 http://localhost:4040 查看
)
timeout /t 3 /nobreak >nul

echo [3/3] 開啟控制台與本機介面...
start "" "http://localhost:4040"
start "" "http://localhost:3000"

echo.
echo 完成。外網進來會要求密碼（.viewer-password）；本機 localhost 免密碼。
endlocal
