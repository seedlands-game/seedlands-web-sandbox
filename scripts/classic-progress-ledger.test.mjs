import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classicProgressLedger } from './classic-progress-ledger.mjs';

const ledger = async (value) => {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-progress-'));
  const path = join(directory, 'progress.json');
  await writeFile(path, JSON.stringify(value));
  return classicProgressLedger(path);
};

test('only reports 100 when every frozen item is complete', async () => {
  const partial = await ledger({
    schemaVersion: 1,
    status: 'ACTIVE',
    items: [
      { id: 'implementation', status: 'COMPLETE', weight: 3 },
      { id: 'browser', status: 'IN_PROGRESS', weight: 1 },
    ],
  });
  assert.equal(partial.status, 'IN_PROGRESS');
  assert.equal(partial.totalWeight, 4);
  assert.equal(partial.completedWeight, 3);
  assert.equal(partial.percent, 75);
  assert.deepEqual(partial.pending, [{ id: 'browser', status: 'IN_PROGRESS', weight: 1 }]);
  const complete = await ledger({
    schemaVersion: 1,
    status: 'COMPLETE',
    items: [
      { id: 'implementation', status: 'COMPLETE', weight: 3 },
      { id: 'browser', status: 'COMPLETE', weight: 1 },
    ],
  });
  assert.equal(complete.percent, 100);
  assert.equal(complete.status, 'COMPLETE');
  assert.deepEqual(complete.pending, []);
});

test('rejects a false top-level completion and malformed item identities', async () => {
  await assert.rejects(
    ledger({
      schemaVersion: 1,
      status: 'COMPLETE',
      items: [{ id: 'browser', status: 'PENDING', weight: 1 }],
    }),
    /top-level status/,
  );
  await assert.rejects(
    ledger({
      schemaVersion: 1,
      status: 'ACTIVE',
      items: [
        { id: 'same', status: 'PENDING', weight: 1 },
        { id: 'same', status: 'PENDING', weight: 1 },
      ],
    }),
    /id is invalid/,
  );
  await assert.rejects(
    ledger({
      schemaVersion: 1,
      status: 'ACTIVE',
      items: [{ id: 'bad', status: 'ALMOST', weight: 1 }],
    }),
    /status is invalid/,
  );
});
