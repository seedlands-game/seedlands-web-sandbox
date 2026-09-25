import { describe, expect, it } from 'vitest';
import { Voxel } from '../../src/world/voxel';
import { createStructureRuntimeFixture, placeStructure } from './registered-structure-runtime-fixture';

const hit = [1, 31, -1] as const;
const adjacent = [1, 31, 0] as const;
const key = hit.join(',');

const unchanged = (world: ReturnType<typeof createStructureRuntimeFixture>) => ({
  worldRevision: world.server.worldRevision,
  gameplayRevision: world.gameplayRevision(),
  inventoryRevision: world.actor.inventoryRevision,
  slots: world.actor.inventory.snapshot(),
  entities: world.entities.query(),
  lower: world.server.getVoxel(...adjacent),
  upper: world.server.getVoxel(adjacent[0], adjacent[1] + 1, adjacent[2]),
  removalApplies: world.removalApplyCount(),
  cancellationApplies: world.cancellationApplyCount(),
});

const expectNoTransactionWrites = (
  world: ReturnType<typeof createStructureRuntimeFixture>,
  before: ReturnType<typeof unchanged>,
) => {
  expect(unchanged(world)).toEqual(before);
  expect(world.runtime.takeCommits()).toEqual([]);
  expect(world.takeFactBatches()).toEqual([]);
};

describe('registered Structure hit validation', () => {
  it('accepts the Browser-06 exposed support face through the direct registered host', () => {
    const world = createStructureRuntimeFixture();
    world.server.edit(69, 30, 0, Voxel.Stone);
    world.server.edit(70, 30, 0, Voxel.Stone);
    world.server.edit(70, 31, 0, Voxel.Air);
    world.server.edit(70, 32, 0, Voxel.Air);
    world.entities.update('alice', { position: [67.35381531679855, 31.000001, 0.6452957045056721] });
    world.runtime.takeCommits();
    const before = {
      worldRevision: world.server.worldRevision,
      gameplayRevision: world.gameplayRevision(),
      inventoryRevision: world.actor.inventoryRevision,
      slots: world.actor.inventory.snapshot(),
      entities: world.entities.query(),
      removalApplies: world.removalApplyCount(),
      cancellationApplies: world.cancellationApplyCount(),
    };

    const result = placeStructure(world, [70, 30, 0], [70, 31, 0]);
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      value: { kind: 'place', definitionId: 'fixture:gate' },
    });
    expect(world.server.getVoxel(70, 31, 0)).not.toBe(Voxel.Air);
    expect(world.server.getVoxel(70, 32, 0)).not.toBe(Voxel.Air);
    expect(world.server.worldRevision).toBe(before.worldRevision + 1);
    expect(world.gameplayRevision()).toBe(before.gameplayRevision + 1);
    expect(world.actor.inventoryRevision).toBe(before.inventoryRevision + 1);
    expect(world.actor.inventory.slot(0)).toEqual({ itemId: 'gate', count: 1 });
    expect(world.removalApplyCount()).toBe(before.removalApplies);
    expect(world.cancellationApplyCount()).toBe(before.cancellationApplies + 1);
    expect(world.runtime.takeCommits()).toHaveLength(1);
    expect(world.takeFactBatches()).toHaveLength(1);
  });

  it('rechecks the exposed face at final validation and rejects a new wall without owner writes', () => {
    const overrides = new Map<string, Readonly<{ voxel: number; fluid: number }>>();
    const world = createStructureRuntimeFixture({
      cellOverrides: overrides,
      beforeWorldPrepare() {
        overrides.set('1,31,1', { voxel: Voxel.Stone, fluid: 0 });
      },
    });
    world.runtime.takeCommits();
    const before = unchanged(world);

    const result = placeStructure(world);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: false, message: 'blocked' });

    expectNoTransactionWrites(world, before);
  });

  it.each([
    ['air', { voxel: Voxel.Air, fluid: 0 }, /targetable/i],
    ['loaded non-targetable', { voxel: Voxel.Glass, fluid: 0 }, /targetable/i],
    ['unregistered semantics', { voxel: 4_095, fluid: 0 }, /targetable/i],
  ] as const)('rejects a directly registered place on %s before any owner writes', (_label, cell, message) => {
    const overrides = new Map([[key, cell]]);
    const world = createStructureRuntimeFixture({ cellOverrides: overrides });
    const before = unchanged(world);

    expect(placeStructure(world, hit, adjacent)).toMatchObject({ ok: false, message: expect.stringMatching(message) });

    expectNoTransactionWrites(world, before);
  });

  it('rejects an unknown hit before any owner writes', () => {
    const world = createStructureRuntimeFixture({ unavailablePositions: new Set([key]) });
    const before = unchanged(world);

    expect(placeStructure(world, hit, adjacent)).toMatchObject({ ok: false, message: 'chunk-unavailable' });

    expectNoTransactionWrites(world, before);
  });

  it('accepts a loaded targetable hit through the direct registered operation', () => {
    const world = createStructureRuntimeFixture({
      cellOverrides: new Map([[key, { voxel: Voxel.Stone, fluid: 0 }]]),
    });

    expect(placeStructure(world, hit, adjacent)).toMatchObject({ ok: true, value: { kind: 'place' } });
    expect(world.server.getVoxel(...adjacent)).not.toBe(Voxel.Air);
    expect(world.runtime.takeCommits()).toHaveLength(1);
    expect(world.takeFactBatches()).toHaveLength(1);
  });

  it.each(['air', 'unavailable'] as const)(
    'rejects a hit that becomes %s at the final validation barrier without transaction writes',
    (fault) => {
      const overrides = new Map<string, Readonly<{ voxel: number; fluid: number }>>([
        [key, { voxel: Voxel.Stone, fluid: 0 }],
      ]);
      const unavailable = new Set<string>();
      const world = createStructureRuntimeFixture({
        cellOverrides: overrides,
        unavailablePositions: unavailable,
        beforeWorldPrepare() {
          if (fault === 'air') overrides.set(key, { voxel: Voxel.Air, fluid: 0 });
          else unavailable.add(key);
        },
      });
      const before = unchanged(world);

      expect(placeStructure(world, hit, adjacent)).toMatchObject({
        ok: false,
        message: fault === 'air' ? expect.stringMatching(/targetable/i) : 'chunk-unavailable',
      });

      expectNoTransactionWrites(world, before);
    },
  );
});
