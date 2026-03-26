#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash server/native-host/install_linux.sh <extension_id> [extra_id ...]"
  echo ""
  echo "  One or more Chrome extension IDs. Pass all browser IDs if you use Veil"
  echo "  in multiple Chromium-based browsers on this machine."
  echo "  Example: bash server/native-host/install_linux.sh ID_CHROME ID_BRAVE"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST_SCRIPT="${REPO_DIR}/server/native_host.py"
HOST_NAME="com.privacyshield.gliner2"
RUNTIME_DIR="${REPO_DIR}/.runtime"
VENV_PYTHON="${REPO_DIR}/.venv/bin/python"

if [[ ! -f "${HOST_SCRIPT}" ]]; then
  echo "Error: Native host script not found: ${HOST_SCRIPT}"
  exit 1
fi

chmod +x "${HOST_SCRIPT}"
mkdir -p "${RUNTIME_DIR}/cache"
touch "${RUNTIME_DIR}/gliner2_server.log"

if [[ ! -x "${VENV_PYTHON}" ]]; then
  python3 -m venv "${REPO_DIR}/.venv"
  echo "Created virtual environment: ${REPO_DIR}/.venv"
fi

# Build JSON allowed_origins array from all provided extension IDs
build_origins() {
  local -a arr=()
  for id in "$@"; do
    arr+=("\"chrome-extension://${id}/\"")
  done
  local joined
  joined="$(printf ',\n    %s' "${arr[@]}")"
  joined="${joined:2}"  # strip leading ",\n    "
  printf '[\n    %s\n  ]' "${joined}"
}

ORIGINS="$(build_origins "$@")"

write_manifest() {
  local target_dir="$1"
  # Only write if the parent browser config directory exists (browser is installed)
  if [[ ! -d "$(dirname "${target_dir}")" ]]; then
    return 0
  fi
  mkdir -p "${target_dir}"
  local manifest_file="${target_dir}/${HOST_NAME}.json"
  cat > "${manifest_file}" <<EOF
{
  "name": "${HOST_NAME}",
  "description": "Privacy Shield GLiNER2 Native Host",
  "path": "${HOST_SCRIPT}",
  "type": "stdio",
  "allowed_origins": ${ORIGINS}
}
EOF
  echo "  Installed → ${manifest_file}"
}

# All known Chromium-based browser paths on Linux
declare -a BROWSER_PATHS=(
  "${HOME}/.config/google-chrome/NativeMessagingHosts"
  "${HOME}/.config/chromium/NativeMessagingHosts"
  "${HOME}/.snap/chromium/current/.config/chromium/NativeMessagingHosts"
  "${HOME}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "${HOME}/.config/microsoft-edge/NativeMessagingHosts"
  "${HOME}/.config/vivaldi/NativeMessagingHosts"
  "${HOME}/.config/opera/NativeMessagingHosts"
)

echo ""
echo "Installing native host manifest for: $*"
echo ""

installed=0
for path in "${BROWSER_PATHS[@]}"; do
  write_manifest "${path}" && ((installed++)) || true
done

if [[ "${installed}" -eq 0 ]]; then
  # Fallback: install to Chrome path unconditionally
  mkdir -p "${HOME}/.config/google-chrome/NativeMessagingHosts"
  write_manifest "${HOME}/.config/google-chrome/NativeMessagingHosts"
  echo "  (Fallback: wrote to Chrome path; no known browser config dirs found)"
fi

echo ""
echo "Done. Reload your browser extensions to apply."
echo "  IDs registered: $*"
