import { describe, expect, it, vi } from 'vitest';
import { createVoxelGeometryRegistryV1, type MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';
import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { createHarnessObservability } from '../../../src/app/gameplay/game-harness-observability';

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

const bindings = () => {
  let authorityEpoch = 'world:2';
  let renderedWorldEpoch: string | null = 'world:2';
  let authorityGeometry = geometry;
  const authority = {
    get voxelGeometry() {
      return authorityGeometry;
    },
    get runtimeEpoch() {
      return authorityEpoch;
    },
  };
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
    authority: () => authority,
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
});
