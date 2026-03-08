---
layout: default
title: Contributing
nav_order: 4
---

# Contributing to Veil
{: .no_toc }

Thank you for your interest in contributing. Veil is a privacy tool — contributions that strengthen detection accuracy, broaden platform coverage, or improve user experience are especially welcome.

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Before You Start

1. **Search existing issues** before opening a new one — your bug or idea may already be tracked
2. **Comment on an issue to claim it** before starting work, so effort isn't duplicated
3. Look for issues labelled `good first issue` or `help wanted` if you're new to the codebase

---

## Development Setup

See [**docs/DEVELOPMENT.md**](https://github.com/nishikantmandal007/Veil/blob/main/docs/DEVELOPMENT.md) in the repo for the full guide: Python server setup, Chrome sideload instructions, and hot-reload tips.

Quick check after setup:

```bash
# Validate JS syntax
node --check extension/content.js extension/background.js extension/popup.js

# Run all tests
npm run test:unit
npm run test:unit:python
```

---

## Commit Convention

Veil uses [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `perf:` | Performance improvement |
| `refactor:` | Code restructure, no behavior change |
| `docs:` | Documentation only |
| `test:` | Adding or updating tests |
| `chore:` | Tooling, build, CI |

Example: `feat: add Firefox manifest v3 support`

---

## Pull Request Process

1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Make your changes, add or update tests where applicable
3. Run `npm run test:unit` and `npm run test:unit:python` — all must pass
4. Fill in the PR template completely
5. Open the PR against `main` — one maintainer approval required to merge

---

## Reporting Bugs

Use the [Bug Report template](https://github.com/nishikantmandal007/Veil/issues/new?template=bug_report.md). Include:

- Your OS and Chrome version
- Steps to reproduce
- Expected vs actual behaviour
- Console output (F12 → Console tab, filter by `content.js` or `background.js`)

---

## Requesting Features

Use the [Feature Request template](https://github.com/nishikantmandal007/Veil/issues/new?template=feature_request.md). Describe the **problem** the feature solves, not just the solution.

---

## Security Vulnerabilities

**Do not open a public issue for security vulnerabilities.**

See [docs/SECURITY.md](https://github.com/nishikantmandal007/Veil/blob/main/docs/SECURITY.md) for responsible disclosure instructions.

---

## Code of Conduct

Be respectful. Harassment, discrimination, or hostile behaviour will not be tolerated. Constructive disagreement is welcome; personal attacks are not.
