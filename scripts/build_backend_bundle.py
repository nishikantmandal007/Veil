#!/usr/bin/env python3
"""Build release assets for the local Veil backend installer."""

from __future__ import annotations

import shutil
import tarfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
UNIX_ARCHIVE = DIST / "veil-backend-unix.tar.gz"
WINDOWS_ARCHIVE = DIST / "veil-backend-windows.zip"
INSTALLER_FILES = [
    ROOT / "install.sh",
    ROOT / "install.ps1",
    ROOT / "uninstall.sh",
    ROOT / "uninstall.ps1",
]
INCLUDE_PATHS = [
    ROOT / "server",
    ROOT / "pyproject.toml",
    ROOT / "uv.lock",
    ROOT / ".python-version",
    ROOT / "LICENSE",
]
SKIP_DIRS = {"__pycache__", ".pytest_cache"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".DS_Store"}


def iter_files(base: Path):
    if base.is_file():
        yield base
        return

    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix in SKIP_SUFFIXES or path.name in SKIP_SUFFIXES:
            continue
        yield path


def build_unix_archive() -> None:
    with tarfile.open(UNIX_ARCHIVE, "w:gz") as archive:
        for base in INCLUDE_PATHS:
            for path in iter_files(base):
                archive.add(path, arcname=path.relative_to(ROOT))


def build_windows_archive() -> None:
    with zipfile.ZipFile(WINDOWS_ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for base in INCLUDE_PATHS:
            for path in iter_files(base):
                archive.write(path, arcname=path.relative_to(ROOT))


def main() -> None:
    DIST.mkdir(parents=True, exist_ok=True)
    build_unix_archive()
    build_windows_archive()
    for installer in INSTALLER_FILES:
        shutil.copy2(installer, DIST / installer.name)
    print(f"Built {UNIX_ARCHIVE}")
    print(f"Built {WINDOWS_ARCHIVE}")
    for installer in INSTALLER_FILES:
        print(f"Copied {DIST / installer.name}")


if __name__ == "__main__":
    main()
