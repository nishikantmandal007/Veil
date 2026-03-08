#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash server/native-host/install_mac.sh <extension_id>"
  exit 1
fi

EXTENSION_ID="$1"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST_SCRIPT="${REPO_DIR}/server/native_host.py"
HOST_NAME="com.privacyshield.gliner2"
RUNTIME_DIR="${REPO_DIR}/.runtime"

if [[ ! -f "${HOST_SCRIPT}" ]]; then
  echo "Native host script not found: ${HOST_SCRIPT}"
  exit 1
fi

chmod +x "${HOST_SCRIPT}"
mkdir -p "${RUNTIME_DIR}/cache"
touch "${RUNTIME_DIR}/gliner2_server.log"

if [[ ! -x "${REPO_DIR}/.venv/bin/python" ]]; then
  python3 -m venv "${REPO_DIR}/.venv"
  echo "Created local virtual environment: ${REPO_DIR}/.venv"
fi

write_manifest() {
  local target_dir="$1"
  mkdir -p "${target_dir}"
  local manifest_file="${target_dir}/${HOST_NAME}.json"
  cat > "${manifest_file}" <<EOF
{
  "name": "${HOST_NAME}",
  "description": "Privacy Shield GLiNER2 Native Host",
  "path": "${HOST_SCRIPT}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
EOF
  echo "Installed: ${manifest_file}"
}

write_manifest "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
write_manifest "${HOME}/Library/Application Support/Chromium/NativeMessagingHosts"
write_manifest "${HOME}/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"

echo "Native host installed for extension id: ${EXTENSION_ID}"
echo "Run 'bash server/autostart/install_mac.sh' to start GLiNER2 automatically at login."
