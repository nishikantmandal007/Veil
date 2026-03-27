<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/icons/veil-wordmark-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/veil-wordmark-light.png">
  <img src="assets/icons/veil-wordmark-dark.png" alt="Veil" height="96">
</picture>

<br/><br/>

**Real-time PII detection and redaction for AI chat interfaces.**<br/>
Protect your sensitive data before it reaches any AI model — locally, privately, and automatically.

<br/>

[![CI](https://github.com/nishikantmandal007/Veil/actions/workflows/ci.yml/badge.svg)](https://github.com/nishikantmandal007/Veil/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![Powered by GLiNER2](https://img.shields.io/badge/Powered%20by-GLiNER2-8B5CF6?style=flat-square)](https://github.com/fastino-ai/GLiNER2)
[![MAYA DATA PRIVACY](https://img.shields.io/badge/Anonymisation%20by-MAYA%20DATA%20PRIVACY-22C55E?style=flat-square)](https://github.com/MAYA-DATA-PRIVACY)
[![Release](https://img.shields.io/github/v/release/nishikantmandal007/Veil?style=flat-square&color=22C55E)](https://github.com/nishikantmandal007/Veil/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange?style=flat-square)](docs/CONTRIBUTING.md)
[![Stars](https://img.shields.io/github/stars/nishikantmandal007/Veil?style=flat-square&color=yellow)](https://github.com/nishikantmandal007/Veil/stargazers)

<br/>

[Website](https://nishikantmandal007.github.io/Veil) · [Documentation](https://nishikantmandal007.github.io/Veil/install) · [Changelog](CHANGELOG.md) · [Report a Bug](https://github.com/nishikantmandal007/Veil/issues/new?template=bug_report.md) · [Request a Feature](https://github.com/nishikantmandal007/Veil/issues/new?template=feature_request.md)

<br/>

</div>

---

## Why Veil?

Every time you paste a name, email, phone number, or address into an AI assistant, that data is sent to a third-party server. It becomes part of training data. It lives in logs. You lose control.

Veil intercepts your input before it is sent. It detects PII in real time using a local ML model (GLiNER2), highlights it inline, and lets you redact it with one click — all without a single byte of your sensitive data leaving your machine.

---

## How It Works

```
Browser Tab (e.g. chatgpt.com)
    │
    ▼
content.js  ──── detects user input ────► background.js (service worker)
    │                                           │
    │   inject redaction spans                  ▼
    │◄──────────────────────────    GLiNER2 local server (127.0.0.1:8765)
    │                                      via native_host.py (stdio bridge)
    ▼
User sees:   "Hello [PERSON], your SSN is [SSN REDACTED]"
AI receives: exactly that — never the original PII
```

All PII processing happens at `127.0.0.1`. The GLiNER2 model runs locally. No data is stored in the extension, synced to Chrome accounts, or sent to any third party.

---

## Features

| Feature               | Detail                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| Local AI              | GLiNER2 runs entirely on your machine — zero cloud calls, zero data egress |
| Inline redaction      | Grammarly-style highlights with one-click redact per entity                |
| Regex fallback        | Pattern rules for emails, API keys, phone numbers — instant, works offline |
| Content-editable safe | Works correctly in rich-text fields (Gemini, Notion, Claude.ai)            |
| Custom patterns       | Add your own regex patterns for API keys, IPs, custom identifiers          |
| Sensitivity control   | Low / Medium / High detection thresholds                                   |
| Server health monitor | Live status indicator and crash toast notifications                        |
| Onboarding wizard     | First-run setup guide with automatic extension ID detection                |
| Cross-platform server | Autostart scripts for Linux (systemd), macOS (launchd), and Windows        |

---

## Supported PII Types

Detected by GLiNER2 NER model: `PERSON` · `EMAIL` · `PHONE` · `ADDRESS` · `SSN` · `CREDIT_CARD` · `DATE_OF_BIRTH` · `LOCATION` · `ORGANIZATION`

Detected by regex fallback: `OpenAI API keys` · `AWS credentials` · `GitHub tokens` · `JWT tokens` · `IPv4/IPv6 addresses` · `Custom patterns`

---

## Prerequisites

- Chrome or any Chromium-based browser
- Python 3.10+
- Node.js 18+
- Internet access for the first local ONNX model download

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/nishikantmandal007/Veil.git
cd Veil

# 2. Install local Python dependencies (ONNX runtime, no PyTorch)
npm run setup

# 3. Load the extension in Chrome
#    chrome://extensions → Developer mode ON → Load unpacked → select extension/
#    Note the Extension ID shown on the card

# 4. Install the local server bundle + native bridge
curl -fsSL https://github.com/nishikantmandal007/Veil/releases/latest/download/install.sh | bash -s -- --extension-id <EXTENSION_ID>   # Linux/macOS
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://github.com/nishikantmandal007/Veil/releases/latest/download/install.ps1' | iex; Install-Veil -ExtensionId '<EXTENSION_ID>'"   # Windows

# 5. Start the local inference server
npm run run-gliner2-lazy   # lazy-load: model warms on first detection
npm run run-gliner2        # eager-load: model ready immediately (~30s)
```

The first start downloads the public GLiNER2 ONNX model into the local cache. No Hugging Face token is required for the default model.

Full setup guide: [nishikantmandal007.github.io/Veil/install](https://nishikantmandal007.github.io/Veil/install)

---

## Autostart

Have the inference server launch automatically at login:

```bash
npm run install-autostart-linux        # Linux  — systemd user service
bash server/autostart/install_mac.sh   # macOS  — launchd plist
server\autostart\install_windows.bat   # Windows — Task Scheduler
```

---

## Configuration

**Sensitivity thresholds**

| Level  | Threshold | Notes                                                               |
| ------ | --------- | ------------------------------------------------------------------- |
| Low    | 0.75      | Higher precision, fewer detections. Recommended for production use. |
| Medium | 0.62      | Balanced. Default.                                                  |
| High   | 0.52      | More detections, higher false positive rate.                        |

**Custom regex patterns**

Add patterns under Advanced → Custom Regex Patterns:

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

---

## Anonymisation Service

Veil optionally integrates with the **[MAYA DATA PRIVACY](https://github.com/MAYA-DATA-PRIVACY)** anonymisation API for format-preserving entity replacement — replacing detected PII with consistent synthetic aliases rather than generic redaction labels (e.g. `John Doe → <PERSON_1>` instead of `[NAME REDACTED]`).

To enable, add your MAYA DATA PRIVACY API key under Advanced Settings in the extension popup.

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

Releases are cut manually from `main` with a semver tag such as `v1.2.0`.
Before tagging, make sure `package.json`, `package-lock.json`, `extension/manifest.json`, and `CHANGELOG.md` already contain the same release version on `main`.

```bash
git checkout main
git pull origin main
git tag v1.2.0
git push origin v1.2.0
```

Pushing the `v*` tag triggers the release workflow, which first verifies the version metadata, then runs the JavaScript, Python, and Playwright test suites, and finally uploads the extension zip plus backend installer assets to the GitHub release for that tag.
If you ever need to republish assets for an existing tag, re-run the `Release` workflow with the `workflow_dispatch` `tag_name` input.
The Chrome Web Store upload is still manual after the GitHub release is published.

---

## Repository Layout

```
veil/
├── extension/              # Chrome extension source (load this folder in Chrome)
│   ├── manifest.json
│   ├── background.js       # Service worker: detection, server health, crash monitoring
│   ├── content.js          # In-page PII detection, redaction & UI
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
├── assets/brand/           # Logo, wordmarks, icons
├── scripts/
│   └── build_crx.sh        # Builds dist/veil-extension.zip
│
├── docs/                   # Contributing, security, changelog, development guide
└── .github/
    └── workflows/          # CI, CodeQL, release pipeline
```

---

## Security

### Threat model

Veil protects against accidental data disclosure to AI APIs. It is not designed to protect against a compromised browser or OS, malicious extensions with higher privileges, or network-level interception.

### Permissions

| Permission        | Reason                                  |
| ----------------- | --------------------------------------- |
| `storage`         | Save settings locally                   |
| `activeTab`       | Read current tab for stats display      |
| `scripting`       | Inject content scripts                  |
| `nativeMessaging` | Communicate with local GLiNER2 bridge   |
| `<all_urls>`      | Monitor any website (user-configurable) |

### Reporting vulnerabilities

Do not open a public issue for security vulnerabilities. See [docs/SECURITY.md](docs/SECURITY.md) for responsible disclosure instructions.

---

## Roadmap

- [x] GLiNER2 local NER detection
- [x] Regex fallback engine
- [x] Inline redaction UI
- [x] Content-editable field support (Gemini, Claude.ai, Notion)
- [x] Custom regex patterns
- [x] Cross-platform autostart scripts
- [ ] Firefox support
- [ ] On-device ONNX model (no Python required)
- [ ] Audit log / export of redacted sessions
- [ ] Team policy mode (enforce redaction rules via JSON config)

---

## Contributing

Contributions are welcome — especially improvements to PII detection accuracy, new platform support, and performance work.

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the local development setup.

Areas that need help: Firefox/Safari port · Windows and macOS native host improvements · ONNX model packaging · UI screenshots and demo GIF

---

## Contributors

See [CONTRIBUTORS.md](CONTRIBUTORS.md).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a full history of changes, automatically generated from [conventional commits](https://www.conventionalcommits.org/).

---

## Acknowledgments

<table>
  <tr>
    <td align="center" width="160">
      <a href="https://github.com/fastino-ai">
        <img src="https://github.com/fastino-ai.png" width="52" style="border-radius:8px" /><br/>
        <b>Fastino Labs</b>
      </a><br/>
      <sub>GLiNER2 — local zero-shot NER powering PII detection</sub>
    </td>
    <td align="center" width="160">
      <a href="https://github.com/MAYA-DATA-PRIVACY">
        <img src="https://github.com/MAYA-DATA-PRIVACY.png" width="52" style="border-radius:8px" /><br/>
        <b>MAYA DATA PRIVACY</b>
      </a><br/>
      <sub>Anonymisation API for format-preserving entity replacement</sub>
    </td>
    <td align="center" width="160">
      <a href="https://huggingface.co">
        <img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" width="52" /><br/>
        <b>Hugging Face</b>
      </a><br/>
      <sub>Model hosting and transformers ecosystem</sub>
    </td>
  </tr>
</table>

---

## License

[MIT](LICENSE) © 2025 Nishikant Mandal & Veil Contributors
