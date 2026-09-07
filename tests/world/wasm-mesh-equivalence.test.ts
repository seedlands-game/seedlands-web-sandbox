import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createKernelMemory, KernelMemory, WASM_ARENA_BYTES } from '../../src/compute/kernel-memory';
import { createMeshKernelInput, meshKernelWindowIndex, runMeshDescriptorKernel } from '../../src/compute/mesh-kernel';
import { runMeshDescriptorControl } from '../../src/compute/mesh-kernel-control';
import { MESH_HALO_SIZE, meshChunk, meshHaloIndex, type MeshData } from '../../src/world/mesh';
import { FaceMaterial, Voxel, voxelIndex } from '../../src/world/voxel';

const wasmPath = new URL('../../src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url);
const CELL_COUNT = 32 ** 3;
const MAX_DESCRIPTOR_BYTES = (3 * 33 * 32 * 32 + 32 ** 3) * 16;

const emptyHalo = () => new Uint16Array(MESH_HALO_SIZE ** 3);

function descriptorKernelReturning(length: number): KernelMemory {
  return new KernelMemory({
    memory: new WebAssembly.Memory({ initial: 256, maximum: 256 }),
    abi_version: () => 1,
    arena_bytes: () => WASM_ARENA_BYTES,
    mesh_describe: () => length,
  } as WebAssembly.Exports);
}

function withHalo(
  mutate: (data: Uint16Array, fluid: Uint8Array) => void,
  mutateHalo = (_halo: Uint16Array, _fluidHalo: Uint8Array) => {},
  outside: (x: number, y: number, z: number) => number = () => Voxel.Air,
) {
  const data = new Uint16Array(CELL_COUNT);
  const halo = emptyHalo();
  const fluid = new Uint8Array(CELL_COUNT);
  const fluidHalo = new Uint8Array(MESH_HALO_SIZE ** 3);
  mutate(data, fluid);
  for (let y = 0; y < 32; y += 1)
    for (let z = 0; z < 32; z += 1)
      for (let x = 0; x < 32; x += 1) {
        halo[meshHaloIndex(x, y, z)] = data[voxelIndex(x, y, z)];
        fluidHalo[meshHaloIndex(x, y, z)] = fluid[voxelIndex(x, y, z)];
      }
  mutateHalo(halo, fluidHalo);
  return {
    data,
    halo,
    fluid,
    fluidHalo,
    input: createMeshKernelInput({
      seed: 0,
      cx: 0,
      cy: 0,
      cz: 0,
      data,
      changes: [],
      halo,
      fluid,
      fluidHalo,
      outside,
    }),
    outside,
  };
}

function expectMeshesEqual(actual: Record<number, MeshData>, expected: Record<number, MeshData>) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const material of Object.keys(expected)) {
    const left = actual[Number(material)];
    const right = expected[Number(material)];
    expect(left.material).toBe(right.material);
    expect(left.renderCategory).toBe(right.renderCategory);
    expect(left.layout).toBe('float32');
    expect(left.positions).toEqual(right.positions);
    expect(left.normals).toEqual(right.normals);
    expect(left.uvs).toEqual(right.uvs);
    expect(left.colors).toEqual(right.colors);
    expect(left.indices).toEqual(right.indices);
  }
}

describe('W04/W05 Wasm mesh descriptors', () => {
  it('starts RED until the real Wasm descriptor ABI and TS emitter exist', async () => {
    const kernel = await createKernelMemory(await readFile(wasmPath));
    const input = withHalo((data) => {
      data[voxelIndex(0, 0, 0)] = Voxel.Stone;
    });
    const actual = runMeshDescriptorKernel(kernel, input.input.window, input.input.fluidWindow);
    const expected = meshChunk({
      seed: 0,
      cx: 0,
      cy: 0,
      cz: 0,
      data: input.data,
      changes: [],
      halo: input.halo,
      fluid: input.fluid,
      fluidHalo: input.fluidHalo,
      outside: () => Voxel.Air,
    });
    expectMeshesEqual(actual, expected);
    expectMeshesEqual(runMeshDescriptorControl(input.input.window, input.input.fluidWindow), expected);
    expect(kernel.failed).toBe(false);
  });

  it('is byte-identical for randomized halo, adjacent chunk, water, model, AO and unknown-id inputs', async () => {
    const kernel = await createKernelMemory(await readFile(wasmPath));
    const input = withHalo(
      (data, fluid) => {
        let state = 0xace1;
        for (let index = 0; index < data.length; index += 1) {
          state = (state * 1103515245 + 12345) >>> 0;
          data[index] = state % 9;
          fluid[index] = data[index] === Voxel.Water ? 0x80 | ((state >>> 8) % 9) : 0;
        }
        data[voxelIndex(0, 8, 0)] = Voxel.Water;
        data[voxelIndex(1, 8, 0)] = Voxel.Water;
        fluid[voxelIndex(0, 8, 0)] = 0x82;
        fluid[voxelIndex(1, 8, 0)] = 0x87;
        data[voxelIndex(3, 3, 3)] = Voxel.Lantern;
        data[voxelIndex(4, 3, 3)] = Voxel.Stone;
      },
      (halo, fluidHalo) => {
        let state = 0x98ab;
        for (let index = 0; index < halo.length; index += 1) {
          state = (state * 1103515245 + 12345) >>> 0;
          halo[index] = state % 17 === 0 ? Voxel.Stone : Voxel.Air;
          fluidHalo[index] = halo[index] === Voxel.Water ? 0x81 : 0;
        }
        halo[meshHaloIndex(-1, 0, 0)] = Voxel.Stone;
        fluidHalo[meshHaloIndex(-1, 8, 0)] = 0x88;
      },
    );
    const actual = runMeshDescriptorKernel(kernel, input.input.window, input.input.fluidWindow);
    const expected = meshChunk({
      seed: 0,
      cx: 0,
      cy: 0,
      cz: 0,
      data: input.data,
      changes: [],
      halo: input.halo,
      fluid: input.fluid,
      fluidHalo: input.fluidHalo,
      outside: () => Voxel.Air,
    });
    expectMeshesEqual(actual, expected);
    expectMeshesEqual(runMeshDescriptorControl(input.input.window, input.input.fluidWindow), expected);
    expect(kernel.failed).toBe(false);
  }, 90_000);

  it('keeps empty, solid, checkerboard, water stair and lantern material ordering exact', async () => {
    const kernel = await createKernelMemory(await readFile(wasmPath));
    for (const kind of ['empty', 'solid', 'checkerboard', 'water-stair', 'lantern'] as const) {
      const input = withHalo((data, fluid) => {
        for (let y = 0; y < 32; y += 1)
          for (let z = 0; z < 32; z += 1)
            for (let x = 0; x < 32; x += 1) {
              const index = voxelIndex(x, y, z);
              if (kind === 'solid') data[index] = Voxel.Stone;
              if (kind === 'checkerboard') data[index] = (x + y + z) % 2 ? Voxel.Stone : Voxel.Air;
              if (kind === 'water-stair' && y === 4) {
                data[index] = Voxel.Water;
                fluid[index] = 0x80 | ((x % 8) + 1);
              }
              if (kind === 'lantern' && x < 2 && y < 2 && z < 2) data[index] = Voxel.Lantern;
            }
      });
      const actual = runMeshDescriptorKernel(kernel, input.input.window, input.input.fluidWindow);
      const expected = meshChunk({
        seed: 0,
        cx: 0,
        cy: 0,
        cz: 0,
        data: input.data,
        changes: [],
        halo: input.halo,
        fluid: input.fluid,
        fluidHalo: input.fluidHalo,
        outside: () => Voxel.Air,
      });
      expectMeshesEqual(runMeshDescriptorControl(input.input.window, input.input.fluidWindow), expected);
      expectMeshesEqual(actual, expected);
    }
    expect(kernel.failed).toBe(false);
    expect(FaceMaterial.LanternGlow).toBe(13);
  }, 30_000);

  it('samples only the reachable upper-water second ring and first-ring AO boundary exactly', async () => {
    const kernel = await createKernelMemory(await readFile(wasmPath));
    const outside = (_x: number, y: number, _z: number) => (y === 33 ? Voxel.Water : Voxel.Air);
    const input = withHalo(
      (data, fluid) => {
        data[voxelIndex(0, 0, 0)] = Voxel.Stone;
        data[voxelIndex(0, 31, 0)] = Voxel.Air;
        fluid[voxelIndex(0, 31, 0)] = 0;
      },
      (halo, fluidHalo) => {
        halo[meshHaloIndex(0, 32, 0)] = Voxel.Water;
        fluidHalo[meshHaloIndex(0, 32, 0)] = 0x81;
        halo[meshHaloIndex(-1, 0, 0)] = Voxel.Stone;
        halo[meshHaloIndex(0, -1, 0)] = Voxel.Stone;
        halo[meshHaloIndex(-1, -1, 0)] = Voxel.Stone;
      },
      outside,
    );
    const options = {
      seed: 0,
      cx: 0,
      cy: 0,
      cz: 0,
      data: input.data,
      changes: [],
      halo: input.halo,
      fluid: input.fluid,
      fluidHalo: input.fluidHalo,
      outside: input.outside,
    };
    expect(input.input.window[meshKernelWindowIndex(0, 33, 0)]).toBe(Voxel.Water);
    const expected = meshChunk(options);
    expectMeshesEqual(runMeshDescriptorControl(input.input.window, input.input.fluidWindow), expected);
    expectMeshesEqual(runMeshDescriptorKernel(kernel, input.input.window, input.input.fluidWindow), expected);
    expect(kernel.failed).toBe(false);
  });

  it('starts RED for malformed descriptor byte counts from a pseudo export', () => {
    const input = withHalo((data) => {
      data[voxelIndex(0, 0, 0)] = Voxel.Stone;
    });
    for (const length of [MAX_DESCRIPTOR_BYTES + 16, 17, Number.NaN]) {
      const kernel = descriptorKernelReturning(length);
      expect(() => runMeshDescriptorKernel(kernel, input.input.window, input.input.fluidWindow)).toThrow(
        /invalid descriptor byte length/,
      );
      expect(kernel.failed).toBe(false);
    }
  });

  it('preserves the current unknown-id rejection instead of silently assigning a material', async () => {
    const kernel = await createKernelMemory(await readFile(wasmPath));
    const input = withHalo((data) => {
      data[voxelIndex(4, 4, 4)] = 0xffff;
    });
    const options = {
      seed: 0,
      cx: 0,
      cy: 0,
      cz: 0,
      data: input.data,
      changes: [],
      halo: input.halo,
      fluid: input.fluid,
      fluidHalo: input.fluidHalo,
      outside: () => Voxel.Air,
    };
    expect(() => meshChunk(options)).toThrow();
    expect(() => runMeshDescriptorControl(input.input.window, input.input.fluidWindow)).toThrow();
    expect(() => runMeshDescriptorKernel(kernel, input.input.window, input.input.fluidWindow)).toThrow();
    expect(kernel.failed).toBe(false);
  });
});
