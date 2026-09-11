import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  createCodecKernel,
  encodeStoredChunkRecord,
  runCRC,
  runCrc32Bytes,
  runCrc32U16,
} from '../../../../src/compute/codec-kernel';
import { createCodecControlMemory, runCodecControl } from '../../../../src/compute/codec-kernel-control';
import { createKernelMemory } from '../../../../src/compute/kernel-memory';
import {
  createStoredChunkRecord,
  type CreateStoredChunkRecordInput,
} from '../../../../../../packages/stdlib/src/world/chunk-snapshot-codec';

const VOXEL_COUNT = 32 ** 3;
const moduleBytes = () => readFile(new URL('../../../../src/generated/wasm/rust-kernels-scalar.wasm', import.meta.url));

const identity = {
  worldId: 'wasm-codec-test',
  seedText: 'codec-seed',
  cx: -2,
  cy: 1,
  cz: 7,
  revision: 11,
  formatVersion: 4,
  voxelSchemaVersion: 3,
  generatorVersion: 2,
};

const xorshift = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
};

const fixtures = (): Array<{ name: string; input: CreateStoredChunkRecordInput; codec: string }> => {
  const uniform = new Uint16Array(VOXEL_COUNT).fill(3);
  const uniformBase = new Uint16Array(VOXEL_COUNT).fill(3);
  const sparse = uniformBase.slice();
  sparse[0] = 7;
  sparse[101] = 9;
  sparse[VOXEL_COUNT - 1] = 12;
  const palette = Uint16Array.from({ length: VOXEL_COUNT }, (_, index) => [0, 1, 2, 3, 8, 9][index % 6]);
  const paletteBase = new Uint16Array(VOXEL_COUNT).fill(0);
  const next = xorshift(0x5eed1234);
  const random = Uint16Array.from({ length: VOXEL_COUNT }, () => next() & 0xffff);
  const randomBase = Uint16Array.from({ length: VOXEL_COUNT }, () => next() & 0xffff);
  const fluid = Uint8Array.from({ length: VOXEL_COUNT }, (_, index) => (index * 17 + 3) & 0xff);
  return [
    {
      name: 'uniform',
      input: { ...identity, voxels: uniform, proceduralVoxels: uniformBase },
      codec: 'procedural-diff-v1',
    },
    {
      name: 'sparse-diff',
      input: { ...identity, voxels: sparse, proceduralVoxels: uniformBase },
      codec: 'procedural-diff-v1',
    },
    {
      name: 'multi-palette',
      input: { ...identity, voxels: palette, proceduralVoxels: paletteBase },
      codec: 'palette-bitpack-v1',
    },
    { name: 'random-u16', input: { ...identity, voxels: random, proceduralVoxels: randomBase }, codec: 'raw-u16-v1' },
    {
      name: 'fluid-sidecar',
      input: { ...identity, voxels: palette, proceduralVoxels: paletteBase, fluid },
      codec: 'palette-bitpack-v1',
    },
  ];
};

describe('W14/W15 Rust Wasm codec and CRC equivalence', () => {
  it('exposes independent W15 CRC measurement entrypoints', async () => {
    const kernel = createCodecKernel(await createKernelMemory(await moduleBytes()));
    expect(runCrc32Bytes(kernel, new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(runCrc32U16(kernel, Uint16Array.from([0x1234, 0xabcd]))).toBe(0x7eff1497);
    expect(runCRC(kernel, new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(runCRC(kernel, Uint16Array.from([0x1234, 0xabcd]))).toBe(0x7eff1497);
    expect(kernel.failed).toBe(false);
  });

  it('matches the TS encoder byte-for-byte across codec candidates and fluid CRC', async () => {
    const kernel = createCodecKernel(await createKernelMemory(await moduleBytes()));
    for (const fixture of fixtures()) {
      const before = fixture.input.voxels.slice();
      const expected = createStoredChunkRecord(fixture.input);
      const actual = encodeStoredChunkRecord(kernel, fixture.input);
      const control = runCodecControl(createCodecControlMemory(), fixture.input);
      expect(actual, fixture.name).toMatchObject(identity);
      expect(expected.codec, fixture.name).toBe(fixture.codec);
      expect(actual.codec, fixture.name).toBe(expected.codec);
      expect(actual.payload, fixture.name).toEqual(expected.payload);
      expect(actual.payloadBytes, fixture.name).toBe(expected.payloadBytes);
      expect(actual.payloadChecksum, fixture.name).toBe(expected.payloadChecksum);
      expect(actual.proceduralBaseSignature, fixture.name).toBe(expected.proceduralBaseSignature);
      expect(actual.fluidChecksum, fixture.name).toBe(expected.fluidChecksum);
      expect(actual.fluid, fixture.name).toEqual(expected.fluid);
      expect(control.codec, fixture.name).toBe(actual.codec);
      expect(control.payload, fixture.name).toEqual(actual.payload);
      expect(control.payloadChecksum, fixture.name).toBe(actual.payloadChecksum);
      expect(control.proceduralBaseSignature, fixture.name).toBe(actual.proceduralBaseSignature);
      expect(control.fluidChecksum, fixture.name).toBe(actual.fluidChecksum);
      expect(fixture.input.voxels, fixture.name).toEqual(before);
      expect(kernel.failed, fixture.name).toBe(false);
    }
  }, 30000);

  it('does not silently use the TS fallback when the ABI export is unavailable', async () => {
    const kernel = createCodecKernel(await createKernelMemory(await moduleBytes()));
    const original = kernel.encodeDiff;
    kernel.encodeDiff = () => {
      throw new Error('forced codec failure');
    };
    expect(() => encodeStoredChunkRecord(kernel, fixtures()[1].input)).toThrow(/forced codec failure/);
    expect(kernel.failed).toBe(true);
    kernel.encodeDiff = original;
  });
});
