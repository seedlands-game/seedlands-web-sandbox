import { describe, expect, it } from 'vitest';
import { Voxel } from '../../src/world/voxel';
import { createStructureRuntimeFixture, placeStructure } from './registered-structure-runtime-fixture';
import { structureTestVariant as variant } from './structure-runtime-test-composition';

describe('registered Structure runtime with real world and entity owners', () => {
  it.each([
    ['north', [1, 31, 1], [1, 31, 0], [1.5, 31, -2.5]],
    ['east', [0, 31, 0], [1, 31, 0], [3.5, 31, 0.5]],
    ['south', [1, 31, -1], [1, 31, 0], [1.5, 31, 3.5]],
    ['west', [2, 31, 0], [1, 31, 0], [-1.5, 31, 0.5]],
  ] as const)(
    'places a cross-Chunk %s state with one world/gameplay/inventory advance',
    (orientation, hit, adjacent, actorPosition) => {
      const world = createStructureRuntimeFixture();
      if (adjacent[1] !== 31) throw new Error('invalid fixture');
      // Direct registered operations must still use a real targetable hit from the clicked face's exterior.
      world.server.edit(hit[0], hit[1], hit[2], Voxel.Stone);
      const actorChunk = actorPosition.map((value) => Math.floor(value / 32)) as [number, number, number];
      world.server.getChunk(...actorChunk);
      world.server.getChunk(actorChunk[0], 1, actorChunk[2]);
      world.entities.update('alice', { position: [...actorPosition] });
      const beforeWorld = world.server.worldRevision;
      const beforeGameplay = world.gameplayRevision();
      const beforeInventory = world.actor.inventoryRevision;
      const lowerChunk = world.server.getChunk(0, 0, 0);
      const upperChunk = world.server.getChunk(0, 1, 0);
      const lowerRevision = lowerChunk.revision;
      const upperRevision = upperChunk.revision;

      const result = placeStructure(world, hit, adjacent);

      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        value: { kind: 'place', definitionId: 'fixture:gate' },
      });
      expect(world.server.getVoxel(1, 31, 0)).toBe(variant(orientation, false, false));
      expect(world.server.getVoxel(1, 32, 0)).toBe(variant(orientation, false, true));
      expect(world.server.worldRevision).toBe(beforeWorld + 1);
      expect(world.gameplayRevision()).toBe(beforeGameplay + 1);
      expect(world.actor.inventoryRevision).toBe(beforeInventory + 1);
      expect(lowerChunk.revision).toBe(lowerRevision + 1);
      expect(upperChunk.revision).toBe(upperRevision + 1);
      expect(world.actor.inventory.slot(0)).toEqual({ itemId: 'gate', count: 1 });
      expect(world.cancellationApplyCount()).toBe(1);
      expect(world.runtime.takeCommits()).toHaveLength(1);
    },
  );

  it('places from the creative catalog without consuming or producing inventory', () => {
    const world = createStructureRuntimeFixture({ mode: 'creative' });
    const slots = world.actor.inventory.snapshot();
    const revision = world.actor.inventoryRevision;

    expect(placeStructure(world)).toMatchObject({ ok: true, value: { kind: 'place' } });
    expect(world.actor.inventory.snapshot()).toEqual(slots);
    expect(world.actor.inventoryRevision).toBe(revision);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
    expect(world.cancellationApplyCount()).toBe(0);
    expect(world.invoke('break', [1, 32, 0], [2, 32, 0])).toMatchObject({ ok: true, value: { kind: 'break' } });
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it.each([
    ['lower', [1, 31, 0] as const],
    ['upper', [1, 32, 0] as const],
  ])('toggles and breaks from the %s half with one survival drop and tool wear', (_role, selected) => {
    const world = createStructureRuntimeFixture();
    expect(placeStructure(world)).toMatchObject({ ok: true });
    world.actor.breakAction = {
      position: [1, 31, 0],
      voxel: variant('north', false, false),
      elapsedSeconds: 0,
      requiredSeconds: 1,
    };
    expect(world.invoke('toggle', selected, [2, selected[1], 0])).toMatchObject({
      ok: true,
      value: { kind: 'toggle' },
    });
    expect(world.actor.breakAction).toBeNull();
    expect(world.server.getVoxel(1, 31, 0)).toBe(variant('north', true, false));
    expect(world.server.getVoxel(1, 32, 0)).toBe(variant('north', true, true));
    world.actor.inventory.replace([
      { itemId: 'tool', count: 1, instance: { durability: 8 } },
      ...Array.from({ length: world.actor.inventory.capacity - 1 }, () => null),
    ]);
    const beforeWorld = world.server.worldRevision;

    expect(world.invoke('break', selected, [2, selected[1], 0])).toMatchObject({
      ok: true,
      value: { kind: 'break' },
    });
    expect(world.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(world.server.worldRevision).toBe(beforeWorld + 1);
    expect(world.actor.inventory.slot(0)).toEqual({ itemId: 'tool', count: 1, instance: { durability: 7 } });
    expect(world.entities.query({ type: 'world-item' }).map((entity) => entity.stack)).toEqual([
      { itemId: 'gate', count: 1 },
    ]);
    expect(world.removalPrepare).toHaveBeenCalledTimes(2);
    expect(world.removalApplyCount()).toBe(2);
    expect(world.cancellationApplyCount()).toBe(3);
  });

  it('migrates a valid legacy pair on toggle and rejects dependent participant failure without writes', () => {
    const legacy = createStructureRuntimeFixture();
    legacy.server.edit(1, 31, 0, 52);
    legacy.server.edit(1, 32, 0, 52);
    expect(legacy.invoke('toggle', [1, 32, 0], [2, 32, 0])).toMatchObject({ ok: true });
    expect(legacy.server.getVoxel(1, 31, 0)).toBe(variant('north', true, false));
    expect(legacy.server.getVoxel(1, 32, 0)).toBe(variant('north', true, true));

    const failed = createStructureRuntimeFixture({ failRemoval: true });
    expect(placeStructure(failed)).toMatchObject({ ok: true });
    failed.runtime.takeCommits();
    const before = {
      world: failed.server.worldRevision,
      gameplay: failed.gameplayRevision(),
      inventory: failed.actor.inventoryRevision,
      slots: failed.actor.inventory.snapshot(),
      entities: failed.entities.query(),
      lower: failed.server.getVoxel(1, 31, 0),
      upper: failed.server.getVoxel(1, 32, 0),
    };
    expect(failed.invoke('break', [1, 31, 0], [2, 31, 0])).toMatchObject({
      ok: false,
      message: 'dependent-removal-failure',
    });
    expect({
      world: failed.server.worldRevision,
      gameplay: failed.gameplayRevision(),
      inventory: failed.actor.inventoryRevision,
      slots: failed.actor.inventory.snapshot(),
      entities: failed.entities.query(),
      lower: failed.server.getVoxel(1, 31, 0),
      upper: failed.server.getVoxel(1, 32, 0),
    }).toEqual(before);
    expect(failed.removalApplyCount()).toBe(0);
    expect(failed.runtime.takeCommits()).toEqual([]);
  });

  it('rejects cancellation and receipt capacity failures before any owner applies', () => {
    const cancellation = createStructureRuntimeFixture({ failCancellation: true });
    const cancelBefore = [
      cancellation.server.worldRevision,
      cancellation.actor.inventoryRevision,
      cancellation.gameplayRevision(),
    ];
    expect(placeStructure(cancellation)).toMatchObject({ ok: false, message: 'cancellation-failure' });
    expect([
      cancellation.server.worldRevision,
      cancellation.actor.inventoryRevision,
      cancellation.gameplayRevision(),
    ]).toEqual(cancelBefore);
    expect(cancellation.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);

    const capacity = createStructureRuntimeFixture({ maxReceipts: 1 });
    expect(placeStructure(capacity)).toMatchObject({ ok: true });
    const before = [capacity.server.worldRevision, capacity.gameplayRevision()];
    expect(capacity.invoke('toggle', [1, 31, 0], [2, 31, 0])).toMatchObject({
      ok: false,
      message: 'Structure commit receipt capacity exhausted.',
    });
    expect([capacity.server.worldRevision, capacity.gameplayRevision()]).toEqual(before);
    expect(capacity.server.getVoxel(1, 31, 0)).toBe(variant('north', false, false));
  });

  it.each(['selection', 'lifetime'] as const)('rejects stale actor %s before preparing world writes', (fault) => {
    const world = createStructureRuntimeFixture({
      beforeWorldPrepare({ entities }) {
        if (fault === 'selection') entities.playerStateAccess('alice').selectedSlot = 1;
        else {
          entities.despawn('alice');
          entities.spawn({ id: 'alice', type: 'player', position: [1.5, 31, 3.5] });
        }
      },
    });
    const beforeWorld = world.server.worldRevision;

    expect(placeStructure(world)).toMatchObject({ ok: false });
    expect(world.server.worldRevision).toBe(beforeWorld);
    expect(world.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(world.runtime.takeCommits()).toEqual([]);
  });

  it('rejects isolated or ambiguous legacy footprints and a stale world without partial Structure writes', () => {
    const isolated = createStructureRuntimeFixture();
    isolated.server.edit(1, 31, 0, 52);
    expect(isolated.invoke('toggle', [1, 31, 0], [2, 31, 0])).toMatchObject({ ok: false });
    expect(isolated.server.getVoxel(1, 31, 0)).toBe(52);
    expect(isolated.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    const ambiguous = createStructureRuntimeFixture();
    ambiguous.server.edit(1, 31, 0, 52);
    ambiguous.server.edit(1, 32, 0, 52);
    ambiguous.server.edit(1, 33, 0, 52);
    expect(ambiguous.invoke('toggle', [1, 32, 0], [2, 32, 0])).toMatchObject({ ok: false });
    expect([31, 32, 33].map((y) => ambiguous.server.getVoxel(1, y, 0))).toEqual([52, 52, 52]);

    const stale = createStructureRuntimeFixture({
      beforeWorldPrepare: ({ server }) => void server.edit(4, 31, 0, Voxel.Stone),
    });
    const before = stale.server.worldRevision;
    expect(placeStructure(stale)).toMatchObject({ ok: false });
    expect(stale.server.worldRevision).toBe(before + 1);
    expect(stale.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(stale.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(stale.actor.inventory.slot(0)).toEqual({ itemId: 'gate', count: 2 });
    expect(stale.runtime.takeCommits()).toEqual([]);
  });

  it.each(['range', 'line-of-sight'] as const)('revalidates %s before preparing a Structure change', (fault) => {
    const world = createStructureRuntimeFixture();
    if (fault === 'range') world.entities.update('alice', { position: [100, 31, 100] });
    else world.server.edit(1, 31, 2, Voxel.Stone);
    const before = world.server.worldRevision;

    expect(placeStructure(world)).toMatchObject({ ok: false });
    expect(world.server.worldRevision).toBe(before);
    expect(world.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(world.actor.inventory.slot(0)).toEqual({ itemId: 'gate', count: 2 });
  });
});
