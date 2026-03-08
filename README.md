<div align="center">

<br/>

<img src="extension/icons/icon128.png" alt="Veil logo" width="72" />

# Veil

**Real-time PII detection and redaction for AI chat interfaces.**  
Stop pasting your SSNs, API keys, and names into ChatGPT. Veil catches them first.

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-black?style=flat-square&logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![Powered by GLiNER2](https://img.shields.io/badge/Powered%20by-GLiNER2-black?style=flat-square)](https://github.com/fastino/gliner2)
[![GitHub release](https://img.shields.io/github/v/release/nishikantmandal007/Veil?style=flat-square&color=black)](https://github.com/nishikantmandal007/Veil/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-black?style=flat-square)](docs/CONTRIBUTING.md)
[![Stars](https://img.shields.io/github/stars/nishikantmandal007/Veil?style=flat-square&color=black)](https://github.com/nishikantmandal007/Veil/stargazers)

[**Website**](https://nishikantmandal007.github.io/Veil) · [**Docs**](https://nishikantmandal007.github.io/Veil/install) · [**Report Bug**](https://github.com/nishikantmandal007/Veil/issues/new?template=bug_report.md) · [**Request Feature**](https://github.com/nishikantmandal007/Veil/issues/new?template=feature_request.md)

<br/>

</div>

---

## What is Veil?

Veil is a Chrome extension that monitors every text field on LLM sites — **ChatGPT, Claude, Gemini, and more** — and detects Personally Identifiable Information (PII) in real time using a **local GLiNER2 Named Entity Recognition model**.

No text is ever sent to a third-party service. The AI runs entirely on your machine.

---

## How It Works

```
Your Browser                 Veil Extension              Your Machine
─────────────                ──────────────              ────────────────
[ChatGPT textarea]  ──text──► content.js                gliner2_server.py
                              detectAndHighlight()       (localhost:8765)
                              │                          GLiNER2 model
                              └──► background.js ──────► native_host.py
                                                         VeilAnonymizer
```

Detected PII is highlighted inline — like Grammarly, but for privacy. Click any highlight to redact it with a label like `[PERSON]`, `[EMAIL]`, or `[SSN]`. LLM **response** areas are **never** scanned or modified.

---

## Features

| | Feature | Detail |
|---|---|---|
| 🧠 | **Local AI** | GLiNER2 runs on your machine — zero cloud calls, zero data leakage |
| ⚡ | **Regex fallback** | Instant offline pattern detection for emails, API keys, phone numbers |
| ✏️ | **Inline redaction** | Click highlights to replace PII with `[PERSON]`, `[EMAIL]`, etc. |
| 🔒 | **Content-editable safe** | Works in rich-text composer fields (Gemini, Notion, Claude.ai) |
| 🩺 | **Server health monitor** | Live status indicator + crash toast notifications |
| 🧭 | **Onboarding wizard** | First-run setup guide walks you through everything |
| 🖥️ | **Cross-platform server** | Autostart scripts for Linux (systemd), macOS (launchd), and Windows |

**PII types detected:** `PERSON` · `EMAIL` · `PHONE` · `ADDRESS` · `SSN` · `CREDIT_CARD` · `DATE_OF_BIRTH` · `LOCATION` · `ORGANIZATION` — plus custom regex patterns for API keys, AWS credentials, and more.

---

## Prerequisites

- **Chrome** (or any Chromium-based browser)
- **Python 3.10+**
- **Node.js** (for setup scripts and tests)
- **~2 GB disk space** for GLiNER2 model weights (downloaded once, cached locally)

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/nishikantmandal007/Veil.git
cd Veil

# 2. Install Python dependencies (creates .venv, installs PyTorch CPU + GLiNER2)
npm run setup

# 3. Load the extension in Chrome
#    → chrome://extensions → Developer mode ON → Load unpacked → select extension/

# 4. Install the native messaging host (use your extension ID from step 3)
bash server/native-host/install_linux.sh <EXTENSION_ID>   # Linux
bash server/native-host/install_mac.sh   <EXTENSION_ID>   # macOS
server\native-host\install_windows.bat   <EXTENSION_ID>   # Windows

# 5. Start the local inference server
npm run run-gliner2-lazy   # Lazy-load: model warms up on first use (faster start)
npm run run-gliner2        # Eager-load: model ready immediately
```

> **First start** downloads the GLiNER2 model (~1.5 GB). Subsequent starts are instant.

Full step-by-step instructions: [**docs/DEVELOPMENT.md**](docs/DEVELOPMENT.md)

---

## Autostart (Optional)

Have the server launch automatically at login:

```bash
npm run install-autostart-linux        # Linux  → systemd user service
bash server/autostart/install_mac.sh   # macOS  → launchd plist
server\autostart\install_windows.bat   # Windows → Task Scheduler
```

---

## Testing

```bash
npm run test:unit           # JavaScript unit tests
npm run test:unit:python    # Python unit tests (pytest)
npm run test:e2e            # Playwright end-to-end tests (headless)
npm run test:e2e:headed     # Playwright end-to-end tests (visible browser)
```

---

## Building a Release

```bash
npm run build:zip
# → dist/veil-extension.zip  ready for Chrome Web Store upload
```

Pushing a version tag triggers the GitHub Actions release pipeline automatically:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

---

## Repository Layout

```
veil/
├── extension/              # Chrome extension source (load this in Chrome)
│   ├── manifest.json
│   ├── background.js       # Service worker: detection, health monitoring
│   ├── content.js          # In-page PII detection, highlighting & redaction
│   ├── popup.html/js/css   # Extension popup UI
│   └── styles.css
│
├── server/                 # Local inference backend (Python)
│   ├── gliner2_server.py   # GLiNER2 HTTP server (localhost:8765)
│   ├── native_host.py      # Chrome native messaging bridge
│   ├── native-host/        # Install/uninstall scripts per platform
│   └── autostart/          # System-level autostart scripts
│
├── tests/
│   ├── e2e/                # Playwright end-to-end tests
│   ├── js/                 # JavaScript unit tests
│   └── server/             # Python unit tests (pytest)
│
├── scripts/
│   └── build_crx.sh        # Builds dist/veil-extension.zip
│
├── docs/                   # Contributing, security, changelog, development guide
└── .github/workflows/      # GitHub Actions: release pipeline
```

---

## Contributing

Contributions are welcome — especially improvements to PII detection accuracy, new platform support, or performance work.

1. Fork the repo and create your branch: `git checkout -b feat/your-feature`
2. Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, etc.
3. Push and open a Pull Request against `main`

Read [**docs/CONTRIBUTING.md**](docs/CONTRIBUTING.md) and [**docs/DEVELOPMENT.md**](docs/DEVELOPMENT.md) before starting.

---

## Security

Found a vulnerability? **Please do not open a public issue.**  
See [**docs/SECURITY.md**](docs/SECURITY.md) for responsible disclosure.

---

## License

[MIT](LICENSE) © 2024 Nishikant Mandal & Veil Contributors

---

<div align="center">

*If Veil has been useful to you, a ⭐ genuinely helps the project grow.*

</div>
