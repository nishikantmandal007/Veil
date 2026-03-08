#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${REPO_DIR}/.venv/bin/python"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/privacy-shield-gliner.service"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Missing virtualenv python: ${PYTHON_BIN}"
  echo "Create it first:"
  echo "  cd ${REPO_DIR}"
  echo "  python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

mkdir -p "${SERVICE_DIR}"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Privacy Shield GLiNER2 Local Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStart=${PYTHON_BIN} ${REPO_DIR}/scripts/gliner2_server.py --host 127.0.0.1 --port 8765
Restart=on-failure
RestartSec=2
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now privacy-shield-gliner.service

echo "Installed and started: privacy-shield-gliner.service"
echo "Status:"
systemctl --user --no-pager status privacy-shield-gliner.service || true
