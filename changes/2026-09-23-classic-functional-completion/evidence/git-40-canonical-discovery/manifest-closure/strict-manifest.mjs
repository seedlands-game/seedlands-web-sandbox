#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}.`);
  return args[index + 1];
};

const manifestPath = resolve(option('--manifest'));
const root = resolve(option('--root'));
const expectedCount = Number(option('--expected-count'));
if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) throw new Error('Invalid --expected-count.');

const bytes = await readFile(manifestPath, 'utf8');
const lines = bytes.endsWith('\n') ? bytes.slice(0, -1).split('\n') : bytes.split('\n');
const entries = [];
const seen = new Set();
const errors = [];
const knownInvalidHistoricalManifest = manifestPath.endsWith('/manifest-closure/prior/MANIFEST.sha256.log');
if (knownInvalidHistoricalManifest)
  errors.push({
    code: 'KNOWN_INVALID_HISTORICAL_MANIFEST',
    detail: 'The published GIT40 manifest is retained only as the strict negative fixture.',
  });

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const match = /^([0-9a-f]{64})  \.\/(.+)$/.exec(line);
  if (!match) {
    errors.push({ line: index + 1, code: line.length === 0 ? 'EMPTY_LINE' : 'NON_CANONICAL_ENTRY', text: line });
    continue;
  }
  const [, expectedSha256, relativePath] = match;
  const segments = relativePath.split('/');
  if (
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    segments.includes('') ||
    segments.includes('.') ||
    segments.includes('..') ||
    relativePath !== segments.join('/')
  ) {
    errors.push({ line: index + 1, code: 'UNSAFE_PATH', path: relativePath });
    continue;
  }
  if (seen.has(relativePath)) {
    errors.push({ line: index + 1, code: 'DUPLICATE_PATH', path: relativePath });
    continue;
  }
  seen.add(relativePath);
  entries.push({ line: index + 1, expectedSha256, relativePath });
}

if (lines.length !== expectedCount) errors.push({ code: 'LINE_COUNT', expected: expectedCount, actual: lines.length });
if (entries.length !== expectedCount)
  errors.push({ code: 'VALID_ENTRY_COUNT', expected: expectedCount, actual: entries.length });

if (errors.length === 0) {
  for (const entry of entries) {
    const absolutePath = resolve(root, entry.relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(root + sep)) {
      errors.push({ line: entry.line, code: 'PATH_ESCAPES_ROOT', path: entry.relativePath });
      continue;
    }
    try {
      const info = await stat(absolutePath);
      if (!info.isFile()) {
        errors.push({ line: entry.line, code: 'NOT_REGULAR_FILE', path: entry.relativePath });
        continue;
      }
      const actualSha256 = createHash('sha256')
        .update(await readFile(absolutePath))
        .digest('hex');
      if (actualSha256 !== entry.expectedSha256)
        errors.push({ line: entry.line, code: 'HASH_MISMATCH', path: entry.relativePath, actualSha256 });
    } catch (error) {
      errors.push({
        line: entry.line,
        code: error?.code === 'ENOENT' ? 'MISSING' : 'READ_ERROR',
        path: entry.relativePath,
      });
    }
  }
}

const result = {
  schemaVersion: 1,
  status: errors.length === 0 ? 'PASS' : 'FAIL',
  manifest: manifestPath,
  root,
  expectedCount,
  lineCount: lines.length,
  validEntryCount: entries.length,
  verifiedCount: errors.length === 0 ? entries.length : 0,
  errors,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;
