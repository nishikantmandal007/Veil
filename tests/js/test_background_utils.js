/**
 * Unit tests for pure utility functions extracted from background.js.
 * Run with: node tests/js/test_background_utils.js
 * No test runner required — uses simple assertions.
 */

'use strict';

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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('All tests passed.');
}
