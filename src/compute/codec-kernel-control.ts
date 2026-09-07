import { KernelMemory, WASM_ARENA_BYTES } from './kernel-memory';
import { CodecKernel, encodeStoredChunkRecord } from './codec-kernel';
import type { CreateStoredChunkRecordInput, StoredChunkRecord } from '../world/chunk-snapshot-codec';

const INPUT_OFFSET = 64;
const VOXEL_COUNT = 32 ** 3;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crcBytes = (bytes: Uint8Array, offset: number, length: number) => {
  let value = 0xffffffff;
  for (let index = 0; index < length; index += 1)
    value = crcTable[(value ^ bytes[offset + index]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const crcU16 = (values: Uint16Array, offset: number, count: number) => {
  let value = 0xffffffff;
  for (let index = 0; index < count; index += 1) {
    const voxel = values[offset + index];
    value = crcTable[(value ^ (voxel & 0xff)) & 0xff] ^ (value >>> 8);
    value = crcTable[(value ^ (voxel >>> 8)) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const pushVarUint = (target: number[], input: number) => {
  let value = input >>> 0;
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    target.push(value ? byte | 0x80 : byte);
  } while (value);
};

/** Same stable Wasm ABI as W14, with the numeric work implemented in JavaScript. */
export function createCodecControlMemory(): KernelMemory {
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });
  const bytes = () => new Uint8Array(memory.buffer);
  const values = () => new Uint16Array(memory.buffer);
  const write = (output: number, payload: Uint8Array, capacity: number) => {
    if (payload.length > capacity || output < INPUT_OFFSET || output + payload.length > WASM_ARENA_BYTES) return -1;
    bytes().set(payload, output);
    return payload.length;
  };
  const exports = {
    memory,
    abi_version: () => 1,
    arena_bytes: () => WASM_ARENA_BYTES,
    crc32_bytes: (offset: number, length: number) => crcBytes(bytes(), offset, length),
    crc32_u16_le: (offset: number, count: number) => crcU16(values(), offset / 2, count),
    encode_diff: (input: number, procedural: number, output: number, capacity: number) => {
      const voxelValues = values();
      const baseValues = values();
      const payload: number[] = [0, 0, 0, 0];
      let count = 0;
      let previousIndex = 0;
      for (let index = 0; index < VOXEL_COUNT; index += 1) {
        if (voxelValues[input / 2 + index] === baseValues[procedural / 2 + index]) continue;
        pushVarUint(payload, index - previousIndex);
        const voxel = voxelValues[input / 2 + index];
        payload.push(voxel & 0xff, voxel >>> 8);
        previousIndex = index;
        count += 1;
      }
      payload[0] = count & 0xff;
      payload[1] = (count >>> 8) & 0xff;
      payload[2] = (count >>> 16) & 0xff;
      payload[3] = count >>> 24;
      return write(output, Uint8Array.from(payload), capacity);
    },
    encode_palette: (input: number, output: number, capacity: number) => {
      const voxelValues = values();
      const palette: number[] = [];
      const paletteIndexes = new Map<number, number>();
      const indexes = new Uint16Array(VOXEL_COUNT);
      for (let index = 0; index < VOXEL_COUNT; index += 1) {
        const voxel = voxelValues[input / 2 + index];
        let paletteIndex = paletteIndexes.get(voxel);
        if (paletteIndex === undefined) {
          paletteIndex = palette.length;
          palette.push(voxel);
          paletteIndexes.set(voxel, paletteIndex);
        }
        indexes[index] = paletteIndex;
      }
      const bits = palette.length <= 1 ? 0 : Math.ceil(Math.log2(palette.length));
      const packedBytes = Math.ceil((VOXEL_COUNT * bits) / 8);
      const payload = new Uint8Array(5 + palette.length * 2 + packedBytes);
      const view = new DataView(payload.buffer);
      view.setUint32(0, palette.length, true);
      payload[4] = bits;
      palette.forEach((voxel, index) => view.setUint16(5 + index * 2, voxel, true));
      let byteOffset = 5 + palette.length * 2;
      let accumulator = 0;
      let accumulatorBits = 0;
      for (const paletteIndex of indexes) {
        accumulator += paletteIndex * 2 ** accumulatorBits;
        accumulatorBits += bits;
        while (accumulatorBits >= 8) {
          payload[byteOffset++] = accumulator & 0xff;
          accumulator = Math.floor(accumulator / 256);
          accumulatorBits -= 8;
        }
      }
      if (accumulatorBits) payload[byteOffset] = accumulator & 0xff;
      return write(output, payload, capacity);
    },
    encode_raw: (input: number, output: number, capacity: number) => {
      const payload = new Uint8Array(VOXEL_COUNT * 2);
      const voxelValues = values();
      for (let index = 0; index < VOXEL_COUNT; index += 1) {
        const voxel = voxelValues[input / 2 + index];
        payload[index * 2] = voxel & 0xff;
        payload[index * 2 + 1] = voxel >>> 8;
      }
      return write(output, payload, capacity);
    },
  } as unknown as WebAssembly.Exports;
  return new KernelMemory(exports);
}

export function runCodecControl(memory: KernelMemory, input: CreateStoredChunkRecordInput): StoredChunkRecord {
  return encodeStoredChunkRecord(new CodecKernel(memory), input);
}
