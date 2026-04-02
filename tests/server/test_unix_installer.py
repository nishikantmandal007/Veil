"""
Regression tests for the Unix installer metadata stamping path.
"""
from pathlib import Path


INSTALLER_PATH = Path(__file__).resolve().parents[2] / "install.sh"


def test_release_metadata_uses_field_extraction_instead_of_greedy_html_url_matching():
    script = INSTALLER_PATH.read_text(encoding="utf-8")

    assert "extract_release_field()" in script
    assert 'grep -o "\\"${field}\\"[[:space:]]*:[[:space:]]*\\"[^\\"]*\\""' in script
    assert '"html_url"[[:space:]]*:[[:space:]]*"\\([^"]*\\)"' not in script


def test_installer_stamps_installed_release_metadata_from_the_bundled_file():
    script = INSTALLER_PATH.read_text(encoding="utf-8")

    assert 'stamp_release_metadata "${INSTALL_DIR}/.runtime/bundle_release.json" "${INSTALL_DIR}/.runtime/bundle_release.json"' in script
    assert "RELEASE_API=" not in script
    assert 'curl -fsSL "${RELEASE_API}"' not in script
