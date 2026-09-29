import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import { createGameplayActorAuthority } from '../../src/server/composition/gameplay-actor-authority';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import {
  MEDIA_ACTIVATE_OPERATION,
  MEDIA_INSERT_OPERATION,
  defineMediaPlaybackModuleV1,
} from '../../src/server/gameplay/modules/media-playback-module';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenProvider } from '../support/worldgen';
import { CHUNK_SIZE, mod, voxelIndex } from '../../src/world/voxel';

const DEVICE = 500;
const POSITION = [1, 34, 0] as const;
const mediaWorldgenProvider = Object.freeze({
  identity: testWorldgenProvider,
  generate: ({
    coordinate,
    generatorVersion,
    epoch,
    revision,
  }: Parameters<import('@seedlands/kernel/spatial').KernelWorldgenProvider['generate']>[0]) => ({
    coordinate,
    provider: testWorldgenProvider,
    generatorVersion,
    epoch,
    revision,
    voxels: new Uint16Array(32 ** 3),
  }),
  sampleVoxel: () => 0,
});

function mediaComposition(
  playOnInsert = false,
  resource: Readonly<{ packId: string; path: string }> = {
    packId: 'fixture:media-world',
    path: 'assets/audio/track.mp3',
  },
) {
  const content = defineContentModule({
    moduleId: 'fixture:media-content',
    items: [{ id: 'fixture:disc', storageId: 'disc', name: 'Disc', stackLimit: 1 }],
    recipes: [],
    voxels: [
      {
        id: 'fixture:air',
        storageId: 0,
        solid: false,
        targetable: false,
        renderable: false,
        meshKind: 'cube',
        emission: 0,
        lightCost: 1,
        faceMaterials: [1, 1, 1, 1, 1, 1],
      },
      {
        id: 'fixture:jukebox',
        storageId: DEVICE,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 1,
        faceMaterials: [1, 1, 1, 1, 1, 1],
      },
    ],
    meleeDefinitions: [],
  });
  const media = defineMediaPlaybackModuleV1({
    moduleId: 'fixture:media',
    definition: {
      version: 1,
      tracks: [{ id: 'fixture:track', resource }],
      devices: [
        {
          id: 'fixture:jukebox',
          target: { kind: 'voxel', voxelId: 'fixture:jukebox' },
          tracks: [{ itemId: 'fixture:disc', trackId: 'fixture:track' }],
          ...(playOnInsert ? { playOnInsert: true as const } : {}),
        },
      ],
    },
  });
  const pack = definePack({
    id: 'fixture:media-world',
    version: '1.0.0',
    kind: 'playbook',
    modules: [content, media],
    resources: ['assets/audio/track.mp3'],
  });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: {
          algorithm: 'sha256',
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [{ path: 'assets/audio/track.mp3', digest: 'c'.repeat(64) }],
        },
      },
    ],
    { approvedPermissions: { 'fixture:media-world': media.descriptor.permissions! } },
  );
  return composition;
}

describe('Authority media committed-fact drain', () => {
  const selection = (runtime: AuthorityRuntime) => {
    const player = runtime.server.getPlayerState(runtime.playerId);
    const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
    return {
      inventoryRevision: inventory.revision,
      modeRevision: player.mode?.revision ?? 0,
      creativeCatalogRevision: player.creativeCatalog?.revision ?? 0,
      selectedSlot: player.selectedSlot,
    };
  };

  it('drains only committed facts from the composed runtime and keeps projections independent', async () => {
    const composition = mediaComposition();
    const runtime = await AuthorityRuntime.create({
      composition,
      moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'player' }),
      platform: testCorePlatform,
      worldgenProvider: mediaWorldgenProvider,
      epoch: 'outer-session',
      seedText: 'media-fact-drain',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [1.5, 33, 2.5],
    });
    runtime.server.edit(POSITION[0], POSITION[1], POSITION[2], DEVICE);
    runtime.server.giveItem(runtime.playerId, { itemId: 'disc', count: 1 });

    const operation = await runtime.performAction({
      type: 'interact',
      intent: 'use',
      target: { kind: 'voxel', hit: POSITION, adjacent: [1, 34, 1] },
      expectedSelection: selection(runtime),
    });
    expect(operation.result).toMatchObject({ success: true, value: { kind: 'insert', playing: false } });
    expect(runtime.view().media).toMatchObject([
      { device: { position: POSITION, definitionId: 'fixture:jukebox' }, revision: 1 },
    ]);

    const drained = runtime.takeMediaFacts('runtime-world:2');
    expect(drained).toMatchObject([
      {
        version: 1,
        worldEpoch: 'runtime-world:2',
        facts: [
          {
            kind: 'insert',
            device: { position: POSITION, definitionId: 'fixture:jukebox' },
            revision: 1,
          },
        ],
      },
    ]);
    expect(runtime.takeMediaFacts('runtime-world:2')).toEqual([]);
    expect(runtime.view().media).toHaveLength(1);
  });

  it.each([
    ['unknown pack', { packId: 'fixture:missing', path: 'assets/audio/track.mp3' }],
    ['unlocked path', { packId: 'fixture:media-world', path: 'assets/audio/missing.mp3' }],
  ])('rejects a Media track with %s before creating the Authority runtime', async (_case, resource) => {
    const composition = mediaComposition(false, resource);
    await expect(
      AuthorityRuntime.create({
        composition,
        moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'player' }),
        platform: testCorePlatform,
        worldgenProvider: mediaWorldgenProvider,
        epoch: 'invalid-media-resource',
        seedText: 'invalid-media-resource',
        initialWorldTime: 9,
        startTimeMs: 0,
        initialPlayerBodyPosition: [1.5, 33, 2.5],
      }),
    ).rejects.toThrow(/Pack lock/i);
  });

  it('derives play-on-insert from the device policy and commits it through one Authority interact', async () => {
    const composition = mediaComposition(true);
    const runtime = await AuthorityRuntime.create({
      composition,
      moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'player' }),
      platform: testCorePlatform,
      worldgenProvider: mediaWorldgenProvider,
      epoch: 'media-interact',
      seedText: 'media-interact',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [1.5, 33, 2.5],
    });
    runtime.server.edit(POSITION[0], POSITION[1], POSITION[2], DEVICE);
    runtime.server.giveItem(runtime.playerId, { itemId: 'disc', count: 1 });

    const result = await runtime.performAction({
      type: 'interact',
      intent: 'use',
      target: { kind: 'voxel', hit: POSITION, adjacent: [1, 34, 1] },
      expectedSelection: selection(runtime),
    });

    expect(result.result).toMatchObject({ success: true, handled: true, value: { kind: 'insert-and-activate' } });
    expect(result.gameplay.media).toMatchObject([{ revision: 1, playing: true, resumePending: false }]);
    expect(runtime.server.getInventory(runtime.playerId).slots.filter(Boolean)).toEqual([]);
    expect(runtime.takeMediaFacts('media-world')).toMatchObject([
      { facts: [{ kind: 'insert-and-activate', revision: 1, playing: true }] },
    ]);
    expect(runtime.takeMediaFacts('media-world')).toEqual([]);
  });

  it('restores playing intent as a resource-bearing projection without replaying committed facts', async () => {
    const composition = mediaComposition();
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const options = {
      composition,
      moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'player' }),
      platform: testCorePlatform,
      worldgenProvider: mediaWorldgenProvider,
      seedText: 'media-restore',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [1.5, 33, 2.5] as [number, number, number],
      persistence,
    };
    const first = await AuthorityRuntime.create({ ...options, epoch: 'first-session' });
    first.server.edit(POSITION[0], POSITION[1], POSITION[2], DEVICE);
    first.server.giveItem(first.playerId, { itemId: 'disc', count: 1 });
    expect(
      first.server.invokeActorModuleOperation(first.playerId, {
        operationId: MEDIA_INSERT_OPERATION,
        target: { kind: 'voxel', position: POSITION },
        input: { expectedRevision: 0, itemId: 'fixture:disc' },
      }),
    ).toMatchObject({ ok: true });
    expect(
      first.server.invokeActorModuleOperation(first.playerId, {
        operationId: MEDIA_ACTIVATE_OPERATION,
        target: { kind: 'voxel', position: POSITION },
        input: { expectedRevision: 1 },
      }),
    ).toMatchObject({ ok: true });
    expect(first.takeMediaFacts('first-world')).toHaveLength(2);
    await first.save();

    const restored = await AuthorityRuntime.create({ ...options, epoch: 'second-session' });
    expect(restored.ready().gameplay.media).toEqual([
      {
        version: 1,
        device: { kind: 'voxel', position: POSITION, definitionId: 'fixture:jukebox' },
        revision: 2,
        slot: { itemId: 'fixture:disc', trackId: 'fixture:track' },
        resource: { packId: 'fixture:media-world', path: 'assets/audio/track.mp3' },
        playing: false,
        resumePending: true,
      },
    ]);
    expect(restored.takeMediaFacts('second-world')).toEqual([]);
  });

  it('rejects a persisted media device mismatch before replacing the live world', async () => {
    const composition = mediaComposition(true);
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const runtime = await AuthorityRuntime.create({
      composition,
      moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'player' }),
      platform: testCorePlatform,
      worldgenProvider: mediaWorldgenProvider,
      persistence,
      epoch: 'media-atomic-restore',
      seedText: 'media-atomic-restore',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [1.5, 33, 2.5],
    });
    runtime.server.edit(POSITION[0], POSITION[1], POSITION[2], DEVICE);
    runtime.server.giveItem(runtime.playerId, { itemId: 'disc', count: 1 });
    await runtime.performAction({
      type: 'interact',
      intent: 'use',
      target: { kind: 'voxel', hit: POSITION, adjacent: [1, 34, 1] },
      expectedSelection: selection(runtime),
    });
    runtime.takeMediaFacts('live-world');
    const before = structuredClone(runtime.ready().gameplay);
    const corrupted = structuredClone(runtime.exportPortableCheckpoint());
    const chunk = corrupted.chunks.find(({ key }) => key === '0,1,0')!;
    chunk.voxels[voxelIndex(mod(POSITION[0], CHUNK_SIZE), mod(POSITION[1], CHUNK_SIZE), mod(POSITION[2], CHUNK_SIZE))] =
      0;
    persistence.saveFrozenSnapshot(corrupted);

    await expect(runtime.server.restore()).rejects.toThrow(/media-device-stale/i);
    expect(runtime.server.getVoxel(...POSITION)).toBe(DEVICE);
    expect(runtime.ready().gameplay).toEqual(before);
    expect(runtime.takeMediaFacts('live-world')).toEqual([]);
  });
});
