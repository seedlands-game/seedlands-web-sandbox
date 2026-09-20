import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyBlockBehaviorCandidates } from './verify-block-behavior-candidates.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'block-behavior-candidates.json'), 'utf8'));
const parents = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const parentById = new Map(parents.cases.map((entry) => [entry.caseId, entry]));

test('block candidate methods resolve through the declared class chain', () => {
  assert.doesNotThrow(() => verifyBlockBehaviorCandidates(catalog, parentById));
});

test('crop placement cannot silently regress to the Block base method', () => {
  const changed = structuredClone(catalog);
  const crop = changed.records.find((entry) => entry.caseId === 'B-059');
  crop.methodCandidates.placement = crop.methodCandidates.placement.filter(
    (candidate) => candidate.method !== 'canPlaceBlockAt',
  );
  assert.throws(() => verifyBlockBehaviorCandidates(changed, parentById), /crop placement/);
});

test('block method anchors cannot point outside the inheritance chain', () => {
  const changed = structuredClone(catalog);
  changed.records
    .find((entry) => entry.caseId === 'B-059')
    .methodCandidates.placement.push({
      file: 'BlockDoor.java',
      method: 'canPlaceBlockAt',
    });
  assert.throws(() => verifyBlockBehaviorCandidates(changed, parentById), /outside inheritance chain/);
});
