@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    echo Usage: install_native_host_windows.bat ^<extension_id^>
    echo Example: install_native_host_windows.bat abcdefghijklmnopqrstuvwxyz123456
    exit /b 1
)

set "EXTENSION_ID=%~1"
set "SCRIPT_DIR=%~dp0"
set "REPO_DIR=%SCRIPT_DIR%..\.."

:: Resolve absolute path
pushd "%REPO_DIR%"
set "REPO_DIR=%CD%"
popd

set "HOST_NAME=com.veil.gliner.server"
set "LEGACY_HOST_NAME=com.privacyshield.gliner2"
set "HOST_SCRIPT=%REPO_DIR%\server\native_host.py"
set "LAUNCHER=%REPO_DIR%\server\native-host\native_host_win.bat"
set "MANIFEST=%REPO_DIR%\server\native-host\%HOST_NAME%.json"
set "LEGACY_MANIFEST=%REPO_DIR%\server\native-host\%LEGACY_HOST_NAME%.json"
set "VENV_PYTHON=%REPO_DIR%\.venv\Scripts\python.exe"
set "RUNTIME_DIR=%REPO_DIR%\.runtime"

if not exist "%VENV_PYTHON%" (
    echo ERROR: Veil managed runtime not found at %VENV_PYTHON%
    echo Run the Veil installer first so uv can provision the local runtime.
    exit /b 1
)

:: Create runtime dirs
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
if not exist "%RUNTIME_DIR%\cache" mkdir "%RUNTIME_DIR%\cache"
if not exist "%RUNTIME_DIR%\gliner2_server.log" type nul > "%RUNTIME_DIR%\gliner2_server.log"

:: Create Windows launcher script (Chrome requires executable, not .py)
(
echo @echo off
echo "%VENV_PYTHON%" "%HOST_SCRIPT%"
) > "%LAUNCHER%"

del "%LEGACY_MANIFEST%" >nul 2>&1

:: Escape backslashes for JSON
set "LAUNCHER_JSON=%LAUNCHER:\=\\%"

:: Write native host manifest
(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "Veil GLiNER Server Native Host",
echo   "path": "%LAUNCHER_JSON%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXTENSION_ID%/"
echo   ]
echo }
) > "%MANIFEST%"

reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\%LEGACY_HOST_NAME%" /f >nul 2>&1
reg delete "HKCU\Software\Chromium\NativeMessagingHosts\%LEGACY_HOST_NAME%" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%LEGACY_HOST_NAME%" /f >nul 2>&1

:: Register for Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
echo Registered for Chrome.

:: Register for Chromium
reg add "HKCU\Software\Chromium\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
echo Registered for Chromium.

:: Register for Edge (Chromium-based)
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
echo Registered for Microsoft Edge.

echo.
echo Native host installed for extension: %EXTENSION_ID%
echo Manifest:  %MANIFEST%
echo Launcher:  %LAUNCHER%
echo.
echo Next step: run install_autostart_windows.bat to register Veil autostart at login.
endlocal
