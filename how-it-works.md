---
layout: default
title: How It Works
nav_order: 3
---

# How It Works
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Veil sits between your keyboard and the LLM. When you type into a chat field on ChatGPT, Claude, or Gemini, Veil intercepts the text, runs it through a local Named Entity Recognition model, and highlights any PII it finds — before you hit send.

```
Your Browser                 Veil Extension              Your Machine
─────────────                ──────────────              ────────────────
[ChatGPT textarea]  ──text──► content.js                gliner2_server.py
                              detectAndHighlight()       (localhost:8765)
                              │                          GLiNER2 model
                              └──► background.js ──────► native_host.py
                                                         VeilAnonymizer
```

All processing happens on `localhost`. No text is ever forwarded to a third-party API.

---

## The Extension (content.js)

`content.js` is a content script that runs on every page. It:

1. **Monitors text fields** — watches `<textarea>`, `<input>`, and `[contenteditable]` elements using MutationObserver
2. **Handles platform quirks** — has specific selectors for ChatGPT's ProseMirror editor, Gemini's rich-textarea, Claude.ai's CE fields, and a generic fallback for any other site
3. **Sends text to the background worker** — debounces keystrokes and sends changed text via `chrome.runtime.sendMessage`
4. **Renders highlights** — receives detected entities and overlays highlight spans on the text field without breaking the input's functionality
5. **Handles redaction** — when you click a highlight, replaces the original text with the entity label (e.g. `[PERSON]`)

LLM **response** areas are explicitly excluded from scanning.

---

## The Service Worker (background.js)

`background.js` runs as a Chrome Manifest V3 service worker. It:

1. **Manages the native host connection** — communicates with `native_host.py` via the Chrome Native Messaging API (stdio-based)
2. **Routes detection requests** — receives text from `content.js`, forwards to the GLiNER2 server, and returns detections
3. **Regex pre-filter** — runs fast pattern matching for common PII types (emails, API keys, phone numbers) instantly, without waiting for the AI model
4. **Monitors server health** — polls `localhost:8765/health` and sends crash toast notifications to the active tab if the server goes down
5. **Manages labels** — maintains the list of PII entity types and their GLiNER2 natural-language descriptions for zero-shot matching

---

## The GLiNER2 Server (gliner2_server.py)

`gliner2_server.py` is a lightweight HTTP server (Python's built-in `ThreadingHTTPServer`) that:

1. **Loads the GLiNER2 model** — either eagerly at startup or lazily on the first request
2. **Exposes a `/detect` endpoint** — accepts text + label config, returns a list of entity spans
3. **Uses the `fastino/gliner2-large-v1` model** — a zero-shot NER model that takes natural-language label descriptions, enabling it to detect entity types it was never explicitly trained on
4. **Handles chunking** — long inputs are split server-side via `batch_extract_entities`
5. **Stays local** — only binds to `127.0.0.1`, never reachable from outside your machine

---

## The Native Host (native_host.py)

Chrome extensions cannot directly open TCP sockets to `localhost` from the service worker in all configurations. The native messaging host bridges this gap:

- Registered with Chrome via a JSON manifest in the browser's NativeMessagingHosts directory
- Launched by Chrome as a subprocess when the extension starts
- Communicates over stdio using Chrome's length-prefixed JSON protocol
- Forwards messages to `gliner2_server.py` and relays responses back

---

## Detection Pipeline

For each text input event:

```
1. content.js detects keystroke → debounce (300ms)
2. Send text to background.js via chrome.runtime.sendMessage
3. background.js runs regex pre-filter (instant)
4. background.js sends text to native_host → gliner2_server
5. GLiNER2 returns entity spans: [{label, start, end, score}]
6. background.js merges regex + AI results, deduplicates
7. Sends combined detections back to content.js
8. content.js renders highlight overlays on the input field
```

---

## Privacy Guarantees

| Claim | How it's enforced |
|-------|-------------------|
| No text sent to third parties | Server only binds to `127.0.0.1` |
| No analytics or telemetry | No external HTTP calls in extension code |
| No cloud model | GLiNER2 runs fully offline after model download |
| LLM responses not scanned | `content.js` explicitly excludes response containers |

The only outbound network call is the one-time model download from Hugging Face on first start.
