@echo off
schtasks /delete /tn "PrivacyShieldGLiNER2" /f >nul 2>&1
if errorlevel 1 (
    echo Task PrivacyShieldGLiNER2 not found.
) else (
    echo Removed scheduled task: PrivacyShieldGLiNER2
)
