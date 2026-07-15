@echo off
REM 一鍵發布：重新加密 docs/ 並推上 GitHub Pages
setlocal

set NODE=E:\dev\node\node.exe

echo [1/3] 產生加密靜態網站...
"%NODE%" "%~dp0build-static.js"
if errorlevel 1 (
  echo build 失敗，中止。
  exit /b 1
)

echo [2/3] 提交變更...
git -C "%~dp0" add -A
git -C "%~dp0" commit -m "data: update flight prices"

echo [3/3] 推送到 GitHub...
git -C "%~dp0" push

echo.
echo 完成！GitHub Pages 將在 1 分鐘內更新。
endlocal
