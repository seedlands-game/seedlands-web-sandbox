import { describe, expect, it, vi } from 'vitest';
import {
  WorldMediaPlayer,
  type WorldMediaAudioPort,
  type WorldMediaResourceLease,
  type WorldMediaSourcePort,
} from '../../../src/app/audio/world-media-player';
import type { MediaDeviceInstanceV1, MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';

type Deferred<Value> = Readonly<{ promise: Promise<Value>; resolve(value: Value): void; reject(error: unknown): void }>;

const deferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const mediaResource = (path: string) => ({ packId: 'sample:pack', path });
const mediaDevice = (x = 1): MediaDeviceInstanceV1 => ({
  kind: 'voxel',
  position: [x, 2, 3],
  definitionId: 'sample:player',
});
const fact = (revision: number, overrides: Partial<MediaPlaybackFactV1> = {}): MediaPlaybackFactV1 => {
  return {
    version: 1,
    kind: 'activate',
    device: mediaDevice(),
    revision,
    previousTrackId: null,
    trackId: 'sample:shore',
    resource: mediaResource('assets/audio/shore.mp3'),
    playing: true,
    resumePending: false,
    ...overrides,
  };
};
const projection = (revision: number): MediaPlaybackProjectionV1 => ({
  version: 1,
  device: mediaDevice(),
  revision,
  slot: { itemId: 'sample:disc', trackId: 'sample:shore' },
  resource: mediaResource('assets/audio/shore.mp3'),
  playing: true,
  resumePending: false,
});

const resource = (label: string): WorldMediaResourceLease => ({
  bytes: new TextEncoder().encode(label).buffer,
  release: vi.fn(),
});

const source = (): WorldMediaSourcePort & {
  connected: unknown[];
  ended(): void;
  removeEnded: ReturnType<typeof vi.fn>;
} => {
  let ended = () => undefined;
  const removeEnded = vi.fn(() => {
    ended = () => undefined;
  });
  return {
    connected: [],
    connect(output) {
      this.connected.push(output);
    },
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onEnded(listener) {
      ended = listener;
      return removeEnded;
    },
    ended() {
      ended();
    },
    removeEnded,
  };
};

function fixture(playbackAllowed = true) {
  let allowed = playbackAllowed;
  const leases = new Map<string, WorldMediaResourceLease>();
  const sources: ReturnType<typeof source>[] = [];
  const errors: unknown[] = [];
  const resources = {
    validate: vi.fn(),
    resolve: vi.fn(async (reference: ReturnType<typeof mediaResource>) => {
      const lease = resource(reference.path);
      leases.set(reference.path, lease);
      return lease;
    }),
  };
  const decode = vi.fn(async (bytes: ArrayBuffer) => new TextDecoder().decode(bytes));
  const audio: WorldMediaAudioPort<string> = {
    output: { bus: 'music' },
    playbackAllowed: vi.fn(() => allowed),
    resume: vi.fn(async () => {
      allowed = true;
      return true;
    }),
    decode,
    createSource: vi.fn(() => {
      const created = source();
      sources.push(created);
      return created;
    }),
  };
  const player = new WorldMediaPlayer(resources, audio, (error) => errors.push(error));
  return {
    player,
    resources,
    audio,
    decode,
    leases,
    sources,
    errors,
    setAllowed: (value: boolean) => (allowed = value),
  };
}

describe('WorldMediaPlayer', () => {
  it('loads an activated committed track, releases its resource lease and connects to the injected output', async () => {
    const f = fixture();
    await expect(f.player.consume(fact(1))).resolves.toBe(true);

    expect(f.resources.resolve).toHaveBeenCalledWith(mediaResource('assets/audio/shore.mp3'));
    expect(f.audio.decode).toHaveBeenCalledOnce();
    expect(f.leases.get('assets/audio/shore.mp3')?.release).toHaveBeenCalledOnce();
    expect(f.sources[0]?.connected).toEqual([f.audio.output]);
    expect(f.sources[0]?.start).toHaveBeenCalledOnce();
    expect(f.player.snapshot()).toEqual({
      phase: 'playing',
      instanceKey: 'sample:player@1,2,3',
      trackId: 'sample:shore',
      revision: 1,
      error: null,
    });
  });

  it('starts an atomic insert-and-activate fact without a second client action', async () => {
    const f = fixture();

    await expect(
      f.player.consume(fact(1, { kind: 'insert-and-activate', insertedItemId: 'sample:disc', playing: true })),
    ).resolves.toBe(true);

    expect(f.sources).toHaveLength(1);
    expect(f.sources[0]!.start).toHaveBeenCalledOnce();
    expect(f.player.snapshot()).toMatchObject({ phase: 'playing', revision: 1 });
  });

  it('uses the observed projection as an instance revision floor while allowing the matching first fact', async () => {
    const f = fixture();
    f.player.reconcileProjection(projection(3));

    await expect(f.player.consume(fact(1))).resolves.toBe(false);
    await expect(f.player.consume(fact(4))).resolves.toBe(false);
    await expect(f.player.consume(fact(3))).resolves.toBe(true);
    await expect(f.player.consume(fact(3))).resolves.toBe(false);

    expect(f.resources.resolve).toHaveBeenCalledOnce();
    expect(f.sources[0]?.start).toHaveBeenCalledOnce();
  });

  it('invalidates an older pending load when a newer playing projection arrives', async () => {
    const pending = deferred<WorldMediaResourceLease>();
    const lease = resource('old');
    const f = fixture();
    f.resources.resolve.mockImplementationOnce(() => pending.promise);
    const oldLoad = f.player.consume(fact(1));

    f.player.reconcileProjection({
      ...projection(3),
      slot: { itemId: 'sample:other-disc', trackId: 'sample:other' },
      resource: mediaResource('assets/audio/other.mp3'),
    });
    pending.resolve(lease);

    await expect(oldLoad).resolves.toBe(false);
    expect(lease.release).toHaveBeenCalledOnce();
    expect(f.audio.decode).not.toHaveBeenCalled();
    expect(f.sources).toHaveLength(0);
    expect(f.player.snapshot().phase).toBe('idle');
  });

  it('waits for a legal gesture for blocked and restored pending playback', async () => {
    const f = fixture();
    await expect(f.player.consume(fact(4, { playing: false, resumePending: true }))).resolves.toBe(true);
    expect(f.resources.resolve).not.toHaveBeenCalled();
    expect(f.player.snapshot().phase).toBe('resume-pending');

    await expect(f.player.resumeFromGesture()).resolves.toBe(true);
    expect(f.audio.resume).toHaveBeenCalledOnce();
    expect(f.resources.resolve).toHaveBeenCalledOnce();
    expect(f.player.snapshot()).toMatchObject({ phase: 'playing', revision: 4, trackId: 'sample:shore' });
  });

  it('retires output on pause and requires a gesture to restart the committed intent', async () => {
    const f = fixture();
    await f.player.consume(fact(1));
    const active = f.sources[0]!;

    f.player.setPaused(true);
    expect(active.stop).toHaveBeenCalledOnce();
    expect(active.disconnect).toHaveBeenCalledOnce();
    expect(f.player.snapshot()).toMatchObject({ phase: 'resume-pending', trackId: 'sample:shore' });
    await expect(f.player.resumeFromGesture()).resolves.toBe(false);

    f.player.setPaused(false);
    await expect(f.player.resumeFromGesture()).resolves.toBe(true);
    expect(f.sources).toHaveLength(2);
    expect(f.player.snapshot().phase).toBe('playing');
  });

  it('switches sources and releases the previous source before starting the replacement', async () => {
    const f = fixture();
    await f.player.consume(fact(1));
    const previous = f.sources[0]!;

    await f.player.consume(
      fact(2, {
        kind: 'switch',
        previousTrackId: 'sample:shore',
        trackId: 'sample:orbit',
        resource: mediaResource('assets/audio/orbit.ogg'),
      }),
    );

    expect(previous.removeEnded).toHaveBeenCalledOnce();
    expect(previous.stop).toHaveBeenCalledOnce();
    expect(previous.disconnect).toHaveBeenCalledOnce();
    expect(f.sources[1]?.start).toHaveBeenCalledOnce();
    expect(f.player.snapshot()).toMatchObject({ phase: 'playing', trackId: 'sample:orbit', revision: 2 });
  });

  it.each(['stop', 'eject'] as const)(
    '%s retires the matching source and duplicate facts stay ignored',
    async (kind) => {
      const f = fixture();
      await f.player.consume(fact(1));
      const active = f.sources[0]!;
      const stopped = fact(2, {
        kind,
        trackId: kind === 'eject' ? null : 'sample:shore',
        resource: kind === 'eject' ? null : mediaResource('assets/audio/shore.mp3'),
        playing: false,
      });

      await expect(f.player.consume(stopped)).resolves.toBe(true);
      expect(active.stop).toHaveBeenCalledOnce();
      expect(active.disconnect).toHaveBeenCalledOnce();
      expect(f.player.snapshot().phase).toBe('idle');
      await expect(f.player.consume(stopped)).resolves.toBe(false);
      expect(active.stop).toHaveBeenCalledOnce();
    },
  );

  it('accepts a lower revision from another device and switches the active source', async () => {
    const f = fixture();
    await expect(f.player.consume(fact(10))).resolves.toBe(true);
    const deviceA = f.sources[0]!;

    await expect(
      f.player.consume(
        fact(1, {
          device: mediaDevice(9),
          trackId: 'sample:orbit',
          resource: mediaResource('assets/audio/orbit.ogg'),
        }),
      ),
    ).resolves.toBe(true);

    expect(deviceA.stop).toHaveBeenCalledOnce();
    expect(deviceA.disconnect).toHaveBeenCalledOnce();
    expect(f.sources).toHaveLength(2);
    expect(f.player.snapshot()).toMatchObject({
      phase: 'playing',
      instanceKey: 'sample:player@9,2,3',
      trackId: 'sample:orbit',
      revision: 1,
    });
  });

  it.each(['stop', 'eject'] as const)('%s from another device does not stop the active source', async (kind) => {
    const f = fixture();
    await f.player.consume(fact(10));
    const deviceA = f.sources[0]!;

    await expect(
      f.player.consume(
        fact(1, {
          kind,
          device: mediaDevice(9),
          trackId: kind === 'eject' ? null : 'sample:orbit',
          resource: kind === 'eject' ? null : mediaResource('assets/audio/orbit.ogg'),
          playing: false,
        }),
      ),
    ).resolves.toBe(true);

    expect(deviceA.stop).not.toHaveBeenCalled();
    expect(deviceA.disconnect).not.toHaveBeenCalled();
    expect(f.player.snapshot()).toMatchObject({
      phase: 'playing',
      instanceKey: 'sample:player@1,2,3',
      trackId: 'sample:shore',
      revision: 10,
    });
  });

  it('rejects duplicate and older revisions for another device without changing the active source', async () => {
    const f = fixture();
    await f.player.consume(fact(10));
    const deviceA = f.sources[0]!;
    await expect(f.player.consume(fact(2, { kind: 'stop', device: mediaDevice(9), playing: false }))).resolves.toBe(
      true,
    );
    const before = f.player.snapshot();

    await expect(f.player.consume(fact(2, { kind: 'stop', device: mediaDevice(9), playing: false }))).resolves.toBe(
      false,
    );
    await expect(
      f.player.consume(
        fact(1, {
          kind: 'eject',
          device: mediaDevice(9),
          trackId: null,
          resource: null,
          playing: false,
        }),
      ),
    ).resolves.toBe(false);

    expect(deviceA.stop).not.toHaveBeenCalled();
    expect(deviceA.disconnect).not.toHaveBeenCalled();
    expect(f.sources).toHaveLength(1);
    expect(f.player.snapshot()).toEqual(before);
  });

  it('does not let a stale load revive a track after a newer switch', async () => {
    const first = deferred<WorldMediaResourceLease>();
    const second = deferred<WorldMediaResourceLease>();
    const firstLease = resource('first');
    const secondLease = resource('second');
    const sources: ReturnType<typeof source>[] = [];
    const resources = {
      validate: vi.fn(),
      resolve: vi.fn((reference: ReturnType<typeof mediaResource>) =>
        reference.path.endsWith('shore.mp3') ? first.promise : second.promise,
      ),
    };
    const audio: WorldMediaAudioPort<string> = {
      output: {},
      playbackAllowed: () => true,
      resume: async () => true,
      decode: vi.fn(async (bytes) => new TextDecoder().decode(bytes)),
      createSource: vi.fn(() => {
        const created = source();
        sources.push(created);
        return created;
      }),
    };
    const player = new WorldMediaPlayer(resources, audio);

    const oldLoad = player.consume(fact(1));
    const newLoad = player.consume(
      fact(2, { kind: 'switch', trackId: 'sample:orbit', resource: mediaResource('assets/audio/orbit.ogg') }),
    );
    second.resolve(secondLease);
    await expect(newLoad).resolves.toBe(true);
    first.resolve(firstLease);
    await expect(oldLoad).resolves.toBe(false);

    expect(firstLease.release).toHaveBeenCalledOnce();
    expect(secondLease.release).toHaveBeenCalledOnce();
    expect(audio.decode).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(1);
    expect(player.snapshot()).toMatchObject({ phase: 'playing', trackId: 'sample:orbit', revision: 2 });
  });

  it('does not create an old source when decoding finishes after a newer track', async () => {
    const oldDecode = deferred<string>();
    const f = fixture();
    f.decode.mockImplementationOnce(() => oldDecode.promise);

    const oldLoad = f.player.consume(fact(1));
    await vi.waitFor(() => expect(f.decode).toHaveBeenCalledOnce());
    const newLoad = f.player.consume(
      fact(2, { kind: 'switch', trackId: 'sample:orbit', resource: mediaResource('assets/audio/orbit.ogg') }),
    );
    await expect(newLoad).resolves.toBe(true);
    oldDecode.resolve('old');
    await expect(oldLoad).resolves.toBe(false);

    expect(f.sources).toHaveLength(1);
    expect(f.player.snapshot()).toMatchObject({ phase: 'playing', trackId: 'sample:orbit', revision: 2 });
  });

  it('reports missing resources and decode failures without creating a source', async () => {
    const missing = fixture();
    missing.resources.resolve.mockRejectedValueOnce(new Error('missing'));
    await expect(missing.player.consume(fact(1))).resolves.toBe(false);
    expect(missing.player.snapshot()).toMatchObject({ phase: 'error', error: { code: 'resource-unavailable' } });
    expect(missing.errors).toHaveLength(1);
    expect(missing.audio.createSource).not.toHaveBeenCalled();

    const broken = fixture();
    broken.decode.mockRejectedValueOnce(new Error('decode'));
    await expect(broken.player.consume(fact(1))).resolves.toBe(false);
    expect(broken.leases.get('assets/audio/shore.mp3')?.release).toHaveBeenCalledOnce();
    expect(broken.player.snapshot()).toMatchObject({ phase: 'error', error: { code: 'decode-failed' } });
    expect(broken.audio.createSource).not.toHaveBeenCalled();
  });

  it('reports source startup failures and releases every acquired resource and node', async () => {
    const f = fixture();
    const brokenSource = source();
    vi.mocked(brokenSource.start).mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    vi.mocked(f.audio.createSource).mockReturnValueOnce(brokenSource);

    await expect(f.player.consume(fact(1))).resolves.toBe(false);
    expect(f.leases.get('assets/audio/shore.mp3')?.release).toHaveBeenCalledOnce();
    expect(brokenSource.removeEnded).toHaveBeenCalledOnce();
    expect(brokenSource.stop).toHaveBeenCalledOnce();
    expect(brokenSource.disconnect).toHaveBeenCalledOnce();
    expect(f.player.snapshot()).toMatchObject({ phase: 'error', error: { code: 'playback-failed' } });
  });

  it('dispose invalidates pending work, retires active nodes and prevents later resurrection', async () => {
    const pending = deferred<WorldMediaResourceLease>();
    const lateLease = resource('late');
    const f = fixture();
    await f.player.consume(fact(1));
    const active = f.sources[0]!;
    f.decode.mockClear();
    f.resources.resolve.mockImplementationOnce(() => pending.promise);
    const loading = f.player.consume(
      fact(2, { kind: 'switch', trackId: 'sample:orbit', resource: mediaResource('assets/audio/orbit.ogg') }),
    );
    expect(active.stop).toHaveBeenCalledOnce();
    expect(active.disconnect).toHaveBeenCalledOnce();
    f.player.dispose();
    pending.resolve(lateLease);

    await expect(loading).resolves.toBe(false);
    expect(lateLease.release).toHaveBeenCalledOnce();
    expect(f.decode).not.toHaveBeenCalled();
    expect(f.player.snapshot()).toEqual({
      phase: 'disposed',
      instanceKey: null,
      trackId: null,
      revision: null,
      error: null,
    });
    await expect(f.player.consume(fact(2))).resolves.toBe(false);
  });

  it('releases naturally ended sources without publishing a false authority stop', async () => {
    const f = fixture();
    await f.player.consume(fact(1));
    f.sources[0]!.ended();

    expect(f.sources[0]!.stop).not.toHaveBeenCalled();
    expect(f.sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(f.player.snapshot()).toEqual({
      phase: 'idle',
      instanceKey: null,
      trackId: null,
      revision: null,
      error: null,
    });
  });
});
