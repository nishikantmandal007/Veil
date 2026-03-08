---
layout: home
title: Home
nav_order: 1
---

# Veil
{: .fs-9 }

Real-time PII detection and redaction for AI chat interfaces.  
Your data never leaves your machine.
{: .fs-5 .fw-300 }

[Get Started]({{ site.baseurl }}/install){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/nishikantmandal007/Veil){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is Veil?

Veil is a Chrome extension that monitors every text field on LLM sites — ChatGPT, Claude, Gemini, and more — and detects **Personally Identifiable Information (PII)** in real time using a local AI model.

Detected PII is highlighted inline, like Grammarly for privacy. One click redacts it with a safe label like `[PERSON]` or `[EMAIL]`. Nothing is ever sent to a third-party server.

---

## Why Veil?

When you paste a document into ChatGPT, you might not notice the employee names, email addresses, or SSNs buried in the text. Veil does — before you hit send.

| Problem | Veil's answer |
|---------|--------------|
| LLMs train on user data | Veil redacts PII before it leaves your browser |
| Cloud-based PII tools send your text to yet another server | Veil's AI runs **100% locally** via GLiNER2 |
| Manual review is slow and error-prone | Veil highlights PII in real time as you type |

---

## Key Features

- 🧠 **Local AI** — GLiNER2 NER model runs on your machine, zero cloud calls
- ⚡ **Regex fallback** — instant offline detection for emails, API keys, phone numbers
- ✏️ **Inline redaction** — click to replace with `[PERSON]`, `[SSN]`, etc.
- 🔒 **Content-editable safe** — works in Gemini, Notion, Claude.ai rich-text fields
- 🩺 **Health monitoring** — live server status + crash notifications
- 🖥️ **Cross-platform** — autostart scripts for Linux, macOS, and Windows

---

## PII Types Detected

`PERSON` &nbsp;·&nbsp; `EMAIL` &nbsp;·&nbsp; `PHONE` &nbsp;·&nbsp; `ADDRESS` &nbsp;·&nbsp; `SSN` &nbsp;·&nbsp; `CREDIT_CARD` &nbsp;·&nbsp; `DATE_OF_BIRTH` &nbsp;·&nbsp; `LOCATION` &nbsp;·&nbsp; `ORGANIZATION`

Plus custom regex patterns for OpenAI API keys, AWS credentials, and more.

---

## Supported Platforms

| Browser | Status |
|---------|--------|
| Chrome  | ✅ Supported |
| Chromium-based browsers | ✅ Supported |
| Firefox | 🔜 Planned |

| LLM Site | Status |
|----------|--------|
| ChatGPT  | ✅ |
| Claude.ai | ✅ |
| Google Gemini | ✅ |
| Any site with a textarea | ✅ |

---

## License

Veil is open source under the [MIT License](https://github.com/nishikantmandal007/Veil/blob/main/LICENSE).
