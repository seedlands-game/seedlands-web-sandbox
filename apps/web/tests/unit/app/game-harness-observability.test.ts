import { describe, expect, it, vi } from 'vitest';
import { createVoxelGeometryRegistryV1, type MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';
import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import {
  createHarnessObservability,
  type HarnessObservabilityBindings,
} from '../../../src/app/gameplay/game-harness-observability';

const geometry = createVoxelGeometryRegistryV1([
  {
    version: 1,
    voxel: 89,
    boxes: [{ min: [0, 0, 0], max: [1, 1, 0.1875], material: 14 }],
    collision: [{ min: [0, 0, 0], max: [1, 1, 0.1875] }],
    occludesFullFace: false,
  },
]);
const projection: MediaPlaybackProjectionV1 = {
  version: 1,
  device: { kind: 'voxel', position: [1, 2, 3], definitionId: 'sample:jukebox' },
  revision: 2,
  slot: { itemId: 'sample:record', trackId: 'sample:track' },
  resource: { packId: 'sample:pack', path: 'audio/track.mp3' },
  playing: true,
  resumePending: false,
};
const batch: MediaPlaybackCommittedBatchV1 = {
  version: 1,
  worldEpoch: 'world:2',
  worldRevision: 3,
  gameplayRevision: 4,
  facts: [
    {
      version: 1,
      kind: 'activate',
      device: projection.device,
      revision: 2,
      previousTrackId: projection.slot!.trackId,
      trackId: projection.slot!.trackId,
      resource: projection.resource,
      playing: true,
      resumePending: false,
    },
  ],
};

const gameplayView = (
  options: Readonly<{ health?: number; firstItemId?: string; armorPoints?: number | null }> = {},
): AuthorityGameplayView => ({
  gameplayRevision: 11,
  gameplayTime: 7,
  player: {
    entityId: 'player-1',
    spawnPosition: [0, 2, 0],
    health: options.health ?? 17,
    maxHealth: 20,
    hunger: 14,
    maxHunger: 20,
    lifecycle: 'alive',
    inventory: [],
    selectedSlot: 0,
    hotbarSize: 9,
    attackCooldownSeconds: 0,
    hungerAccumulator: 0,
    healingAccumulator: 0,
    starvationAccumulator: 0,
    breakAction: null,
  },
  entities: [],
  actors: [],
  inventory: {
    version: 1,
    actor: { entityId: 'player-1', epoch: 2, lifetime: 7 },
    revision: 13,
    slots: [{ itemId: options.firstItemId ?? 'sample:pickaxe', count: 1, instance: { durability: 8 } }, null],
    hotbarSize: 2,
    armor: {
      helmet: { itemId: 'sample:helmet', count: 1, instance: { durability: 4 } },
      chestplate: { itemId: 'sample:chestplate', count: 1, instance: { durability: 9 } },
      leggings: { itemId: 'sample:leggings', count: 1, instance: { durability: 7 } },
      boots: { itemId: 'sample:boots', count: 1, instance: { durability: 3 } },
    },
    cursor: {
      version: 1,
      revision: 5,
      stack: { itemId: 'sample:cursor', count: 1, instance: { durability: 2 } },
      origin: {
        kind: 'station',
        reference: { entityId: 'bench-1', epoch: 2, lifetime: 9 },
        slot: 3,
      },
      craftingGrid: [{ itemId: 'sample:craft', count: 1, instance: { durability: 6 } }, null, null, null],
    },
    matchedCraftingRecipeIds: [],
  },
  craftableRecipeIds: [],
  ...(options.armorPoints === null ? {} : { armorPoints: options.armorPoints ?? 17 }),
  metrics: {
    entityCount: 1,
    worldItemCount: 0,
    creatureCount: 0,
    npcCount: 0,
    nearbyVisitedBucketCount: 0,
    nearbyCandidateCount: 0,
    nearbyReturnedCount: 0,
    inventoryOperationCount: 0,
    gameplayEventCount: 0,
    snapshotBytes: 0,
    retainedActorCount: 0,
    activeActorCount: 0,
    behaviorEvaluationCount: 0,
    navigationPlanCount: 0,
    navigationExpandedNodeCount: 0,
    pathRecomputeCount: 0,
    actionCompletionCount: 0,
    actionFailureCount: 0,
    actionInterruptionCount: 0,
    perceptionLineOfSightCheckCount: 0,
    simulationTime: 0,
  },
});

const bindings = () => {
  let authorityEpoch = 'world:2';
  let authorityReady = true;
  let authorityGameplay = gameplayView();
  let authorityValue: NonNullable<ReturnType<HarnessObservabilityBindings['authority']>> | null;
  let renderedWorldEpoch: string | null = 'world:2';
  let authorityGeometry = geometry;
  const authority = {
    get isReady() {
      return authorityReady;
    },
    get gameplay() {
      return authorityGameplay;
    },
    get voxelGeometry() {
      return authorityGeometry;
    },
    get runtimeEpoch() {
      return authorityEpoch;
    },
  };
  authorityValue = authority;
  const rendered = {
    chunkKey: '0,0,0',
    chunkRevision: 7,
    material: 14,
    vertexCount: 4,
    indexCount: 6,
    min: [1, 2, 3],
    max: [2, 3, 4],
  } as const;
  let renderedSummary: typeof rendered | null = rendered;
  return {
    developerWorld: () => ({}),
    authority: () => authorityValue,
    world: () => null,
    renderedMaterialMesh: vi.fn(() => renderedSummary),
    renderedWorldEpoch: () => renderedWorldEpoch,
    media: () => ({ worldEpoch: 'world:2', projections: [projection], lastForwardedBatch: batch }),
    audio: () => ({
      epoch: 'world:2',
      instances: [{ key: 'sample:jukebox@1,2,3', phase: 'playing', revision: 2 }],
      error: null,
    }),
    setAuthorityEpoch: (value: string) => (authorityEpoch = value),
    setAuthorityReady: (value: boolean) => (authorityReady = value),
    setAuthorityGameplay: (value: AuthorityGameplayView) => (authorityGameplay = value),
    setAuthority: (value: typeof authority | null) => (authorityValue = value),
    setAuthorityGeometry: (value: typeof geometry) => (authorityGeometry = value),
    setRenderedWorldEpoch: (value: string | null) => (renderedWorldEpoch = value),
    setRenderedSummary: (value: typeof rendered | null) => (renderedSummary = value),
  };
};

describe('BrowserProductHarness V1 read-only observability', () => {
  it('returns a detached frozen descriptor from the current Authority registry', () => {
    const current = bindings();
    const api = createHarnessObservability(current);
    const descriptor = api.getVoxelGeometry(89);

    expect(descriptor).toEqual(geometry.require(89));
    expect(descriptor).not.toBe(geometry.require(89));
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor?.boxes[0]?.min)).toBe(true);
    expect(api.getVoxelGeometry(1)).toBeNull();
    current.setAuthorityGeometry(
      createVoxelGeometryRegistryV1([
        {
          version: 1,
          voxel: 90,
          boxes: [{ min: [0, 0, 0], max: [1, 0.5, 1], material: 14 }],
          collision: [],
          occludesFullFace: false,
        },
      ]),
    );
    expect(api.getVoxelGeometry(89)).toBeNull();
    expect(api.getVoxelGeometry(90)?.voxel).toBe(90);
  });

  it('clones the current postrender material summary without treating it as writable state', () => {
    const current = bindings();
    const api = createHarnessObservability(current);
    const summary = api.getRenderedMaterialMesh(0, 0, 0, 14);
    const rendered = current.renderedMaterialMesh();

    expect(summary).toEqual({ ...rendered, worldEpoch: 'world:2' });
    expect(summary).not.toBe(rendered);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary?.min)).toBe(true);
  });

  it('keeps failed restore on the old mesh epoch and admits a successful restore only after new postrender', () => {
    const current = bindings();
    const api = createHarnessObservability(current);
    const rendered = current.renderedMaterialMesh();

    current.setAuthorityEpoch('world:3');
    expect(api.getRenderedMaterialMesh(0, 0, 0, 14)).toBeNull();
    current.setAuthorityEpoch('world:2');
    expect(api.getRenderedMaterialMesh(0, 0, 0, 14)?.worldEpoch).toBe('world:2');

    current.setAuthorityEpoch('world:3');
    current.setRenderedSummary(null);
    current.setRenderedWorldEpoch('world:3');
    expect(api.getRenderedMaterialMesh(0, 0, 0, 14)).toBeNull();
    current.setRenderedSummary(rendered);
    expect(api.getRenderedMaterialMesh(0, 0, 0, 14)?.worldEpoch).toBe('world:3');
  });

  it('keeps forwarded facts separate from the independently observed audio phase', () => {
    const current = bindings();
    const api = createHarnessObservability(current);
    const snapshot = api.mediaSnapshot();

    expect(snapshot).toMatchObject({
      worldEpoch: 'world:2',
      projection: [projection],
      lastForwardedBatch: batch,
      audio: { instances: [{ phase: 'playing' }] },
    });
    expect(snapshot.projection[0]).not.toBe(projection);
    expect(snapshot.lastForwardedBatch).not.toBe(batch);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.audio?.instances)).toBe(true);

    current.audio = () => ({ epoch: 'world:old', instances: [], error: null });
    expect(api.mediaSnapshot()).toMatchObject({
      worldEpoch: 'world:2',
      lastForwardedBatch: batch,
      audio: null,
    });
  });

  it('returns a detached recursively frozen equipment projection with all four slots and cursor origin', () => {
    const current = bindings();
    const api = createHarnessObservability(current);
    const source = current.authority()!.gameplay;
    const snapshot = api.equipmentSnapshot();

    expect(snapshot).toEqual({
      runtimeEpoch: 'world:2',
      gameplayRevision: 11,
      actor: { entityId: 'player-1', epoch: 2, lifetime: 7 },
      inventoryRevision: 13,
      slots: [{ itemId: 'sample:pickaxe', count: 1, instance: { durability: 8 } }, null],
      armor: {
        helmet: { itemId: 'sample:helmet', count: 1, instance: { durability: 4 } },
        chestplate: { itemId: 'sample:chestplate', count: 1, instance: { durability: 9 } },
        leggings: { itemId: 'sample:leggings', count: 1, instance: { durability: 7 } },
        boots: { itemId: 'sample:boots', count: 1, instance: { durability: 3 } },
      },
      cursor: {
        version: 1,
        revision: 5,
        stack: { itemId: 'sample:cursor', count: 1, instance: { durability: 2 } },
        origin: { kind: 'station', reference: { entityId: 'bench-1', epoch: 2, lifetime: 9 }, slot: 3 },
        craftingGrid: [{ itemId: 'sample:craft', count: 1, instance: { durability: 6 } }, null, null, null],
      },
      player: { health: 17, lifecycle: 'alive' },
      armorPoints: 17,
    });
    expect(snapshot?.actor).not.toBe(source.inventory.actor);
    expect(snapshot?.slots).not.toBe(source.inventory.slots);
    expect(snapshot?.slots[0]).not.toBe(source.inventory.slots[0]);
    expect(snapshot?.slots[0]?.instance).not.toBe(source.inventory.slots[0]?.instance);
    expect(snapshot?.armor).not.toBe(source.inventory.armor);
    expect(snapshot?.armor.helmet).not.toBe(source.inventory.armor.helmet);
    expect(snapshot?.armor.helmet?.instance).not.toBe(source.inventory.armor.helmet?.instance);
    expect(snapshot?.cursor).not.toBe(source.inventory.cursor);
    expect(snapshot?.cursor.stack).not.toBe(source.inventory.cursor.stack);
    expect(snapshot?.cursor.stack?.instance).not.toBe(source.inventory.cursor.stack?.instance);
    expect(snapshot?.cursor.origin).not.toBe(source.inventory.cursor.origin);
    if (snapshot?.cursor.origin?.kind === 'station' && source.inventory.cursor.origin?.kind === 'station')
      expect(snapshot.cursor.origin.reference).not.toBe(source.inventory.cursor.origin.reference);
    expect(snapshot?.cursor.craftingGrid[0]).not.toBe(source.inventory.cursor.craftingGrid[0]);
    expect(snapshot?.cursor.craftingGrid[0]?.instance).not.toBe(source.inventory.cursor.craftingGrid[0]?.instance);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.actor)).toBe(true);
    expect(Object.isFrozen(snapshot?.slots)).toBe(true);
    expect(Object.isFrozen(snapshot?.slots[0]?.instance)).toBe(true);
    expect(Object.isFrozen(snapshot?.armor)).toBe(true);
    expect(Object.values(snapshot?.armor ?? {}).every((slot) => !slot || Object.isFrozen(slot))).toBe(true);
    expect(Object.values(snapshot?.armor ?? {}).every((slot) => !slot || Object.isFrozen(slot.instance))).toBe(true);
    expect(Object.isFrozen(snapshot?.cursor)).toBe(true);
    expect(Object.isFrozen(snapshot?.cursor.stack)).toBe(true);
    expect(Object.isFrozen(snapshot?.cursor.stack?.instance)).toBe(true);
    expect(Object.isFrozen(snapshot?.cursor.origin)).toBe(true);
    expect(snapshot?.cursor.origin?.kind !== 'station' || Object.isFrozen(snapshot.cursor.origin.reference)).toBe(true);
    expect(Object.isFrozen(snapshot?.cursor.craftingGrid)).toBe(true);
    expect(snapshot?.cursor.craftingGrid.every((slot) => !slot || Object.isFrozen(slot))).toBe(true);
    expect(snapshot?.cursor.craftingGrid.every((slot) => !slot?.instance || Object.isFrozen(slot.instance))).toBe(true);
    expect(Object.isFrozen(snapshot?.player)).toBe(true);

    Object.assign(source.inventory.actor, { epoch: 99 });
    Object.assign(source.inventory.slots[0]!.instance!, { durability: 1 });
    Object.assign(source.inventory.armor.helmet!.instance!, { durability: 1 });
    Object.assign(source.inventory.cursor.origin!, { slot: 8 });
    Object.assign(source.inventory.cursor.craftingGrid[0]!.instance!, { durability: 1 });
    Object.assign(source.player, { health: 1 });
    expect(snapshot?.actor.epoch).toBe(2);
    expect(snapshot?.slots[0]?.instance?.durability).toBe(8);
    expect(snapshot?.armor.helmet?.instance?.durability).toBe(4);
    expect(snapshot?.cursor.origin).toMatchObject({ slot: 3 });
    expect(snapshot?.cursor.craftingGrid[0]?.instance?.durability).toBe(6);
    expect(snapshot?.player.health).toBe(17);
  });

  it('returns null when Authority is missing, not ready, or has no runtime epoch', () => {
    const current = bindings();
    const api = createHarnessObservability(current);
    current.setAuthority(null);
    expect(api.equipmentSnapshot()).toBeNull();

    let notReadyGameplayReads = 0;
    current.setAuthority({
      isReady: false,
      runtimeEpoch: 'world:2',
      voxelGeometry: geometry,
      get gameplay() {
        notReadyGameplayReads += 1;
        throw new Error('Authority gameplay view is not ready.');
      },
    });
    expect(api.equipmentSnapshot()).toBeNull();
    expect(notReadyGameplayReads).toBe(0);

    let emptyEpochGameplayReads = 0;
    current.setAuthority({
      isReady: true,
      runtimeEpoch: '',
      voxelGeometry: geometry,
      get gameplay() {
        emptyEpochGameplayReads += 1;
        throw new Error('An empty epoch must be rejected before gameplay is read.');
      },
    });
    expect(api.equipmentSnapshot()).toBeNull();
    expect(emptyEpochGameplayReads).toBe(0);
  });

  it('returns null when the client, epoch, or gameplay object changes during one observation', () => {
    const clientChanged = bindings();
    const firstClient = clientChanged.authority()!;
    const secondClient = bindings().authority()!;
    let clientReads = 0;
    expect(
      createHarnessObservability({
        ...clientChanged,
        authority: () => (++clientReads === 1 ? firstClient : secondClient),
      }).equipmentSnapshot(),
    ).toBeNull();
    expect(clientReads).toBe(2);

    const epochView = gameplayView();
    let epochReads = 0;
    const changingEpoch = {
      isReady: true,
      gameplay: epochView,
      voxelGeometry: geometry,
      get runtimeEpoch() {
        return ++epochReads === 1 ? 'world:2' : 'world:3';
      },
    };
    expect(
      createHarnessObservability({ ...bindings(), authority: () => changingEpoch }).equipmentSnapshot(),
    ).toBeNull();
    expect(epochReads).toBe(2);

    const firstGameplay = gameplayView();
    const secondGameplay = gameplayView({ health: 9 });
    let gameplayReads = 0;
    const changingGameplay = {
      isReady: true,
      runtimeEpoch: 'world:2',
      voxelGeometry: geometry,
      get gameplay() {
        return ++gameplayReads === 1 ? firstGameplay : secondGameplay;
      },
    };
    expect(
      createHarnessObservability({ ...bindings(), authority: () => changingGameplay }).equipmentSnapshot(),
    ).toBeNull();
    expect(gameplayReads).toBe(2);
  });

  it('returns current data after an epoch change without reusing an older snapshot', () => {
    const current = bindings();
    const api = createHarnessObservability(current);
    const first = api.equipmentSnapshot();
    const next = gameplayView({ health: 9, firstItemId: 'sample:new', armorPoints: null });
    current.setAuthorityEpoch('world:3');
    current.setAuthorityGameplay(next);
    const second = api.equipmentSnapshot();

    expect(first).toMatchObject({ runtimeEpoch: 'world:2', armorPoints: 17 });
    expect(second).toMatchObject({
      runtimeEpoch: 'world:3',
      slots: [{ itemId: 'sample:new', count: 1 }, null],
      player: { health: 9, lifecycle: 'alive' },
      armorPoints: null,
    });
    expect(second).not.toBe(first);
  });
});
