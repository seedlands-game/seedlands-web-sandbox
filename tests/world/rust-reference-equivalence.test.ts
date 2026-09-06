import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createChunkKernel } from '../../src/compute/chunk-kernel';
import { createKernelMemory } from '../../src/compute/kernel-memory';
import { createMeshKernelInput, runMeshDescriptorKernel } from '../../src/compute/mesh-kernel';
import type { FluidAuthoritySnapshot } from '../../src/server/fluid/fluid-transaction';
import { createFluidKernel } from '../../src/worker/fluid-kernel';
import { MESH_HALO_SIZE, meshHaloIndex, type MeshData } from '../../src/world/mesh';
import { Voxel, voxelIndex } from '../../src/world/voxel';

const moonbitPath = new URL('../../src/generated/wasm/seedlands-kernels.wasm', import.meta.url);
const rustPath = process.env.RUST_REFERENCE_WASM;
const suite = rustPath ? describe : describe.skip;
const CELL_COUNT = 32 ** 3;

const loadMemory = async (path: string | URL) => createKernelMemory(await readFile(path));

const expectMeshRecordsEqual = (left: Record<number, MeshData>, right: Record<number, MeshData>) => {
  expect(Object.keys(left)).toEqual(Object.keys(right));
  for (const material of Object.keys(left)) {
    const a = left[Number(material)];
    const b = right[Number(material)];
    expect(a.material).toBe(b.material);
    expect(a.renderCategory).toBe(b.renderCategory);
    expect(a.layout).toBe(b.layout);
    expect(a.positions).toEqual(b.positions);
    expect(a.normals).toEqual(b.normals);
    expect(a.uvs).toEqual(b.uvs);
    expect(a.colors).toEqual(b.colors);
    expect(a.indices).toEqual(b.indices);
  }
};

const makeFluidSnapshot = (scene: number): FluidAuthoritySnapshot => {
  const voxels = new Uint16Array(CELL_COUNT);
  const fluid = new Uint8Array(CELL_COUNT);
  const source = voxelIndex(10, 10, 10);
  voxels[voxelIndex(10, 9, 10)] = Voxel.Stone;
  voxels[source] = Voxel.Water;
  fluid[source] = 8;
  for (let index = 0; index < scene % 8; index += 1) {
    const x = 12 + index;
    const water = voxelIndex(x, 10, 10);
    voxels[water] = Voxel.Water;
    fluid[water] = 3 + (index % 5);
  }
  return {
    protocolVersion: 1,
    epoch: 1,
    workId: `rust-reference-${scene}`,
    frontier: [[10, 10, 10]],
    cleanupFrontier: scene % 2 ? [[10, 10, 10]] : [],
    chunks: [{ key: '0,0,0', cx: 0, cy: 0, cz: 0, revision: scene, voxels, fluid }],
  };
};

const makeMeshInput = (scene: number) => {
  const data = new Uint16Array(CELL_COUNT);
  const fluid = new Uint8Array(CELL_COUNT);
  const halo = new Uint16Array(MESH_HALO_SIZE ** 3);
  const fluidHalo = new Uint8Array(MESH_HALO_SIZE ** 3);
  data[voxelIndex(16, 8, 16)] = Voxel.Stone;
  data[voxelIndex(17, 8, 16)] = Voxel.Dirt;
  data[voxelIndex(12, 9, 12)] = Voxel.Water;
  fluid[voxelIndex(12, 9, 12)] = 1 + (scene % 8);
  if (scene % 3 === 0) data[voxelIndex(8, 6, 8)] = Voxel.Lantern;
  for (let y = 0; y < 32; y += 1)
    for (let z = 0; z < 32; z += 1)
      for (let x = 0; x < 32; x += 1) {
        const index = voxelIndex(x, y, z);
        const haloIndex = meshHaloIndex(x, y, z);
        halo[haloIndex] = data[index];
        fluidHalo[haloIndex] = fluid[index];
      }
  return createMeshKernelInput({
    seed: 0x5eed + scene,
    cx: 0,
    cy: 0,
    cz: 0,
    data,
    changes: [],
    halo,
    fluid,
    fluidHalo,
    outside: () => Voxel.Air,
  });
};

suite('Rust reference production-path equivalence', () => {
  it('matches 30 deterministic Chunk, fluid, and mesh corpus cases', async () => {
    const moonbitChunk = createChunkKernel(await loadMemory(moonbitPath));
    const rustChunkMemory = await loadMemory(rustPath!);
    const rustChunk = createChunkKernel(rustChunkMemory);
    for (let scene = 0; scene < 30; scene += 1) {
      const seed = (0x12340000 + scene * 97) | 0;
      const cx = (scene % 5) - 2;
      const cy = (scene % 3) - 1;
      const cz = ((scene * 3) % 5) - 2;
      const changes: [number, number, number, number][] = [
        [cx * 32 + (scene % 32), cy * 32 + 4, cz * 32 + 7, Voxel.Air],
        [cx * 32 + 31, cy * 32 + 31, cz * 32 + 31, Voxel.Stone],
      ];
      expect(rustChunk(seed, cx, cy, cz, changes), `chunk scene ${scene}`).toEqual(
        moonbitChunk(seed, cx, cy, cz, changes),
      );
      expect(rustChunkMemory.failed, `chunk failed scene ${scene}`).toBe(false);
    }

    const moonbitFluidMemory = await loadMemory(moonbitPath);
    const rustFluidMemory = await loadMemory(rustPath!);
    const moonbitFluid = createFluidKernel(moonbitFluidMemory);
    const rustFluid = createFluidKernel(rustFluidMemory);
    for (let scene = 0; scene < 30; scene += 1) {
      const snapshot = makeFluidSnapshot(scene);
      const moonbitCandidate = moonbitFluid(snapshot);
      const rustCandidate = rustFluid(snapshot);
      expect(rustCandidate, `fluid scene ${scene}`).toEqual(moonbitCandidate);
      expect(rustFluidMemory.failed, `fluid failed scene ${scene}`).toBe(false);
      expect(moonbitCandidate.writes.length, `fluid writes scene ${scene}`).toBeGreaterThan(0);
      expect(moonbitCandidate.nextFrontier.length, `fluid frontier scene ${scene}`).toBeGreaterThan(0);
    }

    const moonbitMeshMemory = await loadMemory(moonbitPath);
    const rustMeshMemory = await loadMemory(rustPath!);
    for (let scene = 0; scene < 30; scene += 1) {
      const input = makeMeshInput(scene);
      const moonbitMesh = runMeshDescriptorKernel(moonbitMeshMemory, input.window, input.fluidWindow);
      const rustMesh = runMeshDescriptorKernel(rustMeshMemory, input.window, input.fluidWindow);
      expectMeshRecordsEqual(rustMesh, moonbitMesh);
      expect(Object.keys(moonbitMesh).length, `mesh records scene ${scene}`).toBeGreaterThan(0);
      expect(rustMeshMemory.failed, `mesh failed scene ${scene}`).toBe(false);
    }
  }, 30000);
});
