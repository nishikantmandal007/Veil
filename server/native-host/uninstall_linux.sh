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

remove_manifest "${HOME}/.config/google-chrome/NativeMessagingHosts"
remove_manifest "${HOME}/.config/chromium/NativeMessagingHosts"

echo "Native host manifests removed."
