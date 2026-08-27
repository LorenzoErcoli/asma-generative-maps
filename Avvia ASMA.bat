@echo off
REM Doppio clic su Windows.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ==============================================================
  echo   Manca Node.js, che e' l'unica cosa che serve.
  echo ==============================================================
  echo.
  echo   1. Apri  https://nodejs.org
  echo   2. Scarica la versione LTS e installala ^(sempre Avanti^)
  echo   3. Chiudi questa finestra e fai di nuovo doppio clic qui
  echo.
  pause
  start "" "https://nodejs.org"
  exit /b 1
)

node "tools\avvia.mjs"
pause
