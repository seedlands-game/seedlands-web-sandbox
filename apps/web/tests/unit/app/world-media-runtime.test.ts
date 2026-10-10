import { describe, expect, it, vi } from 'vitest';
import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';
import type { WorldMediaAudioPort, WorldMediaSourcePort } from '../../../src/app/audio/world-media-player';
import { WorldMediaRuntime } from '../../../src/app/audio/world-media-runtime';

const device = (x: number) => ({ kind: 'voxel' as const, position: [x, 2, 3] as const, definitionId: 'sample:device' });
const resource = { packId: 'sample:pack', path: 'assets/audio/track.mp3' } as const;
const projection = (
  x: number,
  revision: number,
  state: Pick<MediaPlaybackProjectionV1, 'playing' | 'resumePending'> = { playing: false, resumePending: true },
): MediaPlaybackProjectionV1 => ({
  version: 1,
  device: device(x),
  revision,
  slot: { itemId: 'sample:disc', trackId: 'sample:track' },
  resource,
  ...state,
});
const fact = (x: number, revision: number, playing = true): MediaPlaybackFactV1 => ({
  version: 1,
  kind: playing ? 'activate' : 'stop',
  device: device(x),
  revision,
  previousTrackId: 'sample:track',
  trackId: 'sample:track',
  resource,
  playing,
  resumePending: false,
});

function fixture(allowed = true) {
  let playbackAllowed = allowed;
  const sources: Array<
    WorldMediaSourcePort & { stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }
  > = [];
  const resources = {
    validate: vi.fn(),
    resolve: vi.fn(async () => ({ bytes: new ArrayBuffer(1), release: vi.fn() })),
    abort: vi.fn(),
  };
  const audio: WorldMediaAudioPort<AudioBuffer> = {
    output: {},
    playbackAllowed: () => playbackAllowed,
    resume: vi.fn(async () => {
      playbackAllowed = true;
      return true;
    }),
    decode: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
    createSource: vi.fn(() => {
      const source = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onEnded: vi.fn(() => () => undefined),
      };
      sources.push(source);
      return source;
    }),
  };
  const errors = vi.fn();
  const runtime = new WorldMediaRuntime('runtime:1', resources, audio, errors);
  return { runtime, resources, audio, sources, errors };
}

describe('WorldMediaRuntime', () => {
  it('restores from projection alone and starts from the beginning only after a gesture', async () => {
    const world = fixture(false);
    world.runtime.installProjections([projection(1, 4)]);

    expect(world.resources.resolve).not.toHaveBeenCalled();
    expect(world.runtime.snapshot().instances).toEqual([
      { key: 'sample:device@1,2,3', phase: 'resume-pending', revision: 4 },
    ]);

    await expect(world.runtime.resumeFromGesture()).resolves.toBe(true);
    expect(world.resources.resolve).toHaveBeenCalledWith(resource);
    expect(world.sources[0]?.start).toHaveBeenCalledOnce();
  });

  it('consumes the first fact at the same revision as an already installed projection', async () => {
    const world = fixture();
    world.runtime.installProjections([projection(1, 4, { playing: true, resumePending: false })]);

    await world.runtime.consumeFacts([fact(1, 4)]);

    expect(world.sources).toHaveLength(1);
    expect(world.runtime.snapshot().instances[0]).toMatchObject({ phase: 'playing', revision: 4 });
  });

  it('rejects older playback after a newer stopped projection and does not create players for absent terminal facts', async () => {
    const world = fixture();
    world.runtime.installProjections([
      { ...projection(1, 3, { playing: false, resumePending: false }), slot: null, resource: null },
    ]);

    await world.runtime.consumeFacts([fact(1, 1)]);
    world.runtime.installProjections([]);
    await world.runtime.consumeFacts([fact(1, 4, { kind: 'eject', trackId: null, resource: null, playing: false })]);

    expect(world.resources.resolve).not.toHaveBeenCalled();
    expect(world.sources).toHaveLength(0);
    expect(world.runtime.snapshot().instances).toEqual([]);
  });

  it('isolates two instances of one definition and does not stop the other device', async () => {
    const world = fixture();
    world.runtime.installProjections([
      projection(1, 10, { playing: true, resumePending: false }),
      projection(9, 1, { playing: true, resumePending: false }),
    ]);
    await world.runtime.consumeFacts([fact(1, 10), fact(9, 1)]);
    const [first, second] = world.sources;

    world.runtime.installProjections([
      projection(1, 11, { playing: false, resumePending: false }),
      projection(9, 1, { playing: true, resumePending: false }),
    ]);
    await world.runtime.consumeFacts([fact(1, 11, false)]);

    expect(first!.stop).toHaveBeenCalledOnce();
    expect(first!.disconnect).toHaveBeenCalledOnce();
    expect(second!.stop).not.toHaveBeenCalled();
    expect(second!.disconnect).not.toHaveBeenCalled();
  });

  it('does not replay an unchanged restored projection when another instance advances', async () => {
    const world = fixture(false);
    world.runtime.installProjections([projection(1, 4), projection(9, 1)]);
    await world.runtime.resumeFromGesture();
    const first = world.sources[0]!;

    world.runtime.installProjections([projection(1, 4), projection(9, 2)]);

    expect(first.stop).not.toHaveBeenCalled();
    expect(first.disconnect).not.toHaveBeenCalled();
  });

  it('stops and disposes an active player when the complete projection removes its instance', async () => {
    const world = fixture();
    world.runtime.installProjections([projection(1, 1, { playing: true, resumePending: false })]);
    await world.runtime.consumeFacts([fact(1, 1)]);
    const active = world.sources[0]!;

    world.runtime.installProjections([]);

    expect(active.stop).toHaveBeenCalledOnce();
    expect(active.disconnect).toHaveBeenCalledOnce();
    expect(world.runtime.snapshot().instances).toEqual([]);
  });

  it('validates the complete projection set before changing any player', async () => {
    const world = fixture(false);
    world.runtime.installProjections([projection(1, 4)]);
    await world.runtime.resumeFromGesture();
    const active = world.sources[0]!;

    expect(() => world.runtime.installProjections([projection(1, 5), projection(1, 6)])).toThrow(/duplicated/i);

    expect(active.stop).not.toHaveBeenCalled();
    expect(active.disconnect).not.toHaveBeenCalled();
    expect(world.runtime.snapshot().instances).toContainEqual(
      expect.objectContaining({ key: 'sample:device@1,2,3', phase: 'playing', revision: 4 }),
    );
  });

  it('pauses every source, aborts pending work on dispose and exposes failures', async () => {
    const world = fixture();
    world.runtime.installProjections([
      projection(1, 1, { playing: true, resumePending: false }),
      projection(9, 1, { playing: true, resumePending: false }),
    ]);
    await world.runtime.consumeFacts([fact(1, 1), fact(9, 1)]);
    world.runtime.setPaused(true);
    expect(world.sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);

    world.runtime.dispose();
    expect(world.resources.abort).toHaveBeenCalledOnce();
    expect(world.runtime.snapshot().instances).toEqual([]);
  });

  it('surfaces a verified resource failure without affecting another instance', async () => {
    const world = fixture();
    world.resources.resolve.mockRejectedValueOnce(new Error('digest mismatch'));
    world.runtime.installProjections([
      projection(1, 1, { playing: true, resumePending: false }),
      projection(9, 1, { playing: true, resumePending: false }),
    ]);

    await world.runtime.consumeFacts([fact(1, 1), fact(9, 1)]);

    expect(world.errors).toHaveBeenCalledOnce();
    expect(world.runtime.snapshot().error).toMatchObject({ code: 'resource-unavailable' });
    expect(world.runtime.snapshot().instances).toContainEqual(
      expect.objectContaining({ key: 'sample:device@9,2,3', phase: 'playing' }),
    );
  });
});
