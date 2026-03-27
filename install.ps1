function Invoke-VeilCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Command,
        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    $exe = $Command[0]
    $args = @()
    if ($Command.Length -gt 1) {
        $args = $Command[1..($Command.Length - 1)]
    }

    & $exe @args
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

function Get-VeilPythonVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PythonPath
    )

    try {
        $output = & $PythonPath -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($output)) {
            return $null
        }
        return [version]($output | Select-Object -Last 1).Trim()
    }
    catch {
        return $null
    }
}

function Get-VeilScheduledTaskNames {
    return @(
        "Veil GLiNER Server",
        "PrivacyShieldGLiNER2"
    )
}

function Stop-VeilScheduledTask {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskName
    )

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        return $false
    }

    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
    return $true
}

function Start-VeilScheduledTask {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskName
    )

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        return $false
    }

    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
    return $true
}

function Stop-VeilWindowsProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallDir
    )

    foreach ($taskName in Get-VeilScheduledTaskNames) {
        Stop-VeilScheduledTask -TaskName $taskName | Out-Null
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

function Remove-VeilInstallContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallDir
    )

    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
        try {
            $items = @(Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object {
                    $_.Name -notin @(".venv", ".runtime", ".env")
                })

            if ($items.Count -eq 0) {
                return
            }

            $items | Remove-Item -Recurse -Force
            return
        }
        catch {
            if ($attempt -eq 3) {
                throw
            }
            Start-Sleep -Seconds 1
        }
    }
}

function Write-VeilReleaseMetadata {
    param(
        [Parameter(Mandatory = $true)]
        $ReleaseInfo,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,
        [Parameter(Mandatory = $true)]
        [string]$RepoSlug
    )

    $releaseMeta = @{
        tag = [string]($ReleaseInfo.tag_name)
        published_at = [string]($ReleaseInfo.published_at)
        html_url = [string]($ReleaseInfo.html_url)
        repository = $RepoSlug
        installed_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    $releaseMeta | ConvertTo-Json | Set-Content -LiteralPath $TargetPath -Encoding UTF8
}

function Ensure-VeilUv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallDir,
        [Parameter(Mandatory = $true)]
        [string]$UvVersion,
        [Parameter(Mandatory = $true)]
        [string]$TempRoot,
        [string]$UvPath
    )

    if (-not [string]::IsNullOrWhiteSpace($UvPath)) {
        if (-not (Test-Path -LiteralPath $UvPath)) {
            throw "Specified uv binary was not found: $UvPath"
        }
        return $UvPath
    }

    $uvInstallDir = Join-Path $InstallDir ".runtime\tools\uv"
    $uvExe = Join-Path $uvInstallDir "uv.exe"
    New-Item -ItemType Directory -Force -Path $uvInstallDir | Out-Null

    $needsInstall = $true
    if (Test-Path -LiteralPath $uvExe) {
        try {
            $currentVersion = (& $uvExe --version | Select-Object -Last 1).Trim()
            if ($currentVersion -eq "uv $UvVersion") {
                $needsInstall = $false
            }
        }
        catch {
            $needsInstall = $true
        }
    }

    if ($needsInstall) {
        $uvInstaller = Join-Path $TempRoot "uv-install.ps1"
        Invoke-WebRequest -UseBasicParsing -Uri "https://astral.sh/uv/$UvVersion/install.ps1" -OutFile $uvInstaller

        $previousInstall = $env:UV_UNMANAGED_INSTALL
        $previousPathFlag = $env:UV_NO_MODIFY_PATH
        try {
            $env:UV_UNMANAGED_INSTALL = $uvInstallDir
            $env:UV_NO_MODIFY_PATH = "1"
            & powershell -NoProfile -ExecutionPolicy Bypass -File $uvInstaller
            if ($LASTEXITCODE -ne 0) {
                throw "uv installer failed with exit code $LASTEXITCODE."
            }
        }
        finally {
            $env:UV_UNMANAGED_INSTALL = $previousInstall
            $env:UV_NO_MODIFY_PATH = $previousPathFlag
        }
    }

    if (-not (Test-Path -LiteralPath $uvExe)) {
        throw "Failed to install pinned uv $UvVersion into $uvInstallDir."
    }

    return $uvExe
}

function Sync-VeilRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallDir,
        [Parameter(Mandatory = $true)]
        [string]$UvExe,
        [Parameter(Mandatory = $true)]
        [string]$PythonVersion,
        [switch]$RecreateVenv
    )

    $runtimeDir = Join-Path $InstallDir ".runtime"
    $venvDir = Join-Path $InstallDir ".venv"
    $venvPython = Join-Path $venvDir "Scripts\python.exe"

    if ($RecreateVenv -and (Test-Path -LiteralPath $venvDir)) {
        Remove-Item -LiteralPath $venvDir -Recurse -Force
    }

    $venvVersion = $null
    if (Test-Path -LiteralPath $venvPython) {
        $venvVersion = Get-VeilPythonVersion -PythonPath $venvPython
        if (-not $venvVersion -or $venvVersion.Major -ne 3 -or $venvVersion.Minor -ne 11) {
            Remove-Item -LiteralPath $venvDir -Recurse -Force
        }
    }

    $previousCache = $env:UV_CACHE_DIR
    $previousInstall = $env:UV_PYTHON_INSTALL_DIR
    $previousEnv = $env:UV_PROJECT_ENVIRONMENT
    $previousLinkMode = $env:UV_LINK_MODE
    try {
        $env:UV_CACHE_DIR = Join-Path $runtimeDir "cache\uv"
        $env:UV_PYTHON_INSTALL_DIR = Join-Path $runtimeDir "python"
        $env:UV_PROJECT_ENVIRONMENT = $venvDir
        $env:UV_LINK_MODE = "copy"

        Invoke-VeilCommand -Command @($UvExe, "python", "install", $PythonVersion, "--install-dir", $env:UV_PYTHON_INSTALL_DIR) -FailureMessage "Failed to install Veil's managed Python runtime"
        Invoke-VeilCommand -Command @($UvExe, "sync", "--frozen", "--no-dev", "--no-install-project", "--directory", $InstallDir, "--python", $PythonVersion, "--managed-python") -FailureMessage "Failed to sync the Veil runtime from uv.lock"
    }
    finally {
        $env:UV_CACHE_DIR = $previousCache
        $env:UV_PYTHON_INSTALL_DIR = $previousInstall
        $env:UV_PROJECT_ENVIRONMENT = $previousEnv
        $env:UV_LINK_MODE = $previousLinkMode
    }
}

function Install-Veil {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExtensionId,
        [string]$InstallDir = $env:VEIL_INSTALL_DIR,
        [switch]$RecreateVenv,
        [string]$UvVersion = $env:VEIL_UV_VERSION,
        [string]$UvPath = $env:VEIL_UV_PATH
    )

    $repoSlug = "Maya-Data-Privacy/Veil"
    $releaseBase = "https://github.com/$repoSlug/releases/latest/download"
    $releaseApi = "https://api.github.com/repos/$repoSlug/releases/latest"
    $assetName = "veil-backend-windows.zip"
    $defaultAnonEndpoint = "https://app.mayadataprivacy.in/mdp/engine/anonymization"
    $pinnedUvVersion = "0.10.7"
    $pinnedPythonVersion = "3.11.11"

    if ([string]::IsNullOrWhiteSpace($UvVersion)) {
        $UvVersion = $pinnedUvVersion
    }

    if ([string]::IsNullOrWhiteSpace($InstallDir)) {
        $InstallDir = Join-Path $env:LOCALAPPDATA "Veil"
    }

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("veil-install-" + [guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $tempRoot $assetName
    $extractDir = Join-Path $tempRoot "extract"

    try {
        $ErrorActionPreference = "Stop"
        New-Item -ItemType Directory -Force -Path $tempRoot, $extractDir, $InstallDir | Out-Null

        Write-Host "Downloading Veil backend bundle..."
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$assetName" -OutFile $archivePath
        Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force

        $nativeHostUninstall = Join-Path $InstallDir "server\native-host\uninstall_windows.bat"
        $autostartUninstall = Join-Path $InstallDir "server\autostart\uninstall_windows.bat"
        if (Test-Path -LiteralPath $autostartUninstall) {
            & $autostartUninstall
            $null = $LASTEXITCODE
        }
        if (Test-Path -LiteralPath $nativeHostUninstall) {
            & $nativeHostUninstall
            $null = $LASTEXITCODE
        }

        Stop-VeilWindowsProcesses -InstallDir $InstallDir
        Remove-VeilInstallContents -InstallDir $InstallDir
        Copy-Item -Path (Join-Path $extractDir "*") -Destination $InstallDir -Recurse -Force

        $envFile = Join-Path $InstallDir ".env"
        if (-not (Test-Path -LiteralPath $envFile)) {
            "MDP_ANONYMIZATION_ENDPOINT=$defaultAnonEndpoint" | Set-Content -LiteralPath $envFile -Encoding UTF8
        }
        else {
            $envContent = Get-Content -LiteralPath $envFile -Raw
            if ($envContent -notmatch "(?m)^MDP_ANONYMIZATION_ENDPOINT=") {
                Add-Content -LiteralPath $envFile -Value "`r`nMDP_ANONYMIZATION_ENDPOINT=$defaultAnonEndpoint"
            }
        }

        $runtimeDir = Join-Path $InstallDir ".runtime"
        New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
        try {
            $releaseInfo = Invoke-RestMethod -UseBasicParsing -Uri $releaseApi
            Write-VeilReleaseMetadata -ReleaseInfo $releaseInfo -TargetPath (Join-Path $runtimeDir "bundle_release.json") -RepoSlug $repoSlug
        }
        catch {
            Write-Host "Warning: could not stamp release metadata. Update notices may stay conservative until the next refresh."
        }

        $uvExe = Ensure-VeilUv -InstallDir $InstallDir -UvVersion $UvVersion -TempRoot $tempRoot -UvPath $UvPath
        Sync-VeilRuntime -InstallDir $InstallDir -UvExe $uvExe -PythonVersion $pinnedPythonVersion -RecreateVenv:$RecreateVenv

        Invoke-VeilCommand -Command @((Join-Path $InstallDir "server\native-host\install_windows.bat"), $ExtensionId) -FailureMessage "Failed to register the Veil native host"
        Invoke-VeilCommand -Command @((Join-Path $InstallDir "server\autostart\install_windows.bat")) -FailureMessage "Failed to register Veil autostart"
        foreach ($taskName in Get-VeilScheduledTaskNames) {
            if (Start-VeilScheduledTask -TaskName $taskName) {
                break
            }
        }

        Write-Host ""
        Write-Host "Veil install complete."
        Write-Host "Install directory: $InstallDir"
        Write-Host "Extension ID: $ExtensionId"
    }
    finally {
        if (Test-Path $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}
