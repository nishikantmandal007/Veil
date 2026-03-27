@echo off
setlocal
for %%H in ("com.veil.gliner.server" "com.privacyshield.gliner2") do (
    reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\%%~H" /f >nul 2>&1
    reg delete "HKCU\Software\Chromium\NativeMessagingHosts\%%~H" /f >nul 2>&1
    reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%%~H" /f >nul 2>&1
    del "%~dp0%%~H.json" >nul 2>&1
)
echo Veil native host registry entries removed.
endlocal
