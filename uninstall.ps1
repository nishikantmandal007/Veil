function Stop-VeilWindowsProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallDir
    )

    foreach ($taskName in @("Veil GLiNER Server", "PrivacyShieldGLiNER2")) {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($null -ne $task) {
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
        }
    }

    $patterns = @(
        [regex]::Escape((Join-Path $InstallDir "server\gliner2_server.py")),
        [regex]::Escape((Join-Path $InstallDir "server\native_host.py")),
        [regex]::Escape((Join-Path $InstallDir "server\native-host\native_host_win.bat"))
    )

    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $cmd = $_.CommandLine
            if ([string]::IsNullOrWhiteSpace($cmd)) {
                return $false
            }

            foreach ($pattern in $patterns) {
                if ($cmd -match $pattern) {
                    return $true
                }
            }

            return $false
        })

    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    if ($processes.Count -gt 0) {
        Start-Sleep -Seconds 1
    }
}

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

    $ErrorActionPreference = "Stop"

    if (Test-Path -LiteralPath $autostartUninstall) {
        & $autostartUninstall
        $null = $LASTEXITCODE
    }
    if (Test-Path -LiteralPath $nativeHostUninstall) {
        & $nativeHostUninstall
        $null = $LASTEXITCODE
    }

    Stop-VeilWindowsProcesses -InstallDir $InstallDir
    Remove-Item -LiteralPath $InstallDir -Recurse -Force

    Write-Host ""
    Write-Host "Veil uninstall complete."
    Write-Host "Removed install directory: $InstallDir"
}
