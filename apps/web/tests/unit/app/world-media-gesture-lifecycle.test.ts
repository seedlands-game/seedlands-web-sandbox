import { expect, it, vi } from 'vitest';
import { WorldMediaPlayer, type WorldMediaAudioPort } from '../../../src/app/audio/world-media-player';
import type { MediaPlaybackFactV1 } from '@seedlands/stdlib/mod-api';

const playingFact: MediaPlaybackFactV1 = {
  version: 1,
  kind: 'activate',
  device: { kind: 'voxel', position: [1, 2, 3], definitionId: 'sample:player' },
  revision: 1,
  previousTrackId: null,
  trackId: 'sample:shore',
  resource: { packId: 'sample:pack', path: 'assets/audio/shore.mp3' },
  playing: true,
  resumePending: false,
};

function fixture() {
  const sources: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const release = vi.fn();
  const resources = {
    validate: vi.fn(),
    resolve: vi.fn(async () => ({ bytes: new ArrayBuffer(1), release })),
  };
  const audio: WorldMediaAudioPort<string> = {
    output: {},
    playbackAllowed: () => true,
    resume: vi.fn(async () => true),
    decode: vi.fn(async () => 'decoded-track'),
    createSource: vi.fn(() => {
      const source = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onEnded: () => vi.fn(),
      };
      sources.push(source);
      return source;
    }),
  };
  return { player: new WorldMediaPlayer(resources, audio), resources, audio, sources, release };
}

it('普通手势不重启正在播放的唱片，dispose回收同一唯一source', async () => {
  const f = fixture();
  expect(await f.player.consume(playingFact)).toBe(true);
  const initial = f.sources[0]!;
  expect(await f.player.resumeFromGesture()).toBe(true);
  expect(await f.player.resumeFromGesture()).toBe(true);
  expect(f.audio.resume).toHaveBeenCalledTimes(2);
  expect(f.resources.resolve).toHaveBeenCalledOnce();
  expect(f.audio.decode).toHaveBeenCalledOnce();
  expect(f.sources).toEqual([initial]);
  expect(initial.start).toHaveBeenCalledOnce();
  expect(initial.stop).not.toHaveBeenCalled();
  expect(initial.disconnect).not.toHaveBeenCalled();
  f.player.dispose();
  expect(initial.stop).toHaveBeenCalledOnce();
  expect(initial.disconnect).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
});

it.each([true, false])('loading期间保留原解码，即使一次手势许可为%s', async (allowed) => {
  const f = fixture();
  let completeDecode!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    completeDecode = resolve;
  });
  vi.mocked(f.audio.decode).mockImplementationOnce(() => pending);
  const original = f.player.consume(playingFact);
  await vi.waitFor(() => expect(f.audio.decode).toHaveBeenCalledOnce());
  vi.mocked(f.audio.resume).mockResolvedValueOnce(allowed);
  expect(await f.player.resumeFromGesture()).toBe(false);
  expect(f.player.snapshot().phase).toBe(allowed ? 'loading' : 'resume-pending');
  expect(await f.player.resumeFromGesture()).toBe(false);
  expect(f.sources).toHaveLength(0);
  expect(f.audio.decode).toHaveBeenCalledOnce();
  completeDecode('original-track');
  expect(await original).toBe(true);
  expect(f.sources).toHaveLength(1);
  expect(f.resources.resolve).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
  f.player.dispose();
});

it('真正pause回收旧source，合法恢复手势仍可启动同唱片的新source', async () => {
  const f = fixture();
  expect(await f.player.consume(playingFact)).toBe(true);
  const initial = f.sources[0]!;
  f.player.setPaused(true);
  expect(await f.player.resumeFromGesture()).toBe(false);
  expect(initial.stop).toHaveBeenCalledOnce();
  expect(initial.disconnect).toHaveBeenCalledOnce();
  f.player.setPaused(false);
  expect(await f.player.resumeFromGesture()).toBe(true);
  expect(f.sources).toHaveLength(2);
  expect(f.sources[1]!.start).toHaveBeenCalledOnce();
  expect(f.audio.decode).toHaveBeenCalledTimes(2);
  f.player.dispose();
  expect(initial.stop).toHaveBeenCalledOnce();
  expect(f.sources[1]!.stop).toHaveBeenCalledOnce();
});
