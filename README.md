# Privacy Shield (GLiNER2)

Chrome extension for Grammarly-style privacy protection:

- real-time PII detection
- inline redaction/anonymization
- hover to restore or re-redact entities
- local-only inference with GLiNER2
- one-click server start/stop from popup (with native host bridge)
- custom regex engine (API keys, IP, SSN, JWT, etc.)
- configurable field selectors
- monitor anywhere (`<all_urls>`)

Developer workflow is documented in `DEVELOPMENT.md`.

## GLiNER2 Source

This project is configured to use:

- https://github.com/fastino-ai/GLiNER2

The Python bridge defaults to:

- model: `fastino/gliner2-base-v1`
- endpoint: `http://127.0.0.1:8765`

## Quick Start

1. Setup Python environment:

```bash
cd /home/stark007/privacy-shield-extension
python3 -m venv .venv
source .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.0.0"
pip install -r requirements.txt
```

The native host first-run path installs **CPU-only torch wheels** by default
(to avoid NVIDIA CUDA packages on non-GPU machines).

Important: `pip install gliner2` installs the code, not model weights. Model
weights are loaded via `from_pretrained(...)` from a model id/path.

2. Download/cache GLiNER2 weights:

```bash
python scripts/gliner2_server.py --download-only
```

If you want to avoid remote download at runtime, point to a local model folder:

```bash
export GLINER2_MODEL=/absolute/path/to/local/gliner2-model
```

3. Run GLiNER2 local server:

```bash
python scripts/gliner2_server.py
```

Optional lazy mode:

```bash
python scripts/gliner2_server.py --lazy-load
```

If you hit a model download auth error (`401 Unauthorized`), export a token and retry:

```bash
export HF_TOKEN=<your_huggingface_token>
```

You can also set the token directly in the extension popup:
`Local Server -> Model Access Token (Optional)` and then click `Start Server`.

4. Verify server:

```bash
curl http://127.0.0.1:8765/health
```

If you use anonymization mode with MayaData proxying, set endpoint in local `.env`:

```bash
MDP_ANONYMIZATION_ENDPOINT=https://app.mayadataprivacy.in/mdp/engine/anonymization
```

5. Load extension:
1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select `/home/stark007/privacy-shield-extension`
5. Reload extension and refresh pages after updates

6. Install native host bridge once (required for popup Start/Stop buttons):
1. Copy extension id from `chrome://extensions` (Privacy Shield card)
2. Run:

```bash
bash scripts/install_native_host_linux.sh <your_extension_id>
```

After this, popup buttons can start/stop GLiNER server and auto-bootstrap first run.

First start bootstraps a local sandbox:
- `.venv/` for Python packages
- `.runtime/` for state/logs/cache
- no global pip/huggingface cache dependency for normal operation

## Main Components

- `scripts/gliner2_server.py`
  - GLiNER2 local HTTP bridge
  - robust disconnect handling (no noisy BrokenPipe crashes)
  - supports modern GLiNER2 API (`extract_entities`) with fallback
- `background.js`
  - local GLiNER2 calling logic
  - regex fallback if local server is unavailable
  - custom regex detection pipeline
  - native-host server controls (`start` / `stop` / `status`)
- `content.js`
  - debounced field monitoring
  - anonymization engine and per-entity aliasing
  - smooth highlights and hover restore/re-redact controls
  - selector-based monitoring
- `popup.*`
  - Claude-inspired clean settings UI
  - monitor-anywhere toggle
  - anonymize vs mask mode
  - custom regex JSON editor
  - one-click local server controls

## Advanced Config (Popup)

### Redaction modes
- `Anonymize`: replaces entities with stable aliases like `<PERSON_1>`
- `Mask`: replaces entities with `[TYPE REDACTED]` style tokens

### Custom regex patterns
Use JSON array with entries:

```json
{
  "id": "custom_name",
  "label": "api_key",
  "pattern": "\\bsk-[A-Za-z0-9]{20,}\\b",
  "flags": "g",
  "score": 0.99,
  "replacement": "[API KEY REDACTED]",
  "enabled": true
}
```

### Monitored selectors
Set which fields are inspected, for example:

- `textarea`
- `input[type="text"]`
- `div[contenteditable="true"]`
- `.ProseMirror`

## Notes

- GLiNER2 detection runs locally on your machine.
- In anonymize mode, the browser sends text only to local server (`127.0.0.1`);
  server-side proxy forwards anonymization requests to
  `MDP_ANONYMIZATION_ENDPOINT` from `.env`.
- If local GLiNER2 is down, extension falls back to regex detections.
- Native host manifest still lives under Chrome's native messaging directory
  (for example `~/.config/google-chrome/NativeMessagingHosts/`), as required by Chrome.

## Auto Start On Browser Session (Linux)

Chrome extensions cannot directly launch/daemonize Python processes for security reasons.
The reliable approaches are:
1. native host bridge (for popup start/stop)
2. OS background service (autostart)

Install autostart service (systemd user):

```bash
cd /home/stark007/privacy-shield-extension
bash scripts/install_autostart_linux.sh
```

Check status:

```bash
systemctl --user --no-pager status privacy-shield-gliner.service
```

Remove autostart:

```bash
bash scripts/uninstall_autostart_linux.sh
```

NPM shortcuts:

```bash
npm run install-autostart-linux
npm run status-autostart-linux
npm run remove-autostart-linux
```
