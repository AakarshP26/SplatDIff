@echo off
rem SplatDiff one-click launcher (Windows).
rem If web\data exists it is served directly with Python.
rem Otherwise the build runs inside WSL, which provides gcc and make.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8765

if exist "web\data\manifest.json" goto serve

where wsl >nul 2>nul
if errorlevel 1 (
  echo ERROR: viewer data is missing and WSL was not found.
  echo Install WSL with "wsl --install", or copy a built web\data folder here.
  pause
  exit /b 1
)
echo First run: building viewer data inside WSL. This takes a few minutes.
wsl bash -c "PORT=%PORT% bash start.sh"
exit /b %errorlevel%

:serve
set PY=python
where python >nul 2>nul
if errorlevel 1 set PY=py
where %PY% >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python 3 not found. Install it from python.org.
  pause
  exit /b 1
)
echo SplatDiff is running at http://localhost:%PORT%/ (close this window to stop)
start "" "http://localhost:%PORT%/"
%PY% -m http.server %PORT% --bind 127.0.0.1 --directory web
