# Development Guide

Everything you need to run Veil locally, make changes, and test them end-to-end.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Google Chrome (or Chromium) | 120+ |
| uv | 0.10.7+ |
| Python | 3.11.x |
| Node.js (optional, for linting) | 18+ |

---

## 1. Clone the repo

```bash
git clone https://github.com/your-org/veil-extension.git
cd veil-extension
```

---

## 2. Start the GLiNER2 inference server

The extension sends text to a local Python HTTP server for NER inference. No text ever leaves your machine. Veil now uses a pinned `uv`-managed runtime instead of an ad-hoc `venv + pip` flow.

```bash
# Create/update the managed .venv from uv.lock
npm run setup

# (First run only) Download the model weights
npm run download-gliner2

# Start the server — listens on http://127.0.0.1:8765
npm run run-gliner2
```

You should see:

```
[Veil] GLiNER2 server running on http://127.0.0.1:8765
```

Leave this terminal open while developing.

---

## 3. Load the extension in Chrome (Developer mode)

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the root of this repository (the folder containing `manifest.json`).
5. The Veil icon should appear in your toolbar. Pin it for easy access.

> **Tip:** After editing any extension file, click the refresh icon on the `chrome://extensions` card (or press `Ctrl+R` on that page) to reload the extension. Content scripts on already-open tabs need the tab to be refreshed as well.

---

## 4. Hot-reload workflow

There is no bundler — all JS/CSS is loaded directly by Chrome. Your loop is:

1. Edit a file (e.g., `content.js`).
2. Go to `chrome://extensions` → click the reload icon for Veil.
3. Refresh the target tab (ChatGPT, Gemini, Claude, etc.).
4. Inspect with **F12 → Console** (for page errors) or open the **Service Worker** devtools from `chrome://extensions` (for background.js errors).

---

## 5. Inspecting the background service worker

1. On `chrome://extensions`, click **"Service Worker"** link under Veil.
2. A DevTools window opens attached to `background.js`.
3. You can set breakpoints, inspect `chrome.storage`, and watch network requests to `127.0.0.1:8765`.

---

## 6. Syntax checking JS files

```bash
node --check content.js
node --check background.js
node --check popup.js
```

All three should exit silently (no output = no syntax errors).

---

## 7. Project structure

```
veil-extension/
├── extension/             # MV3 extension source
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html / popup.js / popup.css
│   └── options.html / options.css
├── server/                # Local GLiNER2 Python server
│   ├── gliner2_server.py
│   ├── native_host.py
│   ├── native-host/
│   └── autostart/
├── pyproject.toml         # Pinned Python dependency metadata
├── uv.lock                # Locked Python dependency graph
├── docs/
│   └── architecture.drawio
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── .python-version
├── package.json
├── DEVELOPMENT.md         # ← you are here
├── SECURITY.md
├── LICENSE
├── .editorconfig
└── .gitignore
```

---

## 8. Environment variables

Copy `.env.example` to `.env` (never commit `.env`):

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `MDP_ANONYMIZATION_ENDPOINT` | Optional external anonymisation API URL |

---

## 9. Building a production `.crx`

```bash
# Pack from chrome://extensions (Developer mode → Pack Extension)
# or use the CLI tool:
npx crx pack . -o dist/veil.crx
```

Do **not** commit `.crx` or `.pem` files — they are gitignored.
