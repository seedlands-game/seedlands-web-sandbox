import { describe, expect, it, vi } from 'vitest';
import { createContentItemIdentityResolver } from '../../src/server/composition/content-item-identity';
import { defineStructureDefinitionV1 } from '../../src/server/gameplay/modules/structure-definition';
import { createStructureDefinitionRegistryV1 } from '../../src/server/gameplay/modules/structure-definition-module';
import {
  dispatchStructureTargetFirstV1,
  resolveStructurePlacementIntentV1,
  resolveStructureTargetIntentV1,
} from '../../src/server/gameplay/modules/structure-target-dispatch';

const panel = defineStructureDefinitionV1({
  version: 1,
  id: 'sample:panel',
  rootRole: 'base',
  initialState: 'closed',
  parts: [
    { role: 'base', offset: [0, 0, 0] },
    { role: 'cap', offset: [0, 1, 0] },
  ],
  states: [
    { id: 'closed', variants: { base: 500, cap: 501 }, collision: { base: 'blocking', cap: 'blocking' } },
    { id: 'open', variants: { base: 502, cap: 503 }, collision: { base: 'passable', cap: 'passable' } },
  ],
  transitions: [
    { id: 'toggle', from: 'closed', to: 'open' },
    { id: 'toggle', from: 'open', to: 'closed' },
  ],
  legacyStates: [{ stateId: 'closed', variants: { base: 52, cap: 52 } }],
  support: { role: 'base', offset: [0, -1, 0], requirement: 'solid' },
  variantDescriptorKind: 'voxel-semantics',
  placementItemId: 'sample:panel-item',
  dropOwnerRole: 'base',
  drop: { itemId: 'sample:panel-item', count: 1 },
});
const registry = createStructureDefinitionRegistryV1([panel]);
const reader =
  (cells: ReadonlyMap<string, number | undefined>) =>
  ([x, y, z]: readonly number[]) =>
    cells.get(`${x},${y},${z}`);

describe('Structure target-first routing', () => {
  const expectedSelection = { inventoryRevision: 1, modeRevision: 2, creativeCatalogRevision: 3, selectedSlot: 0 };
  const actor = (selectedItemId: string | null) => () => ({
    lifecycle: 'alive' as const,
    position: [7.5, 31.5, 2] as const,
    inventoryRevision: 1,
    modeRevision: 2,
    creativeCatalogRevision: 3,
    selectedSlot: 0,
    mode: 'survival' as const,
    survivalItemId: selectedItemId,
    creativeItemId: null,
  });
  it('distinguishes resolved, not-structure, unavailable and malformed targets', () => {
    expect(
      resolveStructureTargetIntentV1(
        registry,
        [7, 32, 0],
        reader(
          new Map([
            ['7,31,0', 500],
            ['7,32,0', 501],
            ['7,30,0', 3],
          ]),
        ),
      ),
    ).toMatchObject({ status: 'resolved', structure: { definitionId: 'sample:panel', root: [7, 31, 0] } });
    expect(resolveStructureTargetIntentV1(registry, [9, 31, 0], () => 3)).toEqual({ status: 'not-structure' });
    expect(
      resolveStructureTargetIntentV1(
        registry,
        [7, 31, 0],
        reader(
          new Map([
            ['7,31,0', 500],
            ['7,32,0', undefined],
            ['7,30,0', 3],
          ]),
        ),
      ),
    ).toMatchObject({ status: 'unavailable', chunkKeys: ['0,0,0', '0,1,0'] });
    expect(
      resolveStructureTargetIntentV1(
        registry,
        [7, 31, 0],
        reader(
          new Map([
            ['7,31,0', 500],
            ['7,32,0', 3],
            ['7,30,0', 3],
          ]),
        ),
      ),
    ).toEqual({
      status: 'malformed',
    });
    expect(
      resolveStructureTargetIntentV1(
        registry,
        [7, 31, 0],
        reader(
          new Map([
            ['7,30,0', 52],
            ['7,31,0', 52],
            ['7,32,0', 52],
            ['7,29,0', 3],
          ]),
        ),
      ),
    ).toEqual({ status: 'malformed' });
    expect(
      resolveStructureTargetIntentV1(
        registry,
        [7, 31, 0],
        reader(
          new Map([
            ['7,30,0', 3],
            ['7,31,0', 52],
            ['7,32,0', 52],
          ]),
        ),
      ),
    ).toMatchObject({ status: 'resolved', structure: { source: 'legacy', root: [7, 31, 0] } });
  });

  it('resolves placement only through frozen content identity and derives horizontal or vertical bearing', () => {
    const identity = createContentItemIdentityResolver({
      items: [{ id: 'sample:panel-item', storageId: 'stored-panel' }],
    });
    expect(
      resolveStructurePlacementIntentV1(registry, identity, 'stored-panel', [0, 0, 0], [1, 0, 0], [20, 0, 20]),
    ).toMatchObject({ status: 'resolved', definition: { id: 'sample:panel' }, stateId: 'closed', bearing: 'east' });
    expect(
      resolveStructurePlacementIntentV1(registry, identity, 'stored-panel', [1, 0, 0], [1, 1, 0], [-2, 0, 0]),
    ).toMatchObject({ status: 'resolved', bearing: 'east' });
    expect(
      resolveStructurePlacementIntentV1(registry, identity, 'stored-panel', [0, 0, 0], [0, 1, 0], [-0.5, 0, -0.5]),
    ).toMatchObject({ status: 'resolved', bearing: 'east' });
    expect(
      resolveStructurePlacementIntentV1(registry, identity, 'stored-panel', [0, 0, 0], [0, 1, 0], [0.5, 0, 0.5]),
    ).toEqual({ status: 'malformed', reason: 'ambiguous-placement-orientation' });
    expect(
      resolveStructurePlacementIntentV1(registry, identity, 'sample:panel-item', [0, 0, 0], [1, 0, 0], [0, 0, 0]),
    ).toEqual({
      status: 'not-structure',
    });
  });

  it.each([null, 'water-bucket'])('routes a resolved Structure before selected item %s', (selectedItemId) => {
    const invoke = vi.fn(() => ({ success: true as const, handled: true as const }));
    const fallback = vi.fn(() => ({ success: false as const, reason: 'item-no-interaction' as const }));
    expect(
      dispatchStructureTargetFirstV1(
        {
          actor: actor(selectedItemId),
          getVoxel: () => 0,
          resolve: () => ({
            status: 'resolved',
            structure: registry.resolveTarget(
              [7, 31, 0],
              reader(
                new Map([
                  ['7,31,0', 500],
                  ['7,32,0', 501],
                  ['7,30,0', 3],
                ]),
              ),
            )!,
            chunkKeys: ['0,0,0', '0,1,0'],
          }),
          invoke,
          fallback,
        },
        {
          actorId: 'player',
          intent: 'use',
          target: { kind: 'voxel', hit: [7, 31, 0], adjacent: [6, 31, 0] },
          expectedSelection,
        },
      ),
    ).toEqual({ success: true, handled: true });
    expect(invoke).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    ['not-structure', { status: 'not-structure' as const }, true, 'item-no-interaction'],
    ['unavailable', { status: 'unavailable' as const, chunkKeys: ['0,1,0'] }, false, 'chunk-unavailable'],
    ['malformed', { status: 'malformed' as const }, false, 'structure-malformed'],
  ])('handles %s without unsafe fallback', (_label, resolved, usesFallback, reason) => {
    const fallback = vi.fn(() => ({ success: false as const, reason: 'item-no-interaction' as const }));
    expect(
      dispatchStructureTargetFirstV1(
        { actor: actor('water-bucket'), getVoxel: () => 0, resolve: () => resolved, invoke: vi.fn(), fallback },
        {
          actorId: 'player',
          intent: 'use',
          target: { kind: 'voxel', hit: [7, 31, 0], adjacent: [6, 31, 0] },
          expectedSelection,
        },
      ),
    ).toEqual({ success: false, reason });
    expect(fallback).toHaveBeenCalledTimes(Number(usesFallback));
  });

  it('passes the trusted selected storage identity to the target resolver', () => {
    const resolve = vi.fn(() => ({ status: 'not-structure' as const }));
    dispatchStructureTargetFirstV1(
      {
        actor: actor('water-bucket'),
        getVoxel: () => 0,
        resolve,
        invoke: vi.fn(),
        fallback: vi.fn(() => ({ success: false as const, reason: 'fallback' })),
      },
      {
        actorId: 'player',
        intent: 'use',
        target: { kind: 'voxel', hit: [7, 31, 0], adjacent: [6, 31, 0] },
        expectedSelection,
      },
    );
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ selectedItemId: 'water-bucket' }));
  });

  it.each(['inventoryRevision', 'modeRevision', 'creativeCatalogRevision', 'selectedSlot'] as const)(
    'rejects stale %s before target resolution',
    (field) => {
      const resolve = vi.fn(() => ({ status: 'not-structure' as const }));
      const fallback = vi.fn();
      expect(
        dispatchStructureTargetFirstV1(
          { actor: actor(null), getVoxel: () => 0, resolve, invoke: vi.fn(), fallback },
          {
            actorId: 'player',
            intent: 'alternate',
            target: { kind: 'voxel', hit: [7, 31, 0], adjacent: [6, 31, 0] },
            expectedSelection: { ...expectedSelection, [field]: expectedSelection[field] + 1 },
          },
        ),
      ).toEqual({ success: false, reason: 'stale-selection' });
      expect(resolve).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['diagonal', { hit: [7, 31, 0] as const, adjacent: [8, 32, 0] as const }, () => 0, 'invalid-target'],
    ['out-of-range', { hit: [20, 31, 0] as const, adjacent: [21, 31, 0] as const }, () => 0, 'out-of-range'],
    ['unknown', { hit: [7, 31, 0] as const, adjacent: [6, 31, 0] as const }, () => undefined, 'chunk-unavailable'],
    [
      'blocked',
      { hit: [7, 31, 0] as const, adjacent: [6, 31, 0] as const },
      ([, , z]: readonly number[]) => (z === 1 ? 3 : 0),
      'blocked',
    ],
  ])('rejects %s target before Structure resolution', (_label, target, getVoxel, reason) => {
    const resolve = vi.fn();
    expect(
      dispatchStructureTargetFirstV1(
        { actor: actor(null), getVoxel, resolve, invoke: vi.fn(), fallback: vi.fn() },
        { actorId: 'player', intent: 'use', target: { kind: 'voxel', ...target }, expectedSelection },
      ),
    ).toEqual({ success: false, reason });
    expect(resolve).not.toHaveBeenCalled();
  });
});
