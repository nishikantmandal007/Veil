#!/usr/bin/env python3
"""Sync version from package.json to extension/manifest.json and pyproject.toml.

Usage:
    python scripts/sync_version.py          # sync (write changes)
    python scripts/sync_version.py --check  # verify only, exit 1 if out of sync
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
MANIFEST_JSON = ROOT / "extension" / "manifest.json"
PYPROJECT_TOML = ROOT / "pyproject.toml"


def read_package_version() -> str:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return str(data["version"]).strip()


def read_manifest_version() -> str:
    data = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
    return str(data["version"]).strip()


def read_pyproject_version() -> str:
    text = PYPROJECT_TOML.read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def write_manifest_version(version: str) -> None:
    data = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
    data["version"] = version
    MANIFEST_JSON.write_text(
        json.dumps(data, indent=2) + "\n", encoding="utf-8"
    )


def write_pyproject_version(version: str) -> None:
    text = PYPROJECT_TOML.read_text(encoding="utf-8")
    updated = re.sub(
        r'^(version\s*=\s*)"[^"]*"',
        rf'\g<1>"{version}"',
        text,
        count=1,
        flags=re.MULTILINE,
    )
    PYPROJECT_TOML.write_text(updated, encoding="utf-8")


def main() -> None:
    check_only = "--check" in sys.argv

    source = read_package_version()
    manifest = read_manifest_version()
    pyproject = read_pyproject_version()

    drift: list[str] = []
    if manifest != source:
        drift.append(f"  manifest.json: {manifest!r} (expected {source!r})")
    if pyproject != source:
        drift.append(f"  pyproject.toml: {pyproject!r} (expected {source!r})")

    if not drift:
        print(f"All versions in sync: {source}")
        return

    if check_only:
        print(f"Version drift detected (source: package.json = {source!r}):")
        print("\n".join(drift))
        sys.exit(1)

    # Write updates
    if manifest != source:
        write_manifest_version(source)
        print(f"  manifest.json: {manifest!r} -> {source!r}")
    if pyproject != source:
        write_pyproject_version(source)
        print(f"  pyproject.toml: {pyproject!r} -> {source!r}")

    print(f"Synced all versions to {source}")


if __name__ == "__main__":
    main()
