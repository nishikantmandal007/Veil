"""
Regression tests for the Windows PowerShell installer script.
"""
from pathlib import Path
import re


INSTALLER_PATH = Path(__file__).resolve().parents[2] / "scripts" / "installers" / "install.ps1"
AUTOSTART_INSTALLER_PATH = Path(__file__).resolve().parents[2] / "server" / "autostart" / "install_windows.bat"


def test_uv_bootstrap_output_is_not_returned_from_ensure_veil_uv():
    script = INSTALLER_PATH.read_text(encoding="utf-8")

    # The nested PowerShell installer can print status lines to stdout.
    # Those lines must stay on the console instead of becoming part of
    # Ensure-VeilUv's return value, or $uvExe turns into an array.
    assert "& powershell -NoProfile -ExecutionPolicy Bypass -File $uvInstaller | Out-Host" in script
    assert "$uvInstallExitCode = $LASTEXITCODE" in script
    assert 'throw "uv installer failed with exit code $uvInstallExitCode."' in script

    direct_invoke = re.compile(
        r"^\s*& powershell -NoProfile -ExecutionPolicy Bypass -File \$uvInstaller\s*$",
        re.MULTILINE,
    )
    assert direct_invoke.search(script) is None


def test_install_veil_starts_the_server_now_and_treats_autostart_as_a_warning():
    script = INSTALLER_PATH.read_text(encoding="utf-8")

    assert "function Start-VeilServerNow" in script
    assert 'Write-Host "Warning: Veil install completed, but autostart could not be registered.' in script
    assert "Start-VeilServerNow -InstallDir $InstallDir | Out-Null" in script


def test_install_veil_stamps_release_metadata_from_the_bundled_file_without_api_calls():
    script = INSTALLER_PATH.read_text(encoding="utf-8")

    assert "[string]$SourcePath" in script
    assert 'Write-VeilReleaseMetadata -SourcePath (Join-Path $runtimeDir "bundle_release.json")' in script
    assert 'Invoke-RestMethod -UseBasicParsing -Uri $releaseApi' not in script


def test_windows_autostart_script_prints_powershell_safe_manual_start_guidance():
    script = AUTOSTART_INSTALLER_PATH.read_text(encoding="utf-8")

    assert "Manual start from PowerShell:" in script
    assert 'Start-Process "%VENV_PYTHON%" -ArgumentList' in script
