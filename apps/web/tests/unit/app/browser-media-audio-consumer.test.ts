import { describe, expect, it, vi } from 'vitest';
import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';
import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { WorldMediaRuntime } from '../../../src/app/audio/world-media-runtime';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { BrowserMediaFrontier } from '../../../src/client/authority/browser-media-frontier';
import { FakeAuthorityWorker, frequencies, ready } from '../client/fixtures/browser-authority';

const mediaDevice = { kind: 'voxel' as const, position: [1, 2, 3] as const, definitionId: 'sample:device' };
const mediaResource = { packId: 'sample:pack', path: 'assets/audio/track.mp3' } as const;
const insertAndActivateBatch = (revision = 1, gameplayRevision = 2): MediaPlaybackCommittedBatchV1 => ({
  version: 1,
  worldEpoch: 'world:1',
  worldRevision: 0,
  gameplayRevision,
  facts: [
    {
      version: 1,
      kind: 'insert-and-activate',
      device: mediaDevice,
      revision,
      previousTrackId: null,
      trackId: 'sample:track',
      resource: mediaResource,
      playing: true,
      resumePending: false,
      insertedItemId: 'sample:disc',
    },
  ],
});
const mediaProjection = (revision: number): MediaPlaybackProjectionV1 => ({
  version: 1,
  device: mediaDevice,
  revision,
  slot: { itemId: 'sample:disc', trackId: 'sample:track' },
  resource: mediaResource,
  playing: true,
  resumePending: false,
});
const mediaFact = (revision: number): MediaPlaybackFactV1 => ({
  version: 1,
  kind: 'activate',
  device: mediaDevice,
  revision,
  previousTrackId: 'sample:track',
  trackId: 'sample:track',
  resource: mediaResource,
  playing: true,
  resumePending: false,
});

const audioFixture = () => {
  const sources: Array<ReturnType<typeof sourceFixture>> = [];
  const resources = {
    validate: vi.fn(),
    resolve: vi.fn(async () => ({ bytes: new ArrayBuffer(1), release: vi.fn() })),
    abort: vi.fn(),
  };
  const runtime = new WorldMediaRuntime('world:1', resources, {
    output: {},
    playbackAllowed: () => true,
    resume: async () => true,
    decode: async () => ({ duration: 1 }) as AudioBuffer,
    createSource: () => {
      const source = sourceFixture();
      sources.push(source);
      return source;
    },
  });
  return { resources, runtime, sources };
};

const sourceFixture = () => ({
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
  onEnded: vi.fn(() => () => undefined),
});

describe('Browser media audio consumer', () => {
  it('plays one insert-and-activate fact once through the formal frontier and audio runtime', async () => {
    const { resources, runtime, sources } = audioFixture();
    const frontier = new BrowserMediaFrontier('world:1', undefined, (batch) => {
      void runtime.consumeFacts(batch.facts);
    });
    const batch = insertAndActivateBatch();
    const [inserted] = batch.facts;
    runtime.installProjections([
      {
        version: 1,
        device: mediaDevice,
        revision: 1,
        slot: { itemId: inserted!.insertedItemId!, trackId: inserted!.trackId! },
        resource: inserted!.resource,
        playing: true,
        resumePending: false,
      },
    ]);
    frontier.replaceEpoch('world:1', runtimeProjection(1));

    expect(frontier.acceptFacts('world:1', batch)).toBe(true);
    await vi.waitFor(() => expect(sources[0]?.start).toHaveBeenCalledOnce());
    expect(frontier.acceptFacts('world:1', batch)).toBe(false);
    expect(sources[0]?.start).toHaveBeenCalledOnce();
    expect(resources.resolve).toHaveBeenCalledOnce();
  });

  it('does not revive an older fact after BrowserAuthority installed a newer stopped projection', async () => {
    const { resources, runtime, sources } = audioFixture();
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1', {
      onMediaProjection: (projections) => runtime.installProjections(projections),
      onMediaFacts: (batch) => void runtime.consumeFacts(batch.facts),
    });
    const base = ready();
    const starting = client.start({
      seedText: 'media-order',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies,
    });
    worker.emit({
      kind: 'authority-ready',
      protocolVersion: 1,
      epoch: 'world:1',
      ready: {
        ...base,
        snapshot: base.snapshot,
        gameplay: {
          ...base.gameplay,
          media: [
            {
              version: 1,
              device: mediaDevice,
              revision: 3,
              slot: null,
              resource: null,
              playing: false,
              resumePending: false,
            },
          ],
        },
      },
    });
    await starting;

    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'world:1',
      batch: insertAndActivateBatch(1),
    });
    await Promise.resolve();

    expect(resources.resolve).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
  });

  it('stops a removed instance and only starts its higher-revision rebuild', async () => {
    const { resources, runtime, sources } = audioFixture();
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1', {
      onMediaProjection: (projections) => runtime.installProjections(projections),
      onMediaFacts: (batch) => void runtime.consumeFacts(batch.facts),
    });
    const base = ready();
    const starting = client.start({
      seedText: 'media-rebuild',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies,
    });
    worker.emit({
      kind: 'authority-ready',
      protocolVersion: 1,
      epoch: 'world:1',
      ready: { ...base, gameplay: { ...base.gameplay, media: [mediaProjection(1)] } },
    });
    await starting;
    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'world:1',
      batch: insertAndActivateBatch(1, 1),
    });
    await vi.waitFor(() => expect(sources[0]?.start).toHaveBeenCalledOnce());

    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'world:1',
      snapshot: { ...base.snapshot, physicsTick: 1, commitSequence: 1 },
      gameplay: { ...base.gameplay, gameplayRevision: 2, media: [] },
    });
    expect(sources[0]?.stop).toHaveBeenCalledOnce();
    expect(sources[0]?.disconnect).toHaveBeenCalledOnce();
    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'world:1',
      batch: insertAndActivateBatch(1, 2),
    });
    expect(sources).toHaveLength(1);

    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'world:1',
      snapshot: { ...base.snapshot, physicsTick: 2, commitSequence: 2 },
      gameplay: { ...base.gameplay, gameplayRevision: 3, media: [mediaProjection(3)] },
    });
    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'world:1',
      batch: insertAndActivateBatch(3, 3),
    });
    await vi.waitFor(() => expect(sources[1]?.start).toHaveBeenCalledOnce());
    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'world:1',
      batch: insertAndActivateBatch(1, 3),
    });

    expect(sources).toHaveLength(2);
    expect(resources.resolve).toHaveBeenCalledTimes(2);
  });

  it('keeps BrowserAuthority projection and fact cursors independent without accepting older state', async () => {
    const worker = new FakeAuthorityWorker();
    const projections = vi.fn();
    const facts = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'world:1', {
      onMediaProjection: projections,
      onMediaFacts: facts,
    });
    const base = ready();
    const initial = { ...base, gameplay: { ...base.gameplay, media: [mediaProjection(4)] } };
    const starting = client.start({
      seedText: 'worker-client',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies,
    });
    worker.emit({ kind: 'authority-ready', protocolVersion: 1, epoch: 'world:1', ready: initial });
    await starting;
    const response = (revision: number) => ({
      kind: 'authority-media-facts' as const,
      protocolVersion: 1 as const,
      epoch: 'world:1',
      batch: { ...insertAndActivateBatch(), facts: [mediaFact(revision)] },
    });

    worker.emit(response(4));
    worker.emit(response(4));
    worker.emit(response(1));

    expect(projections).toHaveBeenCalledOnce();
    expect(facts).toHaveBeenCalledOnce();

    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'world:1',
      snapshot: { ...initial.snapshot, physicsTick: 1 },
      gameplay: { ...initial.gameplay, media: [{ ...mediaProjection(5), playing: false, resumePending: true }] },
    });
    expect(projections).toHaveBeenCalledTimes(2);
    expect(client.gameplay.media).toEqual([{ ...mediaProjection(5), playing: false, resumePending: true }]);
  });

  it('accepts one BrowserAuthority insert-and-activate fact and deduplicates its repeated batch', async () => {
    const worker = new FakeAuthorityWorker();
    const facts = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'world:1', { onMediaFacts: facts });
    const starting = client.start({
      seedText: 'worker-client',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies,
    });
    const base = ready();
    worker.emit({
      kind: 'authority-ready',
      protocolVersion: 1,
      epoch: 'world:1',
      ready: { ...base, gameplay: { ...base.gameplay, media: [mediaProjection(1)] } },
    });
    await starting;
    const batch = insertAndActivateBatch();
    const message = { kind: 'authority-media-facts' as const, protocolVersion: 1 as const, epoch: 'world:1', batch };

    worker.emit(message);
    worker.emit(message);

    expect(facts).toHaveBeenCalledOnce();
    expect(facts).toHaveBeenCalledWith(expect.objectContaining({ facts: batch.facts }));
  });
});

const runtimeProjection = (revision: number) => [
  {
    version: 1 as const,
    device: mediaDevice,
    revision,
    slot: { itemId: 'sample:disc', trackId: 'sample:track' },
    resource: mediaResource,
    playing: true,
    resumePending: false,
  },
];
