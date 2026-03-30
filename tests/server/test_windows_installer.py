"""
Regression tests for the Windows PowerShell installer script.
"""
from pathlib import Path
import re


INSTALLER_PATH = Path(__file__).resolve().parents[2] / "install.ps1"


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
