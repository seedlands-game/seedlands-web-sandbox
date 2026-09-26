import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveWorldSourceLocations } from './mechanism-world-merge.mjs';
import { verifyWorldMechanismSync } from './verify-mechanism-world-sync.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const readJson = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'));

test('world source shorthand resolves to the fixed commit and file', () => {
  const result = resolveWorldSourceLocations(['World.java#L10-L20', 'L30-L35', 'Chunk.java']);
  assert.equal(result.anchored.length, 2);
  assert.match(result.anchored[1], /World\.java#L30-L35$/);
  assert.match(result.fileOnly[0], /Chunk\.java$/);
  assert.throws(() => resolveWorldSourceLocations(['L30-L35']), /invalid world source location/);
});

test('world mechanism sync rejects stale reconstructed evidence', async () => {
  const catalog = await readJson('reference-cases.json');
  const candidates = await readJson('mechanism-world-candidates.json');
  assert.equal(await verifyWorldMechanismSync(root, catalog, candidates), 42);
  const parent = catalog.cases.find((entry) => entry.caseId === 'M05-02');
  parent.evidence.push({
    uri: 'https://github.com/jacobo-mc/mc_b1.7.3_release/blob/stale/WorldGenDungeons.java',
    supports: 'stale',
  });
  await assert.rejects(verifyWorldMechanismSync(root, catalog, candidates), /stale evidence M05-02/);
});
