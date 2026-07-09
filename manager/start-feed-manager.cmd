@echo off
REM Double-click launcher for the Announcement Feed Manager (Windows).
REM First run installs dependencies; subsequent runs just start the tool and
REM open it in your browser. Close this window to stop the tool.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found on your PATH.
  echo Install the LTS version from https://nodejs.org/ then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies. This can take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo Starting the Feed Manager - a browser tab will open at http://localhost:4318
echo Leave this window open while you use it; close it to stop.
echo.
call npm run dev
