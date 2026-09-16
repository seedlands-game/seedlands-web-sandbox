import { describe, expect, it } from 'vitest';
import { createStoredChunkRecord, crc32Bytes } from '../../src/world/chunk-snapshot-codec';

const voxelCount = 32 ** 3;
const identity = {
  worldId: 'data-plane-codec',
  seedText: 'data-plane-codec-seed',
  cx: -2,
  cy: 1,
  cz: 3,
  revision: 9,
  formatVersion: 1,
  voxelSchemaVersion: 1,
  generatorVersion: 3,
};

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const oldCrc = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const oldCrcVoxels = (voxels: Uint16Array) => {
  let value = 0xffffffff;
  for (const voxel of voxels) {
    value = crcTable[(value ^ (voxel & 0xff)) & 0xff]! ^ (value >>> 8);
    value = crcTable[(value ^ (voxel >>> 8)) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const oldPushVarUint = (target: number[], input: number) => {
  let value = input >>> 0;
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    target.push(value ? byte | 0x80 : byte);
  } while (value);
};

const oldDiff = (voxels: Uint16Array, procedural: Uint16Array) => {
  const values: number[] = [0, 0, 0, 0];
  let count = 0;
  let previousIndex = 0;
  for (let index = 0; index < voxels.length; index += 1) {
    if (voxels[index] === procedural[index]) continue;
    oldPushVarUint(values, index - previousIndex);
    values.push(voxels[index]! & 0xff, voxels[index]! >>> 8);
    previousIndex = index;
    count += 1;
  }
  values[0] = count & 0xff;
  values[1] = (count >>> 8) & 0xff;
  values[2] = (count >>> 16) & 0xff;
  values[3] = count >>> 24;
  return Uint8Array.from(values);
};

const oldPalette = (voxels: Uint16Array) => {
  const palette: number[] = [];
  const indexes = new Map<number, number>();
  const values = new Uint16Array(voxels.length);
  for (let index = 0; index < voxels.length; index += 1) {
    const voxel = voxels[index]!;
    let paletteIndex = indexes.get(voxel);
    if (paletteIndex === undefined) {
      paletteIndex = palette.length;
      palette.push(voxel);
      indexes.set(voxel, paletteIndex);
    }
    values[index] = paletteIndex;
  }
  const bits = palette.length <= 1 ? 0 : Math.ceil(Math.log2(palette.length));
  const payload = new Uint8Array(5 + palette.length * 2 + Math.ceil((voxels.length * bits) / 8));
  const view = new DataView(payload.buffer);
  view.setUint32(0, palette.length, true);
  payload[4] = bits;
  palette.forEach((voxel, index) => view.setUint16(5 + index * 2, voxel, true));
  let cursor = 5 + palette.length * 2;
  let accumulator = 0;
  let accumulatorBits = 0;
  for (const paletteIndex of values) {
    accumulator += paletteIndex * 2 ** accumulatorBits;
    accumulatorBits += bits;
    while (accumulatorBits >= 8) {
      payload[cursor++] = accumulator & 0xff;
      accumulator = Math.floor(accumulator / 256);
      accumulatorBits -= 8;
    }
  }
  if (accumulatorBits) payload[cursor] = accumulator & 0xff;
  return payload;
};

const oldRaw = (voxels: Uint16Array) => {
  const payload = new Uint8Array(voxels.length * 2);
  for (let index = 0; index < voxels.length; index += 1) {
    payload[index * 2] = voxels[index]! & 0xff;
    payload[index * 2 + 1] = voxels[index]! >>> 8;
  }
  return payload;
};

const oldRecord = (voxels: Uint16Array, proceduralVoxels: Uint16Array) => {
  const candidates = [
    {
      codec: 'procedural-diff-v1' as const,
      payload: oldDiff(voxels, proceduralVoxels),
      proceduralBaseSignature: oldCrcVoxels(proceduralVoxels),
    },
    { codec: 'palette-bitpack-v1' as const, payload: oldPalette(voxels) },
    { codec: 'raw-u16-v1' as const, payload: oldRaw(voxels) },
  ];
  const selected = candidates.reduce((smallest, candidate) =>
    candidate.payload.length < smallest.payload.length ? candidate : smallest,
  );
  return { ...selected, payloadChecksum: oldCrc(selected.payload) };
};

describe('数据平面 Chunk codec', () => {
  it('导出真实生产 CRC，并保持冻结 for-of oracle 的 golden checksum', () => {
    const bytes = new TextEncoder().encode('123456789');

    expect(crc32Bytes(bytes)).toBe(0xcbf43926);
    expect(crc32Bytes(bytes)).toBe(oldCrc(bytes));
  });

  const cases: readonly [string, (procedural: Uint16Array) => Uint16Array][] = [
    [
      'sparse diff',
      (procedural) => {
        const voxels = procedural.slice();
        voxels[1] = 9;
        voxels[1_024] = 8;
        voxels[32_767] = 7;
        return voxels;
      },
    ],
    ['palette', () => Uint16Array.from({ length: voxelCount }, (_, index) => (index * 13) % 17)],
    ['raw', () => Uint16Array.from({ length: voxelCount }, (_, index) => index)],
  ];

  it.each(cases)('与冻结旧 oracle 保持 %s 的 codec、payload 和 checksum', (_name, makeVoxels) => {
    const proceduralVoxels = Uint16Array.from({ length: voxelCount }, (_, index) => (index * 7) % 11);
    const voxels = makeVoxels(proceduralVoxels);
    const expected = oldRecord(voxels, proceduralVoxels);

    const actual = createStoredChunkRecord({ ...identity, voxels, proceduralVoxels });

    expect(actual.codec).toBe(expected.codec);
    expect(actual.payload).toEqual(expected.payload);
    expect(actual.payloadChecksum).toBe(expected.payloadChecksum);
    expect(actual.proceduralBaseSignature).toBe(expected.proceduralBaseSignature);
  });

  it('每次返回独立 payload，且不改变输入以支持同步重入', () => {
    const proceduralVoxels = new Uint16Array(voxelCount).fill(4);
    const voxels = proceduralVoxels.slice();
    voxels[17] = 8;
    const beforeVoxels = voxels.slice();
    const beforeProcedural = proceduralVoxels.slice();

    const first = createStoredChunkRecord({ ...identity, voxels, proceduralVoxels });
    const second = createStoredChunkRecord({ ...identity, voxels, proceduralVoxels });
    first.payload[0] ^= 0xff;

    expect(second.payload).toEqual(oldRecord(voxels, proceduralVoxels).payload);
    expect(voxels).toEqual(beforeVoxels);
    expect(proceduralVoxels).toEqual(beforeProcedural);
  });
});
