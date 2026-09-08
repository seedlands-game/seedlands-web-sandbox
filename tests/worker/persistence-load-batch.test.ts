import { describe, expect, it } from 'vitest';
import {
  MAX_PERSISTENCE_LOAD_BATCH,
  validatePersistenceLoadBatch,
} from '../../apps/web/src/worker/persistence-load-batch';

describe('persistence load batch', () => {
  it('accepts one bounded unique mesh neighborhood', () => {
    const coordinates = Array.from({ length: MAX_PERSISTENCE_LOAD_BATCH }, (_, cx) => ({ cx, cy: 1, cz: -2 }));
    expect(validatePersistenceLoadBatch(coordinates)).toBe(coordinates);
  });

  it('rejects empty, oversized, duplicate, and non-integer batches', () => {
    expect(() => validatePersistenceLoadBatch([])).toThrow(/1\.\.27/);
    expect(() =>
      validatePersistenceLoadBatch(
        Array.from({ length: MAX_PERSISTENCE_LOAD_BATCH + 1 }, (_, cx) => ({ cx, cy: 1, cz: -2 })),
      ),
    ).toThrow(/1\.\.27/);
    expect(() =>
      validatePersistenceLoadBatch([
        { cx: 1, cy: 1, cz: -2 },
        { cx: 1, cy: 1, cz: -2 },
      ]),
    ).toThrow(/Duplicate/);
    expect(() => validatePersistenceLoadBatch([{ cx: 0.5, cy: 1, cz: -2 }])).toThrow(/safe integers/);
    expect(() => validatePersistenceLoadBatch(null as never)).toThrow(/1\.\.27/);
    expect(() => validatePersistenceLoadBatch([null as never])).toThrow(/objects/);
  });
});
