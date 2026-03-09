---
layout: page
title: FAQ
description: The questions people actually ask before installing Veil.
---

## Does Veil send my text to the cloud?

No. Detection runs locally on your machine. The GLiNER2 server listens on `127.0.0.1:8765` — that's loopback only. There is no path from your text to any external server.

If the local server is not running, Veil falls back to regex-only detection (emails, phone numbers, SSNs, API keys). It does not fall back to a cloud model.

---

## What happens to the text after Veil scans it?

Nothing. Veil reads the text from the input field, passes it through the detection pipeline, and renders highlights back into the same field. The text is not stored, logged, or transmitted. Once the scan is done, Veil holds nothing.

---

## Does the GLiNER2 model run on my GPU?

If you have a compatible GPU and PyTorch can see it, yes — GLiNER2 will use it automatically. On most machines without a dedicated GPU it runs on CPU, which is still fast enough for typical message lengths. Detection usually completes in under a second on modern hardware.

---

## What does Veil do on sites that aren't ChatGPT, Claude, or Gemini?

Veil works on any site with a `textarea` or `contenteditable` input. ChatGPT, Claude, and Gemini have been explicitly tested and are listed as supported, but the extension is not restricted to them. If you paste sensitive text into Notion, a support ticket form, or a custom web app, Veil will scan it the same way.

---

## Can I use Veil without the Python server?

Yes. Regex-only mode catches emails, phone numbers, SSNs, API keys, JWT tokens, IPv4 addresses, and a handful of other structured formats. What it won't catch: names, organisations, addresses written in plain English, and anything else that depends on context rather than pattern. For most workflows, having the server running is worth the setup.

---

## Does Veil work in Firefox?

Not yet. The extension is currently Chrome and Chromium-based browsers only. Firefox support is planned. Check the [changelog]({{ site.changelog_url }}) for updates.

---

## Will redaction break the AI's understanding of my message?

Mask mode replaces PII with type labels like `[NAME REDACTED]` — the AI sees that something was there, which sometimes helps it understand context.

Anonymize mode is smarter: it replaces each unique value with a consistent alias (`<PERSON_1>`, `<PERSON_2>`, etc.). If you mention the same person twice, they get the same alias both times. The AI can still reason about relationships without knowing the actual names. For most use cases, anonymize gives better results than mask.

---

## Does Veil affect page performance?

Minimally. The content script adds an event listener to the page and runs a debounced detection call after you pause typing — it's not running on every keystroke. The Python server is a lightweight HTTP endpoint; once the model is loaded it responds quickly. On slower machines, the first scan after a cold start (lazy-load mode) takes longer, but subsequent scans are fast.

---

## Is the GLiNER2 model accurate?

It performs well on the entity types it was trained on (persons, locations, organisations, addresses, dates of birth). Like any NER model, it's not perfect — it can miss uncommon name formats or misclassify text in edge cases. The regex layer underneath it catches the high-confidence structured types regardless of what the model returns.

If you find a consistent false negative on a site you use regularly, [open an issue]({{ site.github_url }}/issues) — specific examples are the fastest way to improve detection.

---

## Can I turn off auto-redact and only see highlights?

Yes. Open the Veil popup and disable auto-redact. In that mode, Veil highlights detected PII but does nothing until you act — you can click individual spans to redact them, or use the "Redact all" button when you're ready.

---

## Where is my configuration stored?

Everything — mode preferences, auto-redact toggle, server URL — is stored in `chrome.storage.local`. It stays on your device and is not synced across browsers or profiles.
