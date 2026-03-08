# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email **security@veil-extension.dev** with:

1. A clear description of the vulnerability.
2. Steps to reproduce (proof-of-concept if possible).
3. Potential impact assessment.
4. Your preferred contact method for follow-up.

You will receive an acknowledgement within **48 hours** and a status update within **7 days**.

If a fix is warranted, we will coordinate a disclosure timeline with you (typically 90 days).

---

## Threat Model

Veil operates entirely client-side. The surfaces most relevant to security researchers are:

| Surface | Notes |
|---------|-------|
| Content script ↔ page DOM | `innerHTML` injection paths — all user-controlled strings must be `escapeHtml()`-escaped |
| Content script ↔ background message | Structured-clone boundary; validate all message shapes |
| Background ↔ local Python server | HTTP on `127.0.0.1:8765` — no CSRF/Origin check yet (known, tracked) |
| `chrome.storage.local` | API key stored; no sync, no cloud exposure |
| Custom regex patterns | Executed client-side; regex DoS (ReDoS) possible with malicious patterns |

---

## Known Accepted Risks

- **Local server Origin validation**: The GLiNER2 server at `127.0.0.1:8765` does not currently validate the `Origin` header. This is acceptable because the server is only accessible from localhost and does not mutate persistent state. Tracking issue: #TBD.

---

## Hall of Fame

Responsible disclosures that lead to a fix will be credited here (with permission).
