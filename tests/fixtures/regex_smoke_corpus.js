'use strict';

const REGEX_SMOKE_TEXT = `
Primary Contact: Rohan Sen
Email: rohan.sen@example.com
Phone: +1 415-555-1234
Address: 221 Baker Street
Date of Birth: 04/18/1992
SSN: 123-45-6789
Credit Card: 4111 1111 1111 1111

OpenAI API Key: sk-proj-abcDEF1234567890ghijKLMN_opqrstuVWXYZ
AWS Access Key: AKIAIOSFODNN7EXAMPLE
GitHub Token: github_pat_11AABBCCDDEEFF00112233445566778899
JWT Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature
IPv4 Address: 192.168.34.21
IPv6 Address: 2001:0db8:85a3:0000:0000:8a2e:0370:7334

PAN Number: BQKPS4587L
Aadhaar Number: 4821-7395-1602
Passport Number: N7392615
Driver License Number: MP09-20230014567
IFSC Code: SBIN0004587

Bank Account Number: 348291765432
OAuth Token: ya29.a0AfH6SMDemoToken98765
MAC Address: 3C:52:82:AF:91:7B
Employee ID: TN-EMP-20458
Device ID: ANDR-98X2-KL45-PL09
Session ID: SESS-a82f91d7c6b34e2f
`.trim();

const REGEX_SMOKE_CUSTOM_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'bank_account',
    label: 'bank_account',
    pattern: '(?<=Bank Account Number:\\s)\\d{10,18}\\b',
    flags: 'g',
    score: 0.93,
    replacement: '[BANK ACCOUNT REDACTED]',
    enabled: true,
  }),
  Object.freeze({
    id: 'oauth_token',
    label: 'oauth_token',
    pattern: '\\bya29\\.[A-Za-z0-9._-]{12,}\\b',
    flags: 'g',
    score: 0.98,
    replacement: '[OAUTH TOKEN REDACTED]',
    enabled: true,
  }),
  Object.freeze({
    id: 'mac_address',
    label: 'mac_address',
    pattern: '\\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\\b',
    flags: 'g',
    score: 0.96,
    replacement: '[MAC REDACTED]',
    enabled: true,
  }),
  Object.freeze({
    id: 'employee_id',
    label: 'employee_id',
    pattern: '\\b[A-Z]{2,5}-EMP-\\d{4,8}\\b',
    flags: 'g',
    score: 0.96,
    replacement: '[EMPLOYEE ID REDACTED]',
    enabled: true,
  }),
  Object.freeze({
    id: 'device_id',
    label: 'device_id',
    pattern: '\\b[A-Z]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\\b',
    flags: 'g',
    score: 0.95,
    replacement: '[DEVICE ID REDACTED]',
    enabled: true,
  }),
  Object.freeze({
    id: 'session_id',
    label: 'session_id',
    pattern: '\\bSESS-[A-Za-z0-9]{16}\\b',
    flags: 'g',
    score: 0.95,
    replacement: '[SESSION ID REDACTED]',
    enabled: true,
  }),
]);

const EXPECTED_BUILTIN_REGEX_LABELS = Object.freeze([
  'aadhaar',
  'address',
  'api_key',
  'credit_card',
  'date_of_birth',
  'driver_license',
  'email',
  'ifsc',
  'ip_address',
  'jwt',
  'pan',
  'passport',
  'phone',
  'ssn',
]);

const EXPECTED_CUSTOM_REGEX_LABELS = Object.freeze([
  'bank_account',
  'device_id',
  'employee_id',
  'mac_address',
  'oauth_token',
  'session_id',
]);

module.exports = {
  REGEX_SMOKE_TEXT,
  REGEX_SMOKE_CUSTOM_PATTERNS,
  EXPECTED_BUILTIN_REGEX_LABELS,
  EXPECTED_CUSTOM_REGEX_LABELS,
};
