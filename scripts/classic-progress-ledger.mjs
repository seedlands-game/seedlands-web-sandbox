#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultProgressPath = resolve(root, 'changes/2026-09-23-composable-content-injection/progress.json');
const itemStatuses = new Set(['PENDING', 'IN_PROGRESS', 'COMPLETE']);

const readProgress = async (path) => {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new TypeError(`Cannot read progress ledger: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new TypeError('Progress ledger must be an object.');
  if (parsed.schemaVersion !== 1) throw new TypeError('Unsupported progress ledger schema version.');
  if (!Array.isArray(parsed.items) || parsed.items.length === 0)
    throw new TypeError('Progress ledger must contain items.');
  const ids = new Set();
  const items = parsed.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new TypeError('Progress ledger item must be an object.');
    const { id, status, weight } = item;
    if (typeof id !== 'string' || !id || ids.has(id))
      throw new TypeError(`Progress ledger item id is invalid: ${String(id)}`);
    if (typeof status !== 'string' || !itemStatuses.has(status))
      throw new TypeError(`Progress ledger item status is invalid: ${id}`);
    if (!Number.isSafeInteger(weight) || weight <= 0)
      throw new TypeError(`Progress ledger item weight is invalid: ${id}`);
    ids.add(id);
    return Object.freeze({ id, status, weight, complete: status === 'COMPLETE' });
  });
  const complete = items.every((item) => item.complete);
  if (parsed.status !== (complete ? 'COMPLETE' : 'ACTIVE'))
    throw new TypeError('Progress ledger top-level status does not match its items.');
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    status: parsed.status,
    items: Object.freeze(items),
  });
};

export async function classicProgressLedger(path = defaultProgressPath) {
  const progress = await readProgress(path);
  const totalWeight = progress.items.reduce((sum, item) => sum + item.weight, 0);
  const completedWeight = progress.items.reduce((sum, item) => sum + (item.complete ? item.weight : 0), 0);
  const pending = progress.items
    .filter((item) => !item.complete)
    .map(({ id, status, weight }) => ({ id, status, weight }));
  const percent = Number(((completedWeight * 100) / totalWeight).toFixed(2));
  return Object.freeze({
    schemaVersion: 1,
    source: path,
    status: pending.length === 0 ? 'COMPLETE' : 'IN_PROGRESS',
    totalWeight,
    completedWeight,
    percent,
    pending: Object.freeze(pending),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2] ? resolve(process.argv[2]) : defaultProgressPath;
  classicProgressLedger(source)
    .then((ledger) => process.stdout.write(`${JSON.stringify(ledger)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
