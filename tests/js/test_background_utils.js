/**
 * Unit tests for pure utility functions extracted from background.js.
 * Run with: node tests/js/test_background_utils.js
 * No test runner required — uses simple assertions.
 */

'use strict';

const {
  cloneDefaultCustomPatterns,
  normalizeCustomPatterns,
  PATTERN_NAMES,
} = require('../../extension/pattern_catalog.js');
const {
  REGEX_SMOKE_TEXT,
  REGEX_SMOKE_CUSTOM_PATTERNS,
  EXPECTED_CUSTOM_REGEX_LABELS,
} = require('../fixtures/regex_smoke_corpus.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertEqual(a, b, message) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
}

function section(name) {
  console.log(`\n${name}`);
}

// ── Inline the pure functions under test ─────────────────────────────────────

function mergeOverlapping(detections) {
  if (detections.length === 0) return [];
  detections.sort((a, b) => a.start - b.start || b.score - a.score);
  const merged = [];
  let current = detections[0];
  for (let i = 1; i < detections.length; i++) {
    const next = detections[i];
    if (next.start < current.end) {
      if (next.score > current.score || (next.score === current.score && (next.end - next.start) > (current.end - current.start))) {
        current = next;
      }
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

function normalizeLabel(label) {
  // Mirrors GLINER_LABEL_DESCRIPTIONS keys
  const KNOWN = new Set(['person','email','phone','address','ssn','credit_card','date_of_birth','location','organization']);
  return KNOWN.has(label) ? label : label;
}

function findClosestOccurrence(text, needle, referenceStart = 0) {
  const source = String(text || '');
  const target = String(needle || '');
  if (!source || !target) return -1;

  const matches = [];
  let startIndex = 0;
  while (startIndex <= source.length) {
    const found = source.indexOf(target, startIndex);
    if (found === -1) break;
    matches.push(found);
    startIndex = found + Math.max(1, target.length);
  }

  if (matches.length === 0) return -1;
  let best = matches[0];
  let bestDistance = Math.abs(best - referenceStart);
  for (let index = 1; index < matches.length; index += 1) {
    const candidate = matches[index];
    const distance = Math.abs(candidate - referenceStart);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function reconcileExistingItems(sourceText, items) {
  const text = String(sourceText || '');
  if (!text || !Array.isArray(items) || items.length === 0) return [];

  return items
    .map((item) => {
      const itemText = String(item?.text || '');
      if (!itemText) return null;
      const referenceStart = Number.isInteger(item.start) ? item.start : 0;
      const nextStart = findClosestOccurrence(text, itemText, referenceStart);
      if (nextStart === -1) return null;
      return {
        ...item,
        start: nextStart,
        end: nextStart + itemText.length,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function mergeWithExistingDetections(existingItems, newDetections) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  return newDetections.filter((nd) => {
    const textLower = String(nd.text || '').toLowerCase();
    const labelLower = String(nd.label || '').toLowerCase();
    return !existing.some((ex) => {
      const exTextLower = String(ex.text || '').toLowerCase();
      const exLabelLower = String(ex.label || '').toLowerCase();
      return (
        exTextLower === textLower &&
        exLabelLower === labelLower &&
        nd.start < ex.end &&
        nd.end > ex.start
      );
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

section('mergeOverlapping — no overlaps');
{
  const dets = [
    { text: 'John', label: 'person', start: 0, end: 4, score: 0.9 },
    { text: 'gmail.com', label: 'email', start: 10, end: 19, score: 0.95 },
  ];
  const result = mergeOverlapping(dets);
  assertEqual(result.length, 2, 'keeps both non-overlapping detections');
  assertEqual(result[0].start, 0, 'first detection at start=0');
}

section('mergeOverlapping — exact same span, keeps higher score');
{
  const dets = [
    { text: 'John', label: 'person', start: 0, end: 4, score: 0.7 },
    { text: 'John', label: 'person', start: 0, end: 4, score: 0.92 },
  ];
  const result = mergeOverlapping(dets);
  assertEqual(result.length, 1, 'merges to single detection');
  assertEqual(result[0].score, 0.92, 'keeps higher score');
}

section('mergeOverlapping — partial overlap, keeps higher score');
{
  const dets = [
    { text: 'John Doe', label: 'person', start: 0, end: 8, score: 0.85 },
    { text: 'Doe', label: 'person', start: 5, end: 8, score: 0.6 },
  ];
  const result = mergeOverlapping(dets);
  assertEqual(result.length, 1, 'overlapping merged to one');
  assertEqual(result[0].score, 0.85, 'kept the higher-scored one');
}

section('mergeOverlapping — adjacent spans, both kept');
{
  const dets = [
    { text: 'John', label: 'person', start: 0, end: 4, score: 0.9 },
    { text: ' Doe', label: 'person', start: 4, end: 8, score: 0.8 },
  ];
  const result = mergeOverlapping(dets);
  assertEqual(result.length, 2, 'adjacent spans are not overlapping');
}

section('mergeOverlapping — empty input');
{
  const result = mergeOverlapping([]);
  assertEqual(result.length, 0, 'empty input returns empty');
}

section('mergeOverlapping — sorts by start position');
{
  const dets = [
    { text: 'Doe', label: 'person', start: 10, end: 13, score: 0.8 },
    { text: 'John', label: 'person', start: 0, end: 4, score: 0.9 },
  ];
  const result = mergeOverlapping(dets);
  assertEqual(result[0].start, 0, 'first result has lower start');
  assertEqual(result[1].start, 10, 'second result has higher start');
}

section('pattern catalog — expected built-in regex detectors are present');
{
  const ids = cloneDefaultCustomPatterns().map((pattern) => pattern.id);
  assert(ids.includes('openai_key'), 'includes OpenAI key pattern');
  assert(ids.includes('aws_access_key'), 'includes AWS access key pattern');
  assert(ids.includes('github_token'), 'includes GitHub token pattern');
  assert(ids.includes('jwt_token'), 'includes JWT pattern');
  assert(ids.includes('ipv4'), 'includes IPv4 pattern');
  assert(ids.includes('ipv6'), 'includes IPv6 pattern');
  assert(ids.includes('ssn'), 'includes SSN pattern');
  assert(ids.includes('indian_pan'), 'includes PAN pattern');
  assert(ids.includes('indian_aadhaar'), 'includes Aadhaar pattern');
  assert(ids.includes('passport'), 'includes passport pattern');
  assert(ids.includes('ifsc_code'), 'includes IFSC pattern');
  assert(ids.includes('indian_driver_license'), 'includes Indian driver license pattern');
  assertEqual(PATTERN_NAMES.openai_key, 'OpenAI API Key', 'exposes display names for built-ins');
}

section('pattern catalog — legacy OpenAI regex migrates to the canonical matcher');
{
  const normalized = normalizeCustomPatterns([
    {
      id: 'openai_key',
      label: 'api_key',
      pattern: '\\bsk-[A-Za-z0-9]{20,}\\b',
      flags: 'g',
      score: 0.99,
      replacement: '[API KEY REDACTED]',
      enabled: true,
    },
  ], cloneDefaultCustomPatterns());

  const openAi = normalized.find((pattern) => pattern.id === 'openai_key');
  assert(openAi.pattern.includes('sk-proj-'), 'legacy OpenAI pattern is upgraded to the canonical matcher');
}

section('pattern catalog — built-in smoke corpus patterns match the shared regex fixture');
{
  const defaults = cloneDefaultCustomPatterns();
  const defaultLabels = new Set(
    defaults
      .filter((pattern) => {
        const regex = new RegExp(pattern.pattern, pattern.flags || 'g');
        return regex.test(REGEX_SMOKE_TEXT);
      })
      .map((pattern) => pattern.label)
  );

  ['aadhaar', 'api_key', 'driver_license', 'ifsc', 'ip_address', 'jwt', 'pan', 'passport', 'ssn'].forEach((label) => {
    assert(defaultLabels.has(label), `shared smoke corpus hits built-in label "${label}"`);
  });
}

section('pattern catalog — custom smoke corpus patterns match the shared regex fixture');
{
  const customLabels = new Set(
    REGEX_SMOKE_CUSTOM_PATTERNS
      .filter((pattern) => {
        const regex = new RegExp(pattern.pattern, pattern.flags || 'g');
        return regex.test(REGEX_SMOKE_TEXT);
      })
      .map((pattern) => pattern.label)
  );

  EXPECTED_CUSTOM_REGEX_LABELS.forEach((label) => {
    assert(customLabels.has(label), `shared smoke corpus hits custom label "${label}"`);
  });
}

section('content reconciliation — drops stale items when the original text disappears');
{
  const reconciled = reconcileExistingItems('My name is Pranav', [
    { text: 'Rohan Sharma', label: 'person', start: 11, end: 23, redacted: true },
  ]);
  assertEqual(reconciled, [], 'stale carried item is removed when the source text no longer contains it');
}

section('content reconciliation — keeps the closest matching occurrence for repeated text');
{
  const reconciled = reconcileExistingItems('Pranav met Pranav yesterday', [
    { text: 'Pranav', label: 'person', start: 12, end: 18, redacted: true },
  ]);
  assertEqual(reconciled.length, 1, 'one repeated-name item is retained');
  assertEqual(reconciled[0].start, 11, 'reconciles to the closest surviving occurrence');
}

section('content reconciliation — duplicate text in new detections is not over-deduped');
{
  const existing = [
    { text: 'Pranav', label: 'person', start: 0, end: 6, redacted: true },
  ];
  const incoming = [
    { text: 'Pranav', label: 'person', start: 0, end: 6, score: 0.9 },
    { text: 'Pranav', label: 'person', start: 16, end: 22, score: 0.9 },
  ];
  const merged = mergeWithExistingDetections(existing, incoming);
  assertEqual(merged.length, 1, 'only the overlapping carried-forward occurrence is suppressed');
  assertEqual(merged[0].start, 16, 'a second identical name remains detectable');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('All tests passed.');
}
