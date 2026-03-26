function Uninstall-Veil {
    param(
        [string]$InstallDir = $env:VEIL_INSTALL_DIR
    )

    if ([string]::IsNullOrWhiteSpace($InstallDir)) {
        $InstallDir = Join-Path $env:LOCALAPPDATA "Veil"
    }

    if (-not (Test-Path -LiteralPath $InstallDir)) {
        Write-Host "Veil local server is not installed at $InstallDir."
        return
    }

    Write-Host "Removing Veil local server from $InstallDir..."

    $nativeHostUninstall = Join-Path $InstallDir "server\native-host\uninstall_windows.bat"
    $autostartUninstall = Join-Path $InstallDir "server\autostart\uninstall_windows.bat"

    if (Test-Path -LiteralPath $autostartUninstall) {
        & $autostartUninstall
    }
    if (Test-Path -LiteralPath $nativeHostUninstall) {
        & $nativeHostUninstall
    }

    Remove-Item -LiteralPath $InstallDir -Recurse -Force

    Write-Host ""
    Write-Host "Veil uninstall complete."
    Write-Host "Removed install directory: $InstallDir"
}
