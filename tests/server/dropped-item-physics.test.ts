import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { ItemIds } from '../../src/server/gameplay/item-registry';
import { Voxel } from '../../src/world/voxel';
import type { WorldCommitResult } from '../../src/server/game-server';

type Position = [number, number, number];

const commit = (): WorldCommitResult => ({
  committed: false,
  worldRevision: 0,
  structuralChange: null,
  semanticEvents: [],
  metrics: {
    timingStatus: 'not-collected-hot-path',
    inputMutationCount: 0,
    canonicalWriteCount: 0,
    dirtyChunkCount: 0,
    meshInvalidationCount: 0,
    structuralEventCount: 0,
    semanticEventCount: 0,
    mutationPayloadBytes: 0,
    mutationCapacityBytes: 0,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});

const createRuntime = (solid: Set<string>) =>
  new GameplayRuntime({
    getVoxel: ([x, y, z]) => (solid.has(`${x},${y},${z}`) ? Voxel.Stone : Voxel.Air),
    editVoxel: () => commit(),
    getWorldTime: () => 12,
  });
const key = (position: Position) => position.join(',');
const floor = (x: number, z: number, y = 0): Position => [x, y, z];

describe('dropped item server physics', () => {
  it('a standing player attracts a ground item from eye-height offset without walking onto it', () => {
    const runtime = createRuntime(new Set([key(floor(0, 0)), key(floor(1, 0)), key(floor(2, 0))]));
    runtime.spawnPlayer({ id: 'standing', position: [0.5, 2.6, 0.5] });
    const item = runtime.spawnWorldItem([2, 1.2, 0.5], { itemId: ItemIds.Berry, count: 1 });
    const result = runtime.advance(2);
    expect(runtime.getEntity(item.id)).toBeNull();
    expect(result.pickups).toHaveLength(1);
  });
  it('falls under server gravity, lands on solid voxels, and falls again when support is removed', () => {
    const solid = new Set([key(floor(0, 0))]);
    const runtime = createRuntime(solid);
    const item = runtime.spawnWorldItem([0.5, 4, 0.5], { itemId: ItemIds.WoodBlock, count: 1 });

    runtime.advance(1);
    expect(runtime.getEntity(item.id)?.position[1]).toBeCloseTo(1.2, 5);
    expect(runtime.getEntity(item.id)?.physicsVelocity).toEqual([0, 0, 0]);

    solid.delete(key(floor(0, 0)));
    runtime.advance(0.5);
    expect(runtime.getEntity(item.id)?.position[1]).toBeLessThan(1.1);
  });

  it('attracts exactly once only when an alive player has a clear path and inventory capacity', () => {
    const runtime = createRuntime(new Set([key(floor(0, 0)), key(floor(1, 0)), key(floor(2, 0))]));
    runtime.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    const item = runtime.spawnWorldItem([2.5, 1.2, 0.5], { itemId: ItemIds.Berry, count: 1 });

    const first = runtime.advance(1);
    expect(first.pickups).toEqual([
      expect.objectContaining({ playerId: 'player', stack: { itemId: ItemIds.Berry, count: 1 } }),
    ]);
    expect(runtime.getEntity(item.id)).toBeNull();
    expect(runtime.getInventory('player').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 1 });
    expect(runtime.advance(1).pickups).toEqual([]);
  });

  it('does not pull through a solid wall, consume a full inventory, or consume for a dead player', () => {
    const wall = new Set([key(floor(1, 0, 1)), key(floor(0, 0))]);
    const runtime = createRuntime(wall);
    runtime.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    const blocked = runtime.spawnWorldItem([2.5, 1.2, 0.5], { itemId: ItemIds.Berry, count: 1 });
    runtime.advance(2);
    expect(runtime.getEntity(blocked.id)).not.toBeNull();

    const full = createRuntime(new Set([key(floor(0, 0))]));
    full.spawnPlayer({ id: 'full', position: [0.5, 1, 0.5] });
    for (let index = 0; index < 24; index += 1)
      expect(full.giveItem('full', { itemId: ItemIds.Berry, count: 64 }).success).toBe(true);
    const retained = full.spawnWorldItem([0.7, 1.2, 0.5], { itemId: ItemIds.WoodBlock, count: 1 });
    full.advance(1);
    expect(full.getEntity(retained.id)).not.toBeNull();

    full.applyDamage('test', 'full', 20, 'test');
    full.advance(1);
    expect(full.getEntity(retained.id)).not.toBeNull();
  });

  it('uses fixed steps across partitions, persists velocity, and grounds unsupported autonomous entities', () => {
    const solid = new Set([key(floor(0, 0))]);
    const once = createRuntime(solid);
    const partitioned = createRuntime(solid);
    once.spawnWorldItem([0.5, 5, 0.5], { itemId: ItemIds.WoodBlock, count: 1 });
    partitioned.spawnWorldItem([0.5, 5, 0.5], { itemId: ItemIds.WoodBlock, count: 1 });
    once.advance(0.4);
    partitioned.advance(0.1);
    partitioned.advance(0.3);
    expect(partitioned.queryEntities({ type: 'world-item' })[0]).toMatchObject(
      once.queryEntities({ type: 'world-item' })[0]!,
    );

    const snapshot = once.createSnapshot();
    expect(snapshot.entities[0]?.physicsVelocity).toEqual(expect.any(Array));
    const restored = createRuntime(solid);
    restored.restoreSnapshot(snapshot);
    expect(restored.queryEntities({ type: 'world-item' })[0]).toMatchObject(
      once.queryEntities({ type: 'world-item' })[0]!,
    );

    const actor = once.spawn({ type: 'creature', position: [0.5, 5, 0.5], health: 12, maxHealth: 12 });
    once.advance(1);
    expect(once.getEntity(actor.id)?.position[1]).toBe(1);
  });
});
