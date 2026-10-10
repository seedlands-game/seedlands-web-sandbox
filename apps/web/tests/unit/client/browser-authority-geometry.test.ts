import { describe, expect, it } from 'vitest';
import { FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import type { AuthorityResponse } from '../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { FakeAuthorityWorker, frequencies, ready } from './fixtures/browser-authority';
import { testWorldgenProvider } from './fixtures/worldgen-provider';
import { createWorkerFirstDispatch } from '../../../src/app/world/mesh-task-dispatch';
import type { VoxelSemanticsDefinition } from '../../../../../packages/stdlib/src/world/voxel-semantics';

const geometry = (minimum: number) => [
  {
    version: 1 as const,
    voxel: 500,
    boxes: [
      { min: [minimum, 0, 0] as const, max: [minimum + 0.125, 1, 1] as const, material: FaceMaterial.WoodenDoor },
    ],
    collision: [{ min: [minimum, 0, 0] as const, max: [minimum + 0.125, 1, 1] as const }],
    occludesFullFace: false,
  },
];
const semantics: readonly VoxelSemanticsDefinition[] = [
  {
    id: 'sample:panel',
    storageId: 500,
    solid: true,
    targetable: true,
    renderable: true,
    meshKind: 'cube',
    emission: 0,
    lightCost: 16,
    faceMaterials: Array(6).fill(FaceMaterial.WoodenDoor) as VoxelSemanticsDefinition['faceMaterials'],
  },
];

describe('BrowserAuthorityClient geometry lifecycle', () => {
  it('rebuilds a per-ready registry and forwards the validated mesh projection', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const starting = client.start({
      seedText: 'geometry',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies,
    });
    worker.emit({
      kind: 'authority-ready',
      protocolVersion: 1,
      epoch: 'world:1',
      ready: { ...ready(), voxelSemantics: semantics, voxelGeometry: geometry(0.125) },
    });
    await starting;
    expect(client.voxelGeometry?.require(500).boxes[0]?.min[0]).toBe(0.125);

    const preparing = client.ensureChunkNeighborhood(0, 0, 0);
    const request = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'mesh-prepared',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      payload: {
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 1,
        generatorVersion: 3,
        provider: testWorldgenProvider,
        voxelSemantics: semantics,
        voxelGeometry: geometry(0.125),
        overlays: [],
      },
    });
    await preparing;
    const prepared = client.prepareWorkerInput(0, 0, 0);
    expect(prepared.voxelGeometry).toEqual(geometry(0.125));
    const dispatch = createWorkerFirstDispatch(
      1,
      {
        traceId: 'geometry',
        epoch: 1,
        chunkKey: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        priority: 'streaming',
      },
      7,
      prepared,
    );
    expect(dispatch.message.voxelGeometry).toBe(prepared.voxelGeometry);
  });

  it('atomically switches registries on restore and keeps the previous world on malformed geometry', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const starting = client.start({
      seedText: 'geometry',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies,
    });
    worker.emit({
      kind: 'authority-ready',
      protocolVersion: 1,
      epoch: 'world:1',
      ready: { ...ready(), voxelSemantics: semantics, voxelGeometry: geometry(0.125) },
    });
    await starting;
    const preparing = client.ensureChunkNeighborhood(0, 0, 0);
    const prepareRequest = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'mesh-prepared',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: prepareRequest.requestId,
      payload: {
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 1,
        generatorVersion: 3,
        provider: testWorldgenProvider,
        voxelSemantics: semantics,
        voxelGeometry: geometry(0.125),
        overlays: [],
      },
    });
    await preparing;
    expect(client.prepareWorkerInput(0, 0, 0).voxelGeometry).toEqual(geometry(0.125));

    const restoring = client.world.checkpoint({ kind: 'restore', snapshot: {} });
    const request = worker.posts.at(-1) as { requestId: number };
    const restored = ready();
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      result: { ok: true, data: { restored: true, byteLength: 1 } },
      runtimeEpoch: 'world:1:runtime:1',
      ready: {
        ...restored,
        snapshot: { ...restored.snapshot, epoch: 'world:1:runtime:1' },
        voxelSemantics: semantics,
        voxelGeometry: geometry(0.75),
      },
    } as AuthorityResponse);
    await restoring;
    expect(client.voxelGeometry?.require(500).boxes[0]?.min[0]).toBe(0.75);
    expect(() => client.prepareWorkerInput(0, 0, 0)).toThrow(/not prepared/i);

    const rejected = client.world.checkpoint({ kind: 'restore', snapshot: {} });
    const rejectedRequest = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: rejectedRequest.requestId,
      result: { ok: true, data: { restored: true, byteLength: 1 } },
      runtimeEpoch: 'world:1:runtime:2',
      ready: {
        ...restored,
        snapshot: { ...restored.snapshot, epoch: 'world:1:runtime:2' },
        voxelSemantics: semantics,
        voxelGeometry: [{ ...geometry(0.5)[0]!, boxes: new Array(2) }],
      },
    } as unknown as AuthorityResponse);
    await expect(rejected).rejects.toThrow(/dense/i);
    expect(client.voxelGeometry?.require(500).boxes[0]?.min[0]).toBe(0.75);
    expect(client.readyState?.snapshot.epoch).toBe('world:1:runtime:1');
  });

  it('rejects a mesh payload from another composition before caching it', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const starting = client.start({
      seedText: 'geometry',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies,
    });
    worker.emit({
      kind: 'authority-ready',
      protocolVersion: 1,
      epoch: 'world:1',
      ready: { ...ready(), voxelSemantics: semantics, voxelGeometry: geometry(0.125) },
    });
    await starting;

    const preparing = client.ensureChunkNeighborhood(0, 0, 0);
    const request = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'mesh-prepared',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      payload: {
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 1,
        generatorVersion: 3,
        provider: testWorldgenProvider,
        voxelSemantics: semantics,
        voxelGeometry: geometry(0.75),
        canonical: new Uint16Array(32 ** 3).buffer,
        overlays: [],
      },
    });

    await expect(preparing).rejects.toThrow(/active world/i);
    expect(() => client.prepareWorkerInput(0, 0, 0)).toThrow(/not prepared/i);
    expect(client.getChunkRevision(0, 0, 0)).toBeNull();
  });
});
