import { describe, expect, it } from 'vitest';
import { GameServer } from '../../src/server/game-server';
import type { ChunkPersistence, ChunkSnapshot } from '../../src/server/persistence/chunk-persistence';
import { MemoryChunkPersistence } from '../../src/server/persistence/memory-chunk-persistence';
import { Voxel, chunkKey } from '../../src/world/voxel';

describe('GameServer headless authority', () => {
  it('deterministically generates canonical data and runs without a browser client', () => {
    const server = new GameServer({ seedText: 'headless-authority' });

    expect(server.getVoxel(3, 20, -4)).toBe(server.getVoxel(3, 20, -4));
    expect(server.getChunk(0, 0, 0).voxels).toBeInstanceOf(Uint16Array);
    expect(server.generatorVersion).toBeGreaterThan(0);
  });

  it('commits a cross-chunk edit batch as one aggregate structural change', () => {
    const server = new GameServer({ seedText: 'batch-authority' });
    const result = server.editBatch({
      actorId: 'harness',
      edits: [
        { x: 31, y: 0, z: 0, value: Voxel.Air },
        { x: 32, y: 0, z: 0, value: Voxel.Wood },
        { x: 32, y: 1, z: 0, value: Voxel.Water },
      ],
    });

    expect(result).toEqual({
      type: 'voxel-region-changed',
      actorId: 'harness',
      editCount: 3,
      chunks: [chunkKey(0, 0, 0), chunkKey(1, 0, 0)],
      meshChunks: expect.arrayContaining([chunkKey(0, 0, 0), chunkKey(1, 0, 0)]),
      bounds: { min: [31, 0, 0], max: [32, 1, 0] },
    });
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 1, dirty: true });
    expect(server.getChunk(1, 0, 0)).toMatchObject({ revision: 1, dirty: true });
    expect(server.getVoxel(32, 1, 0)).toBe(Voxel.Water);

    server.edit(32, 1, 0, Voxel.Water);
    expect(server.getChunk(1, 0, 0).revision).toBe(1);
  });

  it('persists only dirty materialized snapshots and reloads them exactly', () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({ seedText: 'snapshot-authority', persistence });
    first.getChunk(2, 0, 0);
    first.edit(64, 20, 0, Voxel.Wood);

    expect(first.flushDirtyChunks()).toEqual([chunkKey(2, 0, 0)]);
    expect(persistence.writes).toEqual([chunkKey(2, 0, 0)]);
    expect(first.flushDirtyChunks()).toEqual([]);

    const reloaded = new GameServer({ seedText: 'snapshot-authority', persistence });
    expect(reloaded.getVoxel(64, 20, 0)).toBe(Voxel.Wood);
    expect(reloaded.getChunk(2, 0, 0)).toMatchObject({ revision: 1, dirty: false, materialized: true });
  });

  it('does not apply a materialized snapshot to a different seed', () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({ seedText: 'snapshot-seed-a', persistence });
    first.edit(0, 20, 0, Voxel.Wood);
    first.flushDirtyChunks();

    const otherSeed = new GameServer({ seedText: 'snapshot-seed-b', persistence });
    expect(otherSeed.getChunk(0, 0, 0)).toMatchObject({ revision: 0, dirty: false, materialized: false });
  });

  it('ignores incompatible or malformed snapshots and regenerates the procedural chunk', () => {
    const persistence: ChunkPersistence = {
      loadSnapshot: () =>
        ({
          key: chunkKey(0, 0, 0),
          cx: 0,
          cy: 0,
          cz: 0,
          generatorVersion: 0,
          revision: 9,
          voxels: new Uint16Array([Voxel.Wood]),
        }) as ChunkSnapshot,
      saveSnapshots: () => undefined,
    };
    const server = new GameServer({ seedText: 'snapshot-validation', persistence });

    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 0, dirty: false, materialized: false });
    expect(server.getChunk(0, 0, 0).voxels).toHaveLength(32 ** 3);
  });

  it('keeps dirty chunks retryable when snapshot persistence fails', () => {
    const persistence: ChunkPersistence = {
      loadSnapshot: () => null,
      saveSnapshots: () => {
        throw new Error('simulated persistence failure');
      },
    };
    const server = new GameServer({ seedText: 'dirty-retry', persistence });
    server.edit(0, 20, 0, Voxel.Wood);

    expect(() => server.flushDirtyChunks()).toThrow('simulated persistence failure');
    expect(server.getChunk(0, 0, 0).dirty).toBe(true);
  });

  it('retains both sides of a materialized Chunk boundary after save and reload', () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({ seedText: 'boundary-reload', persistence });
    first.editBatch({
      actorId: 'boundary-test',
      edits: [
        { x: 31, y: 20, z: 0, value: Voxel.Wood },
        { x: 32, y: 20, z: 0, value: Voxel.Sand },
      ],
    });
    first.flushDirtyChunks();

    const reloaded = new GameServer({ seedText: 'boundary-reload', persistence });
    expect(reloaded.getVoxel(31, 20, 0)).toBe(Voxel.Wood);
    expect(reloaded.getVoxel(32, 20, 0)).toBe(Voxel.Sand);
  });

  it('owns minimal entity state and the simulation clock independently of presentation', () => {
    const server = new GameServer({ seedText: 'entity-clock' });
    const player = server.createEntity({ kind: 'player', position: [1, 40, -2] });

    server.updateEntity(player.id, { position: [2, 41, -3] });
    server.advanceClock(1.5);

    expect(server.getEntity(player.id)).toEqual({ id: player.id, kind: 'player', position: [2, 41, -3] });
    expect(server.worldTime).toBeCloseTo(1.5);
  });
});
