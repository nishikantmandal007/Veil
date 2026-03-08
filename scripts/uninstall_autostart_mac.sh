#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="com.privacyshield.gliner2"
PLIST_FILE="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"

if [[ -f "${PLIST_FILE}" ]]; then
  launchctl unload "${PLIST_FILE}" 2>/dev/null || true
  rm -f "${PLIST_FILE}"
  echo "Removed ${PLIST_FILE}"
else
  echo "LaunchAgent not found: ${PLIST_FILE}"
fi
