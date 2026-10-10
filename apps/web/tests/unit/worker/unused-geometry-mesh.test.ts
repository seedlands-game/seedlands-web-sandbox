import { deepStrictEqual } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { testWorldgenProvider, testWorldgenProviders } from '../../../../../packages/stdlib/tests/support/worldgen';
import { runWorldComputeTask } from '../../../../../packages/stdlib/src/server/compute/world-compute-task';
import { batchCompactMeshData } from '../../../../../packages/stdlib/src/world/mesh-batching';
import { meshChunk, meshHaloIndex, type MeshData } from '../../../../../packages/stdlib/src/world/mesh';
import { Voxel, voxelIndex } from '../../../../../packages/stdlib/src/world/voxel';
import { createVoxelGeometryRegistryV1 } from '../../../../../packages/stdlib/src/world/voxel-geometry';
import { createMeshSemanticsLookup } from '../../../../../packages/stdlib/src/world/mesh-semantics';
import { overworldVoxelSemantics } from '../../../../../playbooks/classic/src/blocks';
import { classicWoodenDoorGeometryDescriptors } from '../../../../../playbooks/classic/src/structure-descriptors';
import { createMeshKernelInput } from '../../../src/compute/mesh-kernel';
import { createKernelMemory } from '../../../src/compute/kernel-memory';
import { worldKernelAdapter } from '../../../src/worker/world-kernel-adapter';

const CHUNK = 32;
const HALO = 34;
const GEOMETRY_WASM = new URL('../../../src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url);

function expectPackedMeshesEqual(actual: readonly MeshData[], expected: readonly MeshData[]) {
  expect(actual.map(({ material, renderCategory, layout }) => ({ material, renderCategory, layout }))).toEqual(
    expected.map(({ material, renderCategory, layout }) => ({ material, renderCategory, layout })),
  );
  for (let index = 0; index < expected.length; index += 1) {
    const left = actual[index]!;
    const right = expected[index]!;
    deepStrictEqual(left.positions, right.positions);
    deepStrictEqual(left.normals, right.normals);
    deepStrictEqual(left.uvs, right.uvs);
    deepStrictEqual(left.colors, right.colors);
    deepStrictEqual(left.indices, right.indices);
  }
}

describe('unused registered geometry in worker mesh window', () => {
  it('uses the real W04/W05 ABI when none of the complete derived window uses a geometry definition', async () => {
    const geometry = createVoxelGeometryRegistryV1(classicWoodenDoorGeometryDescriptors);
    const semantics = createMeshSemanticsLookup(overworldVoxelSemantics);
    const canonical = new Uint16Array(CHUNK ** 3);
    const halo = new Uint16Array(HALO ** 3);
    const fluid = new Uint8Array(CHUNK ** 3);
    const fluidHalo = new Uint8Array(HALO ** 3);

    for (let z = 0; z < CHUNK; z += 1) for (let x = 0; x < CHUNK; x += 1) canonical[voxelIndex(x, 0, z)] = Voxel.Stone;
    for (let y = 0; y < CHUNK; y += 1)
      for (let z = 0; z < CHUNK; z += 1)
        for (let x = 0; x < CHUNK; x += 1) {
          halo[meshHaloIndex(x, y, z)] = canonical[voxelIndex(x, y, z)]!;
          fluidHalo[meshHaloIndex(x, y, z)] = fluid[voxelIndex(x, y, z)]!;
        }

    const meshOptions = {
      seed: 7,
      cx: 0,
      cy: 0,
      cz: 0,
      data: canonical,
      changes: [],
      halo,
      fluid,
      fluidHalo,
      outside: () => Voxel.Air,
      generatorVersion: 3,
      semantics,
      geometry,
    };
    const window = createMeshKernelInput(meshOptions).window;
    expect([...window].some((voxel) => geometry.get(voxel) !== undefined)).toBe(false);

    const kernel = await createKernelMemory(await readFile(GEOMETRY_WASM));
    const adapter = worldKernelAdapter(
      {
        memory: kernel,
        selected: ['w04', 'w05'],
        status: 'matched',
        requestedArtifact: 'scalar',
        effectiveArtifact: 'scalar',
      },
      testWorldgenProviders.resolve(testWorldgenProvider, 3),
    );
    const result = await runWorldComputeTask(
      {
        kind: 'mesh',
        traceId: 'unused-geometry-window',
        epoch: 1,
        chunkKey: '0,0,0',
        seed: meshOptions.seed,
        cx: meshOptions.cx,
        cy: meshOptions.cy,
        cz: meshOptions.cz,
        chunkRevision: 1,
        haloRevision: 'same-window',
        generatorVersion: meshOptions.generatorVersion,
        provider: testWorldgenProvider,
        canonical: canonical.buffer,
        halo: halo.buffer,
        fluid: fluid.buffer,
        fluidHalo: fluidHalo.buffer,
        voxelSemantics: overworldVoxelSemantics,
        voxelGeometry: geometry.list(),
      },
      undefined,
      undefined,
      { providers: testWorldgenProviders, now: () => performance.now(), ...adapter },
    );
    if (result.kind !== 'mesh-result') throw new Error('Unexpected worker compute result.');

    const jsParts = Object.values(meshChunk(meshOptions));
    expectPackedMeshesEqual(result.meshes, batchCompactMeshData(jsParts));
    expect(kernel.failed).toBe(false);
    expect(kernel.diagnostics().calls).toBeGreaterThan(0);
  });

  it('keeps body, halo, and water-top second-ring geometry on the JS path', async () => {
    const geometry = createVoxelGeometryRegistryV1(classicWoodenDoorGeometryDescriptors);
    const semantics = createMeshSemanticsLookup(overworldVoxelSemantics);
    const customVoxel = geometry.list()[0]!.voxel;
    const kernel = await createKernelMemory(await readFile(GEOMETRY_WASM));
    const adapter = worldKernelAdapter(
      {
        memory: kernel,
        selected: ['w04', 'w05'],
        status: 'matched',
        requestedArtifact: 'scalar',
        effectiveArtifact: 'scalar',
      },
      testWorldgenProviders.resolve(testWorldgenProvider, 3),
    );

    const options = () => {
      const data = new Uint16Array(CHUNK ** 3);
      const halo = new Uint16Array(HALO ** 3);
      const fluid = new Uint8Array(CHUNK ** 3);
      const fluidHalo = new Uint8Array(HALO ** 3);
      for (let z = 0; z < CHUNK; z += 1) for (let x = 0; x < CHUNK; x += 1) data[voxelIndex(x, 0, z)] = Voxel.Stone;
      for (let y = 0; y < CHUNK; y += 1)
        for (let z = 0; z < CHUNK; z += 1)
          for (let x = 0; x < CHUNK; x += 1) halo[meshHaloIndex(x, y, z)] = data[voxelIndex(x, y, z)]!;
      return {
        seed: 7,
        cx: 0,
        cy: 0,
        cz: 0,
        data,
        changes: [],
        halo,
        fluid,
        fluidHalo,
        outside: (_x: number, _y: number, _z: number): number => Voxel.Air,
        generatorVersion: 3,
        semantics,
        geometry,
      };
    };

    const body = options();
    body.data[voxelIndex(4, 4, 4)] = customVoxel;
    adapter.meshChunk?.(body);

    const halo = options();
    halo.halo[meshHaloIndex(CHUNK, 4, 4)] = customVoxel;
    adapter.meshChunk?.(halo);

    const waterTop = options();
    waterTop.halo[meshHaloIndex(4, CHUNK, 4)] = Voxel.Water;
    waterTop.outside = (x, y, z) => (x === 4 && y === CHUNK + 1 && z === 4 ? customVoxel : Voxel.Air);
    adapter.meshChunk?.(waterTop);

    expect(kernel.failed).toBe(false);
    expect(kernel.diagnostics().calls).toBe(0);
  });
});
