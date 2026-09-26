import { describe, expect, it, vi } from 'vitest';
import {
  dispatchItemInteraction,
  isItemInteractionTarget,
  type ItemInteractionExpectedSelectionV1,
} from '../../src/server/gameplay/modules/item-interaction-module';

const selection: ItemInteractionExpectedSelectionV1 = {
  inventoryRevision: 1,
  modeRevision: 2,
  creativeCatalogRevision: 3,
  selectedSlot: 0,
};
const binding = (voxelHitPolicy?: 'fluid-source') => ({
  definition: {
    id: 'test:binding',
    selector: { itemId: 'test:item' },
    trigger: 'voxel' as const,
    operationId: 'test:operation',
    presentationKey: 'test:item',
    ...(voxelHitPolicy ? { voxelHitPolicy } : {}),
  },
  moduleId: 'test:module',
  itemId: 'test:item',
});
const options = (
  voxel: (position: [number, number, number]) => number | undefined,
  actorPosition: readonly [number, number, number] = [0, 0, 0],
  targetable: (voxel: number) => boolean = (voxel) => voxel === 3,
  fluidCell: (position: [number, number, number]) => Readonly<{ level: number; source: boolean }> | null = () => null,
  resolvedBinding = binding(),
) => {
  const invokeActor = vi.fn(() => ({ ok: true as const, value: { success: true }, revision: 1 }));
  return {
    invokeActor,
    value: {
      actor: () => ({
        position: actorPosition,
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
      resolveInteraction: () => resolvedBinding,
      invokeActor,
      getVoxel: voxel,
      getVoxelSemantics: (voxelId: number) =>
        voxelId === 99
          ? undefined
          : {
              id: 'test:voxel',
              storageId: voxelId,
              solid: voxelId === 77 ? false : targetable(voxelId),
              targetable: targetable(voxelId),
              renderable: voxelId !== 0,
              meshKind: 'cube' as const,
              emission: 0,
              lightCost: 1,
              faceMaterials: [1, 1, 1, 1, 1, 1] as const,
            },
      getFluidCell: fluidCell,
    },
  };
};

describe('item interaction target security', () => {
  it('accepts a registered non-targetable full source only for a server-resolved fluid-source binding', () => {
    const context = options(
      ([x]) => (x === 2 ? 8 : 0),
      [0.5, 0, 0.5],
      () => false,
      ([x]) => (x === 2 ? { level: 8, source: true } : null),
      binding('fluid-source'),
    );

    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [2, 1, 0], adjacent: [3, 1, 0] },
        selection,
      ),
    ).toMatchObject({ success: true, handled: true });
    expect(context.invokeActor).toHaveBeenCalledOnce();
  });

  it('rejects an unregistered voxel even when a fluid sidecar claims it is a full source', () => {
    const context = options(
      ([x]) => (x === 2 ? 99 : 0),
      [0.5, 0, 0.5],
      () => false,
      ([x]) => (x === 2 ? { level: 8, source: true } : null),
      binding('fluid-source'),
    );

    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [2, 1, 0], adjacent: [3, 1, 0] },
        selection,
      ),
    ).toEqual({ success: false, reason: 'invalid-target' });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });

  it.each([
    ['default policy', undefined, { level: 8, source: true }],
    ['flowing fluid', 'fluid-source', { level: 7, source: false }],
    ['non-full source', 'fluid-source', { level: 7, source: true }],
  ] as const)('rejects non-targetable %s before invoking a handler', (_name, policy, fluid) => {
    const context = options(
      ([x]) => (x === 2 ? 8 : 0),
      [0.5, 0, 0.5],
      () => false,
      ([x]) => (x === 2 ? fluid : null),
      binding(policy),
    );

    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [2, 1, 0], adjacent: [3, 1, 0] },
        selection,
      ),
    ).toEqual({ success: false, reason: 'invalid-target' });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });

  it('does not accept a client-supplied voxel hit policy', () => {
    expect(
      isItemInteractionTarget({
        kind: 'voxel',
        hit: [2, 1, 0],
        adjacent: [3, 1, 0],
        voxelHitPolicy: 'fluid-source',
      }),
    ).toBe(false);
  });

  it('uses the trusted body position and exposed face for the Browser-04 downward target', () => {
    const floor = new Set(['68,30,2', '67,30,2']);
    const context = options(
      (position) => (floor.has(position.join(',')) ? 3 : 0),
      [65.34008376511767, 31.000001, 2.602567930028762],
    );

    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [68, 30, 2], adjacent: [68, 31, 2] },
        selection,
      ),
    ).toMatchObject({ success: true, handled: true });
    expect(context.invokeActor).toHaveBeenCalledOnce();
  });

  it('uses the current composition semantics for non-Classic line-of-sight voxels', () => {
    const context = options(([x]) => (x === 5 ? 77 : x === 3 ? 3 : 0), [6.5, -0.1, 0.5]);
    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [3, 1, 0], adjacent: [4, 1, 0] },
        selection,
      ),
    ).toMatchObject({ success: true, handled: true });
    expect(context.invokeActor).toHaveBeenCalledOnce();
  });

  it.each([
    [
      [2, 1, 1],
      [3, 1, 1],
      [4.5, -0.1, 1.5],
    ],
    [
      [2, 1, 1],
      [1, 1, 1],
      [0.5, -0.1, 1.5],
    ],
    [
      [1, 2, 1],
      [1, 3, 1],
      [1.5, 2.9, 1.5],
    ],
    [
      [1, 2, 1],
      [1, 1, 1],
      [1.5, -1.1, 1.5],
    ],
    [
      [1, 1, 2],
      [1, 1, 3],
      [1.5, -0.1, 4.5],
    ],
    [
      [1, 1, 2],
      [1, 1, 1],
      [1.5, -0.1, 0.5],
    ],
  ] as const)('accepts an exposed orthogonal face %j -> %j', (hit, adjacent, body) => {
    const context = options((position) => (position.every((value, axis) => value === hit[axis]) ? 3 : 0), body);
    expect(dispatchItemInteraction(context.value, 'player', { kind: 'voxel', hit, adjacent }, selection)).toMatchObject(
      { success: true, handled: true },
    );
    expect(context.invokeActor).toHaveBeenCalledOnce();
  });

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

  it('rejects a hit behind a wall when adjacent remains visible', () => {
    const context = options(([x, y]) => ((x === 2 || x === 3) && y === 1 ? 3 : 0));
    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [3, 1, 0], adjacent: [3, 2, 0] },
        selection,
      ),
    ).toEqual({ success: false, reason: 'blocked' });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unknown hit',
      ([x]: [number, number, number]): number | undefined => (x === 2 ? undefined : 0),
      (_voxel: number): boolean => true,
      'chunk-unavailable',
    ],
    [
      'unknown adjacent',
      ([x]: [number, number, number]): number | undefined => (x === 3 ? undefined : 3),
      (_voxel: number): boolean => true,
      'chunk-unavailable',
    ],
    ['air hit', (): number => 0, (_voxel: number): boolean => false, 'invalid-target'],
    [
      'non-targetable hit',
      ([x]: [number, number, number]): number => (x === 2 ? 4 : 0),
      (_voxel: number): boolean => false,
      'invalid-target',
    ],
    [
      'unregistered hit semantics',
      ([x]: [number, number, number]): number => (x === 2 ? 99 : 0),
      (_voxel: number): boolean => false,
      'invalid-target',
    ],
  ] as const)('rejects %s before invoking a handler', (_name, voxel, targetable, reason) => {
    const context = options(voxel, [0, 0, 0], targetable);
    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [2, 0, 0], adjacent: [3, 0, 0] },
        selection,
      ),
    ).toEqual({ success: false, reason });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });

  it('rejects stale selection before reading the target or invoking a handler', () => {
    const getVoxel = vi.fn(() => 0);
    const context = options(getVoxel);
    expect(
      dispatchItemInteraction(
        context.value,
        'player',
        { kind: 'voxel', hit: [1, 0, 0], adjacent: [1, 1, 0] },
        { ...selection, inventoryRevision: selection.inventoryRevision + 1 },
      ),
    ).toEqual({ success: false, reason: 'stale-selection' });
    expect(getVoxel).not.toHaveBeenCalled();
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
      'out-of-range from trusted interaction origin',
      (): number | undefined => 3,
      { kind: 'voxel' as const, hit: [5, 0, 0] as const, adjacent: [6, 0, 0] as const },
      'out-of-range',
    ],
  ] as const)('rejects %s targets before invoking a handler', (_name, voxel, target, reason) => {
    const context = options(voxel);
    expect(dispatchItemInteraction(context.value, 'player', target, selection)).toEqual({ success: false, reason });
    expect(context.invokeActor).not.toHaveBeenCalled();
  });
});
