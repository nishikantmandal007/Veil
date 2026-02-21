// content.js - Grammarly-style PII detection & redaction for input fields only
// LLM response areas are NEVER scanned or modified.

const DEFAULT_MONITORED_SELECTORS = [
  'textarea',
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input:not([type])',
  'div[contenteditable="true"]',
  '[role="textbox"]',
  '.ProseMirror'
];

const DEFAULT_CUSTOM_PATTERNS = [
  {
    id: 'openai_key',
    label: 'api_key',
    pattern: '\\bsk-[A-Za-z0-9]{20,}\\b',
    flags: 'g',
    score: 0.99,
    replacement: '[API KEY REDACTED]',
    enabled: true
  },
  {
    id: 'aws_access_key',
    label: 'api_key',
    pattern: '\\bAKIA[0-9A-Z]{16}\\b',
    flags: 'g',
    score: 0.99,
    replacement: '[AWS KEY REDACTED]',
    enabled: true
  },
  {
    id: 'jwt_token',
    label: 'jwt',
    pattern: '\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b',
    flags: 'g',
    score: 0.97,
    replacement: '[JWT REDACTED]',
    enabled: true
  },
  {
    id: 'ipv4',
    label: 'ip_address',
    pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\b',
    flags: 'g',
    score: 0.96,
    replacement: '[IP REDACTED]',
    enabled: true
  },
  {
    id: 'ssn',
    label: 'ssn',
    pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
    flags: 'g',
    score: 0.99,
    replacement: '[SSN REDACTED]',
    enabled: true
  }
];

const TYPING_IDLE_DELAY_MS = 1200;
const PASTE_IDLE_DELAY_MS = 750;
const BLUR_DELAY_MS = 80;
const SUPPRESS_INPUT_MS = 90;
const AUTO_REDACT_DELAY_MS = 1500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Selectors that identify known LLM response / output areas ──
const RESPONSE_AREA_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-is-streaming]',
  '.assistant-message',
  '.markdown-body',
  '.response-container',
  '[class*="response"]',
  '[class*="answer"]',
  '.prose',                               // Claude response bodies
  '.result-streaming',                    // ChatGPT streaming
  '.agent-turn',                          // Gemini
  '[data-testid="conversation-turn-"]',
  '.message--assistant',
  '.bot-message',
  '.ai-message',
  '.chat-answer'
];

class PrivacyShield {
  constructor() {
    this.settings = null;
    this.isEnabled = false;
    this.overlay = null;
    this.pageStats = { detections: 0, redactions: 0 };

    this.monitoredElements = new Map();
    this.redactions = new Map();        // element → { sourceText, sourceHtml, mode, items[] }
    this.aliasLedgers = new WeakMap();
    this.lastDetectionSignature = new Map();
    this.debounceTimers = new Map();
    this.inputRevisions = new Map();
    this.lastAnalyzedSnapshot = new Map();
    this.postInteractionTimers = new Map();
    this.suppressedInput = new WeakSet();
    this.tokenTrays = new Map();
    this.scanningPills = new WeakMap();
    this.actionBars = new WeakMap();
    this.autoRedactTimers = new Map();
    this.dismissedDetections = new WeakMap(); // element → Set of "start:end:label"
    this._lastJwtNotificationTs = 0; // cooldown timestamp for JWT expiry notifications

    this.activePopover = null;
    this.activePopoverHideTimer = null;

    this.domObserver = null;
    this.stateReconcileTimer = null;
    this.handleViewportChange = () => this.repositionTokenTrays();
    this.handleRuntimeMessage = this.handleRuntimeMessage.bind(this);
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage);

    this.init();
  }

  // ═══════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════

  async init() {
    await this.loadSettings();

    if (!this.settings.enabled) return;
    if (!this.isSiteMonitored()) return;

    this.isEnabled = true;
    this.createOverlay();
    await this.initializeModel();
    this.startMonitoring();

    // Rehydrate cached redactions
    this.rehydrateCachedRedactions();
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([
        'enabled',
        'autoRedact',
        'redactionMode',
        'sensitivity',
        'includeRegexWhenModelOnline',
        'enabledTypes',
        'monitorAllSites',
        'monitoredSites',
        'monitoredSelectors',
        'customPatterns'
      ], (result) => {
        this.settings = {
          enabled: result.enabled ?? true,
          autoRedact: result.autoRedact ?? true,
          redactionMode: result.redactionMode ?? 'anonymize',
          sensitivity: result.sensitivity ?? 'medium',
          includeRegexWhenModelOnline: result.includeRegexWhenModelOnline ?? false,
          enabledTypes: result.enabledTypes ?? ['person', 'email', 'phone', 'address', 'ssn', 'credit_card'],
          monitorAllSites: result.monitorAllSites ?? true,
          monitoredSites: result.monitoredSites ?? ['claude.ai', 'gemini.google.com', 'chatgpt.com'],
          monitoredSelectors: Array.isArray(result.monitoredSelectors) && result.monitoredSelectors.length > 0
            ? result.monitoredSelectors
            : DEFAULT_MONITORED_SELECTORS,
          customPatterns: Array.isArray(result.customPatterns) && result.customPatterns.length > 0
            ? result.customPatterns
            : DEFAULT_CUSTOM_PATTERNS
        };
        resolve();
      });
    });
  }

  isSiteMonitored() {
    if (this.settings.monitorAllSites) return true;
    const host = window.location.hostname;
    return this.settings.monitoredSites.some((site) => host.includes(site));
  }

  async initializeModel() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'initialize' });
      if (response?.mode) {
        console.debug('[Privacy Shield] detection mode:', response.mode);
      }
    } catch (error) {
      console.error('[Privacy Shield] initialize failed:', error);
    }
  }

  createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'privacy-shield-overlay';
    this.overlay.className = 'ps-overlay';
    document.body.appendChild(this.overlay);
  }

  // ═══════════════════════════════════════════════════════════
  // Response Area Exclusion
  // ═══════════════════════════════════════════════════════════

  isResponseArea(element) {
    if (!element) return false;

    // Check the element itself and all ancestors
    for (const selector of RESPONSE_AREA_SELECTORS) {
      try {
        if (element.matches(selector) || element.closest(selector)) {
          return true;
        }
      } catch { /* invalid selector on some pages, skip */ }
    }

    // Additional heuristic: aria-label containing response/output/answer
    const aria = (element.getAttribute('aria-label') || '').toLowerCase();
    if (/\b(response|output|answer|reply|result)\b/.test(aria)) {
      return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // Element Monitoring
  // ═══════════════════════════════════════════════════════════

  startMonitoring() {
    this.findInputElements();
    this.startStateReconciler();

    this.domObserver = new MutationObserver((mutations) => {
      // Immediately clean up state for tracked elements that were removed from DOM
      for (const mutation of mutations) {
        for (const removed of mutation.removedNodes) {
          if (!(removed instanceof HTMLElement)) continue;
          // Check if the removed node itself is tracked
          if (this.redactions.has(removed)) {
            this.clearElementState(removed);
          }
          // Check children of the removed subtree
          if (removed.querySelectorAll) {
            this.monitoredElements.forEach((_listeners, element) => {
              if (removed.contains(element)) {
                this.clearElementState(element);
              }
            });
          }
        }
      }
      this.findInputElements();
    });
    this.domObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('scroll', this.handleViewportChange, true);
    window.addEventListener('resize', this.handleViewportChange);

    chrome.storage.onChanged.addListener((changes) => {
      if (
        changes.enabled ||
        changes.autoRedact ||
        changes.redactionMode ||
        changes.sensitivity ||
        changes.includeRegexWhenModelOnline ||
        changes.enabledTypes ||
        changes.monitorAllSites ||
        changes.monitoredSites ||
        changes.monitoredSelectors ||
        changes.customPatterns
      ) {
        this.loadSettings().then(() => {
          if (!this.settings.enabled || !this.isSiteMonitored()) {
            this.stopMonitoring();
          } else {
            this.findInputElements();
          }
        });
      }
    });
  }

  findInputElements() {
    this.pruneDisconnectedMonitoredElements();

    this.settings.monitoredSelectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element) => {
        if (!this.isElementEligible(element)) return;
        if (!this.monitoredElements.has(element)) {
          this.attachListeners(element);
        }
      });
    });

    // Some editors clear content programmatically after send without emitting
    // input/blur. Ensure stale highlights are removed.
    this.monitoredElements.forEach((_listeners, element) => {
      if (!this.redactions.has(element)) return;
      const text = this.getRawElementText(element);
      if (!text || text.trim().length < 1) {
        this.clearElementState(element);
        // Clear stale caches to prevent cross-contamination with new composer elements
        this.dismissedDetections.delete(element);
        this.aliasLedgers.delete(element);
      }
    });
  }

  startStateReconciler() {
    if (this.stateReconcileTimer) {
      clearInterval(this.stateReconcileTimer);
      this.stateReconcileTimer = null;
    }
    this.stateReconcileTimer = setInterval(() => this.reconcileElementStates(), 700);
  }

  reconcileElementStates() {
    this.redactions.forEach((_state, element) => {
      if (!element?.isConnected) {
        this.clearElementState(element);
        return;
      }
      if (this.isResponseArea(element)) {
        this.clearElementState(element);
        return;
      }
      if (!this.monitoredElements.has(element)) {
        this.clearElementState(element);
        return;
      }

      const raw = this.getRawElementText(element);
      if (!raw || raw.trim().length < 1) {
        this.clearElementState(element);
      }
    });

    // ── Global orphan sweep: remove UI elements whose tracked element is gone ──
    this.cleanupOrphanedUIElements();
  }

  cleanupOrphanedUIElements() {
    const trackedIds = new Set();
    this.monitoredElements.forEach((_listeners, element) => {
      if (element?.isConnected && element.dataset?.psId) {
        trackedIds.add(element.dataset.psId);
      }
    });

    // Remove orphaned highlight overlays
    document.querySelectorAll('.ps-highlight[data-element-id]').forEach((node) => {
      const id = node.getAttribute('data-element-id');
      if (!id || !trackedIds.has(id)) {
        node.remove();
      }
    });

    // Remove orphaned action bars by DOM selector
    document.querySelectorAll('.ps-action-bar[data-element-id]').forEach((bar) => {
      const id = bar.getAttribute('data-element-id');
      if (!id || !trackedIds.has(id)) {
        bar.remove();
      }
    });

    // Remove orphaned scanning pills (stale > 8s)
    document.querySelectorAll('.ps-scanning-pill').forEach((pill) => {
      if (pill.dataset.psCreated && Date.now() - Number(pill.dataset.psCreated) > 8000) {
        pill.remove();
      }
    });

    // actionBars and scanningPills are WeakMaps — they have no forEach.
    // WeakMap will garbage-collect entries when the element is GC'd.
    // Only tokenTrays (a regular Map) needs explicit cleanup.
    this.tokenTrays.forEach((tray, element) => {
      if (!element?.isConnected) {
        tray.remove();
        this.tokenTrays.delete(element);
      }
    });
  }

  pruneDisconnectedMonitoredElements() {
    this.monitoredElements.forEach((listeners, element) => {
      if (element?.isConnected) return;
      this.cancelPostInteractionCleanup(element);
      element.removeEventListener('input', listeners.handleInput);
      element.removeEventListener('paste', listeners.handlePaste);
      element.removeEventListener('blur', listeners.handleBlur);
      element.removeEventListener('keydown', listeners.handleKeydown);
      element.removeEventListener('compositionstart', listeners.handleCompositionStart);
      element.removeEventListener('compositionend', listeners.handleCompositionEnd);
      if (listeners.form && listeners.handleSubmit) {
        listeners.form.removeEventListener('submit', listeners.handleSubmit);
      }
      this.clearElementState(element);
      this.monitoredElements.delete(element);
      this.inputRevisions.delete(element);
      this.lastAnalyzedSnapshot.delete(element);
    });
  }

  schedulePostInteractionCleanup(element) {
    this.cancelPostInteractionCleanup(element);

    const timers = [];
    [180, 700, 1400].forEach((delay) => {
      const timer = setTimeout(() => {
        if (!this.redactions.has(element)) return;
        const raw = this.getRawElementText(element);
        if (!raw || raw.trim().length < 1 || this.isResponseArea(element)) {
          this.clearElementState(element);
        }
      }, delay);
      timers.push(timer);
    });

    this.postInteractionTimers.set(element, timers);
  }

  cancelPostInteractionCleanup(element) {
    const timers = this.postInteractionTimers.get(element);
    if (!timers) return;
    timers.forEach((timer) => clearTimeout(timer));
    this.postInteractionTimers.delete(element);
  }

  isElementEligible(element) {
    if (!element || !(element instanceof HTMLElement)) return false;
    if (!element.isConnected) return false;

    // ── CRITICAL: never scan LLM response areas ──
    if (this.isResponseArea(element)) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 24) return false;

    if (element.matches('textarea, input')) {
      if (element.disabled || element.readOnly) return false;
      if (element.getAttribute('aria-hidden') === 'true') return false;
      return true;
    }

    const isEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true';
    const roleTextbox = element.getAttribute('role') === 'textbox';
    if (!isEditable && !roleTextbox) return false;
    if (element.getAttribute('aria-readonly') === 'true') return false;
    return true;
  }

  attachListeners(element) {
    const bumpAndSchedule = (reason) => {
      if (this.suppressedInput.has(element)) return;
      this.cancelPostInteractionCleanup(element);
      this.bumpInputRevision(element);
      this.scheduleDetection(element, reason);
    };
    const handleInput = () => bumpAndSchedule('typing');
    const handlePaste = () => bumpAndSchedule('paste');
    const handleBlur = () => {
      this.scheduleDetection(element, 'blur');
      this.schedulePostInteractionCleanup(element);
    };
    const handleCompositionStart = () => { element.dataset.psComposing = '1'; };
    const handleCompositionEnd = () => {
      element.dataset.psComposing = '';
      bumpAndSchedule('typing');
    };

    const handleKeydown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey && this.hasUnreviewedRedactions(element)) {
        event.preventDefault();
        this.showNotification('Review pending redactions before sending.', 'warning');
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.defaultPrevented) {
        // Immediately remove the highlight overlay so it doesn't linger
        this.clearHighlights(element);
        this.removeActionBar(element);
        this.hideScanningPill(element);
        this.schedulePostInteractionCleanup(element);
      }
    };

    element.addEventListener('input', handleInput);
    element.addEventListener('paste', handlePaste);
    element.addEventListener('blur', handleBlur);
    element.addEventListener('keydown', handleKeydown);
    element.addEventListener('compositionstart', handleCompositionStart);
    element.addEventListener('compositionend', handleCompositionEnd);

    const form = element.closest('form');
    let handleSubmit = null;
    if (form) {
      handleSubmit = (event) => {
        if (this.hasUnreviewedRedactions(element)) {
          event.preventDefault();
          this.showNotification('Review pending redactions before sending.', 'warning');
        }
        this.schedulePostInteractionCleanup(element);
      };
      form.addEventListener('submit', handleSubmit);
    }

    this.monitoredElements.set(element, {
      handleInput,
      handlePaste,
      handleBlur,
      handleKeydown,
      handleCompositionStart,
      handleCompositionEnd,
      form,
      handleSubmit
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Input Revision Tracking
  // ═══════════════════════════════════════════════════════════

  bumpInputRevision(element) {
    const current = this.inputRevisions.get(element) || 0;
    const next = current + 1;
    this.inputRevisions.set(element, next);
    return next;
  }

  getInputRevision(element) {
    return this.inputRevisions.get(element) || 0;
  }

  // ═══════════════════════════════════════════════════════════
  // Detection Scheduling
  // ═══════════════════════════════════════════════════════════

  scheduleDetection(element, reason = 'typing') {
    const isComposing = element.dataset.psComposing === '1';
    if (isComposing && reason !== 'blur') return;

    if (this.debounceTimers.has(element)) {
      clearTimeout(this.debounceTimers.get(element));
    }

    const targetRevision = this.getInputRevision(element);
    const delay = reason === 'blur'
      ? BLUR_DELAY_MS
      : reason === 'paste'
        ? PASTE_IDLE_DELAY_MS
        : TYPING_IDLE_DELAY_MS;

    if (reason === 'typing' || reason === 'paste') {
      element.classList.add('ps-awaiting-idle');
    }

    const timer = setTimeout(() => {
      const currentRevision = this.getInputRevision(element);
      if (currentRevision !== targetRevision) return;
      element.classList.remove('ps-awaiting-idle');
      this.detectAndHighlight(element, currentRevision);
    }, delay);

    this.debounceTimers.set(element, timer);
  }

  // ═══════════════════════════════════════════════════════════
  // Scanning Pill ("🛡 Anonymising…")
  // ═══════════════════════════════════════════════════════════

  showScanningPill(element) {
    let pill = this.scanningPills.get(element);
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'ps-scanning-pill';
      pill.innerHTML = '🛡&nbsp;Anonymising…';
      document.body.appendChild(pill);
      this.scanningPills.set(element, pill);
    }

    const rect = element.getBoundingClientRect();
    pill.style.top = `${window.scrollY + rect.top - 28}px`;
    pill.style.left = `${window.scrollX + rect.right - 140}px`;

    requestAnimationFrame(() => pill.classList.add('ps-scanning-pill-visible'));
  }

  hideScanningPill(element) {
    const pill = this.scanningPills.get(element);
    if (!pill) return;
    pill.classList.remove('ps-scanning-pill-visible');
    setTimeout(() => {
      pill.remove();
      this.scanningPills.delete(element);
    }, 220);
  }

  // ═══════════════════════════════════════════════════════════
  // Detection & Highlight (core pipeline)
  // ═══════════════════════════════════════════════════════════

  async detectAndHighlight(element, expectedRevision = null) {
    const currentRevision = this.getInputRevision(element);
    if (expectedRevision !== null && expectedRevision !== currentRevision) return;

    const sourceText = this.getElementText(element);
    const snapshotKey = `${currentRevision}:${this.hashString(sourceText)}`;
    if (this.lastAnalyzedSnapshot.get(element) === snapshotKey) return;
    const currentState = this.redactions.get(element);

    // Prevent re-detect loops when the semantic source text has not changed.
    if (currentState?.sourceText === sourceText) {
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
      return;
    }

    if (!sourceText || sourceText.trim().length < 3) {
      this.clearElementState(element);
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
      return;
    }

    this.setAnalyzingState(element, true);
    this.showScanningPill(element);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'detectPII',
        text: sourceText,
        options: {
          redactionMode: this.settings.redactionMode,
          threshold: this.getSensitivityThreshold(),
          enabledTypes: this.settings.enabledTypes,
          customPatterns: this.settings.customPatterns,
          includeRegexWhenModelOnline: this.settings.includeRegexWhenModelOnline
        }
      });

      // ── JWT expiry notification (inline, from detectPII response) ──
      if (response?.jwtExpired || response?.jwtError) {
        this.handleJwtExpiry(
          response.jwtExpired
            ? '⚠️ Anonymization JWT has expired. Update it in extension settings.'
            : `⚠️ Anonymization error: ${response.jwtError}`
        );
      }

      if (!response?.success || !Array.isArray(response.detections) || response.detections.length === 0) {
        this.clearElementState(element);
        this.lastAnalyzedSnapshot.set(element, snapshotKey);
        return;
      }

      if (expectedRevision !== null && expectedRevision !== this.getInputRevision(element)) return;

      let detections = response.detections;

      // ── Dedup: filter out dismissed and already-handled detections ──
      const dismissed = this.dismissedDetections.get(element) || new Set();
      detections = detections.filter((d) => {
        const key = `${d.start}:${d.end}:${d.label}`;
        return !dismissed.has(key);
      });
      detections = detections.filter((d) => !this.isSyntheticReplacementToken(d.text));

      // ── Prevent re-anonymisation of already-treated text ──
      // If there is existing state, filter out detections whose text matches
      // any known replacement token or alias from the current redactions.
      if (currentState && currentState.items.length > 0) {
        const knownReplacements = new Set();
        currentState.items.forEach((item) => {
          if (item.alias) knownReplacements.add(`<${item.alias}>`);
          if (item.anonymizedText) knownReplacements.add(item.anonymizedText);
          if (item.replacement) knownReplacements.add(item.replacement);
          // Also add the mask text variants
          knownReplacements.add(this.getMaskText(item.label));
        });
        detections = detections.filter((d) => {
          const text = String(d.text || '').trim();
          return !knownReplacements.has(text);
        });
      }

      const existingState = currentState;
      let newDetections = detections;
      if (existingState) {
        newDetections = this.mergeWithExistingDetections(existingState, detections);
      }

      // Carry forward ALL existing items (already redacted/reviewed)
      // and append only genuinely new detections.
      const existingItems = existingState ? existingState.items : [];

      // Update offsets of existing items to match new sourceText
      const updatedExistingItems = existingItems.map((item) => {
        const newOffset = sourceText.indexOf(item.text, Math.max(0, item.start - 50));
        if (newOffset !== -1) {
          return { ...item, start: newOffset, end: newOffset + item.text.length };
        }
        // Fallback: search anywhere
        const fallback = sourceText.indexOf(item.text);
        if (fallback !== -1) {
          return { ...item, start: fallback, end: fallback + item.text.length };
        }
        return item; // keep old offsets if text vanished
      });

      const ledger = this.getAliasLedger(element);
      const newItems = newDetections
        .map((detection) => this.createRedactionItem(detection, ledger, null));

      const allItems = [...updatedExistingItems, ...newItems]
        .slice()
        .sort((a, b) => a.start - b.start);

      if (allItems.length === 0) {
        this.hideScanningPill(element);
        this.setAnalyzingState(element, false);
        return;
      }

      const allDetectionsForSignature = allItems.map((i) => ({
        label: i.label, start: i.start, end: i.end
      }));
      const signature = this.buildSignature(sourceText, allDetectionsForSignature);
      if (this.lastDetectionSignature.get(element) === signature) {
        this.hideScanningPill(element);
        this.setAnalyzingState(element, false);
        return;
      }

      this.lastDetectionSignature.set(element, signature);
      this.renderFieldHighlight(element, allDetectionsForSignature);

      const state = {
        sourceText,
        sourceHtml: this.isContentEditableElement(element)
          ? this.captureContentEditableHtml(element)
          : null,
        mode: this.settings.redactionMode,
        items: allItems
      };

      this.redactions.set(element, state);

      // Render: existing redacted items stay redacted, new items get underlines
      this.renderElement(element);
      this.showActionBar(element, state);

      // Auto-redact after delay if setting is on
      if (this.settings.autoRedact) {
        this.scheduleAutoRedact(element);
      }

      this.updateStats(newItems.filter((i) => !i.redacted).length, 0);
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
    } catch (error) {
      console.error('[Privacy Shield] detection error:', error);
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
    } finally {
      this.hideScanningPill(element);
      this.setAnalyzingState(element, false);
    }
  }

  mergeWithExistingDetections(existingState, newDetections) {
    // Filter out detections whose TEXT + LABEL already exists in the
    // current state. This handles the case where the user added more
    // text, shifting offsets of previously-redacted items.
    const existing = existingState.items;
    return newDetections.filter((nd) => {
      const textLower = String(nd.text || '').toLowerCase();
      const labelLower = String(nd.label || '').toLowerCase();
      return !existing.some((ex) => {
        // Match by text + label (offset-independent)
        const exTextLower = String(ex.text || '').toLowerCase();
        const exLabelLower = String(ex.label || '').toLowerCase();
        return exTextLower === textLower && exLabelLower === labelLower;
      });
    });
  }

  buildSignature(sourceText, detections) {
    const entries = detections.map((item) => `${item.label}:${item.start}:${item.end}`).join('|');
    return `${sourceText.length}:${this.settings.redactionMode}:${entries}`;
  }

  getSensitivityThreshold() {
    const map = { low: 0.75, medium: 0.62, high: 0.52 };
    return map[this.settings.sensitivity] || 0.62;
  }

  getElementText(element) {
    const state = this.redactions.get(element);

    if (element.isContentEditable || element.hasAttribute('contenteditable')) {
      // Reconstruct the TRUE user text by replacing redaction/underline
      // spans with their original values. This ensures the model always
      // sees real text (not masks like <PERSON_1>) and offsets stay
      // consistent across detection cycles.
      const clone = element.cloneNode(true);
      clone.querySelectorAll('.ps-redaction, .ps-pii-underline').forEach((span) => {
        const original = span.getAttribute('data-ps-original') || span.textContent || '';
        span.replaceWith(document.createTextNode(original));
      });
      const raw = clone.textContent || clone.innerText || '';
      const normalized = raw
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n');
      return this.restoreKnownRedactions(normalized, state);
    }

    const rawValue = element.value || '';
    if (!state || !Array.isArray(state.items) || state.items.length === 0) {
      return rawValue;
    }

    const hasRedactedItems = state.items.some((item) => item.redacted);
    if (!hasRedactedItems) return rawValue;

    const renderedFromState = this.buildRenderedText(state);
    if (rawValue === renderedFromState) {
      return state.sourceText || rawValue;
    }

    return this.restoreKnownRedactions(rawValue, state);
  }

  getRawElementText(element) {
    if (!element) return '';

    if (this.isContentEditableElement(element)) {
      const raw = element.textContent || element.innerText || '';
      return raw
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n');
    }

    return String(element.value || '');
  }

  restoreKnownRedactions(rawValue, state) {
    if (!state || !Array.isArray(state.items) || state.items.length === 0) {
      return String(rawValue || '');
    }

    let restored = String(rawValue || '');
    const redactedItems = state.items
      .filter((item) => item.redacted)
      .slice()
      .sort((a, b) => this.getReplacementText(b, state.mode).length - this.getReplacementText(a, state.mode).length);

    redactedItems.forEach((item) => {
      const replacement = this.getReplacementText(item, state.mode);
      if (!replacement || replacement === item.text) return;
      if (!restored.includes(replacement)) return;
      restored = restored.split(replacement).join(item.text);
    });

    return restored;
  }

  isSyntheticReplacementToken(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    if (/^<\s*[A-Z][A-Z0-9_]{1,40}\s*>$/.test(text)) return true;
    if (/^\[[^\]]*redacted[^\]]*\]$/i.test(text)) return true;
    if (/<\s*[A-Z][A-Z0-9_]{1,40}\s*>/.test(text)) return true;
    if (/\[[^\]]*redacted[^\]]*\]/i.test(text)) return true;
    return false;
  }

  setAnalyzingState(element, isAnalyzing) {
    if (!element || !element.classList) return;
    element.classList.toggle('ps-analyzing', isAnalyzing);
  }

  renderFieldHighlight(element, detections) {
    const elementId = this.getElementId(element);
    document.querySelectorAll(`.ps-highlight[data-element-id="${elementId}"]`).forEach((node) => node.remove());

    const rect = element.getBoundingClientRect();
    const primaryType = detections[0]?.label || 'person';
    const highlight = document.createElement('div');
    highlight.className = 'ps-highlight ps-pulse';
    highlight.setAttribute('data-element-id', elementId);
    highlight.style.top = `${rect.top + window.scrollY}px`;
    highlight.style.left = `${rect.left + window.scrollX}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.style.setProperty('--detection-color', this.getTypeColor(primaryType));

    const label = document.createElement('span');
    label.className = 'ps-label';
    label.style.setProperty('--detection-color', this.getTypeColor(primaryType));
    label.textContent = `${detections.length} sensitive entit${detections.length === 1 ? 'y' : 'ies'} detected`;
    highlight.appendChild(label);

    document.body.appendChild(highlight);
    requestAnimationFrame(() => highlight.classList.add('ps-visible'));
  }

  // ═══════════════════════════════════════════════════════════
  // Redaction State Management
  // ═══════════════════════════════════════════════════════════

  getAliasLedger(element) {
    if (this.aliasLedgers.has(element)) return this.aliasLedgers.get(element);
    const ledger = { aliases: new Map(), counters: new Map() };
    this.aliasLedgers.set(element, ledger);
    return ledger;
  }

  createRedactionItem(detection, ledger, existingState = null) {
    // Check if this detection is already tracked and preserve its state
    if (existingState) {
      const existing = existingState.items.find(
        (ex) => ex.start === detection.start && ex.end === detection.end && ex.label === detection.label
      );
      if (existing) return existing; // Keep redacted/reviewed/alias state
    }

    const key = `${String(detection.label).toLowerCase()}::${String(detection.text).toLowerCase()}`;
    let alias = ledger.aliases.get(key);
    if (!alias) {
      alias = this.allocateAlias(detection.label, ledger);
      ledger.aliases.set(key, alias);
    }

    return {
      ...detection,
      alias,
      anonymizedText: detection.anonymizedText ? String(detection.anonymizedText) : null,
      replacement: detection.replacement ? String(detection.replacement) : null,
      redacted: false,   // Start as underlined, NOT redacted
      reviewed: false
    };
  }

  allocateAlias(label, ledger) {
    const normalized = String(label || 'pii')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'PII';
    const next = (ledger.counters.get(normalized) || 0) + 1;
    ledger.counters.set(normalized, next);
    return `${normalized}_${next}`;
  }

  // ═══════════════════════════════════════════════════════════
  // Auto-Redact Scheduler
  // ═══════════════════════════════════════════════════════════

  scheduleAutoRedact(element) {
    this.cancelAutoRedact(element);
    const timer = setTimeout(() => {
      this.redactAll(element);
    }, AUTO_REDACT_DELAY_MS);
    this.autoRedactTimers.set(element, timer);
  }

  cancelAutoRedact(element) {
    const timer = this.autoRedactTimers.get(element);
    if (timer) {
      clearTimeout(timer);
      this.autoRedactTimers.delete(element);
    }
  }

  redactAll(element) {
    const state = this.redactions.get(element);
    if (!state) return;

    let changed = false;
    let count = 0;
    state.items.forEach((item) => {
      // Skip items the user explicitly restored — respect their choice
      if (item.userRestored) return;
      if (!item.redacted) {
        item.redacted = true;
        item.reviewed = true;
        changed = true;
        count += 1;
      }
    });

    if (changed) {
      this.renderElement(element);
      this.showActionBar(element, state);
      this.persistCache(element);
      this.showNotification(`${count} item${count === 1 ? '' : 's'} protected`, 'info');
      this.updateStats(0, count);
    }
  }

  restoreAll(element) {
    const state = this.redactions.get(element);
    if (!state) return;

    state.items.forEach((item) => {
      item.redacted = false;
      item.reviewed = true;
      item.userRestored = true;  // Protect from auto-re-redaction
    });

    this.cancelAutoRedact(element);

    this.renderElement(element);
    this.showActionBar(element, state);
    this.persistCache(element);
  }

  // ═══════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════

  renderElement(element, flashIndex = -1) {
    const state = this.redactions.get(element);
    if (!state) return;

    if (this.isContentEditableElement(element)) {
      // ── Save cursor position ──
      const savedCaret = this.saveCaretPosition(element);

      const allUnderlineOnly = state.items.every((item) => !item.redacted);

      const html = this.renderContentEditableHtml(element, state, flashIndex);
      if (html == null) return;

      this.withSuppressedInput(element, () => {
        element.innerHTML = html;
      });

      // ── Restore cursor position ──
      this.restoreCaretPosition(element, savedCaret);

      if (!allUnderlineOnly) {
        this.playCommitAnimation(element);
      }
      this.removeTokenTray(element);
      return;
    }

    // Input/textarea
    const savedStart = element.selectionStart;
    const savedEnd = element.selectionEnd;

    const renderedText = this.buildRenderedText(state);
    this.withSuppressedInput(element, () => {
      element.value = renderedText;
    });

    // Restore cursor
    try {
      element.selectionStart = Math.min(savedStart, renderedText.length);
      element.selectionEnd = Math.min(savedEnd, renderedText.length);
    } catch { /* some inputs don't support selection */ }

    if (state.items.some((i) => i.redacted)) {
      this.playCommitAnimation(element);
    }
    this.renderTokenTray(element, state);
  }

  isContentEditableElement(element) {
    return Boolean(element?.isContentEditable || element?.hasAttribute?.('contenteditable'));
  }

  // ── Caret save/restore for contenteditable ──

  saveCaretPosition(element) {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !element.contains(sel.anchorNode)) return null;

      const range = sel.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      const startOffset = preCaretRange.toString().length;

      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const endOffset = preCaretRange.toString().length;

      return { startOffset, endOffset };
    } catch {
      return null;
    }
  }

  restoreCaretPosition(element, saved) {
    if (!saved) return;
    try {
      const offsets = this.buildTextNodeOffsets(element);
      const startPos = this.resolveTextPosition(offsets, saved.startOffset, false);
      const endPos = this.resolveTextPosition(offsets, saved.endOffset, true);
      if (!startPos || !endPos) return;

      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch { /* best-effort */ }
  }

  captureContentEditableHtml(element) {
    const clone = element.cloneNode(true);
    // Strip any existing redaction/underline spans to get clean source
    clone.querySelectorAll('.ps-redaction, .ps-pii-underline').forEach((node) => {
      const original = node.getAttribute('data-ps-original') || node.textContent || '';
      node.replaceWith(document.createTextNode(original));
    });
    return clone.innerHTML;
  }

  buildTextNodeOffsets(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const offsets = [];
    let position = 0;
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue || '';
      const length = value.length;
      offsets.push({ node, start: position, end: position + length });
      position += length;
      node = walker.nextNode();
    }
    return offsets;
  }

  resolveTextPosition(offsets, absoluteOffset, preferNext = false) {
    if (!Array.isArray(offsets) || offsets.length === 0) return null;

    for (let index = 0; index < offsets.length; index += 1) {
      const item = offsets[index];
      if (absoluteOffset < item.start) continue;
      if (absoluteOffset > item.end) continue;

      if (absoluteOffset === item.end && preferNext && index < offsets.length - 1) {
        const next = offsets[index + 1];
        return { node: next.node, offset: 0 };
      }

      return {
        node: item.node,
        offset: Math.max(0, Math.min(item.node.nodeValue?.length || 0, absoluteOffset - item.start))
      };
    }

    const last = offsets[offsets.length - 1];
    if (absoluteOffset === last.end) {
      return { node: last.node, offset: last.node.nodeValue?.length || 0 };
    }

    return null;
  }

  renderContentEditableHtml(element, state, flashIndex = -1) {
    const htmlSource = typeof state.sourceHtml === 'string' ? state.sourceHtml : element.innerHTML;
    const container = document.createElement('div');
    container.innerHTML = htmlSource;

    const offsets = this.buildTextNodeOffsets(container);
    if (!offsets.length) return container.innerHTML;

    const entries = state.items
      .map((item, index) => ({ item, index }))
      .slice()
      .sort((a, b) => b.item.start - a.item.start);

    entries.forEach(({ item, index }) => {
      const startPos = this.resolveTextPosition(offsets, item.start, false);
      const endPos = this.resolveTextPosition(offsets, item.end, true);
      if (!startPos || !endPos) return;

      const range = document.createRange();
      try {
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
      } catch { return; }

      // Avoid deleting structural nodes (br/div/etc.) which would break layout
      const clone = range.cloneContents();
      const hasElementNodes = Array.from(clone.childNodes).some((node) => node.nodeType === 1);
      if (hasElementNodes) return;

      let span;
      if (item.redacted) {
        span = this.createRedactionSpan(element, index, item, flashIndex === index);
      } else {
        span = this.createUnderlineSpan(element, index, item);
      }

      range.deleteContents();
      range.insertNode(span);
    });

    return container.innerHTML;
  }

  // ── Underline span (Grammarly-style, before redaction) ──

  createUnderlineSpan(element, index, item) {
    const span = document.createElement('span');
    span.className = 'ps-pii-underline';
    span.setAttribute('data-index', String(index));
    span.setAttribute('data-ps-original', String(item.text || ''));
    span.style.setProperty('--detection-color', this.getTypeColor(item.label));
    span.style.setProperty('--stagger', `${Math.min(index * 40, 300)}ms`);
    span.textContent = item.text;

    span.addEventListener('mouseenter', () => {
      this.showPopover(span, element, index, 'underline');
    });
    span.addEventListener('mouseleave', () => {
      this.schedulePopoverHide();
    });
    span.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.redactSingle(element, index);
    });

    return span;
  }

  // ── Redaction span (after redaction) ──

  createRedactionSpan(element, index, item, flash = false) {
    const span = document.createElement('span');
    span.className = 'ps-redaction';
    span.setAttribute('data-index', String(index));
    span.setAttribute('data-ps-original', String(item.text || ''));
    span.style.setProperty('--redaction-color', this.getTypeColor(item.label));
    span.style.setProperty('--stagger', `${Math.min(index * 30, 280)}ms`);

    if (item.redacted) {
      span.classList.add('ps-redaction-active');
      if (this.settings.redactionMode === 'anonymize') {
        span.classList.add('ps-redaction-anonymized');
      }
      span.textContent = this.getReplacementText(item);
      span.title = `Hover to restore ${item.label}`;
    } else {
      span.classList.add('ps-redaction-restored');
      span.textContent = item.text;
      span.title = 'Hover to re-redact';
    }

    if (flash) {
      span.classList.add('ps-undo-ripple');
    }

    // Hover preview: show original text
    const setHoverPreview = (preview) => {
      const currentState = this.redactions.get(element);
      const current = currentState?.items?.[index];
      if (!current || !current.redacted) return;
      if (preview) {
        span.classList.add('ps-redaction-hover-preview');
        span.textContent = current.text;
      } else {
        span.classList.remove('ps-redaction-hover-preview');
        span.textContent = this.getReplacementText(current);
      }
    };

    span.addEventListener('mouseenter', () => {
      setHoverPreview(true);
      this.showPopover(span, element, index, 'redacted');
    });
    span.addEventListener('mouseleave', () => {
      setHoverPreview(false);
      this.schedulePopoverHide();
    });
    span.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleRedaction(element, index);
    });

    return span;
  }

  buildRenderedText(state) {
    let output = state.sourceText;
    const sorted = state.items
      .filter((item) => item.redacted)
      .slice()
      .sort((a, b) => b.start - a.start);

    sorted.forEach((item) => {
      output = output.slice(0, item.start) + this.getReplacementText(item) + output.slice(item.end);
    });

    return output;
  }

  getReplacementText(item, modeOverride = this.settings.redactionMode) {
    if (!item.redacted) return item.text;
    if (modeOverride === 'anonymize') {
      if (item.anonymizedText) return item.anonymizedText;
      return `<${item.alias}>`;
    }
    if (item.replacement) return item.replacement;
    return this.getMaskText(item.label);
  }

  getMaskText(label) {
    const map = {
      person: '[NAME REDACTED]',
      email: '[EMAIL REDACTED]',
      phone: '[PHONE REDACTED]',
      address: '[ADDRESS REDACTED]',
      ssn: '[SSN REDACTED]',
      credit_card: '[CARD REDACTED]',
      date_of_birth: '[DOB REDACTED]',
      location: '[LOCATION REDACTED]',
      organization: '[ORG REDACTED]',
      api_key: '[API KEY REDACTED]',
      ip_address: '[IP REDACTED]',
      jwt: '[JWT REDACTED]'
    };
    return map[label] || `[${String(label || 'PII').toUpperCase()} REDACTED]`;
  }

  // ═══════════════════════════════════════════════════════════
  // Popover (per-span anchored tooltip – Grammarly-style)
  // ═══════════════════════════════════════════════════════════

  showPopover(anchorSpan, element, index, mode) {
    this.cancelPopoverHide();
    this.hidePopover();

    const state = this.redactions.get(element);
    if (!state || !state.items[index] || !anchorSpan?.isConnected) return;

    const item = state.items[index];

    const popover = document.createElement('div');
    popover.className = 'ps-popover';
    popover.style.setProperty('--detection-color', this.getTypeColor(item.label));

    const labelText = this.formatLabel(item.label);

    if (mode === 'underline') {
      // PII detected but not yet redacted
      popover.innerHTML = `
        <div class="ps-popover-label" style="color: ${this.getTypeColor(item.label)}">${labelText} detected</div>
        <div class="ps-popover-text">"${this.escapeHtml(item.text)}"</div>
        <div class="ps-popover-actions">
          <button type="button" class="ps-popover-btn ps-popover-btn-primary" data-action="redact">Redact</button>
          <button type="button" class="ps-popover-btn ps-popover-btn-dismiss" data-action="dismiss">Dismiss</button>
        </div>
      `;
    } else if (item.redacted) {
      // Already redacted → offer restore
      popover.innerHTML = `
        <div class="ps-popover-label" style="color: ${this.getTypeColor(item.label)}">${labelText}</div>
        <div class="ps-popover-text">Original: "${this.escapeHtml(item.text)}"</div>
        <div class="ps-popover-actions">
          <button type="button" class="ps-popover-btn ps-popover-btn-restore" data-action="restore">Restore</button>
        </div>
      `;
    } else {
      // Restored → offer re-redact
      popover.innerHTML = `
        <div class="ps-popover-label" style="color: ${this.getTypeColor(item.label)}">${labelText}</div>
        <div class="ps-popover-text">"${this.escapeHtml(item.text)}"</div>
        <div class="ps-popover-actions">
          <button type="button" class="ps-popover-btn ps-popover-btn-primary" data-action="redact">Re-Redact</button>
        </div>
      `;
    }

    popover.addEventListener('mouseenter', () => this.cancelPopoverHide());
    popover.addEventListener('mouseleave', () => this.schedulePopoverHide());
    popover.addEventListener('click', (event) => {
      const action = event.target?.getAttribute?.('data-action');
      if (!action) return;
      if (action === 'redact') {
        this.redactSingle(element, index);
      } else if (action === 'restore') {
        this.restoreSingle(element, index);
      } else if (action === 'dismiss') {
        this.dismissDetection(element, index);
      }
      this.hidePopover();
    });

    document.body.appendChild(popover);
    this.activePopover = popover;

    // Position above the anchor span
    requestAnimationFrame(() => {
      const rect = anchorSpan.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      const top = window.scrollY + rect.top - popRect.height - 12;
      const left = window.scrollX + rect.left + (rect.width / 2) - (popRect.width / 2);

      popover.style.top = `${Math.max(window.scrollY + 4, top)}px`;
      popover.style.left = `${Math.max(window.scrollX + 4, left)}px`;
      popover.classList.add('ps-popover-visible');
    });
  }

  hidePopover() {
    if (!this.activePopover) return;
    this.activePopover.classList.remove('ps-popover-visible');
    const old = this.activePopover;
    setTimeout(() => old.remove(), 200);
    this.activePopover = null;
  }

  schedulePopoverHide() {
    this.cancelPopoverHide();
    this.activePopoverHideTimer = setTimeout(() => this.hidePopover(), 280);
  }

  cancelPopoverHide() {
    if (this.activePopoverHideTimer) {
      clearTimeout(this.activePopoverHideTimer);
      this.activePopoverHideTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Action Bar (Redact All / Restore All near the field)
  // ═══════════════════════════════════════════════════════════

  showActionBar(element, state) {
    this.removeActionBar(element);

    const unredactedCount = state.items.filter((i) => !i.redacted).length;
    const redactedCount = state.items.filter((i) => i.redacted).length;
    if (unredactedCount === 0 && redactedCount === 0) return;

    const bar = document.createElement('div');
    bar.className = 'ps-action-bar';

    const countLabel = document.createElement('span');
    countLabel.className = 'ps-action-bar-count';
    countLabel.textContent = `${state.items.length} PII${state.items.length === 1 ? '' : 's'}`;
    bar.appendChild(countLabel);

    if (unredactedCount > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ps-action-bar-btn ps-action-bar-btn-redact';
      btn.textContent = `🛡 Redact All (${unredactedCount})`;
      btn.addEventListener('click', () => {
        this.cancelAutoRedact(element);
        this.redactAll(element);
      });
      bar.appendChild(btn);
    }

    if (redactedCount > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ps-action-bar-btn ps-action-bar-btn-restore';
      btn.textContent = `Restore All (${redactedCount})`;
      btn.addEventListener('click', () => {
        this.restoreAll(element);
      });
      bar.appendChild(btn);
    }

    document.body.appendChild(bar);
    this.actionBars.set(element, bar);

    // Position below the element
    const rect = element.getBoundingClientRect();
    bar.style.top = `${window.scrollY + rect.bottom + 6}px`;
    bar.style.left = `${window.scrollX + rect.left}px`;

    requestAnimationFrame(() => bar.classList.add('ps-action-bar-visible'));
  }

  removeActionBar(element) {
    const bar = this.actionBars.get(element);
    if (!bar) return;
    bar.remove();
    this.actionBars.delete(element);
  }

  // ═══════════════════════════════════════════════════════════
  // Single-item Actions
  // ═══════════════════════════════════════════════════════════

  redactSingle(element, index) {
    const state = this.redactions.get(element);
    if (!state || !state.items[index]) return;

    state.items[index].redacted = true;
    state.items[index].reviewed = true;
    state.items[index].userRestored = false;  // User chose to re-redact

    this.renderElement(element, index);
    this.showActionBar(element, state);
    this.persistCache(element);
  }

  restoreSingle(element, index) {
    const state = this.redactions.get(element);
    if (!state || !state.items[index]) return;

    state.items[index].redacted = false;
    state.items[index].reviewed = true;
    state.items[index].userRestored = true;  // Protect from auto-re-redaction

    // Cancel any pending auto-redact so it doesn't override this restore
    this.cancelAutoRedact(element);

    this.renderElement(element, index);
    this.showActionBar(element, state);
    this.persistCache(element);
  }

  dismissDetection(element, index) {
    const state = this.redactions.get(element);
    if (!state || !state.items[index]) return;

    const item = state.items[index];
    const key = `${item.start}:${item.end}:${item.label}`;

    if (!this.dismissedDetections.has(element)) {
      this.dismissedDetections.set(element, new Set());
    }
    this.dismissedDetections.get(element).add(key);

    // Remove this item from state
    state.items.splice(index, 1);

    if (state.items.length === 0) {
      this.clearElementState(element);
    } else {
      this.renderElement(element);
      this.showActionBar(element, state);
    }
  }

  toggleRedaction(element, index) {
    const state = this.redactions.get(element);
    if (!state || !state.items[index]) return;

    const wasRedacted = state.items[index].redacted;
    state.items[index].redacted = !wasRedacted;
    state.items[index].reviewed = true;
    // If user is restoring, mark as user-restored; if re-redacting, clear the flag
    state.items[index].userRestored = wasRedacted ? true : false;

    if (wasRedacted) {
      this.cancelAutoRedact(element);
    }

    this.renderElement(element, index);
    this.showActionBar(element, state);
    this.persistCache(element);
  }

  // ═══════════════════════════════════════════════════════════
  // Token Tray (for input/textarea elements)
  // ═══════════════════════════════════════════════════════════

  summarizeTokenText(text, maxLength = 26) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (raw.length <= maxLength) return raw;
    return `${raw.slice(0, Math.max(8, maxLength - 1))}…`;
  }

  renderTokenTray(element, state) {
    let tray = this.tokenTrays.get(element);
    if (!tray) {
      tray = document.createElement('div');
      tray.className = 'ps-token-tray';
      document.body.appendChild(tray);
      this.tokenTrays.set(element, tray);
    }

    tray.innerHTML = '';
    state.items.forEach((item, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `ps-token-chip ${item.redacted ? 'is-redacted' : 'is-restored'}`;
      chip.style.setProperty('--chip-color', this.getTypeColor(item.label));
      chip.textContent = item.redacted ? this.getReplacementText(item) : item.text;
      chip.title = item.redacted ? 'Hover for restore option' : 'Click to re-redact';
      chip.addEventListener('mouseenter', () => {
        chip.classList.add('is-hover-preview');
        if (item.redacted) {
          chip.textContent = `Restore: ${this.summarizeTokenText(item.text)}`;
          chip.title = 'Click to restore original.';
        } else {
          chip.textContent = 'Re-Redact';
          chip.title = 'Click to mask this value again.';
        }
      });
      chip.addEventListener('mouseleave', () => {
        chip.classList.remove('is-hover-preview');
        chip.textContent = item.redacted ? this.getReplacementText(item) : item.text;
        chip.title = item.redacted ? 'Hover for restore option' : 'Click to re-redact';
      });
      chip.addEventListener('click', () => this.toggleRedaction(element, index));
      tray.appendChild(chip);
    });

    this.positionTokenTray(element, tray);
  }

  positionTokenTray(element, tray) {
    const rect = element.getBoundingClientRect();
    tray.style.top = `${window.scrollY + rect.bottom + 6}px`;
    tray.style.left = `${window.scrollX + rect.left}px`;
    tray.style.maxWidth = `${Math.max(220, rect.width)}px`;
    tray.classList.add('ps-token-tray-visible');
  }

  repositionTokenTrays() {
    this.tokenTrays.forEach((tray, element) => {
      if (!document.body.contains(element)) {
        this.removeTokenTray(element);
        return;
      }
      this.positionTokenTray(element, tray);
    });
  }

  removeTokenTray(element) {
    const tray = this.tokenTrays.get(element);
    if (!tray) return;
    tray.remove();
    this.tokenTrays.delete(element);
  }

  // ═══════════════════════════════════════════════════════════
  // localStorage / chrome.storage.local Cache
  // ═══════════════════════════════════════════════════════════

  getCacheKey(element) {
    const host = window.location.hostname;
    const id = this.getElementId(element);
    const state = this.redactions.get(element);
    const textHash = this.hashString(state?.sourceText || '');
    return `ps::${host}::${id}::${textHash}`;
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return hash.toString(36);
  }

  persistCache(element) {
    try {
      const state = this.redactions.get(element);
      if (!state) return;

      const key = this.getCacheKey(element);
      const payload = {
        timestamp: Date.now(),
        sourceText: state.sourceText,
        mode: state.mode,
        items: state.items.map((i) => ({
          label: i.label,
          text: i.text,
          start: i.start,
          end: i.end,
          alias: i.alias,
          anonymizedText: i.anonymizedText || null,
          replacement: i.replacement,
          redacted: i.redacted,
          reviewed: i.reviewed,
          userRestored: i.userRestored || false,
          score: i.score
        }))
      };

      chrome.storage.local.set({ [key]: payload });
    } catch (e) {
      console.error('[Privacy Shield] cache persist error:', e);
    }
  }

  async rehydrateCachedRedactions() {
    try {
      const allData = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
      const now = Date.now();
      const keysToRemove = [];

      Object.entries(allData).forEach(([key, value]) => {
        if (!key.startsWith('ps::')) return;
        if (!value?.timestamp || (now - value.timestamp) > CACHE_TTL_MS) {
          keysToRemove.push(key);
        }
      });

      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove);
      }
    } catch (e) {
      console.error('[Privacy Shield] cache rehydration error:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Utility Helpers
  // ═══════════════════════════════════════════════════════════

  withSuppressedInput(element, updateFn) {
    this.suppressedInput.add(element);
    updateFn();
    setTimeout(() => this.suppressedInput.delete(element), SUPPRESS_INPUT_MS);
  }

  playCommitAnimation(element) {
    // Disabled intentionally: the commit animation feels noisy and can make
    // repeated reflows more noticeable on chat composer UIs.
    return;
  }

  clearElementState(element) {
    this.clearHighlights(element);
    this.redactions.delete(element);
    this.lastDetectionSignature.delete(element);
    this.lastAnalyzedSnapshot.delete(element);
    this.cancelPostInteractionCleanup(element);
    element.classList.remove('ps-awaiting-idle', 'ps-analyzing', 'ps-redaction-commit');
    this.removeTokenTray(element);
    this.removeActionBar(element);
    this.hideScanningPill(element);
    this.cancelAutoRedact(element);

    // Strip injected PII spans from contenteditable elements to avoid visual artifacts
    if (this.isContentEditableElement(element) && element.isConnected) {
      const spans = element.querySelectorAll('.ps-pii-underline, .ps-redaction');
      if (spans.length > 0) {
        this.withSuppressedInput(element, () => {
          spans.forEach((span) => {
            const original = span.getAttribute('data-ps-original') || span.textContent || '';
            span.replaceWith(document.createTextNode(original));
          });
        });
      }
    }
  }

  clearHighlights(element) {
    const elementId = this.getElementId(element);
    document.querySelectorAll(`.ps-highlight[data-element-id="${elementId}"]`).forEach((node) => {
      node.classList.remove('ps-visible');
      setTimeout(() => node.remove(), 220);
    });
  }

  hasUnreviewedRedactions(element) {
    const state = this.redactions.get(element);
    if (!state) return false;
    return state.items.some((item) => item.redacted && !item.reviewed);
  }

  getElementId(element) {
    if (!element.dataset.psId) {
      element.dataset.psId = `ps-${Math.random().toString(36).slice(2, 11)}`;
    }
    return element.dataset.psId;
  }

  getTypeColor(type) {
    const palette = {
      person: '#D32F2F',
      email: '#0288D1',
      phone: '#00796B',
      address: '#EF6C00',
      ssn: '#C2185B',
      credit_card: '#5D4037',
      date_of_birth: '#8E24AA',
      location: '#2E7D32',
      organization: '#3949AB',
      api_key: '#6A1B9A',
      ip_address: '#546E7A',
      jwt: '#8D6E63'
    };
    return palette[type] || '#546E7A';
  }

  formatLabel(label) {
    return String(label || 'PII')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  updateStats(detections, redactions) {
    this.pageStats = {
      detections: this.pageStats.detections + (Number(detections) || 0),
      redactions: this.pageStats.redactions + (Number(redactions) || 0)
    };
  }

  handleRuntimeMessage(request, _sender, sendResponse) {
    if (request?.action === 'getPageStats') {
      if (window !== window.top) return false;
      sendResponse({
        success: true,
        stats: { ...this.pageStats }
      });
      return false;
    }

    if (request?.action === 'jwtExpired') {
      this.handleJwtExpiry(request.message || '⚠️ Anonymization JWT has expired. Update it in extension settings.');
      return false;
    }

    if (request?.action === 'jwtExpiringSoon') {
      this.handleJwtExpiry(request.message || '⚠️ Your anonymization JWT is expiring soon.');
      return false;
    }

    return false;
  }

  /**
   * Show a JWT expiry notification, rate-limited to at most once every 5 minutes.
   */
  handleJwtExpiry(message) {
    const now = Date.now();
    const cooldownMs = 5 * 60 * 1000; // 5 minutes
    if (now - this._lastJwtNotificationTs < cooldownMs) return;
    this._lastJwtNotificationTs = now;
    this.showNotification(message, 'warning');
  }

  showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `ps-notification ps-notification-${type}`;
    toast.innerHTML = `<div class="ps-notification-message">${message}</div>`;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('ps-notification-visible'));

    setTimeout(() => {
      toast.classList.remove('ps-notification-visible');
      setTimeout(() => toast.remove(), 260);
    }, 1900);
  }

  // ═══════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════

  stopMonitoring() {
    this.monitoredElements.forEach((listeners, element) => {
      element.removeEventListener('input', listeners.handleInput);
      element.removeEventListener('paste', listeners.handlePaste);
      element.removeEventListener('blur', listeners.handleBlur);
      element.removeEventListener('keydown', listeners.handleKeydown);
      element.removeEventListener('compositionstart', listeners.handleCompositionStart);
      element.removeEventListener('compositionend', listeners.handleCompositionEnd);
      if (listeners.form && listeners.handleSubmit) {
        listeners.form.removeEventListener('submit', listeners.handleSubmit);
      }
      this.clearElementState(element);
    });

    this.monitoredElements.clear();
    this.redactions.clear();
    this.inputRevisions.clear();
    this.lastAnalyzedSnapshot.clear();
    this.lastDetectionSignature.clear();
    this.postInteractionTimers.forEach((timers) => {
      timers.forEach((timer) => clearTimeout(timer));
    });
    this.postInteractionTimers.clear();

    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();

    this.autoRedactTimers.forEach((timer) => clearTimeout(timer));
    this.autoRedactTimers.clear();

    this.hidePopover();

    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = null;
    }
    if (this.stateReconcileTimer) {
      clearInterval(this.stateReconcileTimer);
      this.stateReconcileTimer = null;
    }

    window.removeEventListener('scroll', this.handleViewportChange, true);
    window.removeEventListener('resize', this.handleViewportChange);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PrivacyShield());
} else {
  new PrivacyShield();
}
