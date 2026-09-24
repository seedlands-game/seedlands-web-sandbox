import { describe, expect, it } from 'vitest';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { defineMediaPlaybackModelV1 } from '../../src/server/gameplay/modules/media-playback-model';
import { RegisteredMediaPlaybackRuntime } from '../../src/server/gameplay/modules/registered-media-playback-runtime';
import { MEDIA_INSERT_OPERATION } from '../../src/server/gameplay/modules/media-playback-module';
import {
  first as registeredFirst,
  fixture as registeredFixture,
  prepare as prepareRegistered,
} from './registered-media-playback-runtime-fixture';

const model = defineMediaPlaybackModelV1({
  version: 1,
  tracks: [{ id: 'sample:track', resource: { packId: 'sample:pack', path: 'assets/audio/track.mp3' } }],
  devices: [
    {
      id: 'sample:device',
      target: { kind: 'voxel', voxelId: 'sample:device-block' },
      tracks: [{ itemId: 'sample:disc', trackId: 'sample:track' }],
    },
  ],
});
const items = createItemDefinitionRegistry([
  { id: 'disc', name: 'Disc', itemType: 'resource', stackLimit: 1, capabilities: [] },
]);
const first = [1, 2, 3] as const;
const second = [4, 5, 6] as const;
const nonDevice = [10, 11, 12] as const;

function fixture() {
  const voxels = new Map([
    [first.join(','), 'sample:device-block'],
    [second.join(','), 'sample:device-block'],
    [nonDevice.join(','), 'sample:stone'],
  ]);
  const runtime = new RegisteredMediaPlaybackRuntime({
    model,
    items,
    getVoxelId: (position) => voxels.get(position.join(',')),
    readActor: () => {
      throw new Error('actor port is not used by dependent removal');
    },
    resolveItemStorageId: () => undefined,
    prepareInventory: () => {
      throw new Error('inventory port is not used by dependent removal');
    },
    assertActorAuthorized: () => undefined,
    assertTargetReachable: () => undefined,
    worldRevision: () => 0,
    prepareGameplayChange: () => {
      throw new Error('gameplay port is not used by dependent removal');
    },
  });
  const occupy = (positions: readonly (readonly [number, number, number])[], revision = 1) => {
    const candidate = runtime.prepareCheckpointCandidate({
      version: 1,
      devices: positions.map((position) => ({
        position,
        snapshot: {
          version: 1,
          deviceId: 'sample:device',
          revision,
          slot: { itemId: 'sample:disc', trackId: 'sample:track' },
          playingIntent: true,
        },
      })),
    });
    candidate.validate();
    candidate.apply();
  };
  return { runtime, voxels, occupy };
}

describe('media dependent removal', () => {
  it('returns an explicit non-owner only for a loaded non-device without residual state', () => {
    const world = fixture();
    const removal = world.runtime.prepareDependentRemoval(nonDevice);

    expect(removal).toMatchObject({ removed: false, ejectedItem: null, fact: null });
    expect(Object.isFrozen(removal)).toBe(true);
    expect(() => removal.apply()).toThrow(/validation/i);
    removal.validate();
    removal.apply();
    expect(() => removal.apply()).toThrow(/validation|stale/i);
    expect(() => world.runtime.prepareDependentRemoval([20, 21, 22])).toThrow(/unavailable/i);
    expect(() => world.runtime.prepareDeviceRemoval(nonDevice)).toThrow(/unsupported/i);

    const generationStale = world.runtime.prepareDependentRemoval(nonDevice);
    world.occupy([first]);
    expect(() => generationStale.validate()).toThrow(/stale/i);
  });

  it('rejects orphaned state and a non-device whose voxel identity changes before validation', () => {
    const orphaned = fixture();
    orphaned.occupy([first]);
    orphaned.voxels.set(first.join(','), 'sample:stone');
    expect(() => orphaned.runtime.prepareDependentRemoval(first)).toThrow(/orphan/i);
    orphaned.voxels.set(first.join(','), 'sample:device-block');
    expect(orphaned.runtime.checkpoint().devices).toHaveLength(1);

    const changed = fixture();
    const removal = changed.runtime.prepareDependentRemoval(nonDevice);
    changed.voxels.set(nonDevice.join(','), 'sample:device-block');
    expect(() => removal.validate()).toThrow(/stale/i);
    expect(changed.runtime.checkpoint()).toEqual({ version: 1, devices: [] });
  });

  it('removes two occupied devices after one validate-all barrier with exact detached outputs', () => {
    const world = fixture();
    world.occupy([first, second]);
    const removals = [first, second].map((at) => world.runtime.prepareDependentRemoval(at));

    expect(removals.map(({ removed, ejectedItem, fact }) => ({ removed, ejectedItem, fact }))).toEqual(
      [first, second].map((position) => ({
        removed: true,
        ejectedItem: { itemId: 'sample:disc', trackId: 'sample:track' },
        fact: {
          version: 1,
          kind: 'eject',
          device: { kind: 'voxel', position, definitionId: 'sample:device' },
          revision: 2,
          previousTrackId: 'sample:track',
          trackId: null,
          resource: null,
          playing: false,
          resumePending: false,
          ejectedItemId: 'sample:disc',
        },
      })),
    );
    for (const removal of removals) {
      expect(Object.isFrozen(removal.ejectedItem)).toBe(true);
      expect(Object.isFrozen(removal.fact)).toBe(true);
      removal.validate();
    }
    for (const removal of removals) removal.apply();

    expect(world.runtime.checkpoint()).toEqual({ version: 1, devices: [] });
    expect(world.runtime.read(first)).toMatchObject({ revision: 2, slot: null });
    expect(world.runtime.read(second)).toMatchObject({ revision: 2, slot: null });

    const rebuilt = world.runtime.prepareCheckpointCandidate({
      version: 1,
      devices: [
        {
          position: first,
          snapshot: {
            version: 1,
            deviceId: 'sample:device',
            revision: 3,
            slot: { itemId: 'sample:disc', trackId: 'sample:track' },
            playingIntent: true,
          },
        },
      ],
    });
    rebuilt.validate();
    rebuilt.apply();
    expect(world.runtime.read(first)).toMatchObject({ revision: 3, slot: { itemId: 'sample:disc' } });
  });

  it('keeps both devices when the second removal fails the validate-all barrier', () => {
    const world = fixture();
    world.occupy([first, second]);
    const removals = [first, second].map((at) => world.runtime.prepareDependentRemoval(at));
    world.voxels.set(second.join(','), 'sample:stone');

    removals[0]!.validate();
    expect(() => removals[1]!.validate()).toThrow(/device|stale/i);

    world.voxels.set(second.join(','), 'sample:device-block');
    expect(world.runtime.checkpoint().devices).toHaveLength(2);
    expect(world.runtime.read(first)).toMatchObject({ revision: 1, slot: { itemId: 'sample:disc' } });
    expect(world.runtime.read(second)).toMatchObject({ revision: 1, slot: { itemId: 'sample:disc' } });
  });

  it('uses one safe generation for two removals prepared from the same near-limit checkpoint', () => {
    const world = fixture();
    const restoredRevision = Number.MAX_SAFE_INTEGER - 1;
    world.occupy([first, second], restoredRevision);
    const beforeFailedPrepare = world.runtime.checkpoint();
    expect(() => world.runtime.prepareDeviceRemoval(nonDevice)).toThrow(/unsupported/i);
    expect(world.runtime.checkpoint()).toEqual(beforeFailedPrepare);
    const removals = [first, second].map((at) => world.runtime.prepareDependentRemoval(at));

    for (const removal of removals) removal.validate();
    for (const removal of removals) removal.apply();

    expect(world.runtime.checkpoint()).toEqual({ version: 1, devices: [] });
    for (const position of [first, second]) {
      const empty = world.runtime.read(position);
      expect(empty.revision).toBe(Number.MAX_SAFE_INTEGER);
      expect(Number.isSafeInteger(empty.revision)).toBe(true);
      expect(empty.slot).toBeNull();
    }
    expect(() => world.runtime.prepareDeviceRemoval(first)).toThrow(/exhausted/i);
  });

  it('keeps a rebuilt device revision strictly above its removed instance', () => {
    const world = registeredFixture({ mode: 'creative' });
    const inserted = prepareRegistered(world, MEDIA_INSERT_OPERATION, registeredFirst, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    inserted.validate();
    inserted.apply();
    const removal = world.runtime.prepareDeviceRemoval(registeredFirst);
    removal.validate();
    removal.apply();
    const removedRevision = world.runtime.read(registeredFirst).revision;
    const rebuilt = prepareRegistered(world, MEDIA_INSERT_OPERATION, registeredFirst, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    rebuilt.validate();
    rebuilt.apply();

    expect(removedRevision).toBe(2);
    expect(world.runtime.read(registeredFirst)).toMatchObject({
      revision: 3,
      slot: { itemId: 'sample:first-disc' },
    });
  });
});
