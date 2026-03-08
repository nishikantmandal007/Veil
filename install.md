---
layout: default
title: Installation
nav_order: 2
---

# Installation
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Prerequisites

Before you start, make sure you have:

- **Chrome** (or any Chromium-based browser — Edge, Brave, Arc)
- **Python 3.10 or higher** — `python3 --version`
- **Node.js 18+** — `node --version`
- **~2 GB free disk space** for the GLiNER2 model (downloaded once, cached)

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/nishikantmandal007/Veil.git
cd Veil
```

---

## Step 2 — Install Python Dependencies

This creates a virtual environment and installs PyTorch (CPU-only) and GLiNER2:

```bash
npm run setup
```

> This may take a few minutes the first time. PyTorch CPU wheels are ~200 MB.

---

## Step 3 — Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Select the `extension/` folder inside your cloned `Veil/` directory
5. Note the **Extension ID** shown on the extension card — you'll need it in step 4

---

## Step 4 — Install the Native Messaging Host

The native messaging host lets the Chrome extension communicate with the local Python server.

Run the install script for your platform, replacing `<EXTENSION_ID>` with the ID from step 3:

```bash
# Linux
bash server/native-host/install_linux.sh <EXTENSION_ID>

# macOS
bash server/native-host/install_mac.sh <EXTENSION_ID>

# Windows (Command Prompt as Administrator)
server\native-host\install_windows.bat <EXTENSION_ID>
```

Alternatively, the onboarding wizard inside the extension can do this automatically via `npm run install-native-host-linux`.

---

## Step 5 — Start the Local Inference Server

```bash
# Recommended: lazy-load (model warms up on first detection)
npm run run-gliner2-lazy

# Or: eager-load (model ready immediately, ~30s startup)
npm run run-gliner2
```

**First start only:** GLiNER2 model weights (~1.5 GB) will be downloaded and cached. This is a one-time step.

You should see:

```
INFO: GLiNER2 server listening on localhost:8765
```

---

## Step 6 — Verify It's Working

1. Click the Veil shield icon in the Chrome toolbar
2. The popup should show **Server: Connected** in green
3. Open ChatGPT, paste something like `My name is John Smith, email john@example.com` into the chat box
4. Veil should highlight the name and email inline

---

## Autostart (Optional)

To have the GLiNER2 server start automatically when you log in:

```bash
# Linux (systemd user service)
npm run install-autostart-linux

# macOS (launchd plist)
bash server/autostart/install_mac.sh

# Windows (Task Scheduler)
server\autostart\install_windows.bat
```

To remove autostart:

```bash
npm run remove-autostart-linux
bash server/autostart/uninstall_mac.sh
server\autostart\uninstall_windows.bat
```

---

## Troubleshooting

### Server not connecting

- Make sure the Python server is running (`npm run run-gliner2-lazy`)
- Check the popup status indicator — it shows connection state in real time
- Verify the native host is installed correctly by checking for the manifest file:
  - Linux: `~/.config/google-chrome/NativeMessagingHosts/com.privacyshield.gliner2.json`
  - macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`

### Model download fails

- Check your internet connection
- Try running `npm run download-gliner2` directly
- Ensure you have ~2 GB of free disk space

### Extension not detecting PII

- Reload the extension on `chrome://extensions` after making any changes
- Check the browser console (F12) for errors from `content.js`
- Make sure the server is running and connected (green indicator in popup)

---

Still stuck? [Open an issue](https://github.com/nishikantmandal007/Veil/issues/new?template=bug_report.md) with your OS, Chrome version, and any console errors.
