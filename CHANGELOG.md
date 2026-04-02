# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.4] - 2026-04-02

### Update UX and Backend Tracking

- Split extension and backend release state in the popup/settings UI so Veil can clearly show mixed states like “extension behind, backend already updated” instead of masking backend success behind one generic update warning.
- Refreshed release-state checks whenever the popup or settings view regains focus, reducing the need to close and reopen Veil after refreshing the local server bundle.
- Surfaced missing backend release metadata as a one-time refresh step instead of incorrectly implying that the installed backend is definitely outdated.
- Fixed Unix release metadata stamping so the stored backend `html_url` is extracted from the actual GitHub release payload instead of occasionally capturing an unrelated nested URL.
- Embedded canonical release metadata directly into the backend bundles so local installs can verify the installed server version even when `api.github.com` is temporarily rate-limited or unavailable.
- Updated the Unix and Windows installers to stamp `.runtime/bundle_release.json` from the bundled metadata and add `installed_at` locally instead of depending on a live GitHub API call during install.
- Changed the settings popup/update surface to treat GitHub latest-release lookups as best-effort only: Veil now shows a verified local bundle state when installed metadata is known, and falls back to “backend version unknown” when both GitHub and local metadata are unavailable.

### Settings and Maintenance

- Fixed settings-page sidebar navigation so section headers land fully below the sticky control bar, improved bottom-of-page scroll-spy behavior, and made the `About` section reliably selectable.
- Moved local server uninstall into Diagnostics so setup, logs, runtime details, and repair actions live in one Local Server workflow.
- Polished the Local Server maintenance surface with clearer recovery copy and a more explicit uninstall command section for removing the native host, autostart entry, and installed backend bundle.

### Regex Detection

- Unified Veil’s built-in sensitive-token patterns into one shared regex catalog used by the background runtime, popup/options editor, and content-side settings normalization, eliminating drift between UI and detection behavior.
- Updated the online regex toggle to govern all regex-based detectors while GLiNER is healthy, while keeping regex fallback automatic when the local server is offline.
- Expanded the built-in regex catalog coverage for GitHub tokens, IPv6, PAN, Aadhaar, passport, IFSC, and Indian driver-license patterns, and ensured explicit regex replacements are respected even in anonymize mode for token-style detections.
- Added a shared regex smoke corpus and hostile-editor E2E fixtures so built-in and custom regex detectors are verified in online, offline, and internal-scroll scenarios without depending on a live local server.

### Overlay and Onboarding Polish

- Reworked hostile-editor overlay refresh so external highlight boxes are rebuilt from tracked state, clipped to the visible editor scroll bounds, and refreshed through one anchored UI scheduler instead of lingering as stray floating boxes during Gemini-style internal scrolling.
- Stabilized hostile-editor overlay highlights by updating them in place instead of destroying and recreating them on every layout pass, reducing visible flicker in Gemini/Claude-style editors.
- Added a stable hover-intent reveal card for redacted hostile-editor overlays so original text stays readable while moving the pointer from the token to the reveal card.
- Added clearer live regex-runtime status notes to popup and settings so users can tell whether Veil is currently running in `AI only`, `AI + Regex`, or `Regex fallback` mode.
- Updated the setup flow styling to keep button text readable on hover and align the onboarding surface with Veil’s dashboard color language.

### Privacy Hardening

- Removed inline response de-anonymization from provider-owned chat threads so Veil no longer writes original PII back into ChatGPT/Gemini/Claude-style message history.
- Tightened ChatGPT input monitoring so historical user turns are never mistaken for live composer surfaces.
- Standardized anonymize-mode fallback so supported entities fall back to safe masking instead of alias placeholders when Maya anonymization is unavailable.
- Clarified popup/settings copy that Maya anonymization is the trusted remote path for supported labels, unsupported detections stay local, and Diagnostics are local-only troubleshooting data.

### Windows Installer

- Changed the Windows PowerShell installer to treat autostart registration as a warning when permissions block scheduled-task creation, allowing the core backend/native-host install to finish cleanly in non-admin sessions.
- Added a safe immediate-start step after install on Windows so Veil can start the local server for the current session when port `8765` is free, while still warning instead of failing if the server is already running or the port is occupied.
- Replaced the previous `cmd.exe`-only manual start guidance in the Windows autostart script with both Command Prompt and PowerShell-safe instructions.

## [1.2.3] - 2026-03-31

### Runtime and Packaging

- Included the Windows installer follow-up fix and regression test that harden the PowerShell install path and keep the release line aligned with commit `b26472e258d48cc0ca1631cbb409fa6d8d0d5a4c`.
- Tightened the local GLiNER2 server CORS behavior so it only reflects trusted browser-extension and localhost origins instead of sending a wildcard allow-origin header.

### Privacy UX and Settings

- Persisted the Maya anonymization seed in extension storage so anonymized replacements stay stable across sessions instead of changing on each browser restart.
- Switched first-use defaults and guidance toward mask mode, including one-time mask-mode hints in both the popup and content-script flow so users understand the zero-setup path before opting into anonymization.
- Polished the onboarding overlay layout for popup-sized surfaces and replaced the welcome icon with the Veil brand asset for a cleaner first-run experience.
- Escaped custom pattern and custom entity labels before rendering them in the popup/settings UI, closing an HTML injection path in user-supplied display text.

## [1.2.2] - 2026-03-27

### Runtime and Packaging

- Replaced the ad-hoc `venv + pip + requirements.txt` bootstrap path with a pinned `uv` runtime contract: `uv 0.10.7`, managed Python `3.11.11`, project metadata in `pyproject.toml`, and a committed `uv.lock` for deterministic installs.
- Updated the Linux and Windows installers to provision Veil’s runtime inside the install directory, preserve `.env` and `.runtime`, rebuild incompatible environments in place, and stop Veil-owned processes before overwriting backend files.
- Switched backend bundle creation to ship the uv metadata files required for offline-consistent runtime sync and removed the now-obsolete `requirements.txt` dependency definition.
- Fixed the Windows PowerShell installer path that previously failed on fresh systems when `schtasks /end` was called for a missing legacy task, and migrated autostart/native-host identifiers from the old `PrivacyShield...` naming to Veil-branded names with cleanup for both generations during reinstall and uninstall.

### Native Host and Local Server Control

- Extended the native messaging host with explicit `restart` support, richer runtime metadata, and settings-page diagnostics for the managed Python path, pinned uv binary, and local port ownership state.
- Tightened server lifecycle semantics so Veil only stops Veil-owned backend processes discovered from tracked PID state or Veil-specific command lines under the current install directory.
- Added non-destructive port-conflict handling for `127.0.0.1:8765`: when another local process owns the port, Veil now reports the conflict in the settings UI instead of attempting to terminate it.
- Added a dedicated Unix native-host launcher that always executes the Veil-managed interpreter, aligning Chrome native-messaging startup with the same local `.venv` used by manual start, autostart, and backend tests.

### Settings Experience

- Promoted the settings page into the primary post-install control surface by adding an explicit `Restart Server` action alongside the existing start/stop/refresh controls.
- Expanded diagnostics to expose the active GLiNER2 model, runtime directory, managed interpreter version, uv version, log path, and live port state so runtime failures are debuggable without opening a terminal.
- Carried forward the last 20 upstream commits’ release and installer work into a single technical release narrative: manual tag-based publishing, backend release metadata, richer update notices, improved popup/options server management, backend server tests, and hardened reinstall/uninstall paths.

### Release Engineering and Tests

- Migrated Python CI and release jobs to `astral-sh/setup-uv` and `uv sync --frozen`, so test and release workflows now validate the same locked runtime that end users install.
- Added native-host unit coverage for port-conflict detection, ownership-safe stop behavior, and restart sequencing, plus popup/options E2E coverage for the new restart control.
- Cleaned up release documentation so contributor setup, test commands, and manual release steps all reference the uv-managed runtime rather than the removed `requirements.txt` flow.

## [1.2.0] - 2026-03-27


### Features

* Add dependabot configuration for automated dependency updates ([097a7b8](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/097a7b8c1ce75c3b2d6c5899677e2406879404fe))
* Add GitHub Actions for CI, CodeQL, and Dependabot, and update README badges. ([4798939](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/4798939443f05244c0611e0a6ff774e633f3380c))
* Add JWT utility functions and simplify CSS animations and transitions across various UI elements. ([df79936](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/df79936617469732010d924de590367d70b70062))
* enhance UI with design tokens and improve styling for various elements ([b66bff7](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/b66bff7ed164b0cfb9660bd20f549a6081eea752))
* implement reveal overlay for redacted text and enhance external highlights ([2f20499](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/2f2049910301d4b19850e432fa8742cd2fc0a57a))
* Integrate MayaData anonymization service with JWT token management and API communication. ([fe63c51](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/fe63c514b351b850ee96dff11f9d2bbfcdcfc202))
* Major feature additions — GLiNER2 server integration, custom PII types, cross-platform install scripts, tests ([7c75332](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/7c75332db1b1cccb02d4962ddcdf34cb027d6b50))
* migrate storage from chrome.storage.sync to chrome.storage.local ([b4d16c0](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/b4d16c0bc77ad70038b24b2347a0c3646e09fb67))
* Refactor content-editable rendering to use string-based HTML generation with delegated event listeners, improve detection filtering to prevent overlaps, and enhance synthetic token recognition. ([1734b89](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/1734b8911551d81dc7031d53484309b85e960693))
* Rename extension to "Veil" and enhance UI ([db526fa](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/db526fa00ce7457213c4a1afc5ebbe2908d5c909))
* Rename project to Veil, update package metadata, and add GitHub funding configuration. ([83ab788](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/83ab7888b71c1af7a5c04330888cc28de1877b35))


### Bug Fixes

* **ci:** summarize release-please outputs in workflow summary ([36d26df](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/36d26df90cb8e5c12f304d8fbd05d7124540ae63))
* ensure build script output path is absolute and correct manifest path in release workflow. ([fe10b68](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/fe10b68385d0847c8ab3a0c915d07526a7ccf70b))
* Update CI pip install to use `--extra-index-url` for PyTorch wheels. ([7593711](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/75937111bf759cf4219a91adedcc4e6751776e7e))
* Update README to enhance clarity and improve branding with new logo and descriptions ([bf8c9ed](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/bf8c9edebd22457905103b881482f75dd28c92eb))

## [1.1.1] - 2026-03-27


### Bug Fixes

* **ci:** summarize release-please outputs in workflow summary ([36d26df](https://github.com/MAYA-DATA-PRIVACY/Veil/commit/36d26df90cb8e5c12f304d8fbd05d7124540ae63))

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
