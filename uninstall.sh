#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${VEIL_INSTALL_DIR:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
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

OS_NAME="$(uname -s)"
case "${OS_NAME}" in
  Linux*) PLATFORM="linux"; DEFAULT_INSTALL_DIR="${HOME}/.local/share/veil" ;;
  Darwin*) PLATFORM="mac"; DEFAULT_INSTALL_DIR="${HOME}/Library/Application Support/Veil" ;;
  *)
    echo "Unsupported OS for uninstall.sh: ${OS_NAME}" >&2
    exit 1
    ;;
esac

INSTALL_DIR="${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "Veil local server is not installed at ${INSTALL_DIR}."
  exit 0
fi

echo "Removing Veil local server from ${INSTALL_DIR}..."

if [[ "${PLATFORM}" == "linux" ]]; then
  [[ -f "${INSTALL_DIR}/server/autostart/uninstall_linux.sh" ]] && bash "${INSTALL_DIR}/server/autostart/uninstall_linux.sh"
  [[ -f "${INSTALL_DIR}/server/native-host/uninstall_linux.sh" ]] && bash "${INSTALL_DIR}/server/native-host/uninstall_linux.sh"
else
  [[ -f "${INSTALL_DIR}/server/autostart/uninstall_mac.sh" ]] && bash "${INSTALL_DIR}/server/autostart/uninstall_mac.sh"
  [[ -f "${INSTALL_DIR}/server/native-host/uninstall_mac.sh" ]] && bash "${INSTALL_DIR}/server/native-host/uninstall_mac.sh"
fi

rm -rf "${INSTALL_DIR}"

echo
echo "Veil uninstall complete."
echo "Removed install directory: ${INSTALL_DIR}"
