// popup.js - Claude-like compact settings UI + server controls

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
    id: 'github_token',
    label: 'api_key',
    pattern: '\\bgh[pousr]_[A-Za-z0-9]{20,}\\b',
    flags: 'g',
    score: 0.99,
    replacement: '[TOKEN REDACTED]',
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

const DEFAULT_SETTINGS = {
  enabled: true,
  autoRedact: true,
  redactionMode: 'anonymize',
  sensitivity: 'medium',
  includeRegexWhenModelOnline: false,
  monitorAllSites: true,
  enabledTypes: [
    'person',
    'email',
    'phone',
    'address',
    'ssn',
    'credit_card',
    'date_of_birth',
    'location',
    'organization'
  ],
  monitoredSites: [
    'claude.ai',
    'gemini.google.com',
    'chatgpt.com',
    'chat.openai.com',
    'copilot.microsoft.com',
    'poe.com'
  ],
  monitoredSelectors: [
    'textarea',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input:not([type])',
    'div[contenteditable="true"]',
    '[role="textbox"]',
    '.ProseMirror'
  ],
  customPatterns: DEFAULT_CUSTOM_PATTERNS
};

class SettingsManager {
  constructor() {
    this.settings = {};
    this.stats = { detections: 0, redactions: 0 };
    this.localSecrets = {
      hfToken: '',
      mdpJwtToken: ''
    };
    this.serverBusy = false;
    this.serverPhase = 'disconnected';
    this.terminalVisible = false;
    this.serverToolsPanelIndex = 0;
    this.serverState = {
      known: false,
      installed: true,
      running: false,
      healthy: false,
      pid: null
    };
    this.serverMeta = this.getDefaultServerMeta();
    this.serverPollTimer = null;
    this.statsPollTimer = null;
    this.messageTimer = null;
    this.copyButtonTimers = new Map();
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadLocalSecrets();
    this.bindEvents();
    this.render();
    await this.loadPageStats();
    await this.refreshServerStatus();
    await this.refreshServerLogs({ silent: true });
    this.startServerPolling();
    this.startStatsPolling();
  }

  loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (result) => {
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...result
        };
        if (!Array.isArray(this.settings.customPatterns)) {
          this.settings.customPatterns = DEFAULT_CUSTOM_PATTERNS;
        }
        resolve();
      });
    });
  }

  async getActiveTabId() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(typeof tabs?.[0]?.id === 'number' ? tabs[0].id : null);
      });
    });
  }

  async loadPageStats() {
    const tabId = await this.getActiveTabId();
    if (typeof tabId !== 'number') {
      this.stats = { detections: 0, redactions: 0 };
      this.renderStats();
      return;
    }

    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'getPageStats' }, (message) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false });
          return;
        }
        resolve(message || { success: false });
      });
    });

    if (response?.success && response.stats) {
      this.stats = {
        detections: Number(response.stats.detections) || 0,
        redactions: Number(response.stats.redactions) || 0
      };
    } else {
      this.stats = { detections: 0, redactions: 0 };
    }

    this.renderStats();
  }

  loadLocalSecrets() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['hfToken', 'mdpJwtToken'], (result) => {
        this.localSecrets = {
          hfToken: typeof result.hfToken === 'string' ? result.hfToken : '',
          mdpJwtToken: typeof result.mdpJwtToken === 'string' ? result.mdpJwtToken : ''
        };
        resolve();
      });
    });
  }

  bindEvents() {
    document.getElementById('enabledToggle').addEventListener('change', (event) => {
      this.updateSetting('enabled', event.target.checked);
      this.renderStatus();
    });

    document.getElementById('autoRedactToggle').addEventListener('change', (event) => {
      this.updateSetting('autoRedact', event.target.checked);
    });

    document.getElementById('monitorAllSitesToggle').addEventListener('change', (event) => {
      this.updateSetting('monitorAllSites', event.target.checked);
      this.renderAdvancedStates();
    });

    document.getElementById('includeRegexToggle').addEventListener('change', (event) => {
      this.updateSetting('includeRegexWhenModelOnline', event.target.checked);
    });

    document.getElementById('redactionModeSelect').addEventListener('change', (event) => {
      this.updateSetting('redactionMode', event.target.value);
      this.renderModeSummary();
    });

    document.getElementById('sensitivitySelect').addEventListener('change', (event) => {
      this.updateSetting('sensitivity', event.target.value);
      this.renderModeSummary();
    });

    document.querySelectorAll('.type-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const enabledTypes = Array.from(document.querySelectorAll('.type-checkbox:checked')).map((node) => node.value);
        this.updateSetting('enabledTypes', enabledTypes);
      });
    });

    document.getElementById('saveAdvancedButton').addEventListener('click', () => this.saveAdvancedConfig(true));
    document.getElementById('loadDefaultsButton').addEventListener('click', () => {
      document.getElementById('patternsInput').value = JSON.stringify(DEFAULT_CUSTOM_PATTERNS, null, 2);
      this.setMessage('Default regex patterns loaded.');
    });

    document.getElementById('monitoredSitesInput').addEventListener('blur', () => this.saveAdvancedConfig(false, false));
    document.getElementById('selectorsInput').addEventListener('blur', () => this.saveAdvancedConfig(false, false));

    document.getElementById('resetButton').addEventListener('click', () => this.resetDefaults());

    document.getElementById('refreshServerButton').addEventListener('click', async () => {
      await this.refreshServerStatus();
      await this.refreshServerLogs({ silent: true });
    });
    document.getElementById('startServerButton').addEventListener('click', () => this.startServer());
    document.getElementById('stopServerButton').addEventListener('click', () => this.stopServer());
    document.getElementById('toggleTerminalButton').addEventListener('click', () => this.toggleTerminalVisibility());
    document.getElementById('copyInstallCommandButton').addEventListener('click', () => this.copyInstallCommand());
    document.getElementById('copyLogCommandButton').addEventListener('click', () => this.copyFromCode('logCommandText', 'copyLogCommandButton'));
    document.getElementById('serverToolsPrevButton').addEventListener('click', () => this.setServerToolsPanel(this.serverToolsPanelIndex - 1));
    document.getElementById('serverToolsNextButton').addEventListener('click', () => this.setServerToolsPanel(this.serverToolsPanelIndex + 1));
    document.querySelectorAll('.tool-tab').forEach((button) => {
      button.addEventListener('click', () => {
        this.setServerToolsPanel(Number(button.dataset.panelIndex) || 0);
      });
    });
    document.getElementById('saveHfTokenButton').addEventListener('click', () => this.saveHfToken());
    document.getElementById('clearHfTokenButton').addEventListener('click', () => this.clearHfToken());
    document.getElementById('hfTokenInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.saveHfToken();
      }
    });
    document.getElementById('saveMdpCredsButton').addEventListener('click', () => this.saveMdpCredentials());
    document.getElementById('clearMdpJwtButton').addEventListener('click', () => this.clearMdpJwt());
    document.getElementById('mdpJwtInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.saveMdpCredentials();
      }
    });

    window.addEventListener('unload', () => {
      if (this.serverPollTimer) {
        clearInterval(this.serverPollTimer);
        this.serverPollTimer = null;
      }
      if (this.statsPollTimer) {
        clearInterval(this.statsPollTimer);
        this.statsPollTimer = null;
      }
    });

    window.addEventListener('focus', () => {
      this.loadPageStats().catch(() => {});
    });
  }

  render() {
    document.getElementById('enabledToggle').checked = Boolean(this.settings.enabled);
    document.getElementById('autoRedactToggle').checked = Boolean(this.settings.autoRedact);
    document.getElementById('monitorAllSitesToggle').checked = Boolean(this.settings.monitorAllSites);
    document.getElementById('includeRegexToggle').checked = Boolean(this.settings.includeRegexWhenModelOnline);

    document.getElementById('redactionModeSelect').value = this.settings.redactionMode;
    document.getElementById('sensitivitySelect').value = this.settings.sensitivity;

    document.querySelectorAll('.type-checkbox').forEach((checkbox) => {
      checkbox.checked = this.settings.enabledTypes.includes(checkbox.value);
    });

    document.getElementById('monitoredSitesInput').value = (this.settings.monitoredSites || []).join('\n');
    document.getElementById('selectorsInput').value = (this.settings.monitoredSelectors || []).join('\n');
    document.getElementById('patternsInput').value = JSON.stringify(this.settings.customPatterns || [], null, 2);
    document.getElementById('hfTokenInput').value = this.localSecrets.hfToken || '';
    document.getElementById('mdpJwtInput').value = this.localSecrets.mdpJwtToken || '';

    this.renderStatus();
    this.renderStats();
    this.renderAdvancedStates();
    this.renderModeSummary();
    this.renderServerDiagnostics();
    this.renderTerminalVisibility();
    this.renderServerToolsPanel();
  }

  renderStatus() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const sub = document.getElementById('statusSubtext');

    dot.classList.remove('active', 'warn');

    if (!this.settings.enabled) {
      text.textContent = 'Paused';
      sub.textContent = 'Protection is disabled.';
      return;
    }

    if (this.serverPhase === 'connecting') {
      dot.classList.add('warn');
      text.textContent = 'Starting Local Server';
      sub.textContent = 'Attempting to connect to local GLiNER2...';
      return;
    }

    if (this.serverPhase === 'disconnecting') {
      dot.classList.add('warn');
      text.textContent = 'Stopping Local Server';
      sub.textContent = 'Shutting down local GLiNER2 server...';
      return;
    }

    if (!this.serverState.known) {
      text.textContent = 'Active';
      sub.textContent = 'Checking local model status...';
      return;
    }

    if (this.serverState.installed && this.serverState.running && this.serverState.healthy) {
      dot.classList.add('active');
      text.textContent = 'Active (Local)';
      sub.textContent = `Local GLiNER2 is online${this.serverState.pid ? ` (PID ${this.serverState.pid})` : ''}.`;
      return;
    }

    dot.classList.add('warn');
    if (!this.serverState.installed) {
      text.textContent = 'Active (Setup Needed)';
      sub.textContent = 'Native host missing. Install once for one-click server control.';
      return;
    }
    if (this.serverState.running && !this.serverState.healthy) {
      text.textContent = 'Active (Connecting)';
      sub.textContent = 'Local server process is starting.';
      return;
    }
    text.textContent = 'Active (Regex Mode)';
    sub.textContent = 'Local model is offline. Regex/custom patterns are active.';
  }

  renderStats() {
    document.getElementById('detectionCount').textContent = this.formatNumber(this.stats.detections);
    document.getElementById('redactionCount').textContent = this.formatNumber(this.stats.redactions);
  }

  renderAdvancedStates() {
    document.getElementById('monitoredSitesInput').disabled = Boolean(this.settings.monitorAllSites);
  }

  renderModeSummary() {
    const node = document.getElementById('modeSummary');
    if (!node) return;
    const mode = this.settings.redactionMode === 'mask' ? 'Mask' : 'Anonymize';
    const modeBehavior = mode === 'Mask'
      ? 'Output format: [TYPE REDACTED].'
      : 'Output format: API anonymized values (fallback: <TYPE_N>).';

    const sensitivityMap = {
      low: 'Low = strict precision mode (fewer detections).',
      medium: 'Medium = balanced mode.',
      high: 'High = aggressive mode (more detections, more false positives).'
    };
    node.textContent = `${mode}: ${modeBehavior} ${sensitivityMap[this.settings.sensitivity] || sensitivityMap.medium}`;
  }

  startServerPolling() {
    if (this.serverPollTimer) {
      clearInterval(this.serverPollTimer);
    }
    this.serverPollTimer = setInterval(() => {
      this.refreshServerStatus({ silent: true }).catch(() => {});
      this.refreshServerLogs({ silent: true }).catch(() => {});
    }, 2600);
  }

  startStatsPolling() {
    if (this.statsPollTimer) {
      clearInterval(this.statsPollTimer);
    }
    this.statsPollTimer = setInterval(() => {
      this.loadPageStats().catch(() => {});
    }, 1200);
  }

  setServerPhase(phase) {
    this.serverPhase = phase;
    this.renderStatus();
  }

  toggleTerminalVisibility() {
    this.terminalVisible = !this.terminalVisible;
    this.renderTerminalVisibility();
  }

  renderTerminalVisibility() {
    const panel = document.getElementById('terminalPanel');
    const button = document.getElementById('toggleTerminalButton');
    if (!panel || !button) return;
    panel.hidden = !this.terminalVisible;
    button.textContent = this.terminalVisible ? 'Hide Logs' : 'Show Logs';
  }

  getServerToolsPanelCount() {
    return Math.max(1, document.querySelectorAll('.server-tool-panel').length);
  }

  setServerToolsPanel(index) {
    const count = this.getServerToolsPanelCount();
    this.serverToolsPanelIndex = ((index % count) + count) % count;
    this.renderServerToolsPanel();
  }

  renderServerToolsPanel() {
    const track = document.getElementById('serverToolsTrack');
    if (track) {
      track.style.setProperty('--panel-index', String(this.serverToolsPanelIndex));
    }

    document.querySelectorAll('.tool-tab').forEach((button) => {
      const index = Number(button.dataset.panelIndex) || 0;
      button.classList.toggle('is-active', index === this.serverToolsPanelIndex);
    });
  }

  appendTerminalLine(message) {
    const output = document.getElementById('terminalOutput');
    if (!output) return;
    const prefix = new Date().toLocaleTimeString();
    const line = `[${prefix}] ${message}`;
    if (!output.textContent || output.textContent === 'No server logs yet.') {
      output.textContent = line;
    } else {
      output.textContent = `${output.textContent}\n${line}`;
    }
    output.scrollTop = output.scrollHeight;
  }

  renderTerminalLogs(lines) {
    const output = document.getElementById('terminalOutput');
    if (!output) return;
    if (!Array.isArray(lines) || lines.length === 0) {
      if (!output.textContent || output.textContent.trim().length === 0) {
        output.textContent = 'No server logs yet.';
      }
      return;
    }
    output.textContent = lines.join('\n');
    output.scrollTop = output.scrollHeight;
  }

  setServerButtonsDisabled(disabled) {
    this.serverBusy = disabled;
    document.getElementById('startServerButton').disabled = disabled;
    document.getElementById('stopServerButton').disabled = disabled;
    document.getElementById('refreshServerButton').disabled = disabled;
  }

  async requestServerControl(command, options = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'serverControl', command, options }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: 'No response from background.' });
      });
    });
  }

  getNativeHostInstallCommand() {
    return `bash scripts/install_native_host_linux.sh ${chrome.runtime.id}`;
  }

  getDefaultServerMeta() {
    return {
      logFile: '.runtime/gliner2_server.log',
      logCommand: 'tail -n 80 .runtime/gliner2_server.log',
      runtimeDir: '.runtime',
      modelOverride: null
    };
  }

  updateServerMeta(payload = {}) {
    this.serverMeta = {
      ...this.getDefaultServerMeta(),
      ...this.serverMeta,
      ...(payload || {})
    };
    this.renderServerDiagnostics();
  }

  renderServerDiagnostics() {
    document.getElementById('modelText').textContent = String(this.serverMeta.modelOverride || 'fastino/gliner2-base-v1');
    document.getElementById('logFileText').textContent = String(this.serverMeta.logFile || '.runtime/gliner2_server.log');
    document.getElementById('logCommandText').textContent = String(this.serverMeta.logCommand || 'tail -n 80 .runtime/gliner2_server.log');
    document.getElementById('runtimeDirText').textContent = String(this.serverMeta.runtimeDir || '.runtime');
  }

  setCopyButtonState(label = 'Copy', copied = false) {
    const button = document.getElementById('copyInstallCommandButton');
    button.textContent = label;
    button.classList.toggle('is-copied', copied);
  }

  setAnyCopyButtonState(buttonId, label = 'Copy', copied = false) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.textContent = label;
    button.classList.toggle('is-copied', copied);
  }

  clearCopyButtonTimer(buttonId) {
    const timer = this.copyButtonTimers.get(buttonId);
    if (timer) {
      clearTimeout(timer);
      this.copyButtonTimers.delete(buttonId);
    }
  }

  flashCopiedButton(buttonId) {
    this.clearCopyButtonTimer(buttonId);
    this.setAnyCopyButtonState(buttonId, 'Copied!', true);
    const timer = setTimeout(() => {
      this.setAnyCopyButtonState(buttonId, 'Copy', false);
      this.copyButtonTimers.delete(buttonId);
    }, 1400);
    this.copyButtonTimers.set(buttonId, timer);
  }

  renderNativeHostInstallBlock(installed) {
    const block = document.getElementById('nativeHostInstallBlock');
    const code = document.getElementById('nativeHostInstallCommand');
    if (installed) {
      block.hidden = true;
      code.textContent = '';
      this.clearCopyButtonTimer('copyInstallCommandButton');
      this.setCopyButtonState('Copy', false);
      return;
    }

    code.textContent = this.getNativeHostInstallCommand();
    block.hidden = false;
    this.setCopyButtonState('Copy', false);
  }

  async copyInstallCommand() {
    const command = this.getNativeHostInstallCommand();
    try {
      await navigator.clipboard.writeText(command);
      this.flashCopiedButton('copyInstallCommandButton');
      this.setMessage('Install command copied.');
    } catch {
      const helper = document.createElement('textarea');
      helper.value = command;
      helper.setAttribute('readonly', 'true');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      try {
        document.execCommand('copy');
        this.flashCopiedButton('copyInstallCommandButton');
        this.setMessage('Install command copied.');
      } catch {
        this.setMessage('Copy failed. Please copy manually.', true);
      } finally {
        helper.remove();
      }
    }
  }

  async copyFromCode(codeId, buttonId) {
    const node = document.getElementById(codeId);
    const text = node ? String(node.textContent || '').trim() : '';
    if (!text) {
      this.setMessage('Nothing to copy.', true);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.flashCopiedButton(buttonId);
      this.setMessage('Command copied.');
    } catch {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', 'true');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      try {
        document.execCommand('copy');
        this.flashCopiedButton(buttonId);
        this.setMessage('Command copied.');
      } catch {
        this.setMessage('Copy failed. Please copy manually.', true);
      } finally {
        helper.remove();
      }
    }
  }

  getInputHfToken() {
    const node = document.getElementById('hfTokenInput');
    return String(node?.value || '').trim();
  }

  getInputMdpJwtToken() {
    const node = document.getElementById('mdpJwtInput');
    return String(node?.value || '').trim();
  }

  async saveHfToken() {
    const hfToken = this.getInputHfToken();
    await new Promise((resolve) => {
      chrome.storage.local.set({ hfToken }, resolve);
    });
    this.localSecrets.hfToken = hfToken;
    this.setMessage(hfToken ? 'HF token saved locally.' : 'HF token cleared.');
  }

  async clearHfToken() {
    await new Promise((resolve) => {
      chrome.storage.local.set({ hfToken: '' }, resolve);
    });
    this.localSecrets.hfToken = '';
    const input = document.getElementById('hfTokenInput');
    if (input) input.value = '';
    this.setMessage('HF token cleared.');
  }

  async saveMdpCredentials() {
    const mdpJwtToken = this.getInputMdpJwtToken();
    await new Promise((resolve) => {
      chrome.storage.local.set({ mdpJwtToken }, resolve);
    });
    this.localSecrets.mdpJwtToken = mdpJwtToken;
    this.setMessage(mdpJwtToken ? 'Anonymization JWT saved locally.' : 'Anonymization JWT cleared.');
  }

  async clearMdpJwt() {
    await new Promise((resolve) => {
      chrome.storage.local.set({ mdpJwtToken: '' }, resolve);
    });
    this.localSecrets.mdpJwtToken = '';
    const input = document.getElementById('mdpJwtInput');
    if (input) input.value = '';
    this.setMessage('Anonymization JWT cleared.');
  }

  updateServerState(payload = {}) {
    this.serverState = {
      known: true,
      installed: payload.installed !== false,
      running: Boolean(payload.running),
      healthy: Boolean(payload.healthy),
      pid: payload.pid || null
    };
    if (!this.serverState.installed) {
      this.setServerPhase('disconnected');
    } else if (this.serverState.running && this.serverState.healthy) {
      this.setServerPhase('active');
    } else if (this.serverState.running && !this.serverState.healthy) {
      this.setServerPhase('connecting');
    } else {
      this.setServerPhase('disconnected');
    }
  }

  async refreshServerLogs(options = {}) {
    const silent = Boolean(options.silent);
    const response = await this.requestServerControl('logs', { lines: 120 });
    if (!response?.success) {
      if (!silent) {
        this.appendTerminalLine(`Log fetch failed: ${response?.error || 'unknown error'}`);
      }
      return;
    }
    this.updateServerMeta(response);
    this.renderTerminalLogs(response.logLines);
  }

  async refreshServerStatus(options = {}) {
    const silent = Boolean(options.silent);
    if (this.serverBusy) return;
    const response = await this.requestServerControl('status');
    if (!response?.success) {
      this.updateServerMeta({});
      this.updateServerState({ installed: true, running: false, healthy: false, pid: null });
      if (!silent) {
        this.setMessage(response?.error || 'Failed to query server status.', true);
      }
      return;
    }

    const installed = response.installed !== false;
    this.updateServerMeta(response);
    this.renderNativeHostInstallBlock(installed);
    this.updateServerState({
      installed,
      running: Boolean(response.running),
      healthy: Boolean(response.healthy),
      pid: response.pid
    });
  }

  async startServer() {
    if (this.serverBusy) return;
    const hfToken = this.getInputHfToken() || this.localSecrets.hfToken || '';
    this.setServerPhase('connecting');
    this.appendTerminalLine('Start requested. Initializing local GLiNER2 server...');
    this.setServerButtonsDisabled(true);
    const response = await this.requestServerControl('start', {
      installDeps: true,
      downloadModel: true,
      hfToken
    });
    this.setServerButtonsDisabled(false);

    if (!response?.success) {
      this.setServerPhase('disconnected');
      this.appendTerminalLine(`Start failed: ${response?.error || 'unknown error'}`);
      if (/auth|unauthorized|401|repository not found/i.test(String(response?.error || '')) && !hfToken) {
        this.setMessage('Model access failed. Add HF token in Model Access Token and retry.', true);
      } else {
        this.setMessage(response?.error || 'Unable to start server.', true);
      }
      await this.refreshServerStatus();
      await this.refreshServerLogs({ silent: true });
      return;
    }

    if (response.installed === false) {
      this.updateServerMeta(response);
      this.renderNativeHostInstallBlock(false);
      this.updateServerState({ installed: false, running: false, healthy: false, pid: null });
      this.setServerPhase('disconnected');
      this.appendTerminalLine('Start blocked: native host not installed.');
      this.setMessage(response.error || 'Native host is not installed.', true);
      await this.refreshServerLogs({ silent: true });
      return;
    }

    const installed = response.installed !== false;
    this.updateServerMeta(response);
    this.renderNativeHostInstallBlock(installed);
    this.updateServerState({
      installed,
      running: Boolean(response.running),
      healthy: Boolean(response.healthy),
      pid: response.pid
    });
    this.appendTerminalLine(response.message || 'Server started.');
    await this.refreshServerLogs({ silent: true });
    this.setMessage(response.message || 'Server started.');
  }

  async stopServer() {
    if (this.serverBusy) return;
    this.setServerPhase('disconnecting');
    this.appendTerminalLine('Stop requested. Shutting down local GLiNER2 server...');
    this.setServerButtonsDisabled(true);
    const response = await this.requestServerControl('stop');
    this.setServerButtonsDisabled(false);

    if (!response?.success) {
      this.appendTerminalLine(`Stop failed: ${response?.error || 'unknown error'}`);
      this.setMessage(response?.error || 'Unable to stop server.', true);
      await this.refreshServerStatus();
      await this.refreshServerLogs({ silent: true });
      return;
    }

    if (response.installed === false) {
      this.updateServerMeta(response);
      this.renderNativeHostInstallBlock(false);
      this.updateServerState({ installed: false, running: false, healthy: false, pid: null });
      this.setServerPhase('disconnected');
      this.appendTerminalLine('Stop completed. Native host not installed.');
      this.setMessage(response.error || 'Native host is not installed.', true);
      await this.refreshServerLogs({ silent: true });
      return;
    }

    const installed = response.installed !== false;
    this.updateServerMeta(response);
    this.renderNativeHostInstallBlock(installed);
    this.updateServerState({
      installed,
      running: Boolean(response.running),
      healthy: Boolean(response.healthy),
      pid: response.pid
    });
    this.appendTerminalLine(response.message || 'Server stopped.');
    await this.refreshServerLogs({ silent: true });
    this.setMessage(response.message || 'Server stopped.');
  }

  updateSetting(key, value) {
    this.settings[key] = value;
    chrome.storage.sync.set({ [key]: value }, () => this.setMessage('Saved'));
  }

  parseLines(text) {
    return text
      .split(/\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  normalizePatterns(rawPatterns) {
    if (!Array.isArray(rawPatterns)) {
      throw new Error('Patterns must be a JSON array.');
    }

    return rawPatterns.map((pattern, index) => {
      if (!pattern || typeof pattern !== 'object') {
        throw new Error(`Pattern at index ${index} must be an object.`);
      }
      const label = String(pattern.label || '').trim().toLowerCase();
      const patternText = String(pattern.pattern || '');
      if (!label || !patternText) {
        throw new Error(`Pattern at index ${index} must include label and pattern.`);
      }

      return {
        id: pattern.id ? String(pattern.id) : `custom_${index + 1}`,
        label,
        pattern: patternText,
        flags: pattern.flags ? String(pattern.flags) : 'g',
        score: typeof pattern.score === 'number' ? pattern.score : 0.96,
        replacement: pattern.replacement ? String(pattern.replacement) : null,
        enabled: pattern.enabled !== false
      };
    });
  }

  saveAdvancedConfig(showMessage = true, includePatterns = true) {
    try {
      const monitoredSites = this.parseLines(document.getElementById('monitoredSitesInput').value);
      const monitoredSelectors = this.parseLines(document.getElementById('selectorsInput').value);

      let customPatterns = this.settings.customPatterns;
      if (includePatterns) {
        const rawPatterns = JSON.parse(document.getElementById('patternsInput').value || '[]');
        customPatterns = this.normalizePatterns(rawPatterns);
      }

      const payload = {
        monitoredSites: monitoredSites.length > 0 ? monitoredSites : DEFAULT_SETTINGS.monitoredSites,
        monitoredSelectors: monitoredSelectors.length > 0 ? monitoredSelectors : DEFAULT_SETTINGS.monitoredSelectors,
        customPatterns
      };

      this.settings = { ...this.settings, ...payload };
      chrome.storage.sync.set(payload, () => {
        if (showMessage) this.setMessage('Advanced settings saved.');
      });
    } catch (error) {
      this.setMessage(error.message || 'Invalid advanced settings.', true);
    }
  }

  async resetDefaults() {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    this.settings = { ...DEFAULT_SETTINGS };
    this.render();
    this.setMessage('Settings reset to defaults.');
  }

  setMessage(text, isError = false) {
    const bar = document.getElementById('messageBar');
    bar.textContent = text;
    bar.classList.toggle('error', isError);

    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
    }
    if (isError) {
      this.messageTimer = null;
      return;
    }
    this.messageTimer = setTimeout(() => {
      bar.textContent = '';
      bar.classList.remove('error');
    }, 3600);
  }

  formatNumber(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return String(value);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsManager();
});
