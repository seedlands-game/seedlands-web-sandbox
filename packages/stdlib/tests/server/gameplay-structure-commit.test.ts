import { describe, expect, it } from 'vitest';
import { createKernelStateOwner } from '@seedlands/kernel/execution';
import { prepareGameplayStructureChange } from '../../src/server/gameplay/gameplay-structure-commit';

const receipt = (worldRevision: number) => ({ committed: true as const, worldRevision });

describe('prepared Structure gameplay frontier', () => {
  it('reserves the world and gameplay commits before publishing prepared statistics', () => {
    const owner = createKernelStateOwner();
    const counters = { inventoryOperationCount: 2, eventCount: 3 };
    const prepared = prepareGameplayStructureChange(owner, counters, true, receipt(1));

    prepared.validate();
    expect(counters).toEqual({ inventoryOperationCount: 2, eventCount: 3 });
    owner.commitWorldRevision(owner.epoch, 1);
    prepared.apply();

    expect(prepared.revision).toBe(1);
    expect(owner.snapshot()).toMatchObject({ worldRevision: 1, gameplayRevision: 1, commitSequence: 2 });
    expect(counters).toEqual({ inventoryOperationCount: 3, eventCount: 4 });
  });

  it.each([
    ['world revision', (owner: ReturnType<typeof createKernelStateOwner>) => owner.commitWorldRevision(owner.epoch, 1)],
    ['gameplay revision', (owner: ReturnType<typeof createKernelStateOwner>) => owner.commitGameplay(owner.epoch)],
    ['commit sequence', (owner: ReturnType<typeof createKernelStateOwner>) => owner.commitEvent(owner.epoch)],
    ['epoch', (owner: ReturnType<typeof createKernelStateOwner>) => owner.replaceEpoch()],
  ] as const)('rejects a stale %s before either owner applies', (_label, mutate) => {
    const owner = createKernelStateOwner();
    const counters = { inventoryOperationCount: 0, eventCount: 0 };
    const prepared = prepareGameplayStructureChange(owner, counters, false, receipt(1));

    mutate(owner);
    expect(() => prepared.validate()).toThrow(/stale/i);
    expect(counters).toEqual({ inventoryOperationCount: 0, eventCount: 0 });
  });

  it('rejects an invalid receipt and a combined commit frontier with only one slot remaining', () => {
    const counters = { inventoryOperationCount: 0, eventCount: 0 };
    expect(() => prepareGameplayStructureChange(createKernelStateOwner(), counters, false, receipt(2))).toThrow(
      /world revision/i,
    );
    expect(() =>
      prepareGameplayStructureChange(
        createKernelStateOwner({ commitSequence: Number.MAX_SAFE_INTEGER - 1 }),
        counters,
        false,
        receipt(1),
      ),
    ).toThrow(/commit sequence/i);
    expect(counters).toEqual({ inventoryOperationCount: 0, eventCount: 0 });
  });
});
