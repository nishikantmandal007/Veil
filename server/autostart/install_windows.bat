@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "REPO_DIR=%SCRIPT_DIR%..\.."
pushd "%REPO_DIR%"
set "REPO_DIR=%CD%"
popd

set "VENV_PYTHON=%REPO_DIR%\.venv\Scripts\python.exe"
set "SERVER_SCRIPT=%REPO_DIR%\server\gliner2_server.py"
set "TASK_NAME=PrivacyShieldGLiNER2"

if not exist "%VENV_PYTHON%" (
    echo ERROR: .venv not found. Run install_native_host_windows.bat first.
    exit /b 1
)

:: Create scheduled task to run at logon
schtasks /create /tn "%TASK_NAME%" ^
  /tr "\"%VENV_PYTHON%\" \"%SERVER_SCRIPT%\" --host 127.0.0.1 --port 8765" ^
  /sc onlogon /ru "%USERNAME%" /f >nul

if errorlevel 1 (
    echo ERROR: Failed to create scheduled task. Try running as Administrator.
    exit /b 1
)

echo Scheduled task created: %TASK_NAME%
echo The GLiNER2 server will start automatically at next login.
echo.
echo To start it now (in a new window):
echo   start "" "%VENV_PYTHON%" "%SERVER_SCRIPT%" --host 127.0.0.1 --port 8765
endlocal
