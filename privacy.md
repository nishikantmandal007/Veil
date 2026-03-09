---
layout: page
title: Privacy
description: What Veil does and doesn't do with your data. Short version: nothing leaves your machine.
---

## The short version

Veil doesn't collect anything. It doesn't have a server to collect things to. The extension talks to one endpoint — a Python process running on your own machine — and that's it.

---

## What Veil processes

When you type into a supported input field, Veil reads that text locally to scan for PII. That text is:

- Passed to a local HTTP server on `127.0.0.1:8765` for NER detection
- Used to render inline highlights in the input field
- Discarded after the scan completes

The text is never sent to any external server, API, or cloud service. Not to us. Not to third parties. Not anywhere.

---

## What Veil stores

Almost nothing, and only on your device.

**In `chrome.storage.local`:**

| What | Why |
| --- | --- |
| Extension settings (auto-redact on/off, redaction mode) | So your preferences persist across browser sessions |
| Server URL (default: `127.0.0.1:8765`) | So you can change the port if needed |

Chrome's sync engine does not touch `chrome.storage.local`. Your settings don't travel to other devices or profiles.

Veil does not log the text it scans. It does not store detection results. It does not keep any record of what you typed or what PII was found.

---

## Telemetry and analytics

There is none. Veil does not include an analytics library, crash reporter, or usage tracker. We don't know how many people have installed it, what sites they use it on, or what they type.

---

## The local server

The GLiNER2 server that Veil runs locally binds to `127.0.0.1` — loopback only. This is not configurable to a public interface through the normal setup process. The server cannot be reached from outside your device.

The model weights are downloaded once during setup and stored on your machine. They are not updated automatically. You control when you update Veil.

---

## Third-party code

Veil's detection pipeline uses [GLiNER2](https://github.com/urchade/GLiNER), an open-source named-entity recognition model. The model runs locally. No data is sent to the GLiNER project or its authors.

The Chrome extension itself contains no third-party analytics, ad networks, or tracking SDKs.

---

## Open source

Everything described here can be verified in the source code. The extension and the local server are both open source and available on [GitHub]({{ site.github_url }}). If you want to confirm that Veil does what it says, read the code.

---

## Changes to this page

If anything here changes in a meaningful way, it will be noted in the [changelog]({{ site.changelog_url }}). Given how Veil is built — no cloud, no accounts, no telemetry — there isn't much that can change without fundamentally altering the product.

---

## Questions

If you have a question not answered here, [open an issue on GitHub]({{ site.github_url }}/issues).
