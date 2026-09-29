import { createWorldgenProviderRegistry } from '@seedlands/kernel/spatial';
import {
  defineBlockActionsModule,
  defineBlockRulesModule,
  defineContentModule,
  definePack,
  defineStandardWorldgenModule,
  defineVoxelGeometryModule,
  VOXEL_GEOMETRY_CAPABILITY,
  type VoxelGeometryRegistryV1,
} from '@seedlands/stdlib/mod-api';
import type { WorldComputePayload } from '@seedlands/stdlib/server/compute/world-compute-task';
import { runWorldComputeTask } from '@seedlands/stdlib/server/compute/world-compute-task';
import { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import { FaceMaterial } from '@seedlands/stdlib/world/voxel';
import { expect, it } from 'vitest';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { modularWorldgenProvider } from '../../../../fixtures/packs/modular-world/modular-world';
import { createWorkerFirstDispatch } from '../../../../../src/app/world/mesh-task-dispatch';
import { BrowserAuthorityClient } from '../../../../../src/client/authority/browser-authority-client';
import {
  createBrowserAuthorityRuntime,
  prepareBrowserAuthorityWorldgen,
} from '../../../../../src/worker/authority-worldgen-runtime';
import { FakeAuthorityWorker, frequencies } from '../../../../unit/client/fixtures/browser-authority';

const VOXEL = 500;
const faceMaterials = [
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
] as const;
const shape = (minimum: number) => ({ min: [minimum, 0, 0] as const, max: [minimum + 0.125, 1, 1] as const });

const sourcePack = (id: string, minimum?: number, collision = true) => {
  const modules = [
    defineStandardWorldgenModule({ moduleId: `${id}-worldgen`, provider: modularWorldgenProvider }),
    defineContentModule({
      moduleId: `${id}-content`,
      items: [
        {
          id: `${id}-panel`,
          name: 'Panel',
          itemType: 'block',
          stackLimit: 64,
          capabilities: [{ type: 'place', voxel: VOXEL }],
        },
      ],
      voxels: [
        {
          id: `${id}-air`,
          storageId: 0,
          solid: false,
          targetable: false,
          renderable: false,
          meshKind: 'cube',
          emission: 0,
          lightCost: 1,
          faceMaterials,
        },
        {
          id: `${id}-panel`,
          storageId: VOXEL,
          solid: collision,
          targetable: true,
          renderable: true,
          meshKind: 'cube',
          emission: 0,
          lightCost: 16,
          faceMaterials,
        },
      ],
      meleeDefinitions: [],
    }),
    ...(minimum === undefined
      ? []
      : [
          defineVoxelGeometryModule({
            moduleId: `${id}-geometry`,
            descriptors: [
              {
                version: 1,
                voxel: VOXEL,
                boxes: [{ ...shape(minimum), material: FaceMaterial.WoodenDoor }],
                collision: collision ? [shape(minimum)] : [],
                occludesFullFace: false,
              },
            ],
          }),
        ]),
    defineBlockActionsModule(),
    defineBlockRulesModule({
      moduleId: `${id}-rules`,
      voxelDefinitions: [
        { voxel: 0, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
        { voxel: VOXEL, hardnessSeconds: 1, preferredTool: null, drop: null, replaceable: false },
      ],
    }),
  ];
  return definePack({ id, version: '1.0.0', kind: 'playbook', modules });
};

const prepare = (id: string, minimum?: number, collision = true) => {
  const pack = sourcePack(id, minimum, collision);
  const integrity = {
    algorithm: 'sha256' as const,
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  };
  return prepareBrowserAuthorityWorldgen(
    [{ ...pack, integrity }],
    {
      id,
      version: '1.0.0',
      integrity,
      permissions: pack.modules.flatMap((module) => module.descriptor.permissions ?? []),
    },
    [],
    undefined,
  );
};

const runtime = (prepared: ReturnType<typeof prepare>, epoch: string) =>
  createBrowserAuthorityRuntime(prepared, {
    epoch,
    seedText: epoch,
    initialWorldTime: 9,
    initialPlayerBodyPosition: [10.5, 65, 10.5],
  });

const acceptFloor = (runtime: Awaited<ReturnType<typeof createBrowserAuthorityRuntime>>) => {
  const generated = modularWorldgenProvider.generate({
    seed: runtime.server.seed,
    generatorVersion: runtime.server.generatorVersion,
    coordinate: { x: 0, y: 2, z: 0 },
    epoch: 0,
    revision: 0,
  });
  return runtime.acceptGeneratedChunk({
    key: '0,2,0',
    cx: 0,
    cy: 2,
    cz: 0,
    chunkRevision: 0,
    generatorVersion: runtime.server.generatorVersion,
    provider: modularWorldgenProvider.identity,
    canonical: generated.voxels,
  });
};

it('propagates isolated per-composition geometry through Authority ready, mesh payload and real Worker output', async () => {
  const west = prepare('sample:west-geometry', 0);
  const east = prepare('sample:east-geometry', 0.875);
  const westRegistry = (west as { voxelGeometry?: VoxelGeometryRegistryV1 }).voxelGeometry;
  const eastRegistry = (east as { voxelGeometry?: VoxelGeometryRegistryV1 }).voxelGeometry;
  expect(westRegistry).toBe(west.assembly.composition.capability(VOXEL_GEOMETRY_CAPABILITY));
  expect(eastRegistry).toBe(east.assembly.composition.capability(VOXEL_GEOMETRY_CAPABILITY));
  expect(westRegistry).not.toBe(eastRegistry);
  await expect(
    AuthorityRuntime.create({
      ...west.assembly,
      epoch: 'geometry:mismatched-registry',
      seedText: 'geometry:mismatched-registry',
      initialWorldTime: 9,
      initialPlayerBodyPosition: [10.5, 65, 10.5],
      platform: testCorePlatform,
      worldgenProvider: west.worldgenProvider,
      voxelGeometry: eastRegistry,
      startTimeMs: 0,
    }),
  ).rejects.toThrow(/active composition capability instance/i);

  const westRuntime = await runtime(west, 'geometry:west');
  const eastRuntime = await runtime(east, 'geometry:east');
  try {
    expect(westRuntime.server.voxelGeometry).toBe(westRegistry);
    expect(eastRuntime.server.voxelGeometry).toBe(eastRegistry);
    for (const current of [westRuntime, eastRuntime])
      await current.editWorld('fixture', [{ x: 4, y: 5, z: 6, value: VOXEL }]);
    const westPayload = await westRuntime.prepareMesh(0, 0, 0);
    const eastPayload = await eastRuntime.prepareMesh(0, 0, 0);
    expect(westRuntime.ready().voxelGeometry?.[0]?.boxes[0]?.min[0]).toBe(0);
    expect(eastRuntime.ready().voxelGeometry?.[0]?.boxes[0]?.min[0]).toBe(0.875);
    expect(westPayload.voxelGeometry).toEqual(westRuntime.ready().voxelGeometry);
    expect(eastPayload.voxelGeometry).toEqual(eastRuntime.ready().voxelGeometry);

    const mesh = async (
      current: Awaited<ReturnType<typeof createBrowserAuthorityRuntime>>,
      payload: typeof westPayload,
    ) => {
      const worker = new FakeAuthorityWorker();
      const ready = current.ready();
      const client = new BrowserAuthorityClient(worker, ready.snapshot.epoch);
      const starting = client.start({
        seedText: current.server.seed.toString(),
        openMode: 'continue',
        legacySnapshots: [],
        initialWorldTime: 9,
        frequencies,
      });
      worker.emit({
        kind: 'authority-ready',
        protocolVersion: 1,
        epoch: client.epoch,
        ready,
      });
      await starting;
      const loading = client.ensureChunkNeighborhood(payload.cx, payload.cy, payload.cz);
      const request = worker.posts.at(-1) as { requestId: number };
      worker.emit({
        kind: 'mesh-prepared',
        protocolVersion: 1,
        epoch: client.epoch,
        requestId: request.requestId,
        payload,
      });
      await loading;
      const prepared = client.prepareWorkerInput(payload.cx, payload.cy, payload.cz);
      const dispatch = createWorkerFirstDispatch(
        1,
        {
          traceId: 'geometry',
          epoch: 1,
          chunkKey: payload.key,
          cx: payload.cx,
          cy: payload.cy,
          cz: payload.cz,
          priority: 'streaming',
        },
        current.server.seed,
        prepared,
      );
      const result = await runWorldComputeTask(
        dispatch.message as WorldComputePayload,
        () => false,
        () => Promise.resolve(),
        {
          providers: createWorldgenProviderRegistry([modularWorldgenProvider]),
          now: testCorePlatform.now,
        },
      );
      client.dispose();
      return result;
    };
    const westMesh = await mesh(westRuntime, westPayload);
    const eastMesh = await mesh(eastRuntime, eastPayload);
    if (westMesh.kind !== 'mesh-result' || eastMesh.kind !== 'mesh-result') throw new Error('Expected mesh result.');
    const xCoordinates = (result: typeof westMesh) =>
      new Set(result.meshes.flatMap((part) => [...part.positions]).filter((_value, index) => index % 3 === 0));
    expect(xCoordinates(westMesh)).toContain(4);
    expect(xCoordinates(eastMesh)).toContain(4.875);
  } finally {
    westRuntime.server.disposeGameplay();
    eastRuntime.server.disposeGameplay();
  }
});

it('uses one composition registry for Authority physics, placement occupancy and recovery', async () => {
  const blocking = prepare('sample:blocking-geometry', 0.4);
  const open = prepare('sample:open-geometry', 0.4, false);
  const blockingRuntime = await runtime(blocking, 'geometry:blocking');
  const openRuntime = await runtime(open, 'geometry:open');
  try {
    expect(acceptFloor(blockingRuntime)).toBe(true);
    expect(acceptFloor(openRuntime)).toBe(true);
    blockingRuntime.wake(blockingRuntime.sessionTimeMs + 20);
    openRuntime.wake(openRuntime.sessionTimeMs + 20);
    expect(blockingRuntime.snapshot().player.body.position.y).toBeCloseTo(65, 4);
    expect(openRuntime.snapshot().player.body.position.y).toBeLessThan(65);

    for (const current of [blockingRuntime, openRuntime])
      current.server.giveItem(current.playerId, {
        itemId: `${current === blockingRuntime ? 'sample:blocking-geometry' : 'sample:open-geometry'}-panel`,
        count: 1,
      });
    expect(blockingRuntime.server.placeVoxel(blockingRuntime.playerId, [10, 65, 10])).toMatchObject({
      success: false,
      reason: 'player-collision',
    });
    expect(openRuntime.server.placeVoxel(openRuntime.playerId, [10, 65, 10])).toMatchObject({ success: true });

    const blockingRecoveries = blockingRuntime.snapshot().diagnostics?.recoveryResults.length ?? 0;
    const openRecoveries = openRuntime.snapshot().diagnostics?.recoveryResults.length ?? 0;
    await blockingRuntime.editWorld('fixture', [{ x: 10, y: 65, z: 10, value: VOXEL }]);
    blockingRuntime.wake(blockingRuntime.sessionTimeMs + 20);
    openRuntime.wake(openRuntime.sessionTimeMs + 20);
    expect(blockingRuntime.snapshot().diagnostics?.recoveryResults.length).toBeGreaterThan(blockingRecoveries);
    expect(openRuntime.snapshot().diagnostics?.recoveryResults.length ?? 0).toBe(openRecoveries);
  } finally {
    blockingRuntime.server.disposeGameplay();
    openRuntime.server.disposeGameplay();
  }
});

it('keeps legacy worlds compatible when no geometry capability is installed', async () => {
  const prepared = prepare('sample:no-geometry');
  expect((prepared as { voxelGeometry?: unknown }).voxelGeometry).toBeUndefined();
  const current = await runtime(prepared, 'geometry:legacy');
  try {
    expect(current.ready()).not.toHaveProperty('voxelGeometry');
    await expect(current.prepareMesh(0, 0, 0)).resolves.not.toHaveProperty('voxelGeometry');
  } finally {
    current.server.disposeGameplay();
  }
});
