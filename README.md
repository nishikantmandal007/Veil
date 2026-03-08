<div align="center">

<img src="extension/icons/icon128.png" alt="Veil logo" width="80" />

# Veil — Privacy Shield for LLM Interfaces

**Stop pasting your SSNs, API keys, and names into ChatGPT.**  
Veil runs a local AI model to detect and redact PII *before* it ever leaves your browser.

[![CI](https://github.com/nishikantmandal007/Veil/actions/workflows/ci.yml/badge.svg)](https://github.com/nishikantmandal007/Veil/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-black?style=flat-square&logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![GitHub release](https://img.shields.io/github/v/release/nishikantmandal007/Veil?style=flat-square&color=black)](https://github.com/nishikantmandal007/Veil/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-black?style=flat-square)](docs/CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/nishikantmandal007/Veil?style=flat-square&color=black)](https://github.com/nishikantmandal007/Veil/stargazers)
</div>

---

## ✨ What it does

Veil monitors every text field on LLM sites (ChatGPT, Claude, Gemini, etc.) and highlights or auto-redacts detected PII in real time using a **local GLiNER2 NER model** — no data ever sent to a third-party service.

| Feature                     | Detail                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| 🧠 **Local AI**              | GLiNER2 runs entirely on your machine — zero cloud calls                   |
| ⚡ **Regex fallback**        | Pattern rules for emails, API keys, phone numbers — instant, works offline |
| ✏️ **Inline redaction**      | Click to replace PII with `[PERSON]`, `[EMAIL]`, etc.                      |
| 🔒 **Content-editable safe** | Works correctly in rich-text composer fields (Notion, Gemini, Claude)      |
| 🩺 **Server health**         | Live status indicator + crash toast notifications                          |
| 🧭 **Onboarding wizard**     | First-run setup guide walks you through everything                         |

---

## 📐 Repository Layout

```
veil/
├── extension/              # Chrome extension source (load this folder in Chrome)
│   ├── manifest.json
│   ├── background.js       # Service worker — detection, server health, crash monitoring
│   ├── content.js          # In-page PII detection, redaction & UI
│   ├── popup.html/js/css   # Extension popup UI
│   └── icons/
│
├── server/                 # Local inference backend
│   ├── gliner2_server.py   # GLiNER2 HTTP inference server (port 8765)
│   ├── native_host.py      # Chrome native messaging host
│   ├── native-host/        # Install / uninstall scripts per platform
│   │   ├── install_linux.sh
│   │   ├── install_mac.sh
│   │   └── install_windows.bat
│   └── autostart/          # System-level autostart scripts
│       ├── install_linux.sh
│       ├── install_mac.sh
│       └── install_windows.bat
│
├── tests/
│   ├── e2e/                # Playwright end-to-end tests
│   ├── js/                 # JS unit tests (no framework)
│   └── server/             # Python unit tests (pytest)
│
├── scripts/
│   └── build_crx.sh        # Builds dist/veil-extension.zip for CWS upload
│
├── docs/                   # Project documentation
│   ├── CHANGELOG.md
│   ├── CONTRIBUTING.md
│   ├── SECURITY.md
│   ├── DEVELOPMENT.md
│   └── ISSUE_TEMPLATE/
│
└── .github/
    └── workflows/
        └── release.yml     # Builds + publishes a release ZIP on version tag push
```

---

## 🚀 Getting Started

### Prerequisites

- **Chrome** (or Chromium) — any recent version
- **Python 3.10+** — for the local inference server
- **~2 GB disk** — for the GLiNER2 model weights (downloaded once, cached locally)

### 1 · Install Python dependencies

```bash
git clone https://github.com/yourusername/veil.git
cd veil
npm run setup          # Creates .venv and installs PyTorch + GLiNER2
```

### 2 · Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select the **`extension/`** folder
4. Note the extension ID shown on the card

### 3 · Install the native messaging host

```bash
# Linux
bash server/native-host/install_linux.sh <EXTENSION_ID>

# macOS
bash server/native-host/install_mac.sh <EXTENSION_ID>

# Windows
server\native-host\install_windows.bat <EXTENSION_ID>
```

Or use `npm run install-native-host-linux` — it fills in your extension ID automatically via the onboarding wizard.

### 4 · Start the local server

```bash
npm run run-gliner2-lazy   # Lazy-load: model warms up on first detection (faster start)
npm run run-gliner2        # Eager-load: model ready immediately
```

The first start downloads the model (~1.5 GB). Subsequent starts are instant.

### 5 · Pin the extension and go

Click the Veil shield icon in your Chrome toolbar. The onboarding wizard will confirm everything is set up correctly.

---

## 🔁 Autostart (optional)

Have the GLiNER2 server start automatically at login:

```bash
npm run install-autostart-linux   # Linux (systemd user service)
# or
bash server/autostart/install_mac.sh  # macOS (launchd plist)
```

---

## 🧪 Testing

```bash
# JavaScript unit tests
npm run test:unit

# Python unit tests (requires .venv)
npm run test:unit:python

# Playwright E2E tests (opens Chromium with extension loaded)
npm run test:e2e

# E2E with visible browser
npm run test:e2e:headed
```

---

## 📦 Building a Release

```bash
npm run build:zip
# → dist/veil-extension.zip  (browser-side files only, ready for Chrome Web Store)
```

Tagging a version triggers the GitHub Actions release pipeline:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

---

## 🏗 Architecture

```
Browser Tab                Extension                    Local Machine
──────────────             ──────────────               ──────────────
[textarea / CE]  ──text──► content.js                  gliner2_server.py
                           │ detectAndHighlight()        │  (port 8765)
                           │                            │  GLiNER2 model
                           └──chrome.runtime──────────► background.js
                                                        │  + native_host.py
                                                        │  (stdio bridge)
                                                        └── VeilAnonymizer
```

All text stays on `localhost`. No third-party API is contacted unless you explicitly configure an anonymisation proxy.

---

## 🤝 Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines, and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the dev environment setup.

Bug reports and feature suggestions go in [GitHub Issues](../../issues).

---

## 🛡 Security

Found a vulnerability? Please see [docs/SECURITY.md](docs/SECURITY.md) — do **not** open a public issue.

---

## 👥 Contributors

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for the full list.

---

## 📄 License

[MIT](LICENSE) © 2024 Veil Contributors
