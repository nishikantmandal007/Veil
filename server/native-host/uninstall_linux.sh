#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.privacyshield.gliner2"

remove_manifest() {
  local manifest_file="$1/${HOST_NAME}.json"
  if [[ -f "${manifest_file}" ]]; then
    rm "${manifest_file}"
    echo "Removed: ${manifest_file}"
  fi
}

declare -a BROWSER_PATHS=(
  "${HOME}/.config/google-chrome/NativeMessagingHosts"
  "${HOME}/.config/chromium/NativeMessagingHosts"
  "${HOME}/.snap/chromium/current/.config/chromium/NativeMessagingHosts"
  "${HOME}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "${HOME}/.config/microsoft-edge/NativeMessagingHosts"
  "${HOME}/.config/vivaldi/NativeMessagingHosts"
  "${HOME}/.config/opera/NativeMessagingHosts"
)

for path in "${BROWSER_PATHS[@]}"; do
  remove_manifest "${path}"
done

echo "Native host manifests removed."
