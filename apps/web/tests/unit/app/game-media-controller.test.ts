import { describe, expect, it, vi } from 'vitest';
import type { GlobalAudio } from '../../../src/app/audio/global-audio';
import { GameMediaController } from '../../../src/app/audio/game-media-controller';
import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';

const batch = (epoch: string, revision: number): MediaPlaybackCommittedBatchV1 => ({
  version: 1,
  worldEpoch: epoch,
  worldRevision: 0,
  gameplayRevision: revision,
  facts: [
    {
      version: 1,
      kind: 'activate',
      device: { kind: 'voxel', position: [revision, 2, 3], definitionId: 'sample:device' },
      revision,
      previousTrackId: 'sample:track',
      trackId: 'sample:track',
      resource: { packId: 'sample:pack', path: 'assets/audio/track.mp3' },
      playing: true,
      resumePending: false,
    },
  ],
});
const projection = (revision: number): MediaPlaybackProjectionV1 => ({
  version: 1,
  device: { kind: 'voxel', position: [revision, 2, 3], definitionId: 'sample:device' },
  revision,
  slot: { itemId: 'sample:record', trackId: 'sample:track' },
  resource: { packId: 'sample:pack', path: 'assets/audio/track.mp3' },
  playing: true,
  resumePending: false,
});

describe('GameMediaController', () => {
  it('buffers validated startup facts and flushes only the active runtime epoch in order', async () => {
    const audio = {
      beginMediaWorld: vi.fn(),
      installMediaProjections: vi.fn(),
      consumeMediaFacts: vi.fn(),
      setWorldMediaPaused: vi.fn(),
    } as unknown as GlobalAudio;
    const loader = { validate: vi.fn(), resolve: vi.fn(), abort: vi.fn(), dispose: vi.fn() };
    const controller = new GameMediaController(audio, vi.fn(), async () => loader);
    await controller.load(new URL('https://game.test/packs/'));
    controller.facts(batch('old', 1));
    controller.facts(batch('runtime:2', 2));

    controller.beginWorld('runtime:2');

    expect(audio.beginMediaWorld).toHaveBeenCalledWith('runtime:2', loader, expect.any(Function));
    expect(audio.consumeMediaFacts).toHaveBeenCalledOnce();
    expect(audio.consumeMediaFacts).toHaveBeenCalledWith(batch('runtime:2', 2).facts);
  });

  it('drops old-world facts after restore and forwards pause/dispose lifecycle', async () => {
    const audio = {
      beginMediaWorld: vi.fn(),
      installMediaProjections: vi.fn(),
      consumeMediaFacts: vi.fn(),
      setWorldMediaPaused: vi.fn(),
    } as unknown as GlobalAudio;
    const loader = { validate: vi.fn(), resolve: vi.fn(), abort: vi.fn(), dispose: vi.fn() };
    const controller = new GameMediaController(audio, vi.fn(), async () => loader);
    await controller.load(new URL('https://game.test/packs/'));
    controller.beginWorld('runtime:1');
    controller.beginRestore('runtime:2');
    controller.facts(batch('runtime:1', 2));
    controller.facts(batch('runtime:2', 1));
    controller.pause(true);
    controller.dispose();

    expect(audio.consumeMediaFacts).toHaveBeenCalledOnce();
    expect(audio.consumeMediaFacts).toHaveBeenCalledWith(batch('runtime:2', 1).facts);
    expect(audio.setWorldMediaPaused).toHaveBeenCalledWith(true);
    expect(loader.dispose).toHaveBeenCalledOnce();
  });

  it('rejects an entire fact batch before audio when a later resource is not locked', async () => {
    const audio = {
      beginMediaWorld: vi.fn(),
      installMediaProjections: vi.fn(),
      consumeMediaFacts: vi.fn(),
    } as unknown as GlobalAudio;
    const failed = vi.fn();
    const loader = {
      validate: vi.fn((reference: { path: string }) => {
        if (reference.path.endsWith('missing.mp3')) throw new Error('not indexed');
      }),
      resolve: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = new GameMediaController(audio, failed, async () => loader);
    await controller.load(new URL('https://game.test/packs/'));
    controller.beginWorld('runtime:1');
    const valid = batch('runtime:1', 1);
    const invalid = {
      ...batch('runtime:1', 2).facts[0]!,
      resource: { packId: 'sample:pack', path: 'assets/audio/missing.mp3' },
    };

    controller.facts({ ...valid, facts: [valid.facts[0]!, invalid] });

    expect(failed).toHaveBeenCalledWith('唱片资源未通过当前世界资源锁校验。');
    expect(audio.consumeMediaFacts).not.toHaveBeenCalled();
  });

  it('exposes detached frozen projections and the last batch actually forwarded to audio', async () => {
    const audio = {
      beginMediaWorld: vi.fn(),
      installMediaProjections: vi.fn(),
      consumeMediaFacts: vi.fn(),
    } as unknown as GlobalAudio;
    const loader = { validate: vi.fn(), resolve: vi.fn(), abort: vi.fn(), dispose: vi.fn() };
    const controller = new GameMediaController(audio, vi.fn(), async () => loader);
    const currentProjection = projection(1);
    const forwarded = batch('runtime:1', 1);
    await controller.load(new URL('https://game.test/packs/'));
    controller.projection([currentProjection]);
    controller.beginWorld('runtime:1');
    controller.facts(forwarded);

    const snapshot = controller.snapshot();
    expect(snapshot).toEqual({
      worldEpoch: 'runtime:1',
      projections: [currentProjection],
      lastForwardedBatch: forwarded,
    });
    expect(snapshot.projections).not.toBe(controller.snapshot().projections);
    expect(snapshot.projections[0]).not.toBe(currentProjection);
    expect(snapshot.lastForwardedBatch).not.toBe(forwarded);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.projections)).toBe(true);
    expect(Object.isFrozen(snapshot.projections[0]!.device.position)).toBe(true);
    expect(Object.isFrozen(snapshot.lastForwardedBatch?.facts[0]?.resource)).toBe(true);
    expect(() => {
      (snapshot.projections as MediaPlaybackProjectionV1[]).splice(0);
    }).toThrow();
    expect(controller.snapshot().projections).toEqual([currentProjection]);

    const latest = batch('runtime:1', 2);
    controller.facts(latest);
    expect(controller.snapshot().lastForwardedBatch).toEqual(latest);
  });

  it('records a pending batch only after beginWorld validates and forwards it', async () => {
    const audio = {
      beginMediaWorld: vi.fn(),
      installMediaProjections: vi.fn(),
      consumeMediaFacts: vi.fn(),
    } as unknown as GlobalAudio;
    const loader = { validate: vi.fn(), resolve: vi.fn(), abort: vi.fn(), dispose: vi.fn() };
    const controller = new GameMediaController(audio, vi.fn(), async () => loader);
    const pending = batch('runtime:2', 2);
    controller.facts(pending);
    expect(controller.snapshot().lastForwardedBatch).toBeNull();

    await controller.load(new URL('https://game.test/packs/'));
    controller.beginWorld('runtime:2');

    expect(loader.validate).toHaveBeenCalledWith(pending.facts[0]!.resource);
    expect(audio.consumeMediaFacts).toHaveBeenCalledWith(pending.facts);
    expect(controller.snapshot().lastForwardedBatch).toEqual(pending);
  });

  it('does not record batches rejected before audio or received while audio is unavailable', async () => {
    const unavailable = new GameMediaController(undefined, vi.fn());
    unavailable.facts(batch('runtime:1', 1));
    unavailable.beginWorld('runtime:1');
    expect(unavailable.snapshot()).toMatchObject({ worldEpoch: null, lastForwardedBatch: null });

    const audio = {
      beginMediaWorld: vi.fn(),
      installMediaProjections: vi.fn(),
      consumeMediaFacts: vi.fn(),
    } as unknown as GlobalAudio;
    const loader = {
      validate: vi.fn((reference: { path: string }) => {
        if (reference.path.endsWith('missing.mp3')) throw new Error('not indexed');
      }),
      resolve: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = new GameMediaController(audio, vi.fn(), async () => loader);
    controller.beginWorld('runtime:1');
    const pending = batch('runtime:1', 1);
    controller.facts(pending);
    expect(controller.snapshot()).toMatchObject({ worldEpoch: null, lastForwardedBatch: null });
    await controller.load(new URL('https://game.test/packs/'));
    controller.beginWorld('runtime:1');
    expect(controller.snapshot().lastForwardedBatch).toEqual(pending);
    controller.facts(batch('runtime:2', 2));
    expect(controller.snapshot().lastForwardedBatch).toEqual(pending);
    const source = batch('runtime:1', 3);
    const invalid: MediaPlaybackCommittedBatchV1 = {
      ...source,
      facts: [
        {
          ...source.facts[0]!,
          resource: { packId: 'sample:pack', path: 'assets/audio/missing.mp3' },
        },
      ],
    };
    controller.facts(invalid);
    expect(controller.snapshot().lastForwardedBatch).toEqual(pending);
    expect(audio.consumeMediaFacts).toHaveBeenCalledOnce();
  });

  it('clears the forwarding receipt on restore, endWorld and dispose', async () => {
    const audio = {
      beginMediaWorld: vi.fn(),
      installMediaProjections: vi.fn(),
      consumeMediaFacts: vi.fn(),
    } as unknown as GlobalAudio;
    const loader = { validate: vi.fn(), resolve: vi.fn(), abort: vi.fn(), dispose: vi.fn() };
    const controller = new GameMediaController(audio, vi.fn(), async () => loader);
    await controller.load(new URL('https://game.test/packs/'));
    controller.beginWorld('runtime:1');
    controller.facts(batch('runtime:1', 1));
    expect(controller.snapshot().lastForwardedBatch).not.toBeNull();

    controller.beginRestore('runtime:2');
    expect(controller.snapshot()).toMatchObject({ worldEpoch: 'runtime:2', lastForwardedBatch: null });
    controller.facts(batch('runtime:1', 2));
    expect(controller.snapshot().lastForwardedBatch).toBeNull();
    controller.facts(batch('runtime:2', 1));
    expect(controller.snapshot().lastForwardedBatch).not.toBeNull();
    controller.endWorld();
    expect(controller.snapshot()).toEqual({ worldEpoch: null, projections: [], lastForwardedBatch: null });

    controller.beginWorld('runtime:3');
    controller.facts(batch('runtime:3', 1));
    controller.dispose();
    expect(controller.snapshot()).toEqual({ worldEpoch: null, projections: [], lastForwardedBatch: null });
  });
});
