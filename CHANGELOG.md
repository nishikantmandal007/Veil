# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2025-03-08

### Added

- Real-time PII detection via local GLiNER2 NER model (zero server calls for inference).
- Regex fallback engine for offline / pattern-only detection.
- Format-preserving redaction for both `<br>`-based (ChatGPT, Claude) and `<p>`-based (Gemini) contenteditables.
- Grammarly-style wavy underline for detected PII before redaction.
- Hover-to-preview: hovering a redacted token temporarily reveals the original text.
- Per-entity colour theming via CSS custom properties.
- Scanning pill indicator with minimal pulse animation.
- Popup redesign: 3-panel carousel (HF Token · API Key · Diagnostics).
- API key authentication replacing JWT — stored in `chrome.storage.local`, never transmitted unencrypted.
- Show / Hide / Remove API key controls with eye toggle.
- Custom regex pattern support with label colours.
- Token tray: allowlist / blocklist tokens from popover.
- Keyboard shortcut: `Alt+Shift+V` to toggle redaction.
- `chrome.storage.local` used for all sensitive data (no sync leakage).
- Comprehensive `.gitignore`, `.editorconfig`, `CONTRIBUTING.md`, `SECURITY.md`, GitHub issue/PR templates.
- MIT licence.

### Fixed

- Gemini new-line bug: `<p>`-based contenteditables now correctly preserve line breaks on re-render.
- Hover delegation bug: switched from `mouseenter`/`mouseleave` (non-bubbling) to `mouseover`/`mouseout` so delegated listeners fire on child spans.
- XSS vector: `labelText` in popover now HTML-escaped before `innerHTML` injection.
- `escapeHtml` performance: replaced DOM-element approach with pure string replaces.
- DOM pollution: `element._psListenersAttached` replaced with `WeakSet`.
- Duplicate dead variable (`allRestored`) removed.
- Code-block placeholder regex: used `^` anchor to avoid matching wrong placeholder.
