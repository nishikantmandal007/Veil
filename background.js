// background.js - Service worker for GLiNER2 management and local PII detection

const DEFAULT_LABELS = [
  'person',
  'email',
  'phone',
  'address',
  'ssn',
  'credit_card',
  'date_of_birth',
  'location',
  'organization'
];

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

const NATIVE_HOST_NAME = 'com.privacyshield.gliner2';
const MDP_DEFAULT_SEED = 'org_or_project_seed';

const MDP_LABEL_CONFIG = Object.freeze({
  person: Object.freeze({
    columnName: 'Names',
    utilityParameter: 'NAME',
    utilityParameterConditions: Object.freeze(['NAME', 'REMOVE_UNDERSCORE'])
  }),
  email: Object.freeze({
    columnName: 'Emails',
    utilityParameter: 'EMAIL',
    utilityParameterConditions: Object.freeze(['KEEP_DOMAIN'])
  }),
  phone: Object.freeze({
    columnName: 'Phone',
    utilityParameter: 'PHONE',
    utilityParameterConditions: Object.freeze([])
  }),
  address: Object.freeze({
    columnName: 'Address',
    utilityParameter: 'ADDRESS',
    utilityParameterConditions: Object.freeze([])
  }),
  ssn: Object.freeze({
    columnName: 'SSN',
    utilityParameter: 'SSN',
    utilityParameterConditions: Object.freeze([])
  }),
  credit_card: Object.freeze({
    columnName: 'Credit Card',
    utilityParameter: 'CARD',
    utilityParameterConditions: Object.freeze([])
  }),
  date_of_birth: Object.freeze({
    columnName: 'Date Of Birth',
    utilityParameter: 'DATE',
    utilityParameterConditions: Object.freeze([])
  }),
  location: Object.freeze({
    columnName: 'Location',
    utilityParameter: 'LOCATION',
    utilityParameterConditions: Object.freeze([])
  }),
  organization: Object.freeze({
    columnName: 'Organization',
    utilityParameter: 'ORG',
    utilityParameterConditions: Object.freeze([])
  })
});

class VeilAnonymizer {
  constructor() {
    this.timeoutMs = 6000;
    this.localServerUrl = 'http://127.0.0.1:8765';
  }

  async enrichDetections(detections, options = {}) {
    if (options?.redactionMode !== 'anonymize') {
      return detections;
    }
    if (!Array.isArray(detections) || detections.length === 0) {
      return detections;
    }

    const supportedDetections = detections.filter((item) => MDP_LABEL_CONFIG[String(item?.label || '').toLowerCase()]);
    const unsupportedLabels = Array.from(new Set(
      detections
        .map((item) => String(item?.label || '').toLowerCase())
        .filter((label) => label && !MDP_LABEL_CONFIG[label])
    ));
    if (unsupportedLabels.length > 0) {
      console.debug('[Veil] Anonymizer skipped unsupported labels:', unsupportedLabels.join(', '));
    }
    if (supportedDetections.length === 0) {
      return detections;
    }

    const credentials = await this.getCredentials();
    if (!credentials.apiKey) {
      console.warn('[Veil] Anonymizer skipped: no API key configured. Set one in the extension popup.');
      return detections;
    }

    const payload = this.buildPayload(supportedDetections, credentials.seed);
    if (payload.length === 0) {
      return detections;
    }

    try {
      const apiResponse = await this.callApi(credentials.apiKey, payload);
      const replacements = this.extractReplacementMap(payload, apiResponse);
      return detections.map((item) => this.applyReplacement(item, replacements));
    } catch (error) {
      console.warn('[Veil] Anonymization bulk request failed, retrying per label:', error?.message || String(error));
      const replacements = await this.callApiBestEffort(credentials.apiKey, payload);
      if (replacements.size === 0) {
        return detections;
      }
      return detections.map((item) => this.applyReplacement(item, replacements));
    }
  }

  async getCredentials() {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['veilApiKey'], resolve);
    });

    return {
      apiKey: String(result?.veilApiKey || '').trim(),
      seed: MDP_DEFAULT_SEED
    };
  }

  buildPayload(detections, seed) {
    const grouped = new Map();

    detections.forEach((item) => {
      const label = String(item?.label || '').toLowerCase();
      const config = MDP_LABEL_CONFIG[label];
      if (!config) return;
      const value = String(item?.text || '').trim();
      if (!value) return;

      let entry = grouped.get(label);
      if (!entry) {
        entry = {
          column_name: config.columnName,
          utilityParameter: config.utilityParameter,
          utilityParameterConditions: [...config.utilityParameterConditions],
          seed,
          values: []
        };
        grouped.set(label, entry);
      }

      if (!entry.values.includes(value)) {
        entry.values.push(value);
      }
    });

    return Array.from(grouped.values());
  }

  async callApi(apiKey, payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.localServerUrl}/anonymize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ apiKey, entries: payload }),
        signal: controller.signal
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        throw new Error('Local anonymization proxy returned invalid JSON.');
      }

      if (data?.ok === false) {
        throw new Error(String(data.error || 'Local anonymization proxy failed.'));
      }
      if (!response.ok) {
        throw new Error(`Local anonymization proxy returned status ${response.status}.`);
      }

      if (Array.isArray(data?.data)) return data.data;
      if (Array.isArray(data?.result)) return data.result;

      const upstream = data?.data;
      if (Array.isArray(upstream?.data)) return upstream.data;
      if (Array.isArray(upstream?.result)) return upstream.result;
      if (Array.isArray(upstream?.results)) return upstream.results;
      if (Array.isArray(upstream)) return upstream;

      if (Array.isArray(data)) return data;
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async callApiBestEffort(apiKey, payload) {
    const merged = new Map();
    for (const entry of payload) {
      try {
        const apiResponse = await this.callApi(apiKey, [entry]);
        const replacementMap = this.extractReplacementMap([entry], apiResponse);
        replacementMap.forEach((value, key) => merged.set(key, value));
      } catch (error) {
        const label = String(entry?.utilityParameter || entry?.column_name || 'unknown');
        console.warn(`[Veil] Anonymizer skipped label ${label}:`, error?.message || String(error));
      }
    }
    return merged;
  }

  extractReplacementMap(payload, apiResponse) {
    const replacementMap = new Map();
    const rows = this.extractRows(apiResponse);

    // MayaData format:
    // [{ column_name, anonymizedValues: { "John Doe": { anonymizedValue: "..." } } }, ...]
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const map = row.anonymizedValues;
      if (!map || typeof map !== 'object' || Array.isArray(map)) return;
      Object.entries(map).forEach(([sourceValue, detail]) => {
        const source = String(sourceValue || '').trim();
        const replacement = this.normalizeResponseValue(detail?.anonymizedValue ?? detail).trim();
        if (!source || !replacement || replacement === source) return;
        replacementMap.set(this.makeAnyMapKey(source), replacement);
      });
    });

    payload.forEach((requestRow, index) => {
      const sourceValues = Array.isArray(requestRow.values) ? requestRow.values : [];
      const responseRow = rows[index];
      const mappedValues = this.extractValuesArray(responseRow);

      sourceValues.forEach((sourceValue, valueIndex) => {
        const replacement = String(mappedValues[valueIndex] || '').trim();
        if (!replacement || replacement === sourceValue) return;
        replacementMap.set(this.makeMapKey(requestRow.utilityParameter, sourceValue), replacement);
      });
    });

    return replacementMap;
  }

  extractRows(apiResponse) {
    if (Array.isArray(apiResponse)) return apiResponse;
    if (!apiResponse || typeof apiResponse !== 'object') return [];

    const candidates = [
      apiResponse.data,
      apiResponse.results,
      apiResponse.result,
      apiResponse.outputs
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  extractValuesArray(responseRow) {
    if (Array.isArray(responseRow)) {
      return responseRow.map((item) => this.normalizeResponseValue(item));
    }
    if (!responseRow || typeof responseRow !== 'object') {
      return [];
    }

    const keys = [
      'values',
      'anonymized_values',
      'anonymizedValues',
      'outputValues',
      'outputs',
      'result',
      'results'
    ];

    for (const key of keys) {
      if (Array.isArray(responseRow[key])) {
        return responseRow[key].map((item) => this.normalizeResponseValue(item));
      }
    }

    if (responseRow.data && typeof responseRow.data === 'object') {
      for (const key of keys) {
        if (Array.isArray(responseRow.data[key])) {
          return responseRow.data[key].map((item) => this.normalizeResponseValue(item));
        }
      }
    }

    return [];
  }

  normalizeResponseValue(item) {
    if (typeof item === 'string' || typeof item === 'number') {
      return String(item);
    }
    if (!item || typeof item !== 'object') {
      return '';
    }

    const keys = [
      'anonymized',
      'anonymizedValue',
      'anonymized_value',
      'output',
      'value',
      'masked',
      'maskedValue'
    ];

    for (const key of keys) {
      if (item[key] == null) continue;
      return String(item[key]);
    }

    return '';
  }

  applyReplacement(item, replacementMap) {
    const label = String(item?.label || '').toLowerCase();
    const config = MDP_LABEL_CONFIG[label];
    if (!config) return item;

    const sourceValue = String(item?.text || '').trim();
    if (!sourceValue) return item;

    const replacement = replacementMap.get(this.makeMapKey(config.utilityParameter, sourceValue))
      || replacementMap.get(this.makeAnyMapKey(sourceValue));
    if (!replacement) return item;

    return {
      ...item,
      anonymizedText: replacement
    };
  }

  makeMapKey(utilityParameter, value) {
    return `${utilityParameter}\u0000${value}`;
  }

  makeAnyMapKey(value) {
    return `*\u0000${value}`;
  }
}

function getDefaultCustomPatterns() {
  return [
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
      id: 'ipv6',
      label: 'ip_address',
      pattern: '\\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\\b',
      flags: 'g',
      score: 0.9,
      replacement: '[IPV6 REDACTED]',
      enabled: false
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
}

function isNativeHostMissingError(message) {
  const text = String(message || '').toLowerCase();
  return (
    (text.includes('native messaging host') &&
      (text.includes('not found') || text.includes('not registered'))) ||
    (text.includes('native messaging') && text.includes('forbidden')) ||
    (text.includes('access to the specified native messaging host is forbidden'))
  );
}

function sendNativeHostMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('No response from native host.'));
          return;
        }
        if (response.success === false) {
          reject(new Error(response.error || 'Native host command failed.'));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

class GLiNERDetector {
  constructor() {
    this.isLoading = false;
    this.isReady = false;
    this.mode = 'regex-fallback';
    this.localServerUrl = 'http://127.0.0.1:8765';
    this.lastServerCheckTs = 0;
    this.serverCheckCooldownMs = 2500;
    this.labels = DEFAULT_LABELS;
  }

  async initialize(force = false) {
    if (this.isReady && !force) return;
    if (this.isLoading) {
      while (this.isLoading) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }

    this.isLoading = true;
    try {
      await this.refreshMode();
      this.isReady = true;
    } finally {
      this.isLoading = false;
    }
  }

  async refreshMode() {
    const now = Date.now();
    if (now - this.lastServerCheckTs < this.serverCheckCooldownMs && this.isReady) {
      return;
    }
    this.lastServerCheckTs = now;
    this.mode = (await this.pingLocalServer()) ? 'gliner2-local' : 'regex-fallback';
  }

  async pingLocalServer() {
    try {
      const response = await this.fetchWithTimeout(`${this.localServerUrl}/health`, { method: 'GET' }, 1400);
      if (!response.ok) return false;
      const data = await response.json();
      return Boolean(data?.ok);
    } catch {
      return false;
    }
  }

  async fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async detectPII(text, options = {}) {
    await this.initialize();

    const threshold = typeof options.threshold === 'number' ? options.threshold : 0.5;
    const enabledTypes = Array.isArray(options.enabledTypes) && options.enabledTypes.length > 0
      ? options.enabledTypes
      : this.labels;
    const customPatterns = Array.isArray(options.customPatterns)
      ? options.customPatterns
      : getDefaultCustomPatterns();
    const includeRegexWhenModelOnline = Boolean(options.includeRegexWhenModelOnline);

    if (!text || text.trim().length === 0) {
      return [];
    }

    const detections = [];
    let modelOnline = false;
    if (this.mode === 'gliner2-local') {
      try {
        detections.push(...await this.detectWithLocalGLiNER(text, enabledTypes, threshold));
        modelOnline = true;
      } catch (error) {
        console.warn('Local GLiNER2 server unavailable, using fallback detection:', error.message);
        this.mode = 'regex-fallback';
      }
    }

    if (!modelOnline || includeRegexWhenModelOnline) {
      detections.push(...this.detectWithRegex(text, enabledTypes, threshold));
    }
    detections.push(...this.detectWithCustomPatterns(text, customPatterns, threshold));

    return this.mergeOverlapping(this.postProcessDetections(detections, threshold));
  }

  postProcessDetections(detections, threshold) {
    const baseThreshold = typeof threshold === 'number' ? threshold : 0.5;
    const minByLabel = {
      person: Math.max(baseThreshold, 0.72),
      organization: Math.max(baseThreshold, 0.67),
      location: Math.max(baseThreshold, 0.66),
      address: Math.max(baseThreshold, 0.64),
      date_of_birth: Math.max(baseThreshold, 0.6)
    };
    const personStopwords = new Set([
      'you',
      'your',
      'yours',
      'i',
      'me',
      'my',
      'mine',
      'we',
      'our',
      'ours',
      'they',
      'their',
      'theirs',
      'this',
      'that',
      'these',
      'those',
      'hello',
      'thanks',
      'please',
      'assistant',
      'model',
      'server',
      'privacy',
      'shield'
    ]);

    return detections.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (typeof item.start !== 'number' || typeof item.end !== 'number') return false;
      if (item.end <= item.start) return false;
      if (typeof item.score !== 'number') return false;

      const text = String(item.text || '');
      const label = String(item.label || '').toLowerCase();
      if (!text.trim()) return false;
      if (item.score < (minByLabel[label] || baseThreshold)) return false;

      if (label === 'person') {
        if (text.length < 4) return false;
        if (/^[A-Z\s]+$/.test(text)) return false;
        const words = text.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0 || words.length > 3) return false;
        if (words.some((word) => /\d/.test(word))) return false;
        if (words.length === 1) {
          const token = words[0];
          if (token.length < 5) return false;
          if (personStopwords.has(token.toLowerCase())) return false;
          if (!/^[A-Z][A-Za-z'`.-]*$/.test(token)) return false;
        } else {
          if (words.some((word) => !/^[A-Z][A-Za-z'`.-]*$/.test(word))) return false;
        }
      }

      if (label === 'organization') {
        if (text.length < 3) return false;
        const lower = text.toLowerCase();
        if (/^[a-z\s]+$/.test(text) && !/\b(inc|llc|corp|company|university|bank|labs?|group|systems?)\b/.test(lower)) {
          return false;
        }
      }

      if (label === 'location') {
        if (text.length < 3) return false;
        if (!/[A-Z]/.test(text.charAt(0)) && text.trim().split(/\s+/).length === 1) return false;
      }

      if (label === 'address') {
        const hasStreetNumber = /\d/.test(text);
        const hasStreetWord = /\b(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/i.test(text);
        if (!hasStreetNumber && !hasStreetWord) return false;
      }

      return true;
    });
  }

  async warmUpIfAvailable() {
    await this.initialize(true);
    if (this.mode !== 'gliner2-local') return false;
    try {
      await this.detectWithLocalGLiNER(
        'Warmup: contact warmup@example.com',
        ['email'],
        0.95
      );
      return true;
    } catch (error) {
      console.debug('Warmup request failed:', error.message);
      return false;
    }
  }

  async detectWithLocalGLiNER(text, enabledTypes, threshold) {
    const response = await this.fetchWithTimeout(
      `${this.localServerUrl}/detect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, labels: enabledTypes, threshold })
      },
      4200
    );

    if (!response.ok) {
      throw new Error(`GLiNER2 local server returned status ${response.status}`);
    }

    const data = await response.json();
    const rows = Array.isArray(data?.detections) ? data.detections : [];
    return rows
      .map((row) => this.normalizeDetection(row, text, 'gliner2'))
      .filter(Boolean)
      .filter((row) => row.score >= threshold);
  }

  normalizeDetection(row, sourceText, source) {
    if (!row || typeof row !== 'object') return null;
    const label = String(row.label || '').trim().toLowerCase();
    if (!label) return null;

    let start = Number.isInteger(row.start) ? row.start : -1;
    let end = Number.isInteger(row.end) ? row.end : -1;
    const entityText = String(row.text || '');

    if (start < 0 || end <= start) {
      const inferredStart = entityText ? sourceText.indexOf(entityText) : -1;
      if (inferredStart < 0) return null;
      start = inferredStart;
      end = inferredStart + entityText.length;
    }

    if (start < 0 || end > sourceText.length || end <= start) return null;

    const score = typeof row.score === 'number' ? row.score : 0.0;
    return {
      text: sourceText.slice(start, end),
      label,
      start,
      end,
      score,
      source,
      replacement: row.replacement ? String(row.replacement) : null
    };
  }

  detectWithRegex(text, enabledTypes, threshold) {
    const detections = [];
    const push = (match, label, score) => {
      detections.push({
        text: match[0],
        label,
        start: match.index,
        end: match.index + match[0].length,
        score,
        source: 'fallback'
      });
    };

    if (enabledTypes.includes('email')) {
      const regex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
      let match;
      while ((match = regex.exec(text)) !== null) push(match, 'email', 0.95);
    }

    if (enabledTypes.includes('phone')) {
      const regex = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
      let match;
      while ((match = regex.exec(text)) !== null) push(match, 'phone', 0.9);
    }

    if (enabledTypes.includes('address')) {
      const regex = /\b\d+\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b/gi;
      let match;
      while ((match = regex.exec(text)) !== null) push(match, 'address', 0.84);
    }

    if (enabledTypes.includes('credit_card')) {
      const regex = /\b(?:\d[ -]*?){13,16}\b/g;
      let match;
      while ((match = regex.exec(text)) !== null) push(match, 'credit_card', 0.9);
    }

    if (enabledTypes.includes('date_of_birth')) {
      const regex = /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/g;
      let match;
      while ((match = regex.exec(text)) !== null) push(match, 'date_of_birth', 0.87);
    }

    if (enabledTypes.includes('person')) {
      // Disabled by default due high false positives.
    }

    return detections.filter((item) => item.score >= threshold);
  }

  detectWithCustomPatterns(text, patterns, threshold) {
    const detections = [];
    patterns
      .filter((patternDef) => patternDef && typeof patternDef === 'object' && patternDef.enabled !== false)
      .forEach((patternDef) => {
        const label = String(patternDef.label || 'custom').trim().toLowerCase();
        const pattern = String(patternDef.pattern || '');
        const flags = this.normalizeRegexFlags(patternDef.flags);
        const score = typeof patternDef.score === 'number' ? patternDef.score : 0.96;
        const replacement = patternDef.replacement ? String(patternDef.replacement) : null;

        if (!label || !pattern) return;

        let regex;
        try {
          regex = new RegExp(pattern, flags);
        } catch {
          return;
        }

        let match;
        while ((match = regex.exec(text)) !== null) {
          if (!match[0]) {
            regex.lastIndex += 1;
            continue;
          }
          detections.push({
            text: match[0],
            label,
            start: match.index,
            end: match.index + match[0].length,
            score,
            source: 'custom',
            replacement
          });
        }
      });

    return detections.filter((item) => item.score >= threshold);
  }

  normalizeRegexFlags(flags) {
    const raw = String(flags || 'g');
    const filtered = raw.replace(/[^dgimsuvy]/g, '');
    return filtered.includes('g') ? filtered : `${filtered}g`;
  }

  mergeOverlapping(detections) {
    if (detections.length === 0) return [];
    detections.sort((a, b) => a.start - b.start || b.score - a.score);

    const merged = [];
    let current = detections[0];
    for (let index = 1; index < detections.length; index += 1) {
      const next = detections[index];
      const overlap = next.start < current.end;
      if (!overlap) {
        merged.push(current);
        current = next;
        continue;
      }

      const currentLength = current.end - current.start;
      const nextLength = next.end - next.start;
      const nextWins = next.score > current.score || (next.score === current.score && nextLength > currentLength);
      if (nextWins) current = next;
    }
    merged.push(current);
    return merged;
  }
}

const detector = new GLiNERDetector();
const anonymizer = new VeilAnonymizer();

async function handleServerControl(command, options = {}) {
  try {
    if (command === 'status') {
      const response = await sendNativeHostMessage({ action: 'status' });
      return { success: true, ...response };
    }

    if (command === 'logs') {
      const response = await sendNativeHostMessage({
        action: 'logs',
        lines: typeof options.lines === 'number' ? options.lines : 120
      });
      return { success: true, ...response };
    }

    if (command === 'start') {
      const hfToken = typeof options.hfToken === 'string' ? options.hfToken.trim() : '';
      const payload = {
        action: 'start',
        installDeps: options.installDeps !== false,
        downloadModel: options.downloadModel !== false
      };
      if (hfToken) {
        payload.hfToken = hfToken;
      }
      const response = await sendNativeHostMessage({
        ...payload
      });
      await detector.initialize(true);
      return { success: true, ...response, detectionMode: detector.mode };
    }

    if (command === 'stop') {
      const response = await sendNativeHostMessage({ action: 'stop' });
      await detector.initialize(true);
      return { success: true, ...response, detectionMode: detector.mode };
    }

    return { success: false, error: `Unknown server control command: ${command}` };
  } catch (error) {
    if (isNativeHostMissingError(error.message)) {
      return {
        success: true,
        installed: false,
        running: false,
        healthy: false,
        logLines: [],
        logExists: false,
        error: `Native host is not installed for extension id ${chrome.runtime.id}.`
      };
    }
    return { success: false, error: error.message || String(error) };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectPII') {
    detector.detectPII(request.text, request.options)
      .then((detections) => anonymizer.enrichDetections(detections, request.options))
      .then((detections) => {
        sendResponse({
          success: true,
          detections,
          mode: detector.mode
        });
      })
      .catch((error) => {
        console.error('Detection error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'initialize') {
    detector.initialize(true)
      .then(() => {
        sendResponse({
          success: true,
          mode: detector.mode,
          localServerUrl: detector.localServerUrl
        });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'getStatus') {
    sendResponse({
      isReady: detector.isReady,
      isLoading: detector.isLoading,
      mode: detector.mode,
      localServerUrl: detector.localServerUrl
    });
  }

  if (request.action === 'serverControl') {
    handleServerControl(request.command, request.options)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    autoRedact: true,
    redactionMode: 'anonymize',
    sensitivity: 'medium',
    includeRegexWhenModelOnline: false,
    monitorAllSites: true,
    enabledTypes: DEFAULT_LABELS,
    customPatterns: getDefaultCustomPatterns(),
    monitoredSelectors: DEFAULT_MONITORED_SELECTORS,
    monitoredSites: [
      'claude.ai',
      'gemini.google.com',
      'chatgpt.com',
      'chat.openai.com',
      'copilot.microsoft.com',
      'poe.com'
    ]
  });
  detector.warmUpIfAvailable().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  detector.warmUpIfAvailable().catch(() => {});
});
