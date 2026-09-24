import { describe, expect, it, vi } from 'vitest';
import type { GlobalAudio } from '../../../src/app/audio/global-audio';
import { GameMediaController } from '../../../src/app/audio/game-media-controller';
import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

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
});
