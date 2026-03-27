function Install-Veil {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExtensionId,
        [string]$InstallDir = $env:VEIL_INSTALL_DIR
    )

    $repoSlug = "Maya-Data-Privacy/Veil"
    $releaseBase = "https://github.com/$repoSlug/releases/latest/download"
    $releaseApi = "https://api.github.com/repos/$repoSlug/releases/latest"
    $assetName = "veil-backend-windows.zip"
    $defaultAnonEndpoint = "https://app.mayadataprivacy.in/mdp/engine/anonymization"

    if ([string]::IsNullOrWhiteSpace($InstallDir)) {
        $InstallDir = Join-Path $env:LOCALAPPDATA "Veil"
    }

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("veil-install-" + [guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $tempRoot $assetName
    $extractDir = Join-Path $tempRoot "extract"

    try {
        New-Item -ItemType Directory -Force -Path $tempRoot, $extractDir, $InstallDir | Out-Null

        Write-Host "Downloading Veil backend bundle..."
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$assetName" -OutFile $archivePath

        Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force

        Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object {
            $_.Name -notin @(".venv", ".runtime", ".env")
        } | Remove-Item -Recurse -Force

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
            $releaseMeta = @{
                tag = [string]($releaseInfo.tag_name)
                published_at = [string]($releaseInfo.published_at)
                html_url = [string]($releaseInfo.html_url)
                repository = $repoSlug
                installed_at = (Get-Date).ToUniversalTime().ToString("o")
            }
            $releaseMeta | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir "bundle_release.json") -Encoding UTF8
        }
        catch {
            Write-Host "Warning: could not stamp release metadata. Update notices may stay conservative until the next refresh."
        }

        $python = Get-Command python -ErrorAction Stop
        $venvPython = Join-Path $InstallDir ".venv\Scripts\python.exe"
        if (-not (Test-Path $venvPython)) {
            & $python.Source -m venv (Join-Path $InstallDir ".venv")
        }

        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install -r (Join-Path $InstallDir "requirements.txt")

        & (Join-Path $InstallDir "server\native-host\install_windows.bat") $ExtensionId
        & (Join-Path $InstallDir "server\autostart\install_windows.bat")
        schtasks /run /tn "PrivacyShieldGLiNER2" | Out-Null

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
