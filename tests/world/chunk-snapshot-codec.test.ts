import { describe, expect, it } from 'vitest';
import {
  createStoredChunkRecord,
  decodeStoredChunkRecord,
  storedChunkRecordBytes,
} from '../../src/world/chunk-snapshot-codec';
import { CHUNK_SIZE } from '../../src/world/voxel';

const VOXEL_COUNT = CHUNK_SIZE ** 3;

const identity = (revision = 1) => ({
  worldId: 'codec-test-world',
  seedText: 'codec-test-seed',
  cx: 2,
  cy: -1,
  cz: 3,
  revision,
  formatVersion: 1,
  voxelSchemaVersion: 1,
  generatorVersion: 2,
});

const legacyBytes = (voxels: Uint16Array) =>
  new TextEncoder().encode(JSON.stringify({ ...identity(), voxels: [...voxels] })).byteLength;

describe('Chunk snapshot codec', () => {
  it('selects a procedural final-diff record for sparse state and round-trips without mutating inputs', () => {
    const procedural = new Uint16Array(VOXEL_COUNT).fill(3);
    const current = procedural.slice();
    current[1] = 4;
    current[1_024] = 0;
    current[32_767] = 8;
    const proceduralBefore = procedural.slice();
    const currentBefore = current.slice();

    const record = createStoredChunkRecord({ ...identity(), voxels: current, proceduralVoxels: procedural });

    expect(record.codec).toBe('procedural-diff-v1');
    expect(storedChunkRecordBytes(record)).toBeLessThan(512);
    expect(decodeStoredChunkRecord(record, { ...identity(), proceduralVoxels: procedural })).toEqual(current);
    expect(procedural).toEqual(proceduralBefore);
    expect(current).toEqual(currentBefore);
  });

  it('selects palette bit packing for a dense current-schema Chunk', () => {
    const procedural = new Uint16Array(VOXEL_COUNT);
    const current = Uint16Array.from({ length: VOXEL_COUNT }, (_, index) => index % 9);

    const record = createStoredChunkRecord({ ...identity(), voxels: current, proceduralVoxels: procedural });

    expect(record.codec).toBe('palette-bitpack-v1');
    expect(record.payload.byteLength).toBeLessThanOrEqual(16 * 1_024 + 64);
    expect(decodeStoredChunkRecord(record, identity())).toEqual(current);
  });

  it('keeps a raw little-endian fallback for high-cardinality Uint16 data', () => {
    const procedural = new Uint16Array(VOXEL_COUNT);
    const current = Uint16Array.from({ length: VOXEL_COUNT }, (_, index) => index);

    const record = createStoredChunkRecord({ ...identity(), voxels: current, proceduralVoxels: procedural });

    expect(record.codec).toBe('raw-u16-v1');
    expect(record.payload.byteLength).toBe(64 * 1_024);
    expect(decodeStoredChunkRecord(record, identity())).toEqual(current);
  });

  it('produces identical bytes for identical logical state', () => {
    const procedural = Uint16Array.from({ length: VOXEL_COUNT }, (_, index) => index % 4);
    const current = procedural.slice();
    for (const index of [9_001, 7, 4_096, 1_024]) current[index] = 8;

    const first = createStoredChunkRecord({ ...identity(7), voxels: current, proceduralVoxels: procedural });
    const second = createStoredChunkRecord({ ...identity(7), voxels: current, proceduralVoxels: procedural });

    expect(first).toEqual(second);
  });

  it('fails closed for corruption, truncation, identity drift and procedural base drift', () => {
    const procedural = new Uint16Array(VOXEL_COUNT).fill(2);
    const current = procedural.slice();
    current[17] = 8;
    const record = createStoredChunkRecord({ ...identity(), voxels: current, proceduralVoxels: procedural });
    const corrupted = { ...record, payload: record.payload.slice() };
    corrupted.payload[corrupted.payload.length - 1] ^= 0xff;

    expect(() => decodeStoredChunkRecord(corrupted, { ...identity(), proceduralVoxels: procedural })).toThrow(
      /checksum|corrupt/i,
    );
    expect(() =>
      decodeStoredChunkRecord(
        { ...record, payload: record.payload.slice(0, -1) },
        { ...identity(), proceduralVoxels: procedural },
      ),
    ).toThrow(/length|truncated|corrupt/i);
    expect(() => decodeStoredChunkRecord(record, { ...identity(), cx: 99, proceduralVoxels: procedural })).toThrow(
      /identity|coordinate/i,
    );
    expect(() =>
      decodeStoredChunkRecord(record, { ...identity(), proceduralVoxels: new Uint16Array(VOXEL_COUNT).fill(3) }),
    ).toThrow(/base|generator|signature/i);
  });

  it('keeps the low-load 8-Chunk corpus below ten percent of raw snapshots and below legacy JSON', () => {
    let recordBytes = 0;
    let legacyJsonBytes = 0;
    const overrideCounts = [1, 4, 16, 64, 1, 4, 16, 64];

    overrideCounts.forEach((overrideCount, chunkIndex) => {
      const procedural = Uint16Array.from({ length: VOXEL_COUNT }, (_, index) => (index + chunkIndex) % 4);
      const current = procedural.slice();
      for (let index = 0; index < overrideCount; index += 1) current[(index * 499 + chunkIndex * 37) % VOXEL_COUNT] = 8;
      const record = createStoredChunkRecord({
        ...identity(chunkIndex + 1),
        cx: chunkIndex,
        voxels: current,
        proceduralVoxels: procedural,
      });
      recordBytes += storedChunkRecordBytes(record);
      legacyJsonBytes += legacyBytes(current);
    });

    const rawBytes = overrideCounts.length * VOXEL_COUNT * Uint16Array.BYTES_PER_ELEMENT;
    expect(recordBytes).toBeLessThanOrEqual(rawBytes * 0.1);
    expect(recordBytes).toBeLessThan(legacyJsonBytes);
  });
});
