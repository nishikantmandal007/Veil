@echo off
set "HOST_NAME=com.privacyshield.gliner2"
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>&1
reg delete "HKCU\Software\Chromium\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>&1
echo Native host registry entries removed.
