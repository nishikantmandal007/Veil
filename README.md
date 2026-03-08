<div align="center">

# Veil — AI Privacy Guard

**Real-time PII detection and redaction for AI chat interfaces.**
Protect your sensitive data before it reaches any AI model — locally, privately, and automatically.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![GLiNER2](https://img.shields.io/badge/Powered%20by-GLiNER2-8B5CF6)](https://github.com/fastino-ai/GLiNER2)
[![Privacy First](https://img.shields.io/badge/Privacy-Local%20First-22C55E)]()

</div>

---

## Why Veil?

Every time you paste a name, email, phone number, or address into an AI assistant, that data is sent to a third-party server. It becomes part of training data. It lives in logs. You lose control.

**Veil intercepts your input before it's sent.** It detects PII in real-time using a local ML model (GLiNER2), anonymizes or masks it inline, and lets you review every change — all without a single byte of your sensitive data leaving your machine.

> "AI models shouldn't know your patients' names, your clients' addresses, or your employees' SSNs. Veil makes sure they don't."

---

## Features

| Feature | Description |
|---------|-------------|
| **Local NER Detection** | GLiNER2 runs entirely on your machine — no cloud API, no data egress |
| **Inline Redaction** | Grammarly-style underlines with one-click redact/restore |
| **Two Modes** | **Anonymize** (`John Doe → <PERSON_1>`) or **Mask** (`[NAME REDACTED]`) |
| **Format Preserving** | Text structure, spacing, and layout are preserved after redaction |
| **Multi-Platform** | Works on ChatGPT, Gemini, Claude, Copilot, Poe, and any website |
| **Custom Patterns** | Add your own regex patterns for API keys, IPs, custom identifiers |
| **Regex Fallback** | Works even when local model is offline |
| **Hover to Peek** | Hover over a redaction to preview original — without undoing it |
| **Sensitivity Control** | Low / Medium / High detection sensitivity |
| **Secure Key Storage** | API key stored in `chrome.storage.local` — never synced to the cloud |

---

## Supported PII Types

- **Names** — `person`
- **Emails** — `email`
- **Phone numbers** — `phone`
- **Addresses** — `address`
- **Social Security Numbers** — `ssn`
- **Credit card numbers** — `credit_card`
- **Dates of birth** — `date_of_birth`
- **Locations** — `location`
- **Organizations** — `organization`
- **API Keys** — `sk-...`, `AKIA...`, `gh_...` (regex)
- **JWT tokens** — (regex)
- **IP addresses** — IPv4/IPv6 (regex)
- **Custom patterns** — any regex you define

---

## Architecture

```
Browser Tab (e.g. gemini.google.com)
    │
    ▼
content.js  ─── detects user input ───► background.js (service worker)
    │                                         │
    │   inject redaction spans                ▼
    │◄────────────────────────────   GLiNER2 local server (127.0.0.1:8765)
    │                                    │
    │                               (optional) Anonymization API
    │                               via local proxy (your API key)
    │
    ▼
User sees: "Hello <PERSON_1>, your email is [EMAIL REDACTED]"
AI model sees: exactly that — never the original PII
```

**Data flow guarantee:** All PII processing happens at `127.0.0.1`. The GLiNER2 model runs locally. In anonymize mode with an API key, the local proxy contacts the anonymization API — but no data is stored in the extension, synced to Chrome accounts, or sent to Anthropic/Google/any third party.

---

## Quick Start

### 1. Prerequisites

- Google Chrome (or Chromium)
- Python 3.10+
- Node.js (optional, for npm shortcuts)

### 2. Clone and set up Python environment

```bash
git clone https://github.com/yourname/veil-extension.git
cd veil-extension

python3 -m venv .venv
source .venv/bin/activate

# CPU-only PyTorch (recommended unless you have a GPU)
pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.0.0"
pip install -r requirements.txt
```

### 3. Download GLiNER2 model weights

```bash
python scripts/gliner2_server.py --download-only
```

If you hit a 401 Unauthorized error (private model):
```bash
export HF_TOKEN=<your_huggingface_token>
python scripts/gliner2_server.py --download-only
```

Or point to a local model:
```bash
export GLINER2_MODEL=/path/to/local/gliner2-model
```

### 4. Start the local server

```bash
python scripts/gliner2_server.py
```

Verify:
```bash
curl http://127.0.0.1:8765/health
# → {"ok": true}
```

### 5. Load the extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `veil-extension/` folder
5. Note your Extension ID (shown on the card)

### 6. Install native host bridge (for popup Start/Stop buttons)

```bash
bash scripts/install_native_host_linux.sh <your-extension-id>
```

After installation, the popup's Start/Stop Server buttons work without running the server manually.

### 7. (Optional) Auto-start on login

```bash
bash scripts/install_autostart_linux.sh
```

Check status:
```bash
systemctl --user status veil-gliner.service
```

---

## Configuration

### Redaction Modes

| Mode | Example | When to use |
|------|---------|-------------|
| **Anonymize** | `John Doe → <PERSON_1>` | Consistent aliases — the AI understands the structure |
| **Mask** | `John Doe → [NAME REDACTED]` | Explicit redaction — clearer that data was removed |

### Sensitivity

| Level | Threshold | Notes |
|-------|-----------|-------|
| **Low** | 0.75 | Fewer detections, higher precision. Best for production use. |
| **Medium** | 0.62 | Balanced. Recommended default. |
| **High** | 0.52 | More detections, more false positives. |

### Custom Regex Patterns

Add custom patterns in **Advanced → Custom Regex Patterns**:

```json
[
  {
    "id": "stripe_key",
    "label": "api_key",
    "pattern": "\\bsk_(?:test|live)_[A-Za-z0-9]{24,}\\b",
    "flags": "g",
    "score": 0.99,
    "replacement": "[STRIPE KEY REDACTED]",
    "enabled": true
  }
]
```

### Scoped Monitoring

By default, Veil monitors all websites. To restrict to specific AI platforms:

1. Uncheck **Monitor All Websites**
2. Add domains in **Advanced → Scoped Websites**:
   ```
   claude.ai
   chatgpt.com
   gemini.google.com
   ```

---

## Security

### Threat Model

Veil protects against **accidental data disclosure** to AI APIs. It is not designed to protect against:
- A compromised browser or OS
- Malicious Chrome extensions with higher privileges
- Network-level interception (use HTTPS)

### Storage

| Data | Storage | Scope |
|------|---------|-------|
| Settings (toggles, sensitivity, etc.) | `chrome.storage.sync` | Synced across Chrome profiles |
| HF Token, API Key | `chrome.storage.local` | Local device only, never synced |
| Redaction cache | `chrome.storage.local` | Local device only |

**API keys are never:**
- Sent to Anthropic, Google, or any third party
- Included in Chrome sync
- Logged or stored in plain text beyond `chrome.storage.local`

### Permissions

| Permission | Reason |
|------------|--------|
| `storage` | Save settings and API keys locally |
| `activeTab` | Read current tab for stats display |
| `scripting` | Inject content scripts |
| `nativeMessaging` | Communicate with local GLiNER2 bridge |
| `<all_urls>` | Monitor any website (user-configurable) |

---

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for:
- Local server architecture
- Native host protocol
- Testing on specific platforms
- Building for distribution

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run the extension locally and test on ChatGPT, Claude, and Gemini
4. Submit a pull request with a clear description

### Areas that need help

- [ ] Safari / Firefox port
- [ ] Windows native host installer
- [ ] macOS native host installer
- [ ] UI screenshots and demo GIF for this README
- [ ] Additional language support for NER
- [ ] Unit tests for regex patterns

---

## Roadmap

- [x] GLiNER2 local NER detection
- [x] Regex fallback engine
- [x] Format-preserving anonymization
- [x] Gemini `<p>`-based contenteditable support
- [x] Per-entity hover-to-restore
- [x] Custom regex patterns
- [ ] Firefox support
- [ ] Windows / macOS native host installers
- [ ] On-device ONNX model (no Python required)
- [ ] Audit log / export of redacted sessions
- [ ] Team policy mode (enforce redaction rules via JSON config)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [GLiNER2](https://github.com/fastino-ai/GLiNER2) — the local NER engine that powers detection
- [Hugging Face](https://huggingface.co) — model hosting and `transformers` ecosystem
- The privacy-first AI community for the inspiration

---

<div align="center">

**Built with the belief that AI should work for you — not harvest your data.**

Star this repo if you care about AI privacy

</div>
