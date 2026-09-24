import { describe, expect, it, vi } from 'vitest';
import {
  dispatchItemInteraction,
  type ItemInteractionExpectedSelectionV1,
} from '../../src/server/gameplay/modules/item-interaction-module';

const selection: ItemInteractionExpectedSelectionV1 = {
  inventoryRevision: 1,
  modeRevision: 2,
  creativeCatalogRevision: 3,
  selectedSlot: 0,
};
const binding = {
  definition: {
    id: 'test:binding',
    selector: { itemId: 'test:item' },
    trigger: 'voxel' as const,
    operationId: 'test:operation',
    presentationKey: 'test:item',
  },
  moduleId: 'test:module',
  itemId: 'test:item',
};
const options = (voxel: (position: [number, number, number]) => number | undefined) => {
  const invokeActor = vi.fn(() => ({ ok: true as const, value: { success: true }, revision: 1 }));
  return {
    invokeActor,
    value: {
      actor: () => ({
        position: [0, 0, 0] as const,
        lifecycle: 'alive' as const,
        mode: 'survival' as const,
        inventoryRevision: 1,
        modeRevision: 2,
        creativeCatalogRevision: 3,
        selectedSlot: 0,
        survivalItemId: 'test:item',
        creativeItemId: null,
      }),
      resolveEntity: () => null,
      resolveInteraction: () => binding,
      invokeActor,
      getVoxel: voxel,
    },
  };
};

describe('item interaction target security', () => {
  it.each([
    ['far adjacent', { kind: 'voxel' as const, hit: [1, 0, 0] as const, adjacent: [3, 0, 0] as const }],
    ['diagonal adjacent', { kind: 'voxel' as const, hit: [1, 0, 0] as const, adjacent: [2, 1, 0] as const }],
  ])('rejects %s before invoking a handler', (_name, target) => {
    const context = options(() => 0);
    expect(dispatchItemInteraction(context.value, 'player', target, selection)).toEqual({
      success: false,
      reason: 'invalid-target',
    });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });

  it('checks adjacent line of sight independently from the visible hit', () => {
    const context = options(([x]) => (x === 2 ? 3 : 0));
    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [2, 0, 0], adjacent: [3, 0, 0] },
        selection,
      ),
    ).toEqual({ success: false, reason: 'blocked' });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unknown',
      (): number | undefined => undefined,
      { kind: 'voxel' as const, hit: [1, 0, 0] as const, adjacent: [2, 0, 0] as const },
      'chunk-unavailable',
    ],
    [
      'out-of-range',
      (): number | undefined => 0,
      { kind: 'voxel' as const, hit: [5, 0, 0] as const, adjacent: [6, 0, 0] as const },
      'out-of-range',
    ],
  ] as const)('rejects %s targets before invoking a handler', (_name, voxel, target, reason) => {
    const context = options(voxel);
    expect(dispatchItemInteraction(context.value, 'player', target, selection)).toEqual({ success: false, reason });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });
});
