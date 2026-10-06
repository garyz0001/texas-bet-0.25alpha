@echo off
chcp 65001 > nul
cd /d "%~dp0"
where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo   ???? Node.js?
  echo   ?? https://nodejs.org ???? LTS ?????????
  echo.
  pause
  exit /b 1
)
node serve.js
pause