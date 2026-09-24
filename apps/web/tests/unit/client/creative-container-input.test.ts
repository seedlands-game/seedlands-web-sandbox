import { describe, expect, it, vi } from 'vitest';
import {
  createVoxelInteractionAction,
  performSecondaryInteraction,
  performVoxelTargetInteraction,
} from '../../../src/app/player/secondary-interaction';

const target = {
  voxel: 12,
  position: [1, 2, 3] as [number, number, number],
  adjacent: [1, 2, 2] as [number, number, number],
  distance: 2,
  inRange: true,
};

describe('secondary player interaction precedence', () => {
  it('builds a voxel interact action from the authoritative survival or creative selection', () => {
    const gameplay = {
      inventory: { revision: 7 },
      player: {
        selectedSlot: 2,
        mode: { version: 1, value: 'survival', revision: 3 },
        creativeCatalog: { version: 1, hotbar: [null, 'water-bucket'], selectedSlot: 1, revision: 5 },
      },
    };
    expect(createVoxelInteractionAction(gameplay, target, 'use')).toEqual({
      type: 'interact',
      intent: 'use',
      target: { kind: 'voxel', hit: [1, 2, 3], adjacent: [1, 2, 2] },
      expectedSelection: { inventoryRevision: 7, modeRevision: 3, creativeCatalogRevision: 5, selectedSlot: 2 },
    });
    expect(
      createVoxelInteractionAction(
        { ...gameplay, player: { ...gameplay.player, mode: { ...gameplay.player.mode, value: 'creative' } } },
        target,
        'alternate',
      ).expectedSelection.selectedSlot,
    ).toBe(1);
  });

  it('uses the aimed target with its adjacent cell before held-item use or placement', async () => {
    const calls: string[] = [];
    expect(
      await performSecondaryInteraction({
        target,
        bypassTarget: false,
        useTarget: (value) => (
          calls.push(`target:${value.position.join(',')}:${value.adjacent?.join(',')}`),
          Promise.resolve('handled')
        ),
        useHeldItem: () => (calls.push('held'), true),
        place: () => calls.push('place'),
        feedback: vi.fn(),
      }),
    ).toBe('target');
    expect(calls).toEqual(['target:1,2,3:1,2,2']);
  });

  it('sends alternate intent while Shift is held and stops when the target handles it', async () => {
    const calls: string[] = [];
    expect(
      await performSecondaryInteraction({
        target,
        bypassTarget: true,
        useTarget: () => (calls.push('target'), Promise.resolve('handled')),
        useHeldItem: () => (calls.push('held'), false),
        place: (position) => calls.push(`place:${position.join(',')}`),
        feedback: vi.fn(),
      }),
    ).toBe('target');
    expect(calls).toEqual(['target']);
  });

  it('waits for explicit target fallback and never duplicates a handled action', async () => {
    const calls: string[] = [];
    expect(
      await performSecondaryInteraction({
        target,
        bypassTarget: false,
        useTarget: async () => (
          calls.push('target:start'),
          await Promise.resolve(),
          calls.push('target:end'),
          'fallback'
        ),
        useHeldItem: () => (calls.push('held'), false),
        place: () => calls.push('place'),
        feedback: vi.fn(),
      }),
    ).toBe('place');
    expect(calls).toEqual(['target:start', 'target:end', 'held', 'place']);
  });

  it.each([
    [{ success: false, reason: 'item-no-interaction' }, 'fallback'],
    [{ success: false, reason: 'blocked' }, 'handled'],
    [{ success: true }, 'handled'],
  ] as const)('maps Authority target result %j to %s with one request', async (result, expected) => {
    const perform = vi.fn(async () => ({ result }));
    const failed = vi.fn();
    const succeeded = vi.fn();
    await expect(
      performVoxelTargetInteraction({
        gameplay: {
          inventory: { revision: 7 },
          player: {
            selectedSlot: 0,
            mode: { version: 1, value: 'survival', revision: 1 },
            creativeCatalog: { version: 1, hotbar: [null], selectedSlot: 0, revision: 2 },
          },
        },
        target,
        intent: 'use',
        openStation: () => false,
        perform,
        refresh: vi.fn(),
        succeeded,
        failed,
      }),
    ).resolves.toBe(expected);
    expect(perform).toHaveBeenCalledOnce();
    expect(succeeded).toHaveBeenCalledTimes(Number(result.success));
    expect(failed).toHaveBeenCalledTimes(Number(result.success === false && result.reason !== 'item-no-interaction'));
  });

  it('turns a rejected Authority request into visible failure without fallback', async () => {
    const failed = vi.fn();
    await expect(
      performVoxelTargetInteraction({
        gameplay: { inventory: { revision: 0 }, player: { selectedSlot: 0 } },
        target,
        intent: 'use',
        openStation: () => false,
        perform: () => Promise.reject(new Error('authority unavailable')),
        refresh: vi.fn(),
        succeeded: vi.fn(),
        failed,
      }),
    ).resolves.toBe('handled');
    expect(failed).toHaveBeenCalledWith('authority unavailable');
  });
});
