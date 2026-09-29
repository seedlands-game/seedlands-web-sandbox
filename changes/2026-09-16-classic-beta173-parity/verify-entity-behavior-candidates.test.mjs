import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyEntityBehaviorCandidates } from './verify-entity-behavior-candidates.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'entity-behavior-candidates.json'), 'utf8'));
const parents = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const parentById = new Map(parents.cases.map((entry) => [entry.caseId, entry]));

test('entity direct and inherited source locations stay distinct', () => {
  assert.deepEqual(verifyEntityBehaviorCandidates(catalog, parentById), {
    directLocatedSlots: 114,
    directGapSlots: 66,
    inheritedOnlySlots: 51,
    noLocatedMethodSlots: 15,
  });
});

test('generic player inheritance cannot be mislabeled natural spawn', () => {
  const changed = structuredClone(catalog);
  const player = changed.records.find((entry) => entry.name === 'Player');
  player.inheritedMethodCandidates.spawn.push({ file: 'EntityLiving.java', method: 'getCanSpawnHere' });
  assert.throws(() => verifyEntityBehaviorCandidates(changed, parentById), /false inherited natural spawn/);
});

test('entity inherited source must come from its declared ancestry', () => {
  const changed = structuredClone(catalog);
  changed.records
    .find((entry) => entry.name === 'Skeleton')
    .inheritedMethodCandidates.spawn.push({
      file: 'EntityCow.java',
      method: 'getCanSpawnHere',
    });
  assert.throws(() => verifyEntityBehaviorCandidates(changed, parentById), /outside ancestry/);
});
