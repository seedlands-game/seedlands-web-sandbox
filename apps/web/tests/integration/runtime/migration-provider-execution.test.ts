import {
  createWorldgenProviderRegistry,
  worldgenProviderIdentityKey,
  type KernelWorldgenProvider,
  type KernelWorldgenProviderIdentity,
} from '@seedlands/kernel/spatial';
import { defineStandardWorldgenModule } from '@seedlands/stdlib/mod-api';
import { prepareProviderMeshInput, runWorldComputeTask } from '@seedlands/stdlib/server/compute/world-compute-task';
import { CHUNK_SIZE, normalizeSeed, Voxel, voxelIndex } from '@seedlands/stdlib/world/voxel';
import { describe, expect, it, vi } from 'vitest';
import { createPersistenceWorldgenCache } from '../../../src/worker/persistence-worldgen-cache';

const markedIdentity: KernelWorldgenProviderIdentity = Object.freeze({
  id: 'test:marked-worldgen',
  implementationVersion: '21.4.0',
  configurationIdentity: 'marked-stripes',
  supportedGeneratorVersions: Object.freeze([4]),
  artifactIdentity: 'test:marked-worldgen@21.4.0',
});

const markedVoxel = (seed: number, x: number, y: number, z: number) =>
  (seed + x * 3 + y * 5 + z * 7) % 2 === 0 ? Voxel.Glowstone : Voxel.Air;

const createMarkedProvider = (returnedIdentity = markedIdentity): KernelWorldgenProvider => ({
  identity: markedIdentity,
  generate({ seed, generatorVersion, coordinate, epoch, revision }) {
    const voxels = new Uint16Array(CHUNK_SIZE ** 3);
    for (let y = 0; y < CHUNK_SIZE; y += 1)
      for (let z = 0; z < CHUNK_SIZE; z += 1)
        for (let x = 0; x < CHUNK_SIZE; x += 1)
          voxels[voxelIndex(x, y, z)] = markedVoxel(
            seed,
            coordinate.x * CHUNK_SIZE + x,
            coordinate.y * CHUNK_SIZE + y,
            coordinate.z * CHUNK_SIZE + z,
          );
    return { coordinate, provider: returnedIdentity, generatorVersion, epoch, revision, voxels };
  },
  sampleVoxel({ seed, x, y, z }) {
    return markedVoxel(seed, x, y, z);
  },
});

describe('§21.4 executable world-generation provider', () => {
  it('uses one marked implementation for Worker canonical generation and sparse halo sampling', async () => {
    const base = createMarkedProvider();
    const provider: KernelWorldgenProvider = {
      ...base,
      generate: vi.fn(base.generate),
      sampleVoxel: vi.fn(base.sampleVoxel),
    };
    const providers = createWorldgenProviderRegistry([provider]);
    const canonicalResult = await runWorldComputeTask(
      {
        kind: 'generate-canonical',
        seed: 11,
        generatorVersion: 4,
        provider: markedIdentity,
        key: '1,-1,2',
        cx: 1,
        cy: -1,
        cz: 2,
      },
      undefined,
      undefined,
      { providers },
    );
    expect(canonicalResult.kind).toBe('canonical-result');
    if (canonicalResult.kind !== 'canonical-result') throw new Error('Expected canonical provider output.');
    expect(new Uint16Array(canonicalResult.voxels)[0]).toBe(markedVoxel(11, 32, -32, 64));
    expect(canonicalResult.provider).toEqual(markedIdentity);

    const meshResult = await runWorldComputeTask(
      {
        kind: 'generate-mesh',
        traceId: 'marked-provider',
        epoch: 7,
        chunkKey: '1,-1,2',
        seed: 11,
        cx: 1,
        cy: -1,
        cz: 2,
        chunkRevision: 9,
        haloRevision: 'pending',
        generatorVersion: 4,
        provider: markedIdentity,
        overlays: [],
      },
      undefined,
      undefined,
      { providers, now: () => 0 },
    );
    expect(meshResult.kind).toBe('mesh-result');
    if (!('canonical' in meshResult)) throw new Error('Expected generated provider canonical output.');
    const canonical = new Uint16Array(meshResult.canonical);
    expect(canonical[0]).toBe(markedVoxel(11, 32, -32, 64));
    expect(meshResult.provider).toEqual(markedIdentity);
    const expectedHalo = prepareProviderMeshInput({
      seed: 11,
      cx: 1,
      cy: -1,
      cz: 2,
      generatorVersion: 4,
      provider,
      canonical,
      overlays: [],
    });
    expect(meshResult.computedHaloRevision).toBe(expectedHalo.haloRevision);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.sampleVoxel).toHaveBeenCalled();
  });

  it('binds the full provider identity into the module definition map input', () => {
    const provider = createMarkedProvider();
    const module = defineStandardWorldgenModule({ moduleId: 'test:marked-worldgen-module', provider });
    expect(module.descriptor.provides).toEqual([
      {
        id: 'seedlands:worldgen-provider',
        version: '1.0.0',
        definitionIdentity: worldgenProviderIdentityKey(markedIdentity),
      },
    ]);
  });

  it('uses the same marked executable for persistence procedural baselines', () => {
    const provider = createMarkedProvider();
    const providers = createWorldgenProviderRegistry([provider]);
    const config = {
      databaseName: 'test',
      worldId: 'test:marked-world',
      seedText: 'marked-persistence',
      generatorVersion: 4,
      provider: markedIdentity,
    };
    const cache = createPersistenceWorldgenCache(() => config, providers);
    const request = {
      seedText: config.seedText,
      generatorVersion: config.generatorVersion,
      providerIdentity: worldgenProviderIdentityKey(config.provider),
      cx: 1,
      cy: -1,
      cz: 2,
    };

    expect(cache.get(request)[0]).toBe(markedVoxel(normalizeSeed(config.seedText), 32, -32, 64));
    expect(() =>
      cache.get({
        ...request,
        providerIdentity: worldgenProviderIdentityKey({
          ...config.provider,
          configurationIdentity: 'stale-persistence-config',
        }),
      }),
    ).toThrow(/stale/i);
  });

  it('rejects missing executables, old identities, and tampered generated artifacts', async () => {
    const provider = createMarkedProvider();
    const task = {
      kind: 'generate-canonical' as const,
      seed: 11,
      generatorVersion: 4,
      provider: markedIdentity,
      key: '0,0,0',
      cx: 0,
      cy: 0,
      cz: 0,
    };
    await expect(runWorldComputeTask(task)).rejects.toThrow(/executable provider registry/i);

    const providers = createWorldgenProviderRegistry([provider]);
    await expect(
      runWorldComputeTask(
        { ...task, provider: { ...markedIdentity, configurationIdentity: 'old-default-config' } },
        undefined,
        undefined,
        { providers },
      ),
    ).rejects.toThrow(/identity/i);

    const tamperedIdentity = { ...markedIdentity, artifactIdentity: 'tampered:artifact@1' };
    const tamperedProviders = createWorldgenProviderRegistry([createMarkedProvider(tamperedIdentity)]);
    await expect(runWorldComputeTask(task, undefined, undefined, { providers: tamperedProviders })).rejects.toThrow(
      /identity/i,
    );

    await expect(
      runWorldComputeTask({ ...task, provider: undefined } as unknown as typeof task, undefined, undefined, {
        providers,
      }),
    ).rejects.toThrow(/provider identity/i);
  });
});
