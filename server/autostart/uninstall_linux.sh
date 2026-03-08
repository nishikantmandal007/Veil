#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/privacy-shield-gliner.service"

if systemctl --user list-unit-files | grep -q '^privacy-shield-gliner\.service'; then
  systemctl --user disable --now privacy-shield-gliner.service || true
fi

if [[ -f "${SERVICE_FILE}" ]]; then
  rm "${SERVICE_FILE}"
fi

systemctl --user daemon-reload
echo "Removed privacy-shield-gliner.service"
