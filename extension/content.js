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

// Platform-specific selectors for LLM chat interfaces
const PLATFORM_SELECTORS = {
  chatgpt: [
    'textarea[data-id]',
    'div[data-message-author-role="user"]',
    'button[data-testid="send-button"] + div',
    '.flex.flex-1 textarea',
    'form button[type="submit"] + div textarea',
    'textarea.w-full',
    '[contenteditable="true"][data-placeholder]',
    '.chat-input textarea'
  ],
  claude: [
    '.claude-chat-input',
    '[data-claude-ide] textarea',
    '.ce-editor',
    'div[contenteditable="true"][data-test]',
    'textarea#composer-input',
    'textarea[data-celled]',
    '.composer-input textarea',
    '[contenteditable="true"].ce-block'
  ],
  gemini: [
    '[aria-label*="message"] textarea',
    'rich-textarea textarea',
    'text-area textarea',
    '.gemini-chat-input textarea',
    'textarea[placeholder*="message"]',
    'input[aria-label*="prompt"]',
    'rich-textarea',
    'textarea.gmat-input',
    'div[contenteditable="true"][role="textbox"]'
  ],
  generic: [
    'textarea',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input:not([type])',
    'div[contenteditable="true"]',
    '[role="textbox"]',
    '.ProseMirror'
  ]
};

const DEFAULT_CUSTOM_PATTERNS = [
  {
    id: 'openai_key',
    label: 'api_key',
    pattern: '\\b(?:sk-[A-Za-z0-9]{20,}|sk_(?:test|live)_[A-Za-z0-9]{16,}|sk-proj-[A-Za-z0-9_-]{20,})\\b',
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
const SUPPRESS_INPUT_MS = 300;
const AUTO_REDACT_DELAY_MS = 1500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LEGACY_OPENAI_KEY_PATTERN = '\\bsk-[A-Za-z0-9]{20,}\\b';

// ── Selectors that identify known LLM response / output areas ──
const RESPONSE_AREA_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-message-author-role="user"]',
  '[data-is-streaming]',
  '.assistant-message',
  '.markdown-body',
  '.response-container',
  '.prose',                               // Claude response bodies
  '.result-streaming',                    // ChatGPT streaming
  '.agent-turn',                          // Gemini
  '[data-testid="conversation-turn-"]',
  '.message--assistant',
  '.bot-message',
  '.ai-message',
  '.chat-answer'
];

function normalizeCustomPatterns(storedPatterns, defaults) {
  const defaultList = Array.isArray(defaults) ? defaults : [];
  if (!Array.isArray(storedPatterns) || storedPatterns.length === 0) {
    return defaultList.slice();
  }

  const storedById = new Map();
  const extras = [];

  storedPatterns.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const id = String(entry.id || '').trim();
    if (!id) {
      extras.push(entry);
      return;
    }
    storedById.set(id, entry);
  });

  const mergedDefaults = defaultList.map((def) => {
    const id = String(def?.id || '').trim();
    if (!id || !storedById.has(id)) return def;
    const stored = storedById.get(id);
    if (id === 'openai_key' && String(stored.pattern || '') === LEGACY_OPENAI_KEY_PATTERN) {
      return { ...def, ...stored, pattern: def.pattern };
    }
    return { ...def, ...stored };
  });

  const mergedIds = new Set(mergedDefaults.map((entry) => String(entry?.id || '').trim()).filter(Boolean));
  const customOnly = storedPatterns.filter((entry) => {
    const id = String(entry?.id || '').trim();
    return !id || !mergedIds.has(id);
  });

  return [...mergedDefaults, ...extras, ...customOnly];
}

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
    this.lastDetectedRevisions = new Map();   // element → revision at which detection last completed
    this.debounceTimers = new Map();
    this.inputRevisions = new Map();
    this.lastAnalyzedSnapshot = new Map();
    this.postInteractionTimers = new Map();
    this.suppressedInput = new WeakSet();
    this.tokenTrays = new Map();
    this.scanningPills = new Map();
    this.actionBars = new WeakMap();
    this.autoRedactTimers = new Map();
    this.dismissedDetections = new WeakMap(); // element → Set of "start:end:label"

    // Per-site alias ledger — ensures PERSON_1 stays PERSON_1 across sessions
    // on the same site. Loaded from chrome.storage on init, 30-day TTL.
    this.siteAliasCache = { aliases: {}, counters: {}, maskCounters: {} };
    this.siteAliasPersistTimer = null;

    // Per-site redact-all counter — used to offer "always auto-redact here?" after
    // the user has manually clicked Redact All multiple times.
    this.siteRedactCount = 0;

    this.activePopover = null;
    this.activePopoverHideTimer = null;
    this.activeRevealOverlay = null;
    this.isApplyingDecode = false; // guard: true while response decoder is mutating text nodes
    // Session-level decode map: token → original, persists after clearElementState clears
    // this.redactions (which happens 180ms post-send, before the AI response arrives).
    this.sessionDecodeMap = new Map();

    // Overlay highlights — fixed-position divs in document.body that visually
    // decorate text inside rich-editor contenteditables without touching their DOM.
    this._ceOverlayHighlights = new Map(); // element → hl[] array
    this._ceOverlayTimers = new Map();     // element → setTimeout id

    this.domObserver = null;
    this.stateReconcileTimer = null;
    this.handleViewportChange = () => {
      this.repositionTokenTrays();
      this.repositionScanningPills();
      this._refreshAllOverlays();
    };
    this.handleRuntimeMessage = this.handleRuntimeMessage.bind(this);
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage);

    this.init();
  }

  // ═══════════════════════════════════════════════════════════
  // Platform Detection
  // ═══════════════════════════════════════════════════════════

  detectPlatform() {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes('chatgpt') || hostname.includes('openai')) return 'chatgpt';
    if (hostname.includes('claude')) return 'claude';
    if (hostname.includes('gemini') || hostname.includes('google')) return 'gemini';
    return 'generic';
  }

  getPlatformSelectors() {
    const platform = this.detectPlatform();
    const platformSelectors = PLATFORM_SELECTORS[platform] || PLATFORM_SELECTORS.generic;
    // Combine platform-specific selectors with generic ones (deduplicated)
    const allSelectors = [...new Set([...PLATFORM_SELECTORS.generic, ...platformSelectors])];
    return allSelectors;
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
    // Load per-site alias ledger before starting monitoring so that the first
    // element to trigger detection already has the correct counter seed.
    await this.loadSiteAliasLedger();
    this.startMonitoring();

    // Rehydrate cached redactions
    this.rehydrateCachedRedactions();
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([
        'enabled',
        'autoRedact',
        'redactionMode',
        'sensitivity',
        'includeRegexWhenModelOnline',
        'enabledTypes',
        'monitorAllSites',
        'monitoredSites',
        'monitoredSelectors',
        'customPatterns',
        'customEntityTypes'
      ], (result) => {
        this.settings = {
          enabled: result.enabled ?? true,
          autoRedact: result.autoRedact ?? true,
          redactionMode: result.redactionMode ?? 'mask',
          sensitivity: result.sensitivity ?? 'medium',
          includeRegexWhenModelOnline: result.includeRegexWhenModelOnline ?? false,
          enabledTypes: result.enabledTypes ?? ['person', 'email', 'phone', 'address', 'ssn', 'credit_card'],
          monitorAllSites: result.monitorAllSites ?? true,
          monitoredSites: result.monitoredSites ?? ['claude.ai', 'gemini.google.com', 'chatgpt.com'],
          monitoredSelectors: Array.isArray(result.monitoredSelectors) && result.monitoredSelectors.length > 0
            ? result.monitoredSelectors
            : this.getPlatformSelectors(),
          customPatterns: normalizeCustomPatterns(result.customPatterns, DEFAULT_CUSTOM_PATTERNS),
          customEntityTypes: Array.isArray(result.customEntityTypes) ? result.customEntityTypes : []
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
        console.debug('[Veil] detection mode:', response.mode);
      }
    } catch (error) {
      console.error('[Veil] initialize failed:', error);
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

    // Never treat editable user-input surfaces as response areas.
    if (this.isEditableInputSurface(element)) {
      return false;
    }

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

  isEditableInputSurface(element) {
    if (!element || !(element instanceof HTMLElement)) return false;
    if (element.matches('textarea, input')) return true;
    if (element.isContentEditable) return true;
    if (element.getAttribute('contenteditable') === 'true') return true;
    if (element.getAttribute('role') === 'textbox') return true;
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // Element Monitoring
  // ═══════════════════════════════════════════════════════════

  startMonitoring() {
    this.findInputElements();
    this.startStateReconciler();
    this.startDynamicMonitoring();
    this.startPollingFallback();

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
      // Debounce finding new elements to batch rapid mutations
      this.debouncedFindInputElements();
    });
    this.domObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('scroll', this.handleViewportChange, true);
    window.addEventListener('resize', this.handleViewportChange);

    this.initResponseDecoder();
    this._loadSessionDecodeMap();

    // Hide scanning pills when the tab goes to the background so they don't
    // linger and appear stale when switching back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.monitoredElements.forEach((_, el) => this.hideScanningPill(el));
      }
    });

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
        changes.customPatterns ||
        changes.customEntityTypes
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

  // Debounced version of findInputElements to batch rapid DOM mutations
  debouncedFindInputElements() {
    if (this._findInputElementsTimer) {
      clearTimeout(this._findInputElementsTimer);
    }
    this._findInputElementsTimer = setTimeout(() => {
      this.findInputElements();
    }, 300);
  }

  // Enhanced MutationObserver with explicit new element detection
  startDynamicMonitoring() {
    // This is now integrated into startMonitoring's MutationObserver
    // but we keep the method for clarity and potential separate use
    console.debug('[Veil] Dynamic monitoring active for:', this.detectPlatform());
  }

  // Polling fallback for SPA navigation that doesn't trigger MutationObserver
  startPollingFallback() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
    }
    this._pollingInterval = setInterval(() => {
      this.findInputElements();
    }, 5000);
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
        const prevState = this.redactions.get(element);
        if (!prevState?.items?.some((item) => item.redacted)) {
          this.clearElementState(element);
          // Clear stale caches to prevent cross-contamination with new composer elements
          this.dismissedDetections.delete(element);
          this.aliasLedgers.delete(element);
        }
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
        const existingState = this.redactions.get(element);
        if (!existingState?.items?.some((item) => item.redacted)) {
          this.clearElementState(element);
        }
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

    // Remove orphaned action bars, scanning pills, token trays
    // (These are tracked in WeakMaps/Maps but may leak if element is GC'd)
    this.actionBars.forEach?.((bar, element) => {
      if (!element?.isConnected) {
        bar.remove();
        this.actionBars.delete(element);
      }
    });
    this.tokenTrays.forEach((tray, element) => {
      if (!element?.isConnected) {
        tray.remove();
        this.tokenTrays.delete(element);
      }
    });
    this.scanningPills.forEach((pill, element) => {
      if (!element?.isConnected) {
        pill.remove();
        this.scanningPills.delete(element);
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
        // Post-send: always clear when empty — guard only applies to mid-typing reconciliation.
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
    if (rect.width < 48 || rect.height < 18) return false;

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
      // Immediately drop highlight overlays when the user deletes text so stale
      // green boxes don't linger. The debounced re-scan will restore any that
      // are still valid after the edit.
      if (event.key === 'Backspace' || event.key === 'Delete') {
        this.clearHighlights(element);
        this._clearElementOverlay(element);
      }
      if (event.key === 'Enter' && !event.shiftKey && this.hasUnreviewedRedactions(element)) {
        event.preventDefault();
        this.showNotification('Review pending redactions before sending.', 'warning');
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.defaultPrevented) {
        // Immediately clear all visual artifacts so nothing lingers after send
        this.clearHighlights(element);
        this._clearElementOverlay(element); // removes fixed-position ps-overlay-hl divs instantly
        this.removeActionBar(element);
        this.removeTokenTray(element);
        this.hideScanningPill(element);
        this.hidePopover();
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

    // Don't re-scan on blur when nothing new has been typed since the last
    // completed detection. Without this guard, blur reads the already-rendered
    // replacement text (e.g. "[NAME]") as if it were new input, fails the
    // sourceText equality check, and fires a redundant detection that clears state.
    if (reason === 'blur' && this.redactions.has(element)) {
      const rev = this.getInputRevision(element);
      if (this.lastDetectedRevisions.get(element) === rev) return;
    }

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
  // Scanning Indicator (floating logo)
  // ═══════════════════════════════════════════════════════════

  showScanningPill(element) {
    let pill = this.scanningPills.get(element);
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'ps-scanning-pill';
      pill.innerHTML = `
        <span class="ps-scan-dot" aria-hidden="true"></span>
        <div class="ps-scan-copy">
          <div class="ps-scan-title">Veil</div>
          <div class="ps-scan-sub">Scanning...</div>
        </div>
      `;
      document.body.appendChild(pill);
      this.scanningPills.set(element, pill);
    }

    if (pill.psHideTimer) {
      clearTimeout(pill.psHideTimer);
      pill.psHideTimer = null;
    }

    this.positionScanningPill(element, pill);
    requestAnimationFrame(() => pill.classList.add('ps-scanning-pill-visible'));
  }

  positionScanningPill(element, pill) {
    if (!element?.isConnected || !pill) return;

    const rect = element.getBoundingClientRect();
    const margin = 10;
    const estimatedWidth = pill.getBoundingClientRect().width || 210;
    const insideTopOffset = Math.min(Math.max(rect.height * 0.18, 8), 18);
    const top = window.scrollY + rect.top + insideTopOffset;

    let left = window.scrollX + rect.left + ((rect.width - estimatedWidth) / 2);
    const minLeft = window.scrollX + margin;
    const maxLeft = window.scrollX + window.innerWidth - estimatedWidth - margin;
    left = Math.max(minLeft, Math.min(maxLeft, left));

    pill.style.top = `${top}px`;
    pill.style.left = `${left}px`;
  }

  repositionScanningPills() {
    this.scanningPills.forEach((pill, element) => {
      if (!element?.isConnected || !pill?.isConnected) {
        pill?.remove?.();
        this.scanningPills.delete(element);
        return;
      }
      this.positionScanningPill(element, pill);
    });
  }

  updateScanningPillWithSensitivity(element, { sensitivity, score }) {
    if (!sensitivity || sensitivity === 'none' || sensitivity === 'low') return;
    const pill = this.scanningPills.get(element);
    if (!pill) return;
    const colors = { high: '#dc2626', medium: '#d97706' };
    const labels = { high: 'High Risk', medium: 'Moderate Risk' };
    const color = colors[sensitivity];
    const label = labels[sensitivity];
    if (!color) return;
    let badge = pill.querySelector('.ps-sensitivity-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ps-sensitivity-badge';
      badge.style.cssText = `
        display:inline-block;padding:1px 6px;border-radius:999px;
        font-size:9px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;
        margin-left:4px;
      `;
      pill.appendChild(badge);
    }
    badge.textContent = label;
    badge.style.setProperty('color', '#fff');
    badge.style.setProperty('background', color);
  }

  hideScanningPill(element) {
    const pill = this.scanningPills.get(element);
    if (!pill) return;
    pill.classList.remove('ps-scanning-pill-visible');
    pill.psHideTimer = setTimeout(() => {
      pill.remove();
      this.scanningPills.delete(element);
      pill.psHideTimer = null;
    }, 900);
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
    // Trim both sides to tolerate trailing newlines added by block-element editors (e.g. Gemini).
    if (currentState?.sourceText !== undefined &&
        currentState.sourceText.trim() === sourceText.trim()) {
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
      return;
    }

    if (!sourceText || sourceText.trim().length < 3) {
      const prevState = this.redactions.get(element);
      if (!prevState?.items?.some((item) => item.redacted)) {
        this.clearElementState(element);
      }
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
      return;
    }

    // If the text is composed entirely of redaction tokens (state was lost and
    // restoration failed), skip detection — there is nothing real to detect.
    const strippedOfTokens = sourceText.replace(/\[[A-Z][A-Z\s]*REDACTED\]/gi, '').trim();
    if (!strippedOfTokens || strippedOfTokens.length < 3) {
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
      return;
    }

    this.setAnalyzingState(element, true);
    this.showScanningPill(element);

    if (sourceText.length >= 20) {
      chrome.runtime.sendMessage({ action: 'classifyPII', text: sourceText }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.success && res.result) this.updateScanningPillWithSensitivity(element, res.result);
      });
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'detectPII',
        text: sourceText,
        options: {
          redactionMode: this.settings.redactionMode,
          threshold: this.getSensitivityThreshold(),
          enabledTypes: this.settings.enabledTypes,
          customPatterns: this.settings.customPatterns,
          customEntityTypes: this.settings.customEntityTypes || [],
          includeRegexWhenModelOnline: this.settings.includeRegexWhenModelOnline
        }
      });

      if (!response?.success || !Array.isArray(response.detections) || response.detections.length === 0) {
        const prevState = this.redactions.get(element);
        if (!prevState?.items?.some((item) => item.redacted)) {
          this.clearElementState(element);
        }
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
          // Also add the mask text variants (both generic and numbered)
          knownReplacements.add(this.getMaskText(item.label));
          if (item.maskIndex != null) knownReplacements.add(this.getMaskText(item.label, item.maskIndex));
        });
        detections = detections.filter((d) => {
          const text = String(d.text || '').trim();
          // Reject exact matches
          if (knownReplacements.has(text)) return false;
          // Reject text that *contains* a known replacement token
          for (const rep of knownReplacements) {
            if (rep && text.includes(rep)) return false;
          }
          return true;
        });

        // ── Overlap guard: reject detections whose character range ──
        // overlaps with ANY already-tracked item (redacted or not).
        // This is the strongest protection against re-anonymising regions
        // that have already been processed.
        detections = detections.filter((d) => {
          return !currentState.items.some((ex) =>
            d.start < ex.end && d.end > ex.start
          );
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

      const state = {
        sourceText,
        sourceHtml: this.isContentEditableElement(element)
          ? this.captureContentEditableHtml(element)
          : null,
        mode: this.settings.redactionMode,
        items: allItems
      };

      this.redactions.set(element, state);
      this.lastDetectedRevisions.set(element, currentRevision);

      // Render: existing redacted items stay redacted, new items get underlines
      this.renderElement(element);

      // Auto-redact after delay if setting is on
      if (this.settings.autoRedact) {
        this.scheduleAutoRedact(element);
      }

      this.updateStats(newItems.filter((i) => !i.redacted).length, 0);
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
    } catch (error) {
      console.error('[Veil] detection error:', error);
      this.lastAnalyzedSnapshot.set(element, snapshotKey);
      // Surface model-offline state as a non-blocking notification so users know
      // regex fallback is active rather than silently getting degraded detection.
      if (/failed to fetch|networkerror|connection refused|econnrefused/i.test(String(error?.message || ''))) {
        this.showNotification('Model offline — regex fallback active', 'warning');
      }
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
      const clone = element.cloneNode(true);
      clone.querySelectorAll('.ps-redaction, .ps-pii-underline').forEach((span) => {
        const original = span.getAttribute('data-ps-original');
        if (original != null) {
          span.replaceWith(document.createTextNode(original));
        } else {
          span.replaceWith(document.createTextNode(span.textContent || ''));
        }
      });
      const raw = this.extractContentEditableText(clone);
      // FIX: always restore known redactions so the semantic source text is
      // returned even when CE renders replacement text (prevents re-detection loop)
      return this.restoreKnownRedactions(raw, state);
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
        .replace(/\r\n?/g, '\n');
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

  /**
   * DOM-aware text extraction for contenteditable elements.
   * Unlike textContent, this adds \n between block-level elements
   * so Gemini's <p>-based structure is correctly read.
   */
  extractContentEditableText(element) {
    let result = '';
    const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR']);

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        result += (node.nodeValue || '').replace(/\u00a0/g, ' ');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') {
        result += '\n';
        return;
      }

      const isBlock = BLOCK_TAGS.has(tag);
      const prevLen = result.length;

      for (const child of node.childNodes) {
        walk(child);
      }

      if (isBlock && result.length > prevLen && !result.endsWith('\n')) {
        result += '\n';
      }
    };

    for (const child of element.childNodes) {
      walk(child);
    }

    return result
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n$/, '')
      .replace(/\r\n?/g, '\n');
  }

  /**
   * Detect whether this contenteditable uses <p> tags (Gemini-style)
   * or <br> elements (ChatGPT/Claude-style) for newlines.
   */
  detectNativeNewlineStyle(element) {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes('gemini') || hostname.includes('bard.google')) return 'p';

    let pCount = 0;
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'P') {
        pCount++;
      }
    }
    return pCount >= 1 ? 'p' : 'br';
  }

  /**
   * Minimal HTML escaper for <p>-mode rendering.
   * Keeps \n as a literal character (caller will split on it for <p> wrapping).
   */
  escapeHtmlForParagraph(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
  }

  isSyntheticReplacementToken(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    // Exact alias tokens: <PERSON_1>
    if (/^<\s*[A-Z][A-Z0-9_]{1,40}\s*>$/.test(text)) return true;
    // Exact redacted tokens: [NAME REDACTED]
    if (/^\[[^\]]*redacted[^\]]*\]$/i.test(text)) return true;
    // Text *containing* alias tokens: "foo <PERSON_1> bar"
    if (/<\s*[A-Z][A-Z0-9_]{1,40}\s*>/.test(text)) return true;
    // Text *containing* redacted tokens
    if (/\[[^\]]*redacted[^\]]*\]/i.test(text)) return true;
    // Text that looks like a corrupted/concatenated redaction artefact
    // e.g. "phon:930409..." or "emailfoo@bar.commom"
    if (/\[\w+\s+REDACTED\]/i.test(text)) return true;
    // "WORD REDACTED" without brackets — GLiNER span may exclude the surrounding brackets
    if (/^[A-Z][A-Z\s]{1,30}\s+REDACTED$/i.test(text)) return true;
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
    // Pre-populate ledger from the site alias cache so aliases stay consistent
    // across sessions (e.g. PERSON_1 remains PERSON_1 on the same site).
    const ledger = {
      aliases: new Map(Object.entries(this.siteAliasCache.aliases || {})),
      counters: new Map(Object.entries(this.siteAliasCache.counters || {}).map(([k, v]) => [k, Number(v)])),
      maskCounters: new Map(Object.entries(this.siteAliasCache.maskCounters || {}).map(([k, v]) => [k, Number(v)]))
    };
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
      // Persist new alias to site cache
      this.siteAliasCache.aliases[key] = alias;
      this.persistSiteAliasLedger();
    }

    // Allocate a stable numeric index per label type for numbered mask tokens,
    // e.g. [NAME_1 REDACTED], [NAME_2 REDACTED] — enables response de-anonymization.
    if (!ledger.maskCounters) ledger.maskCounters = new Map();
    const maskKey = String(detection.label || 'pii').toUpperCase().replace(/[^A-Z0-9]+/g, '_') || 'PII';
    const maskIndex = (ledger.maskCounters.get(maskKey) || 0) + 1;
    ledger.maskCounters.set(maskKey, maskIndex);
    // Persist mask counter to site cache
    this.siteAliasCache.maskCounters[maskKey] = maskIndex;
    this.persistSiteAliasLedger();

    return {
      ...detection,
      alias,
      maskIndex,
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
    // Keep site alias cache in sync so counters persist across sessions
    this.siteAliasCache.counters[normalized] = next;
    this.persistSiteAliasLedger();
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
      // Snapshot committed redactions into session map so response decoder survives
      // clearElementState (which fires at 180ms post-send, before AI responds).
      state.items.forEach((item) => {
        if (!item.redacted) return;
        const original = item.text;
        if (item.maskIndex != null) this.sessionDecodeMap.set(this.getMaskText(item.label, item.maskIndex), original);
        this.sessionDecodeMap.set(this.getMaskText(item.label), original);
        if (item.alias) this.sessionDecodeMap.set(`<${item.alias}>`, original);
        if (item.anonymizedText) this.sessionDecodeMap.set(item.anonymizedText, original);
      });
      this._persistSessionDecodeMap();
      this.renderElement(element);
      this.persistCache(element);
      this.showNotification(`${count} item${count === 1 ? '' : 's'} protected`, 'info');
      this.updateStats(0, count);
      // Decode any matching tokens in AI response areas now that new redactions exist
      this.scanExistingResponseAreas();
      // Track per-site manual redact count — after 3 times offer always-auto-redact
      this.siteRedactCount += 1;
      chrome.storage.local.set({ [this.getSiteRedactCountKey()]: this.siteRedactCount });
      if (this.siteRedactCount === 3 && !this.settings.autoRedact) {
        setTimeout(() => this.showNotification('Tip: enable Auto-Redact in Veil settings to do this automatically.', 'info'), 1200);
      }
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

      // Attach delegated event listeners for click/hover on spans
      this._attachContentEditableSpanListeners(element);

      // ── Restore cursor position ──
      this.restoreCaretPosition(element, savedCaret);

      if (!allUnderlineOnly) {
        this.playCommitAnimation(element);
      }
      this.removeTokenTray(element);

      // FIX: Update lastAnalyzedSnapshot so the input event fired by the DOM
      // mutation doesn't immediately re-trigger detection on the replaced text.
      const currentRevision = this.getInputRevision(element);
      const sourceText = state.sourceText || '';
      const snapshotKey = `${currentRevision}:${this.hashString(sourceText)}`;
      this.lastAnalyzedSnapshot.set(element, snapshotKey);

      // Schedule overlay pass: if the host editor (Lexical, ProseMirror, Angular, etc.)
      // strips our injected spans during its reconciliation cycle, we draw external
      // fixed-position highlights instead so visuals survive without touching the editor DOM.
      this._scheduleOverlayUpdate(element);
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
    const sourceText = state.sourceText || '';
    if (!sourceText) return null;

    // Detect whether the editor uses <p> (Gemini) or <br> (ChatGPT/Claude) for newlines
    const newlineStyle = this.detectNativeNewlineStyle(element);

    const sorted = state.items
      .map((item, index) => ({ item, index }))
      .slice()
      .sort((a, b) => a.item.start - b.item.start);

    const encodeSegment = (str) => newlineStyle === 'p'
      ? this.escapeHtmlForParagraph(str)
      : this.textToHtmlPreserveLayout(str);

    const parts = [];
    let cursor = 0;

    sorted.forEach(({ item, index }) => {
      const start = Math.max(0, item.start);
      const end = Math.min(sourceText.length, item.end);
      if (start >= end || start < cursor) return;

      if (cursor < start) {
        parts.push(encodeSegment(sourceText.slice(cursor, start)));
      }

      const originalText = item.text || sourceText.slice(start, end);
      const color = this.getTypeColor(item.label);
      const stagger = `${Math.min(index * 30, 280)}ms`;
      const escapedOriginal = encodeSegment(originalText);

      if (item.redacted) {
        const displayText = encodeSegment(this.getReplacementText(item));
        const extraClasses = ['ps-redaction-active'];
        if (this.settings?.redactionMode === 'anonymize') extraClasses.push('ps-redaction-anonymized');
        if (flashIndex === index) extraClasses.push('ps-undo-ripple');
        parts.push(
          `<span class="ps-redaction ${extraClasses.join(' ')}"` +
          ` data-index="${index}"` +
          ` data-ps-original="${this._escapeAttr(originalText)}"` +
          ` style="--redaction-color:${color};--stagger:${stagger}"` +
          ` title="Hover to restore ${this.escapeHtml(item.label)}"` +
          `>${displayText}</span>`
        );
      } else {
        const flashClass = flashIndex === index ? ' ps-undo-ripple' : '';
        parts.push(
          `<span class="ps-pii-underline${flashClass}"` +
          ` data-index="${index}"` +
          ` data-ps-original="${this._escapeAttr(originalText)}"` +
          (item.tier ? ` data-tier="${item.tier}"` : '') +
          ` style="--detection-color:${color};--stagger:${stagger}"` +
          `>${escapedOriginal}</span>`
        );
      }

      cursor = end;
    });

    if (cursor < sourceText.length) {
      parts.push(encodeSegment(sourceText.slice(cursor)));
    }

    if (newlineStyle === 'p') {
      // Parts contain literal \n — split and wrap each line in <p>
      const flat = parts.join('');
      const lines = flat.split('\n');
      return lines.map((line) => `<p>${line || '<br>'}</p>`).join('');
    }

    return parts.join('');
  }

  /** Escape a string for safe use inside an HTML attribute value (double-quoted). */
  _escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  textToHtmlPreserveLayout(str) {
    const value = String(str || '').replace(/\r\n?/g, '\n');

    // Step 1: Extract and preserve code blocks (```...```) first
    const codeBlockPattern = /(```[\s\S]*?```)/g;
    const codeBlocks = [];
    let textWithoutCodeBlocks = value.replace(codeBlockPattern, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Step 2: Extract inline code (`...`)
    const inlineCodePattern = /(`[^`\n]+`)/g;
    const inlineCodes = [];
    textWithoutCodeBlocks = textWithoutCodeBlocks.replace(inlineCodePattern, (match) => {
      inlineCodes.push(match);
      return `__INLINE_CODE_${inlineCodes.length - 1}__`;
    });

    // Step 3: Process the remaining text with whitespace and markdown
    let out = '';
    let lineStart = true;

    for (let i = 0; i < textWithoutCodeBlocks.length; i += 1) {
      const ch = textWithoutCodeBlocks[i];

      // Check for placeholder markers and restore original
      if (textWithoutCodeBlocks.startsWith(`__CODE_BLOCK_`, i)) {
        const match = textWithoutCodeBlocks.slice(i).match(/^__CODE_BLOCK_(\d+)__/);
        if (match) {
          // Restore code block with literal formatting
          const codeIdx = parseInt(match[1], 10);
          const codeBlock = codeBlocks[codeIdx] || '';
          // Convert newlines within code blocks to <br> but preserve leading/trailing newlines
          out += codeBlock.replace(/\n/g, '<br>');
          i += match[0].length - 1;
          lineStart = false;
          continue;
        }
      }

      if (textWithoutCodeBlocks.startsWith(`__INLINE_CODE_`, i)) {
        const match = textWithoutCodeBlocks.slice(i).match(/^__INLINE_CODE_(\d+)__/);
        if (match) {
          const codeIdx = parseInt(match[1], 10);
          const inlineCode = inlineCodes[codeIdx] || '';
          // Keep inline code as-is (backticks will be handled later)
          out += inlineCode;
          i += match[0].length - 1;
          lineStart = false;
          continue;
        }
      }

      if (ch === '\n') {
        out += '<br>';
        lineStart = true;
        continue;
      }

      if (ch === '\t') {
        out += '&nbsp;&nbsp;&nbsp;&nbsp;';
        lineStart = false;
        continue;
      }

      if (ch === ' ') {
        const prev = i > 0 ? textWithoutCodeBlocks[i - 1] : '\n';
        const next = i + 1 < textWithoutCodeBlocks.length ? textWithoutCodeBlocks[i + 1] : '\n';
        // Preserve spaces at line start, after other spaces, and before newlines
        const preserve = lineStart || prev === ' ' || next === ' ' || next === '\n';
        out += preserve ? '&nbsp;' : ' ';
        lineStart = false;
        continue;
      }

      // HTML entity escaping
      if (ch === '&') {
        out += '&amp;';
      } else if (ch === '<') {
        out += '&lt;';
      } else if (ch === '>') {
        out += '&gt;';
      } else {
        out += ch;
      }
      lineStart = false;
    }

    // Step 4: Restore inline code with formatting
    out = out.replace(/__INLINE_CODE_(\d+)__/g, (match, idx) => {
      const code = inlineCodes[parseInt(idx, 10)] || '';
      // Wrap inline code in styling span but keep backticks visible
      return `<span class="ps-inline-code">${code}</span>`;
    });

    // Step 5: Handle markdown formatting that wasn't in code blocks
    // Bold: **text** or __text__
    out = out.replace(/(\*\*[^*]+\*\*|__[^_]+__)/g, '<strong>$1</strong>');
    // Italic: *text* or _text_ (not in strong)
    out = out.replace(/(?<!\*)(\*[^*]+\*)(?!\*)/g, '<em>$1</em>');
    out = out.replace(/(?<!_)(_[^_]+_)(?!_)/g, '<em>$1</em>');

    return out;
  }

  /**
   * Attach click / hover listeners to ps-redaction and ps-pii-underline spans
   * inside a contentEditable element via event delegation.  Called once after
   * innerHTML is set so that listeners survive serialisation.
   */
  _attachContentEditableSpanListeners(element) {
    // Guard against double-attaching. Use a WeakSet to avoid polluting DOM nodes.
    if (!this._ceListenersAttached) this._ceListenersAttached = new WeakSet();
    if (this._ceListenersAttached.has(element)) return;
    this._ceListenersAttached.add(element);

    element.addEventListener('click', (event) => {
      const span = event.target.closest('.ps-redaction, .ps-pii-underline');
      if (!span) return;
      event.preventDefault();
      event.stopPropagation();
      const index = parseInt(span.getAttribute('data-index'), 10);
      if (Number.isNaN(index)) return;
      if (span.classList.contains('ps-pii-underline')) {
        this.redactSingle(element, index);
      } else {
        this.toggleRedaction(element, index);
      }
    });

    // IMPORTANT: mouseenter/mouseleave do NOT bubble, so delegating them on the
    // parent element never fires for child spans. Use mouseover/mouseout instead.
    //
    // KEY INSIGHT (Grammarly approach): rich editors like ProseMirror/Lexical run a
    // MutationObserver with { attributes: true, subtree: true } on their contenteditable.
    // Any attribute change on a child node (even a CSS class toggle) triggers their
    // reconciliation loop which re-renders the DOM — wiping our spans before rAF fires.
    //
    // Fix: capture getBoundingClientRect() SYNCHRONOUSLY during the event handler
    // (before any microtask/reconciliation can run), then render the reveal overlay as
    // a fixed-position div OUTSIDE the contenteditable. Zero DOM mutations inside the
    // editor during hover.
    element.addEventListener('mouseover', (event) => {
      const span = event.target.closest('.ps-redaction, .ps-pii-underline');
      if (!span || !element.contains(span)) return;
      const index = parseInt(span.getAttribute('data-index'), 10);
      if (Number.isNaN(index)) return;
      const mode = span.classList.contains('ps-pii-underline') ? 'underline' : 'redacted';

      // Capture rect NOW — synchronously — before any reconciliation microtask runs.
      // Use getClientRects() to get the visual line segment under the cursor; a plain
      // getBoundingClientRect() gives a giant combined box for wrapped tokens.
      const rects = span.getClientRects();
      const anchorRect = [...rects].find(r => event.clientY >= r.top && event.clientY <= r.bottom)
        ?? rects[0]
        ?? span.getBoundingClientRect();

      if (mode === 'redacted') {
        const currentState = this.redactions.get(element);
        const current = currentState?.items?.[index];
        if (current?.redacted) {
          this.showRevealOverlay(current.text, anchorRect, span);
        }
      }
    });

    element.addEventListener('mouseout', (event) => {
      const span = event.target.closest('.ps-redaction, .ps-pii-underline');
      if (!span || !element.contains(span)) return;
      // Skip if the pointer is still within the same span (moving between child nodes)
      if (span.contains(event.relatedTarget)) return;
      this.hideRevealOverlay();
    });
  }

  // ── Underline span (Grammarly-style, before redaction) ──

  createUnderlineSpan(element, index, item) {
    const span = document.createElement('span');
    span.className = 'ps-pii-underline';
    span.setAttribute('data-index', String(index));
    span.setAttribute('data-ps-original', String(item.text || ''));
    if (item.tier) span.setAttribute('data-tier', item.tier);
    span.style.setProperty('--detection-color', this.getTypeColor(item.label));
    span.style.setProperty('--stagger', `${Math.min(index * 40, 300)}ms`);
    span.textContent = item.text;

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
    return this.getMaskText(item.label, item.maskIndex ?? null);
  }

  getMaskText(label, maskIndex = null) {
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
    const base = map[label] || `[${String(label || 'PII').toUpperCase()} REDACTED]`;
    // Insert numeric index before REDACTED so tokens are uniquely identifiable:
    // [NAME REDACTED] → [NAME_1 REDACTED]. This enables response de-anonymization.
    if (maskIndex != null) return base.replace(/ REDACTED]$/, `_${maskIndex} REDACTED]`);
    return base;
  }

  // ═══════════════════════════════════════════════════════════
  // Popover (per-span anchored tooltip – Grammarly-style)
  // ═══════════════════════════════════════════════════════════

  // anchorRect: pre-captured getBoundingClientRect() from the hover event.
  // Passing it avoids relying on the span still being in the DOM by the time
  // requestAnimationFrame fires (rich editors may reconcile in between).
  // Popover removed — actions (redact/restore) are accessible via token tray chips and
  // the inline click handler on detection spans. showPopover is kept as a no-op so any
  // remaining call sites are safe.
  // eslint-disable-next-line no-unused-vars
  showPopover(_anchorSpan, _element, _index, _mode, _anchorRect = null) {}

  hidePopover() {
    if (!this.activePopover) return;
    this.activePopover.classList.remove('ps-popover-visible');
    const old = this.activePopover;
    setTimeout(() => old.remove(), 200);
    this.activePopover = null;
  }

  // ── Reveal overlay (fixed-position, outside contenteditable DOM) ──────────
  // Displays the original text visually over the redacted span on hover,
  // without touching any node inside the contenteditable. This survives
  // rich-editor DOM reconciliation (ProseMirror, Lexical, etc.).

  showRevealOverlay(originalText, anchorRect, refSpan) {
    this.hideRevealOverlay();
    if (!anchorRect || anchorRect.width === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'ps-reveal-overlay';

    // Inherit typographic properties from the span so text aligns naturally.
    const cs = window.getComputedStyle(refSpan);
    overlay.style.cssText = [
      `position:fixed`,
      `top:${anchorRect.top}px`,
      // Centre the overlay horizontally over the span; width is auto so longer
      // original text doesn't get clipped.
      `left:${anchorRect.left + anchorRect.width / 2}px`,
      `transform:translateX(-50%)`,
      `height:${anchorRect.height}px`,
      `display:flex`,
      `align-items:center`,
      `justify-content:center`,
      `white-space:nowrap`,
      `pointer-events:none`,
      `z-index:2147483100`,
      `font-size:${cs.fontSize}`,
      `font-family:${cs.fontFamily}`,
      `font-weight:${cs.fontWeight}`,
      `line-height:${cs.lineHeight}`,
      `letter-spacing:${cs.letterSpacing}`,
      `padding:1px 4px`,
      `border-radius:3px`,
    ].join(';');

    // Safe — this element lives in document.body, not in the contenteditable.
    overlay.textContent = originalText;
    document.body.appendChild(overlay);
    this.activeRevealOverlay = overlay;
  }

  hideRevealOverlay() {
    if (this.activeRevealOverlay) {
      this.activeRevealOverlay.remove();
      this.activeRevealOverlay = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // External overlay highlights for hostile contenteditables
  // (ChatGPT / Gemini / Claude — editors that strip injected spans)
  // ═══════════════════════════════════════════════════════════

  _scheduleOverlayUpdate(element) {
    clearTimeout(this._ceOverlayTimers.get(element));
    this._ceOverlayTimers.set(element, setTimeout(() => {
      this._updateElementOverlay(element);
    }, 90)); // 90ms — enough for any editor reconciliation microtask/macrotask to complete
  }

  _updateElementOverlay(element) {
    this._clearElementOverlay(element);

    const state = this.redactions.get(element);
    if (!state || !element.isConnected || !state.items.length) return;

    // If our spans survived innerHTML injection (regular site), the existing span
    // delegation handles everything — no overlay needed.
    if (element.querySelector('.ps-redaction, .ps-pii-underline')) return;

    // Spans were stripped by the editor. Draw external fixed-position highlights.
    const highlights = [];

    state.items.forEach((item, index) => {
      const range = item.redacted
        ? this._getTokenRange(element, this.getReplacementText(item))
        : this._getTextNodeRange(element, item.start, item.end);

      if (!range) return;
      // Use getClientRects() instead of getBoundingClientRect() so that tokens
      // wrapping across multiple visual lines get one hl div per line segment,
      // not a single giant bounding-box rectangle.
      const lineRects = [...range.getClientRects()].filter(r => r.width > 0);
      if (!lineRects.length) return;

      const color = this.getTypeColor(item.label);
      lineRects.forEach(rect => {
        const hl = document.createElement('div');
        hl.className = `ps-overlay-hl ${item.redacted ? 'ps-overlay-hl-redacted' : 'ps-overlay-hl-underline'}`;
        hl.setAttribute('data-index', String(index));
        hl.style.cssText = [
          'position:fixed',
          `left:${Math.round(rect.left)}px`,
          `top:${Math.round(rect.top)}px`,
          `width:${Math.round(rect.width)}px`,
          `height:${Math.round(rect.height)}px`,
          `--hl-color:${color}`,
        ].join(';');

        hl.addEventListener('mouseenter', () => {
          const hlRect = hl.getBoundingClientRect();
          if (item.redacted) this.showRevealOverlay(item.text, hlRect, hl);
        });
        hl.addEventListener('mouseleave', () => {
          this.hideRevealOverlay();
        });
        hl.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.hideRevealOverlay();
          if (item.redacted) {
            this.toggleRedaction(element, index);
          } else {
            this.redactSingle(element, index);
          }
        });

        document.body.appendChild(hl);
        highlights.push(hl);
      });
    });

    if (highlights.length) {
      this._ceOverlayHighlights.set(element, highlights);
    }
  }

  _clearElementOverlay(element) {
    const highlights = this._ceOverlayHighlights.get(element);
    if (highlights) {
      highlights.forEach((hl) => hl.remove());
      this._ceOverlayHighlights.delete(element);
    }
    clearTimeout(this._ceOverlayTimers.get(element));
    this._ceOverlayTimers.delete(element);
  }

  _refreshAllOverlays() {
    this._ceOverlayHighlights.forEach((_, element) => {
      this._scheduleOverlayUpdate(element);
    });
  }

  // Walk text nodes in element to build a Range for character offsets [start, end].
  _getTextNodeRange(element, start, end) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    let node;

    while ((node = walker.nextNode())) {
      const len = node.textContent.length;

      if (!startNode && charCount + len > start) {
        startNode = node;
        startOff = start - charCount;
      }
      if (startNode && charCount + len >= end) {
        endNode = node;
        endOff = end - charCount;
        break;
      }
      charCount += len;
    }

    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, Math.min(startOff, startNode.textContent.length));
      range.setEnd(endNode, Math.min(endOff, endNode.textContent.length));
      return range;
    } catch { return null; }
  }

  // Walk text nodes to find the first occurrence of tokenText and return its Range.
  _getTokenRange(element, tokenText) {
    if (!tokenText) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;

    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(tokenText);
      if (idx !== -1) {
        try {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + tokenText.length);
          return range;
        } catch { return null; }
      }
    }
    return null;
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

    // Position below the element, clamped to viewport right edge
    const rect = element.getBoundingClientRect();
    bar.style.top = `${window.scrollY + rect.bottom + 6}px`;
    bar.style.left = `${window.scrollX + rect.left}px`;

    requestAnimationFrame(() => {
      const maxLeft = window.scrollX + window.innerWidth - bar.offsetWidth - 8;
      if (parseFloat(bar.style.left) > maxLeft) bar.style.left = `${Math.max(8, maxLeft)}px`;
      bar.classList.add('ps-action-bar-visible');
    });
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
      chip.textContent = this.summarizeTokenText(item.text);
      chip.title = item.redacted ? 'Click to restore' : 'Click to re-redact';
      chip.addEventListener('click', () => this.toggleRedaction(element, index));
      tray.appendChild(chip);
    });

    this.positionTokenTray(element, tray);
  }

  positionTokenTray(element, tray) {
    const rect = element.getBoundingClientRect();
    // Skip elements that aren't actually visible (hidden duplicates, zero-size ghosts)
    if (rect.width < 50 || rect.height < 10) return;
    // Tray is position:fixed — use viewport coordinates directly (no scroll offset)
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 80) {
      // Not enough room below — show above the element instead
      tray.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      tray.style.top = 'auto';
    } else {
      tray.style.top = `${rect.bottom + 6}px`;
      tray.style.bottom = 'auto';
    }
    tray.style.left = `${rect.left}px`;
    tray.style.maxWidth = `${Math.max(220, rect.width)}px`;
    tray.classList.add('ps-token-tray-visible');
    requestAnimationFrame(() => {
      const maxLeft = window.innerWidth - tray.offsetWidth - 8;
      if (parseFloat(tray.style.left) > maxLeft) tray.style.left = `${Math.max(8, maxLeft)}px`;
    });
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
      console.error('[Veil] cache persist error:', e);
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
      console.error('[Veil] cache rehydration error:', e);
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
    this._clearElementOverlay(element);
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
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  updateStats(detections, redactions) {
    this.pageStats = {
      detections: this.pageStats.detections + (Number(detections) || 0),
      redactions: this.pageStats.redactions + (Number(redactions) || 0)
    };
  }

  handleRuntimeMessage(request, _sender, sendResponse) {
    if (request?.action === 'serverCrashed') {
      this.showNotification('⚠ GLiNER2 server offline — using regex fallback.', 'warning');
      // Reset detector mode so next detection triggers a re-check
      try { chrome.runtime.sendMessage({ action: 'initialize' }).catch(() => { }); } catch { }
      return false;
    }

    if (request?.action === 'serverRestored') {
      this.showNotification('✓ Local model back online — full AI detection active.', 'info');
      try { chrome.runtime.sendMessage({ action: 'initialize' }).catch(() => { }); } catch { }
      return false;
    }

    if (request?.action !== 'getPageStats') return false;
    if (window !== window.top) return false;
    const reverseMap = this.buildGlobalReverseMap();
    const redactionKey = reverseMap.size
      ? Object.fromEntries([...reverseMap])
      : null;
    sendResponse({
      success: true,
      stats: { ...this.pageStats },
      redactionKey
    });
    return false;
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

    this.scanningPills.forEach((pill) => {
      if (pill?.psHideTimer) clearTimeout(pill.psHideTimer);
      pill?.remove?.();
    });
    this.scanningPills.clear();

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

    if (this.responseDecoderObserver) {
      this.responseDecoderObserver.disconnect();
      this.responseDecoderObserver = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Per-Site Persistent Memory
  // ═══════════════════════════════════════════════════════════

  getSiteAliasKey() {
    return `veil::aliases::${location.hostname}`;
  }

  getSiteRedactCountKey() {
    return `veil::redactCount::${location.hostname}`;
  }

  async loadSiteAliasLedger() {
    const key = this.getSiteAliasKey();
    const countKey = this.getSiteRedactCountKey();
    try {
      const data = await new Promise((resolve) => chrome.storage.local.get([key, countKey], resolve));
      const stored = data[key];
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (stored && stored.updatedAt && (Date.now() - stored.updatedAt) < thirtyDays) {
        this.siteAliasCache = {
          aliases: stored.aliases || {},
          counters: stored.counters || {},
          maskCounters: stored.maskCounters || {}
        };
      }
      this.siteRedactCount = Number(data[countKey] || 0);
    } catch { /* non-fatal */ }
  }

  persistSiteAliasLedger() {
    // Debounce writes — alias allocations happen in bursts during detection
    clearTimeout(this.siteAliasPersistTimer);
    this.siteAliasPersistTimer = setTimeout(() => {
      const key = this.getSiteAliasKey();
      chrome.storage.local.set({
        [key]: { ...this.siteAliasCache, updatedAt: Date.now() }
      });
    }, 1000);
  }

  // Persist sessionDecodeMap to chrome.storage.session so it survives tab reload.
  // Auto-cleared when the browser closes — PII never written to long-term disk.
  _persistSessionDecodeMap() {
    if (!chrome?.storage?.session) return;
    const key = `veil::decodeMap::${location.hostname}`;
    chrome.storage.session.set({ [key]: Object.fromEntries(this.sessionDecodeMap) });
  }

  // Restore sessionDecodeMap from chrome.storage.session on startup.
  async _loadSessionDecodeMap() {
    if (!chrome?.storage?.session) return;
    const key = `veil::decodeMap::${location.hostname}`;
    try {
      const data = await new Promise((resolve) => chrome.storage.session.get(key, resolve));
      if (data[key] && typeof data[key] === 'object') {
        Object.entries(data[key]).forEach(([token, original]) => {
          if (!this.sessionDecodeMap.has(token)) {
            this.sessionDecodeMap.set(token, original);
          }
        });
      }
    } catch { /* non-fatal — session storage unavailable in older Chrome */ }
  }

  // ═══════════════════════════════════════════════════════════
  // Response De-Anonymization ("Invisible Veil")
  // ═══════════════════════════════════════════════════════════

  // Build a reverse map from all active redaction states: token → originalText.
  // Covers mask tokens ([NAME_1 REDACTED]), alias tokens (<PERSON_1>), and
  // synthetic names (anonymize mode). Memory-only — never persisted.
  buildGlobalReverseMap() {
    // Seed from session-level cache so decoder works even after clearElementState
    // fires at 180ms post-send (before the AI response has been received).
    const map = new Map(this.sessionDecodeMap);
    this.redactions.forEach((state) => {
      if (!state?.items) return;
      state.items.forEach((item) => {
        if (!item.redacted) return;
        const original = item.text;
        // Numbered mask token: [NAME_1 REDACTED]
        if (item.maskIndex != null) map.set(this.getMaskText(item.label, item.maskIndex), original);
        // Generic mask token (backward compat): [NAME REDACTED]
        map.set(this.getMaskText(item.label), original);
        // Alias token: <PERSON_1>
        if (item.alias) map.set(`<${item.alias}>`, original);
        // Synthetic name (anonymize mode)
        if (item.anonymizedText) map.set(item.anonymizedText, original);
      });
    });
    return map;
  }

  // Replace tokens in a response-area element tree with original values.
  // Uses direct text node content mutation — no new DOM nodes, no span wrapping.
  // This is the least invasive mutation possible and survives React/Preact
  // reconciliation because completed responses are frozen (no more state updates).
  processResponseNodeTree(container, reverseMap) {
    if (!container || !reverseMap.size) return;

    const tokens = [...reverseMap.keys()].sort((a, b) => b.length - a.length);
    const tokenRegex = new RegExp(
      tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g'
    );

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    textNodes.forEach((textNode) => {
      if (!textNode.parentNode) return;
      // Never mutate text inside Veil's own UI elements
      if (textNode.parentElement?.closest(
        '.ps-pii-underline, .ps-redaction, .ps-action-bar, .ps-token-tray, .ps-scanning-pill'
      )) return;

      const text = textNode.textContent;
      tokenRegex.lastIndex = 0;
      if (!tokenRegex.test(text)) return;
      tokenRegex.lastIndex = 0;

      // Pure text replacement — decoded value shown inline, no DOM structure change.
      textNode.textContent = text.replace(tokenRegex, (match) => reverseMap.get(match) ?? match);
    });
  }

  // Scan all current response areas for tokens. Called after new redactions are committed.
  scanExistingResponseAreas() {
    const reverseMap = this.buildGlobalReverseMap();
    if (!reverseMap.size) return;
    const selector = RESPONSE_AREA_SELECTORS.join(', ');

    // Disconnect during scan so our text mutations don't re-trigger the decoder observer.
    if (this.responseDecoderObserver) this.responseDecoderObserver.disconnect();
    this.isApplyingDecode = true;
    try {
      document.querySelectorAll(selector).forEach((el) => this.processResponseNodeTree(el, reverseMap));
    } catch { /* ignore invalid selectors on unusual pages */ }
    finally {
      this.isApplyingDecode = false;
      if (this.responseDecoderObserver) {
        this.responseDecoderObserver.observe(document.body, {
          childList: true, subtree: true, characterData: true,
        });
      }
    }
  }

  // Set up a MutationObserver to decode tokens in response areas after streaming ends.
  //
  // Design:
  //   • watches characterData so we catch streaming text-node updates
  //   • 500ms per-container debounce — decode fires only after streaming goes quiet
  //   • disconnect → replace → reconnect prevents our own text mutations from
  //     looping back into the observer
  initResponseDecoder() {
    if (this.responseDecoderObserver) return;
    const responseSelector = RESPONSE_AREA_SELECTORS.join(', ');
    const decodeTimers = new Map(); // container → setTimeout id

    const observerOptions = { childList: true, subtree: true, characterData: true };

    this.responseDecoderObserver = new MutationObserver((mutations) => {
      if (this.isApplyingDecode) return; // our own replacement firing — skip
      const reverseMap = this.buildGlobalReverseMap();
      if (!reverseMap.size) return;

      // Identify which response-area containers were touched by this mutation batch.
      const affected = new Set();
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
        if (!target) continue;
        try {
          const container = target.matches(responseSelector)
            ? target
            : target.closest(responseSelector);
          if (container) affected.add(container);
        } catch { /* invalid selector on some page */ }
      }

      // Debounce per container: reset timer on every streaming chunk,
      // fire 500ms after the last one (i.e. after streaming completes).
      affected.forEach((container) => {
        clearTimeout(decodeTimers.get(container));
        decodeTimers.set(container, setTimeout(() => {
          decodeTimers.delete(container);
          const currentMap = this.buildGlobalReverseMap(); // re-fetch — may have grown
          if (!currentMap.size) return;

          // Disconnect → mutate text nodes → reconnect.
          this.responseDecoderObserver.disconnect();
          this.isApplyingDecode = true;
          try {
            this.processResponseNodeTree(container, currentMap);
          } finally {
            this.isApplyingDecode = false;
            this.responseDecoderObserver.observe(document.body, observerOptions);
          }
        }, 500));
      });
    });

    this.responseDecoderObserver.observe(document.body, observerOptions);

    // Decode any tokens already present on the page (resumed conversation, etc.)
    this.scanExistingResponseAreas();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PrivacyShield());
} else {
  new PrivacyShield();
}
