#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${REPO_DIR}/.venv/bin/python"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/privacy-shield-gliner.service"
LOG_FILE="${REPO_DIR}/.runtime/gliner2_server.log"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Missing virtualenv python: ${PYTHON_BIN}"
  echo "Run the Veil installer first so uv can provision the managed runtime."
  exit 1
fi

mkdir -p "${SERVICE_DIR}"
mkdir -p "${REPO_DIR}/.runtime"
touch "${LOG_FILE}"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Privacy Shield GLiNER2 Local Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStart=${PYTHON_BIN} ${REPO_DIR}/server/gliner2_server.py --host 127.0.0.1 --port 8765
Restart=on-failure
RestartSec=2
Environment=PYTHONUNBUFFERED=1
Environment=HF_HOME=${REPO_DIR}/.runtime/cache/hf
Environment=HUGGINGFACE_HUB_CACHE=${REPO_DIR}/.runtime/cache/hf/hub
Environment=TRANSFORMERS_CACHE=${REPO_DIR}/.runtime/cache/hf/transformers
Environment=XDG_CACHE_HOME=${REPO_DIR}/.runtime/cache/xdg
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now privacy-shield-gliner.service

echo "Installed and started: privacy-shield-gliner.service"
echo "Status:"
systemctl --user --no-pager status privacy-shield-gliner.service || true
