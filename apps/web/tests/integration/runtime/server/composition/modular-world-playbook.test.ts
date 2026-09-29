import { expect, it } from 'vitest';
import { assembleWorldPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import { WORLDGEN_PROVIDER_CAPABILITY } from '@seedlands/stdlib/mod-api';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { projectGameplayViewReference } from '../../../../../../../packages/stdlib/src/server/protocol/network-reference-projection';
import { createMeshSemanticsLookup } from '@seedlands/stdlib/world/mesh-semantics';
import { buildBlockLightVolume, sampleBlockLight } from '@seedlands/stdlib/world/voxel-light';
import { GameServer } from '../../../../fixtures/classic/content';
import { createWorldgenProviderRegistry } from '@seedlands/kernel/spatial';
import { runWorldComputeTask } from '../../../../../../../packages/stdlib/src/server/compute/world-compute-task';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import {
  MODULAR_WORLD_SENTINEL_POSITION,
  MODULAR_WORLD_SENTINEL_VOXEL,
  modularWorldContentCandidates,
  modularWorldgenIdentity,
  modularWorldgenProvider,
  pack,
} from '../../../../fixtures/packs/modular-world/modular-world';

const artifact: VerifiedPackArtifact = {
  ...pack,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: (pack.manifest.resources ?? []).map((path) => ({ path, digest: 'c'.repeat(64) })),
  },
};
const assemble = () =>
  assembleWorldPacks([artifact], {
    approvedPermissions: {
      [pack.manifest.id]: pack.modules.flatMap((module) => module.descriptor.permissions ?? []),
    },
  });

const runtime = () => {
  const runtime = new GameplayRuntime({
    composition: assemble(),
    platform: testCorePlatform,
    getVoxel: () => 0,
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('unused');
    },
  });
  runtime.spawnPlayer({ id: 'player', position: [0, 2, 0] });
  return runtime;
};

it('第二 Playbook 只通过公开 worldgen provider API 生成和采样其 storageId 500 哨兵方块', () => {
  const composition = assemble();
  const provider = composition.capability<typeof modularWorldgenProvider>(WORLDGEN_PROVIDER_CAPABILITY);
  const semantics =
    composition.capability<import('@seedlands/stdlib/world/voxel-semantics').VoxelSemanticsRegistry>(
      'seedlands:voxel-semantics',
    );
  const coordinate = {
    x: Math.floor(MODULAR_WORLD_SENTINEL_POSITION[0] / 32),
    y: Math.floor(MODULAR_WORLD_SENTINEL_POSITION[1] / 32),
    z: Math.floor(MODULAR_WORLD_SENTINEL_POSITION[2] / 32),
  };
  const input = { seed: 917, generatorVersion: 11, coordinate, epoch: 3, revision: 5 };

  expect(provider.identity).toEqual(modularWorldgenProvider.identity);
  expect(provider.generate(input)).toEqual(provider.generate(input));
  expect(
    provider.sampleVoxel({ seed: 917, generatorVersion: 11, ...toPosition(MODULAR_WORLD_SENTINEL_POSITION) }),
  ).toBe(MODULAR_WORLD_SENTINEL_VOXEL);
  expect(createMeshSemanticsLookup(semantics.list()).isGlass(MODULAR_WORLD_SENTINEL_VOXEL)).toBe(true);
  expect(createMeshSemanticsLookup(semantics.list()).renderCategory(21)).toBe('cutout');
  const light = buildBlockLightVolume(
    3,
    [-1, -1, -1],
    (x, y, z) => (x === 0 && y === 0 && z === 0 ? MODULAR_WORLD_SENTINEL_VOXEL : 0),
    semantics,
  );
  expect(sampleBlockLight(light, 1, 0, 0)).toBe(14);
});

it('第二 Playbook 可通过通用 Worker 计算合同寻找出生点并生成 canonical Chunk', async () => {
  const composition = assemble();
  const semantics =
    composition.capability<import('@seedlands/stdlib/world/voxel-semantics').VoxelSemanticsRegistry>(
      'seedlands:voxel-semantics',
    );
  const kernels = {
    providers: createWorldgenProviderRegistry([modularWorldgenProvider]),
    now: () => 0,
  };
  const bootstrap = await runWorldComputeTask(
    {
      kind: 'find-safe-spawn',
      seed: 917,
      generatorVersion: 11,
      provider: modularWorldgenIdentity,
      starterEcology: null,
      voxelSemantics: semantics.list(),
    },
    () => false,
    () => Promise.resolve(),
    kernels,
  );
  expect(bootstrap).toMatchObject({
    kind: 'safe-spawn-result',
    playerBodyPosition: [0.5, 65, 0.5],
  });
  if (bootstrap.kind !== 'safe-spawn-result') throw new Error('Modular bootstrap failed.');
  expect(bootstrap.starterChunks.length).toBeGreaterThan(0);
  const canonical = await runWorldComputeTask(
    {
      kind: 'generate-canonical',
      seed: 917,
      generatorVersion: 11,
      provider: modularWorldgenIdentity,
      key: '0,2,0',
      cx: 0,
      cy: 2,
      cz: 0,
    },
    () => false,
    () => Promise.resolve(),
    kernels,
  );
  expect(canonical).toMatchObject({ kind: 'canonical-result', key: '0,2,0' });
  if (canonical.kind !== 'canonical-result') throw new Error('Modular canonical generation failed.');
  expect(new Uint16Array(canonical.voxels)[0]).toBe(MODULAR_WORLD_SENTINEL_VOXEL);
});

it('第二 Playbook 的 sample:sentinel 跨 spawn、协议投影和 checkpoint 恢复保持 registry 准入', () => {
  const source = runtime();
  source.spawnAutonomous(
    {
      id: 'sentinel',
      archetype: modularWorldContentCandidates.actorProfile.archetype,
      position: [1, 2, 3],
    },
    { archetype: modularWorldContentCandidates.actorProfile.archetype },
  );
  const projected = projectGameplayViewReference(
    {
      gameplayRevision: source.gameplayRevision,
      gameplayTime: source.gameplayTime,
      player: source.getPlayerState('player'),
      inventory: source.getInventoryPointerView('player'),
      entities: source.queryEntities(),
      actors: source.simulation.snapshot().actors,
      craftableRecipeIds: source.listCraftable('player').map((recipe) => recipe.id),
      metrics: source.metrics(),
    },
    {
      epoch: 'sample:modular-world',
      snapshotPhysicsTick: 0,
      snapshotCommitSequence: 0,
      snapshotWorldRevision: 0,
    },
  );
  expect(projected.entities).toContainEqual(
    expect.objectContaining({ id: 'sentinel', archetype: modularWorldContentCandidates.actorProfile.archetype }),
  );

  const saved = source.createSnapshot();
  const target = runtime();
  expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
  expect(target.getEntity('sentinel')).toMatchObject({
    archetype: modularWorldContentCandidates.actorProfile.archetype,
    maxHealth: modularWorldContentCandidates.actorProfile.maxHealth,
  });

  const forged = structuredClone(saved);
  const actor = forged.entityStore.entities.find((entity) => entity.id === 'sentinel')!;
  actor.archetype = 'sample:unregistered';
  const simulated = forged.simulation.actors.find((entry) => entry.entityId === 'sentinel')!;
  simulated.archetype = 'sample:unregistered';
  const before = target.createSnapshot();
  expect(() => target.restoreSnapshot(forged)).toThrow(/unknown actor profile/i);
  expect(target.createSnapshot()).toEqual(before);
});

it('第二 Playbook 的 storageId 500 可被 Authority 接受、写入并投影到 worker mesh payload', async () => {
  const composition = assemble();
  const server = new GameServer({
    composition,
    worldgenProvider: modularWorldgenProvider,
    platform: testCorePlatform,
    seedText: 'modular-authority',
  });
  const key = '312,3,312';
  expect(
    server.acceptWorkerCanonical({
      key,
      cx: 312,
      cy: 3,
      cz: 312,
      chunkRevision: 0,
      generatorVersion: server.generatorVersion,
      provider: modularWorldgenIdentity,
      canonical: new Uint16Array(32 ** 3),
    }),
  ).toBe(true);
  expect(server.edit(10_000, 100, 10_000, MODULAR_WORLD_SENTINEL_VOXEL).committed).toBe(true);
  expect(server.getVoxel(10_000, 100, 10_000)).toBe(MODULAR_WORLD_SENTINEL_VOXEL);
  expect(() => server.edit(10_000, 100, 10_000, 501)).toThrow(/registered voxel/i);
  const prepared =
    await import('../../../../../../../packages/stdlib/src/server/authority/authority-mesh-payload').then(
      ({ prepareAuthorityMeshPayload }) => prepareAuthorityMeshPayload(server, testCorePlatform.now, 312, 3, 312),
    );
  expect(prepared.voxelSemantics).toContainEqual(
    expect.objectContaining({ storageId: MODULAR_WORLD_SENTINEL_VOXEL, emission: 15, meshKind: 'glass' }),
  );
});

const toPosition = ([x, y, z]: readonly [number, number, number]) => ({ x, y, z });
