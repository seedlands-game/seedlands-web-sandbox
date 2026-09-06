import { describe, expect, it, vi } from 'vitest';
import { ProceduralChunkBaseCache } from '../../src/worker/procedural-chunk-base-cache';
import { createStoredChunkRecord, decodeStoredChunkRecord } from '../../src/world/chunk-snapshot-codec';
import { CHUNK_SIZE } from '../../src/world/voxel';

const identity = (cx = 0, seedText = 'seed', generatorVersion = 3, cy = 0, cz = 0) => ({
  seedText,
  generatorVersion,
  cx,
  cy,
  cz,
});

describe('ProceduralChunkBaseCache', () => {
  it('按完整世界身份复用基础Chunk并向调用方返回隔离副本', () => {
    const generate = vi.fn(({ cx }: ReturnType<typeof identity>) => new Uint16Array([cx + 1, 7]));
    const cache = new ProceduralChunkBaseCache(generate);

    const first = cache.get(identity());
    first[0] = 99;
    expect(cache.get(identity())).toEqual(new Uint16Array([1, 7]));
    expect(generate).toHaveBeenCalledTimes(1);
    cache.get(identity(0, 'other'));
    cache.get(identity(0, 'seed', 2));
    cache.get(identity(1));
    cache.get(identity(0, 'seed', 3, 1));
    cache.get(identity(0, 'seed', 3, 0, 1));
    expect(generate).toHaveBeenCalledTimes(6);
  });

  it('同时遵守64项与4MiB上限并按LRU淘汰', () => {
    const generate = vi.fn(() => new Uint16Array(32 ** 3));
    const cache = new ProceduralChunkBaseCache(generate);
    for (let cx = 0; cx < 64; cx += 1) cache.get(identity(cx));
    cache.get(identity(0));
    cache.get(identity(64));

    expect(cache.entryCount).toBe(64);
    expect(cache.byteLength).toBe(4 * 1_024 * 1_024);
    cache.get(identity(1));
    expect(generate).toHaveBeenCalledTimes(66);

    const largeGenerate = vi.fn(() => new Uint16Array((3 * 1_024 * 1_024) / Uint16Array.BYTES_PER_ELEMENT));
    const byteLimited = new ProceduralChunkBaseCache(largeGenerate);
    byteLimited.get(identity(0));
    byteLimited.get(identity(1));
    expect(byteLimited.entryCount).toBe(1);
    expect(byteLimited.byteLength).toBe(3 * 1_024 * 1_024);
    byteLimited.get(identity(0));
    expect(largeGenerate).toHaveBeenCalledTimes(3);
  });

  it('clear和生成异常都不会留下可复用条目', () => {
    let shouldThrow = true;
    const generate = vi.fn(() => {
      if (shouldThrow) throw new Error('generation failed');
      return new Uint16Array([4]);
    });
    const cache = new ProceduralChunkBaseCache(generate);

    expect(() => cache.get(identity())).toThrow('generation failed');
    shouldThrow = false;
    expect(cache.get(identity())).toEqual(new Uint16Array([4]));
    cache.clear();
    expect(cache.entryCount).toBe(0);
    expect(cache.byteLength).toBe(0);
    cache.get(identity());
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('同一基础Chunk支持procedural-diff保存与加载往返且只生成一次', () => {
    const generate = vi.fn(() => new Uint16Array(CHUNK_SIZE ** 3).fill(3));
    const cache = new ProceduralChunkBaseCache(generate);
    const chunkIdentity = identity(2, 'round-trip', 3, 1, -4);
    const current = cache.get(chunkIdentity);
    current[17] = 8;
    const recordIdentity = {
      worldId: 'seedlands:g3:round-trip',
      ...chunkIdentity,
      revision: 7,
      formatVersion: 1,
      voxelSchemaVersion: 1,
    };

    const record = createStoredChunkRecord({
      ...recordIdentity,
      voxels: current,
      proceduralVoxels: cache.get(chunkIdentity),
    });

    expect(record.codec).toBe('procedural-diff-v1');
    expect(decodeStoredChunkRecord(record, { ...recordIdentity, proceduralVoxels: cache.get(chunkIdentity) })).toEqual(
      current,
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
