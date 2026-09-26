import { describe, expect, it } from 'vitest';
import {
  MediaPlaybackModelError,
  buildMediaPlaybackCandidateV1,
  createMediaPlaybackStateV1,
  defineMediaPlaybackModelV1,
  restoreMediaPlaybackStateV1,
  snapshotMediaPlaybackStateV1,
  type MediaPlaybackStateV1,
} from '../../src/server/gameplay/modules/media-playback-model';

const input = () => ({
  version: 1 as const,
  tracks: [
    { id: 'sample:shore', resource: { packId: 'sample:pack', path: './assets/audio/shore.mp3' } },
    { id: 'sample:orbit', resource: { packId: 'sample:pack', path: 'assets/audio/orbit.ogg' } },
  ],
  devices: [
    {
      id: 'sample:player',
      target: { kind: 'voxel' as const, voxelId: 'sample:player-block' },
      tracks: [
        { itemId: 'sample:disc-shore', trackId: 'sample:shore' },
        { itemId: 'sample:disc-orbit', trackId: 'sample:orbit' },
      ],
    },
  ],
});

const model = () => defineMediaPlaybackModelV1(input());
const candidate = (state: MediaPlaybackStateV1, action: unknown, expectedRevision = state.revision) =>
  buildMediaPlaybackCandidateV1({
    model: model(),
    device: { kind: 'voxel', position: [1, 2, 3], definitionId: state.deviceId },
    state,
    expectedRevision,
    action,
  });
const errorCode = (run: () => unknown, code: string) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(MediaPlaybackModelError);
    expect((error as MediaPlaybackModelError).code).toBe(code);
    return;
  }
  throw new Error(`Expected media playback failure: ${code}`);
};

describe('MediaPlaybackModelV1', () => {
  it('normalizes deterministic definitions into detached deeply frozen data', () => {
    const source = input();
    source.tracks.reverse();
    source.devices[0]!.tracks.reverse();
    const first = defineMediaPlaybackModelV1(source);
    const second = model();
    source.tracks[0]!.resource.path = 'assets/audio/changed.mp3';
    source.devices[0]!.target.voxelId = 'sample:changed-player-block';

    expect(first).toEqual(second);
    expect(first.tracks.map(({ id }) => id)).toEqual(['sample:orbit', 'sample:shore']);
    expect(first.devices[0]!.tracks.map(({ itemId }) => itemId)).toEqual(['sample:disc-orbit', 'sample:disc-shore']);
    expect(first.devices[0]!.target).toEqual({ kind: 'voxel', voxelId: 'sample:player-block' });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.tracks)).toBe(true);
    expect(Object.isFrozen(first.tracks[0])).toBe(true);
    expect(Object.isFrozen(first.tracks[0]!.resource)).toBe(true);
    expect(Object.isFrozen(first.devices)).toBe(true);
    expect(Object.isFrozen(first.devices[0])).toBe(true);
    expect(Object.isFrozen(first.devices[0]!.target)).toBe(true);
    expect(Object.isFrozen(first.devices[0]!.tracks)).toBe(true);
    expect(Object.isFrozen(first.devices[0]!.tracks[0])).toBe(true);
    expect(first.tracks.find(({ id }) => id === 'sample:orbit')?.resource).toEqual({
      packId: 'sample:pack',
      path: 'assets/audio/orbit.ogg',
    });
  });

  it('rejects invalid identities, unsafe resources, collisions, unknown tracks and capacity overflow', () => {
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        tracks: [{ id: 'shore', resource: { packId: 'sample:pack', path: 'shore.mp3' } }],
      }),
    ).toThrow(/track.*id/i);
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        tracks: [{ id: 'sample:shore', resource: { packId: 'wrong-pack', path: 'assets/audio/shore.mp3' } }],
      }),
    ).toThrow(/pack id/i);
    for (const path of ['/absolute.mp3', '../outside.mp3', 'assets/../outside.mp3'])
      expect(() =>
        defineMediaPlaybackModelV1({
          ...input(),
          tracks: [{ id: 'sample:shore', resource: { packId: 'sample:pack', path } }],
        }),
      ).toThrow(/resource/i);
    expect(() => defineMediaPlaybackModelV1({ ...input(), tracks: [input().tracks[0]!, input().tracks[0]!] })).toThrow(
      /duplicate.*track/i,
    );
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        devices: [
          {
            id: 'sample:player',
            target: { kind: 'voxel', voxelId: 'sample:player-block' },
            tracks: [
              { itemId: 'sample:disc', trackId: 'sample:shore' },
              { itemId: 'sample:disc', trackId: 'sample:orbit' },
            ],
          },
        ],
      }),
    ).toThrow(/duplicate.*item binding/i);
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        devices: [
          {
            id: 'sample:player',
            target: { kind: 'voxel', voxelId: 'sample:player-block' },
            tracks: [{ itemId: 'sample:disc', trackId: 'sample:missing' }],
          },
        ],
      }),
    ).toThrow(/unknown track/i);
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        tracks: Array.from({ length: 65 }, (_, index) => ({
          id: `sample:track-${index}`,
          resource: { packId: 'sample:pack', path: `assets/audio/${index}.mp3` },
        })),
      }),
    ).toThrow(/tracks.*invalid/i);
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        devices: Array.from({ length: 65 }, (_, index) => ({
          id: `sample:player-${index}`,
          target: { kind: 'voxel' as const, voxelId: `sample:player-block-${index}` },
          tracks: [{ itemId: `sample:disc-${index}`, trackId: 'sample:shore' }],
        })),
      }),
    ).toThrow(/devices.*invalid/i);
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        devices: [
          {
            id: 'sample:player',
            target: { kind: 'voxel', voxelId: 'sample:player-block' },
            tracks: Array.from({ length: 65 }, (_, index) => ({
              itemId: `sample:disc-${index}`,
              trackId: 'sample:shore',
            })),
          },
        ],
      }),
    ).toThrow(/device tracks.*invalid/i);
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        devices: [{ id: 'sample:missing-target', tracks: input().devices[0]!.tracks }] as never,
      }),
    ).toThrow(/shape/i);
    expect(() =>
      defineMediaPlaybackModelV1({
        ...input(),
        devices: [
          input().devices[0]!,
          {
            id: 'sample:duplicate-target',
            target: { kind: 'voxel', voxelId: 'sample:player-block' },
            tracks: [{ itemId: 'sample:other-disc', trackId: 'sample:shore' }],
          },
        ],
      }),
    ).toThrow(/duplicate.*target/i);
  });

  it('builds insert, activate, stop, switch and eject candidates without mutating prior states', () => {
    const empty = createMediaPlaybackStateV1(model(), 'sample:player');
    const inserted = candidate(empty, { kind: 'insert', itemId: 'sample:disc-shore' });
    expect(empty).toEqual({
      version: 1,
      deviceId: 'sample:player',
      revision: 0,
      slot: null,
      playing: false,
      resumePending: false,
    });
    expect(inserted).toMatchObject({
      state: { revision: 1, slot: { itemId: 'sample:disc-shore', trackId: 'sample:shore' }, playing: false },
      fact: {
        kind: 'insert',
        revision: 1,
        previousTrackId: null,
        trackId: 'sample:shore',
        resource: { packId: 'sample:pack', path: 'assets/audio/shore.mp3' },
        insertedItemId: 'sample:disc-shore',
      },
    });

    const activated = candidate(inserted.state, { kind: 'activate' });
    expect(activated.state).toMatchObject({ revision: 2, playing: true, resumePending: false });
    const stopped = candidate(activated.state, { kind: 'stop' });
    expect(stopped.state).toMatchObject({ revision: 3, playing: false, resumePending: false });

    const reactivated = candidate(stopped.state, { kind: 'activate' });
    const switched = candidate(reactivated.state, { kind: 'switch', itemId: 'sample:disc-orbit' });
    expect(switched).toMatchObject({
      state: {
        revision: 5,
        slot: { itemId: 'sample:disc-orbit', trackId: 'sample:orbit' },
        playing: true,
      },
      fact: {
        kind: 'switch',
        previousTrackId: 'sample:shore',
        trackId: 'sample:orbit',
        resource: { packId: 'sample:pack', path: 'assets/audio/orbit.ogg' },
        insertedItemId: 'sample:disc-orbit',
        ejectedItemId: 'sample:disc-shore',
      },
    });

    const ejected = candidate(switched.state, { kind: 'eject' });
    expect(ejected).toMatchObject({
      state: { revision: 6, slot: null, playing: false, resumePending: false },
      fact: {
        kind: 'eject',
        previousTrackId: 'sample:orbit',
        trackId: null,
        resource: null,
        ejectedItemId: 'sample:disc-orbit',
      },
    });
    expect(Object.isFrozen(ejected)).toBe(true);
    expect(Object.isFrozen(ejected.state)).toBe(true);
    expect(Object.isFrozen(ejected.fact)).toBe(true);
    expect(Object.isFrozen(inserted.fact.resource)).toBe(true);
  });

  it('rejects stale, unsupported, occupied, empty and no-op actions without changing the source state', () => {
    const empty = createMediaPlaybackStateV1(model(), 'sample:player');
    const before = JSON.stringify(empty);
    errorCode(() => candidate(empty, { kind: 'insert', itemId: 'sample:unsupported' }), 'unsupported-media');
    errorCode(() => candidate(empty, { kind: 'eject' }), 'empty-slot');
    errorCode(() => candidate(empty, { kind: 'activate' }), 'empty-slot');
    errorCode(() => candidate(empty, { kind: 'stop' }), 'empty-slot');
    errorCode(() => candidate(empty, { kind: 'switch', itemId: 'sample:disc-shore' }), 'empty-slot');
    errorCode(() => candidate(empty, { kind: 'unknown' }), 'invalid-action');
    errorCode(() => candidate(empty, { kind: 'insert', itemId: 'sample:disc-shore' }, 1), 'stale-revision');
    expect(JSON.stringify(empty)).toBe(before);

    const inserted = candidate(empty, { kind: 'insert', itemId: 'sample:disc-shore' }).state;
    errorCode(() => candidate(inserted, { kind: 'insert', itemId: 'sample:disc-orbit' }), 'slot-occupied');
    errorCode(() => candidate(inserted, { kind: 'stop' }), 'already-stopped');
    errorCode(() => candidate(inserted, { kind: 'switch', itemId: 'sample:disc-shore' }), 'same-media');
    const active = candidate(inserted, { kind: 'activate' }).state;
    errorCode(() => candidate(active, { kind: 'activate' }), 'already-playing');
    expect(inserted.revision).toBe(1);
    expect(active.revision).toBe(2);
  });

  it('restores a missing legacy child as empty and converts playing intent into resumePending', () => {
    const definition = model();
    expect(restoreMediaPlaybackStateV1(definition, 'sample:player', undefined)).toEqual({
      version: 1,
      deviceId: 'sample:player',
      revision: 0,
      slot: null,
      playing: false,
      resumePending: false,
    });

    const active = candidate(
      candidate(createMediaPlaybackStateV1(definition, 'sample:player'), {
        kind: 'insert',
        itemId: 'sample:disc-shore',
      }).state,
      { kind: 'activate' },
    ).state;
    const snapshot = snapshotMediaPlaybackStateV1(active);
    const restored = restoreMediaPlaybackStateV1(definition, 'sample:player', snapshot);
    expect(snapshot).toMatchObject({ revision: 2, playingIntent: true });
    expect(restored).toMatchObject({ revision: 2, playing: false, resumePending: true });
    expect(candidate(restored, { kind: 'activate' }).state).toMatchObject({
      revision: 3,
      playing: true,
      resumePending: false,
    });
  });

  it('preserves pending intent across save and switch, while stop and eject clear it', () => {
    const definition = model();
    const pending = restoreMediaPlaybackStateV1(definition, 'sample:player', {
      version: 1,
      deviceId: 'sample:player',
      revision: 8,
      slot: { itemId: 'sample:disc-shore', trackId: 'sample:shore' },
      playingIntent: true,
    });
    expect(snapshotMediaPlaybackStateV1(pending).playingIntent).toBe(true);

    const switched = candidate(pending, { kind: 'switch', itemId: 'sample:disc-orbit' });
    expect(switched.state).toMatchObject({ playing: false, resumePending: true });
    expect(candidate(pending, { kind: 'stop' }).state).toMatchObject({ playing: false, resumePending: false });
    expect(candidate(pending, { kind: 'eject' }).state).toMatchObject({
      slot: null,
      playing: false,
      resumePending: false,
    });
  });

  it('fails closed for malformed snapshots, mismatched bindings and exhausted revisions', () => {
    const definition = model();
    expect(() => restoreMediaPlaybackStateV1(definition, 'sample:player', null)).toThrow(/snapshot/i);
    expect(() =>
      restoreMediaPlaybackStateV1(definition, 'sample:player', {
        version: 1,
        deviceId: 'sample:player',
        revision: 1,
        slot: null,
        playingIntent: true,
      }),
    ).toThrow(/empty.*intent/i);
    expect(() =>
      restoreMediaPlaybackStateV1(definition, 'sample:player', {
        version: 1,
        deviceId: 'sample:player',
        revision: 1,
        slot: { itemId: 'sample:disc-shore', trackId: 'sample:orbit' },
        playingIntent: false,
      }),
    ).toThrow(/does not match/i);
    expect(() => restoreMediaPlaybackStateV1(definition, 'sample:missing', undefined)).toThrow(/unknown media device/i);

    const exhausted = {
      ...createMediaPlaybackStateV1(definition, 'sample:player'),
      revision: Number.MAX_SAFE_INTEGER,
    };
    errorCode(
      () =>
        buildMediaPlaybackCandidateV1({
          model: definition,
          device: { kind: 'voxel', position: [1, 2, 3], definitionId: 'sample:player' },
          state: exhausted,
          expectedRevision: Number.MAX_SAFE_INTEGER,
          action: { kind: 'insert', itemId: 'sample:disc-shore' },
        }),
      'revision-exhausted',
    );
  });
});
