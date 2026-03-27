# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.1](https://github.com/nishikantmandal007/Veil/compare/veil-v1.1.0...veil-v1.1.1) (2026-03-27)


### Bug Fixes

* **ci:** summarize release-please outputs in workflow summary ([fcfc912](https://github.com/nishikantmandal007/Veil/commit/fcfc91241dc889b3b51b651035dd1327f89ace5d))

## [1.1.0](https://github.com/nishikantmandal007/Veil/compare/veil-v1.0.0...veil-v1.1.0) (2026-03-09)


### Features

* Add dependabot configuration for automated dependency updates ([097a7b8](https://github.com/nishikantmandal007/Veil/commit/097a7b8c1ce75c3b2d6c5899677e2406879404fe))
* Add GitHub Actions for CI, CodeQL, and Dependabot, and update README badges. ([4798939](https://github.com/nishikantmandal007/Veil/commit/4798939443f05244c0611e0a6ff774e633f3380c))
* Add JWT utility functions and simplify CSS animations and transitions across various UI elements. ([df79936](https://github.com/nishikantmandal007/Veil/commit/df79936617469732010d924de590367d70b70062))
* enhance UI with design tokens and improve styling for various elements ([b66bff7](https://github.com/nishikantmandal007/Veil/commit/b66bff7ed164b0cfb9660bd20f549a6081eea752))
* implement reveal overlay for redacted text and enhance external highlights ([2f20499](https://github.com/nishikantmandal007/Veil/commit/2f2049910301d4b19850e432fa8742cd2fc0a57a))
* Integrate MayaData anonymization service with JWT token management and API communication. ([fe63c51](https://github.com/nishikantmandal007/Veil/commit/fe63c514b351b850ee96dff11f9d2bbfcdcfc202))
* Major feature additions — GLiNER2 server integration, custom PII types, cross-platform install scripts, tests ([7c75332](https://github.com/nishikantmandal007/Veil/commit/7c75332db1b1cccb02d4962ddcdf34cb027d6b50))
* migrate storage from chrome.storage.sync to chrome.storage.local ([b4d16c0](https://github.com/nishikantmandal007/Veil/commit/b4d16c0bc77ad70038b24b2347a0c3646e09fb67))
* Refactor content-editable rendering to use string-based HTML generation with delegated event listeners, improve detection filtering to prevent overlaps, and enhance synthetic token recognition. ([1734b89](https://github.com/nishikantmandal007/Veil/commit/1734b8911551d81dc7031d53484309b85e960693))
* Rename extension to "Veil" and enhance UI ([db526fa](https://github.com/nishikantmandal007/Veil/commit/db526fa00ce7457213c4a1afc5ebbe2908d5c909))
* Rename project to Veil, update package metadata, and add GitHub funding configuration. ([83ab788](https://github.com/nishikantmandal007/Veil/commit/83ab7888b71c1af7a5c04330888cc28de1877b35))


### Bug Fixes

* ensure build script output path is absolute and correct manifest path in release workflow. ([fe10b68](https://github.com/nishikantmandal007/Veil/commit/fe10b68385d0847c8ab3a0c915d07526a7ccf70b))
* Update CI pip install to use `--extra-index-url` for PyTorch wheels. ([7593711](https://github.com/nishikantmandal007/Veil/commit/75937111bf759cf4219a91adedcc4e6751776e7e))
* Update README to enhance clarity and improve branding with new logo and descriptions ([bf8c9ed](https://github.com/nishikantmandal007/Veil/commit/bf8c9edebd22457905103b881482f75dd28c92eb))

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
