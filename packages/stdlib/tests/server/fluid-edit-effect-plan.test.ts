import { expect, it } from 'vitest';
import { FluidTransactionAuthority } from '../../src/server/fluid/fluid-transaction';

it('records prepared fluid edit queue overflow as bounded rescan work', () => {
  const authority = new FluidTransactionAuthority({
    epoch: 1,
    maxQueue: 1,
    readChunk: () => null,
    readCell: () => null,
    apply: () => undefined,
  });
  const prepared = authority.prepareEditEffects(
    [{ position: [5, 5, 5], activate: true, removeSource: true }],
    'interactive',
  );

  expect(() => prepared.apply()).toThrow(/validation/i);
  prepared.validate();
  prepared.apply();

  expect(authority.pending).toBe(1);
  expect(authority.needsRescan).toEqual(['0,0,0']);
});
