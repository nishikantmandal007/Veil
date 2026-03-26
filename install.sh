#!/usr/bin/env bash
set -euo pipefail

REPO_SLUG="nishikantmandal007/Veil"
RELEASE_BASE="https://github.com/${REPO_SLUG}/releases/latest/download"
ASSET_NAME="veil-backend-unix.tar.gz"

EXTENSION_ID=""
INSTALL_DIR="${VEIL_INSTALL_DIR:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id)
      EXTENSION_ID="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${EXTENSION_ID}" ]]; then
  echo "Usage: curl .../install.sh | bash -s -- --extension-id <EXTENSION_ID> [--install-dir <dir>]" >&2
  exit 1
fi

OS_NAME="$(uname -s)"
case "${OS_NAME}" in
  Linux*) PLATFORM="linux"; DEFAULT_INSTALL_DIR="${HOME}/.local/share/veil" ;;
  Darwin*) PLATFORM="mac"; DEFAULT_INSTALL_DIR="${HOME}/Library/Application Support/Veil" ;;
  *)
    echo "Unsupported OS for install.sh: ${OS_NAME}" >&2
    exit 1
    ;;
esac

INSTALL_DIR="${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}"
TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="${TMP_DIR}/${ASSET_NAME}"
EXTRACT_DIR="${TMP_DIR}/extract"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Downloading Veil backend bundle..."
curl -fsSL "${RELEASE_BASE}/${ASSET_NAME}" -o "${ARCHIVE_PATH}"

mkdir -p "${EXTRACT_DIR}" "${INSTALL_DIR}"
tar -xzf "${ARCHIVE_PATH}" -C "${EXTRACT_DIR}"

find "${INSTALL_DIR}" -mindepth 1 -maxdepth 1 ! -name ".venv" ! -name ".runtime" -exec rm -rf {} +
cp -R "${EXTRACT_DIR}/." "${INSTALL_DIR}/"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but was not found in PATH." >&2
  exit 1
fi

cd "${INSTALL_DIR}"

if [[ ! -x ".venv/bin/python" ]]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

if [[ "${PLATFORM}" == "linux" ]]; then
  bash server/native-host/install_linux.sh "${EXTENSION_ID}"
  bash server/autostart/install_linux.sh
else
  bash server/native-host/install_mac.sh "${EXTENSION_ID}"
  bash server/autostart/install_mac.sh
fi

echo
echo "Veil install complete."
echo "Install directory: ${INSTALL_DIR}"
echo "Extension ID: ${EXTENSION_ID}"
