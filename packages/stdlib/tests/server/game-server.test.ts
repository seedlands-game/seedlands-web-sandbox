import { testWorldgenExecutableProvider, testWorldgenProvider } from '../support/worldgen';
import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it, vi } from 'vitest';
import { GameServer } from '../../src/server/game-server';
import type { ChunkPersistence, ChunkSnapshot } from '../../src/server/persistence/chunk-persistence';
import { MemoryChunkPersistence } from '../../src/server/persistence/memory-chunk-persistence';
import { CHUNK_SIZE, Voxel, chunkKey, voxelIndex } from '../../src/world/voxel';
import { createProceduralMeshInput, meshChunk, meshHaloIndex } from '../../src/world/mesh';
import { peekLoadedVoxel, peekLoadedVoxelInChunk, readLoadedGameplayCell } from '../../src/server/loaded-voxel-reader';

describe('loaded voxel reads with an expected terrain chunk', () => {
  const fixture = () =>
    new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'terrain-keyed-read',
    });

  it('keeps gameplay cell source bits and does not query fluid for unknown canonical cells', () => {
    const server = fixture(),
      chunk = server.getChunk(0, 0, 0),
      chunks = new Map([[chunk.key, chunk]]);
    const cell = vi.fn(() => ({ level: 3, source: true }));
    const readVoxel = vi.fn((x: number, y: number, z: number) => peekLoadedVoxel(chunks, x, y, z));
    expect(readLoadedGameplayCell(readVoxel, { cell }, 0, 0, 0)).toEqual({ voxel: chunk.voxels[0], fluid: 0x83 });
    expect(cell).toHaveBeenCalledWith(0, 0, 0, false);
    expect(readVoxel.mock.invocationCallOrder[0]).toBeLessThan(cell.mock.invocationCallOrder[0]!);
    chunks.clear();
    cell.mockClear();
    expect(readLoadedGameplayCell(readVoxel, { cell }, 0, 0, 0)).toBeNull();
    expect(cell).not.toHaveBeenCalled();
  });

  it.each([-1, 0, 1])('preserves full voxel and fluid fields across chunk coordinate %s', (cx) => {
    const server = fixture(),
      chunk = server.getChunk(cx, -1, cx);
    chunk.voxels[voxelIndex(31, 0, 7)] = Voxel.Water;
    chunk.fluid[voxelIndex(31, 0, 7)] = 0x83;
    const at = [cx * CHUNK_SIZE + 31, -CHUNK_SIZE, cx * CHUNK_SIZE + 7] as const;
    expect(server.peekLoadedVoxelInChunk(chunk.key, ...at)).toEqual(server.peekLoadedVoxel(...at));
    expect(server.peekLoadedVoxelInChunk(chunk.key, ...at)?.fluid).toEqual({ level: 3 });
  });

  it('rejects a wrong chunk, outside or fractional cells, and never materializes an unknown chunk', () => {
    const server = fixture(),
      chunk = server.getChunk(0, 0, 0);
    expect(server.peekLoadedVoxelInChunk(chunk.key, -1, 0, 0)).toBeNull();
    expect(server.peekLoadedVoxelInChunk(chunk.key, CHUNK_SIZE, 0, 0)).toBeNull();
    expect(server.peekLoadedVoxelInChunk(chunk.key, 0, 0.5, 0)).toBeNull();
    server.getChunk(1, 0, 0);
    expect(server.peekLoadedVoxelInChunk('1,0,0', 0, 0, 0)).toBeNull();
    expect(server.peekLoadedVoxelInChunk('2,0,0', 2 * CHUNK_SIZE, 0, 0)).toBeNull();
    expect(server.peekLoadedVoxel(2 * CHUNK_SIZE, 0, 0)).toBeNull();
  });

  it('reads the current chunk, revision and fluid after mutation, unloading and replacement', () => {
    const server = fixture(),
      original = server.getChunk(0, 0, 0),
      chunks = new Map([[original.key, original]]);
    expect(peekLoadedVoxelInChunk(chunks, original.key, 0, 0, 0)?.revision).toBe(original.revision);
    original.revision += 1;
    expect(peekLoadedVoxelInChunk(chunks, original.key, 0, 0, 0)?.revision).toBe(original.revision);
    chunks.delete(original.key);
    expect(peekLoadedVoxelInChunk(chunks, original.key, 0, 0, 0)).toBeNull();
    const replacement = {
      ...original,
      revision: original.revision + 10,
      voxels: new Uint16Array(CHUNK_SIZE ** 3),
      fluid: new Uint8Array(CHUNK_SIZE ** 3),
    };
    replacement.voxels[0] = Voxel.Lava;
    replacement.fluid[0] = 7;
    chunks.set(original.key, replacement);
    expect(peekLoadedVoxelInChunk(chunks, original.key, 0, 0, 0)).toEqual({
      voxel: Voxel.Lava,
      chunkKey: original.key,
      revision: replacement.revision,
      fluid: { level: 7 },
    });
  });
});

describe('GameServer headless authority', () => {
  it('准备Mesh时pin完整27格并只让持久层读取未驻留坐标', async () => {
    const residentCoordinates = [
      [-1, 0, -3],
      [0, 1, -2],
      [1, 2, -1],
    ] as const;
    let requestedResidentKeys: readonly string[] | undefined;
    const holder: { server?: GameServer } = {};
    const persistence: ChunkPersistence = {
      loadSnapshot: () => null,
      saveSnapshots: () => undefined,
      ensureNeighborhood: async (_cx, _cy, _cz, residentKeys) => {
        requestedResidentKeys = residentKeys;
        holder.server!.maintainCanonicalResidency();
      },
    };
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'mesh-neighborhood-residency',
      persistence,
      canonicalResidency: { target: 0, hardLimit: 64, evictionBatch: 32 },
    });
    holder.server = server;
    const residentKeys = residentCoordinates.map(([cx, cy, cz]) => chunkKey(cx, cy, cz));
    server.setFluidActiveChunks(residentKeys);
    residentCoordinates.forEach(([cx, cy, cz]) => {
      expect(
        server.acceptWorkerCanonical({
          key: chunkKey(cx, cy, cz),
          cx,
          cy,
          cz,
          chunkRevision: 0,
          generatorVersion: server.generatorVersion,
          provider: testWorldgenProvider,
          canonical: new Uint16Array(32 ** 3),
        }),
      ).toBe(true);
    });
    server.retainMeshChunk(0, 1, -2);
    const releasePreparation = server.retainMeshPreparationNeighborhood(0, 1, -2);
    server.setFluidActiveChunks([]);
    await server.ensureChunkNeighborhood(0, 1, -2);

    expect(requestedResidentKeys).toEqual(residentKeys);
    residentCoordinates.forEach(([cx, cy, cz]) =>
      expect(server.peekLoadedVoxel(cx * 32, cy * 32, cz * 32)).not.toBeNull(),
    );
    releasePreparation();
    server.releaseChunkNeighborhood(0, 1, -2);
    expect(server.canonicalResidencyDiagnostics.residentCount).toBe(0);
  });

  it('重复旧center release不能撤掉相邻准备期读集且准备闭包只释放自身代际', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'mesh-neighborhood-overlap',
      canonicalResidency: { target: 0, hardLimit: 8, evictionBatch: 8 },
    });
    const key = chunkKey(0, 0, 0);
    server.setFluidActiveChunks([key]);
    expect(
      server.acceptWorkerCanonical({
        key,
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: server.generatorVersion,
        provider: testWorldgenProvider,
        canonical: new Uint16Array(32 ** 3),
      }),
    ).toBe(true);
    server.retainMeshChunk(0, 0, 0);
    const releaseA = server.retainMeshPreparationNeighborhood(1, 0, 0);
    const releaseB = server.retainMeshPreparationNeighborhood(1, 0, 0);
    server.setFluidActiveChunks([]);

    server.releaseChunkNeighborhood(0, 0, 0);
    server.releaseChunkNeighborhood(0, 0, 0);
    releaseA();
    releaseA();

    expect(server.peekLoadedVoxel(0, 0, 0)).not.toBeNull();
    releaseB();
    expect(server.canonicalResidencyDiagnostics.residentCount).toBe(0);
  });

  it('deterministically generates canonical data and runs without a browser client', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'headless-authority',
    });

    expect(server.getVoxel(3, 20, -4)).toBe(server.getVoxel(3, 20, -4));
    expect(server.getChunk(0, 0, 0).voxels).toBeInstanceOf(Uint16Array);
    expect(server.generatorVersion).toBeGreaterThan(0);
  });

  it('commits a cross-chunk edit batch as one aggregate structural change', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'batch-authority',
    });
    const result = server.editBatch({
      actorId: 'harness',
      edits: [
        { x: 31, y: 0, z: 0, value: Voxel.Air },
        { x: 32, y: 0, z: 0, value: Voxel.Wood },
        { x: 32, y: 1, z: 0, value: Voxel.Water },
      ],
    });

    expect(result.structuralChange).toEqual({
      type: 'voxel-region-changed',
      actorId: 'harness',
      worldRevision: 1,
      mutationCount: 3,
      chunks: [chunkKey(0, 0, 0), chunkKey(1, 0, 0)],
      chunkRevisions: [
        { key: chunkKey(0, 0, 0), revision: 1 },
        { key: chunkKey(1, 0, 0), revision: 1 },
      ],
      meshChunks: expect.arrayContaining([chunkKey(0, 0, 0), chunkKey(1, 0, 0)]),
      bounds: { min: [31, 0, 0], max: [32, 1, 0] },
    });
    expect(result).toMatchObject({ committed: true, worldRevision: 1, semanticEvents: [] });
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 1, dirty: true });
    expect(server.getChunk(1, 0, 0)).toMatchObject({ revision: 1, dirty: true });
    expect(server.getVoxel(32, 1, 0)).toBe(Voxel.Water);

    server.edit(32, 1, 0, Voxel.Water);
    expect(server.getChunk(1, 0, 0).revision).toBe(1);
  });

  it('persists only dirty materialized snapshots and reloads them exactly', async () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'snapshot-authority',
      persistence,
    });
    first.getChunk(2, 0, 0);
    first.edit(64, 20, 0, Voxel.Wood);

    await expect(first.flushDirtyChunks()).resolves.toEqual([chunkKey(2, 0, 0)]);
    expect(persistence.writes).toEqual([chunkKey(2, 0, 0)]);
    await expect(first.flushDirtyChunks()).resolves.toEqual([]);

    const reloaded = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'snapshot-authority',
      persistence,
    });
    expect(reloaded.getVoxel(64, 20, 0)).toBe(Voxel.Wood);
    expect(reloaded.getChunk(2, 0, 0)).toMatchObject({ revision: 1, dirty: false, materialized: true });
  });

  it('does not apply a materialized snapshot to a different seed', async () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'snapshot-seed-a',
      persistence,
    });
    first.edit(0, 20, 0, Voxel.Wood);
    await first.flushDirtyChunks();

    const otherSeed = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'snapshot-seed-b',
      persistence,
    });
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
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'snapshot-validation',
      persistence,
    });

    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 0, dirty: false, materialized: false });
    expect(server.getChunk(0, 0, 0).voxels).toHaveLength(32 ** 3);
  });

  it('keeps dirty chunks retryable when snapshot persistence fails', async () => {
    const persistence: ChunkPersistence = {
      loadSnapshot: () => null,
      saveSnapshots: () => {
        throw new Error('simulated persistence failure');
      },
    };
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'dirty-retry',
      persistence,
    });
    server.edit(0, 20, 0, Voxel.Wood);

    await expect(server.flushDirtyChunks()).rejects.toThrow('simulated persistence failure');
    expect(server.getChunk(0, 0, 0).dirty).toBe(true);
  });

  it('keeps a newer edit dirty when an older save ACK arrives', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const revisions: number[] = [];
    const persistence: ChunkPersistence = {
      loadSnapshot: () => null,
      saveSnapshots: async (snapshots) => {
        revisions.push(snapshots[0].revision);
        if (snapshots[0].revision === 1) await firstWrite;
      },
    };
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'edit-during-save',
      persistence,
    });
    server.edit(0, 20, 0, Voxel.Wood);
    const firstFlush = server.flushDirtyChunks();
    server.edit(0, 20, 0, Voxel.Sand);
    releaseFirst();
    await firstFlush;

    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 2, persistedRevision: 1, dirty: true });
    await server.flushDirtyChunks();
    expect(revisions).toEqual([1, 2]);
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 2, persistedRevision: 2, dirty: false });
  });

  it('does not let an old ACK regress a newer persisted revision', async () => {
    const releases = new Map<number, () => void>();
    const persistence: ChunkPersistence = {
      loadSnapshot: () => null,
      saveSnapshots: (snapshots) =>
        new Promise<void>((resolve) => {
          releases.set(snapshots[0].revision, resolve);
        }),
    };
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'stale-save-ack',
      persistence,
    });
    server.edit(0, 20, 0, Voxel.Wood);
    const firstFlush = server.flushDirtyChunks();
    server.edit(0, 20, 0, Voxel.Sand);
    const secondFlush = server.flushDirtyChunks();
    releases.get(2)?.();
    await secondFlush;
    releases.get(1)?.();
    await firstFlush;

    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 2, persistedRevision: 2, dirty: false });
  });

  it('retains both sides of a materialized Chunk boundary after save and reload', async () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'boundary-reload',
      persistence,
    });
    first.editBatch({
      actorId: 'boundary-test',
      edits: [
        { x: 31, y: 20, z: 0, value: Voxel.Wood },
        { x: 32, y: 20, z: 0, value: Voxel.Sand },
      ],
    });
    await first.flushDirtyChunks();

    const reloaded = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'boundary-reload',
      persistence,
    });
    expect(reloaded.getVoxel(31, 20, 0)).toBe(Voxel.Wood);
    expect(reloaded.getVoxel(32, 20, 0)).toBe(Voxel.Sand);
  });

  it('derives a one-voxel mesh halo without materializing procedural neighbours', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'derived-mesh-halo',
    });
    const chunks = (server as unknown as { chunks: Map<string, unknown> }).chunks;

    const initial = server.createDerivedMeshSnapshot(0, 0, 0);
    expect(chunks.size).toBe(1);
    expect(initial.halo).toHaveLength(34 ** 3);
    const profiling = initial as unknown as { proceduralVoxelSamples: number; macroContextCount: number };
    expect(profiling.proceduralVoxelSamples).toBeGreaterThan(0);
    expect(profiling.macroContextCount).toBeGreaterThan(0);
    expect(profiling.macroContextCount).toBeLessThan(profiling.proceduralVoxelSamples);

    server.edit(32, 20, 0, Voxel.Wood);
    const afterBoundaryEdit = server.createDerivedMeshSnapshot(0, 0, 0);
    expect(afterBoundaryEdit.halo[meshHaloIndex(32, 20, 0)]).toBe(Voxel.Wood);
    expect(afterBoundaryEdit.haloRevision).not.toBe(initial.haloRevision);
  });

  it('prepares only copied authority overlays and accepts a current Worker canonical result once', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'worker-canonical',
    });
    server.edit(32, 20, 0, Voxel.Wood);
    const prepared = server.prepareWorkerMeshInput(0, 0, 0);
    const neighbour = prepared.overlays.find((overlay) => overlay.cx === 1 && overlay.cy === 0 && overlay.cz === 0);
    expect(prepared.canonical).toBeUndefined();
    expect(neighbour?.voxels).not.toBe(server.getChunk(1, 0, 0).voxels);

    const canonical = createProceduralMeshInput({
      seed: server.seed,
      cx: 0,
      cy: 0,
      cz: 0,
      overlays: prepared.overlays,
    }).canonical;
    expect(server.acceptWorkerCanonical({ ...prepared, canonical })).toBe(false);
    expect(server.acceptWorkerCanonical({ ...prepared, provider: testWorldgenProvider, canonical })).toBe(true);
    expect(server.acceptWorkerCanonical({ ...prepared, provider: testWorldgenProvider, canonical })).toBe(true);
    expect(server.getChunk(0, 0, 0).voxels).toEqual(canonical);
  });

  it('keeps Worker-first canonical, halo and mesh byte-equivalent to the synchronous path', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'worker-equivalence',
    });
    const synchronous = server.createDerivedMeshSnapshot(0, 0, 0);
    const prepared = server.prepareWorkerMeshInput(0, 0, 0);
    const workerInput = createProceduralMeshInput({
      seed: server.seed,
      cx: 0,
      cy: 0,
      cz: 0,
      canonical: prepared.canonical,
      overlays: prepared.overlays,
    });

    expect(workerInput.canonical).toEqual(synchronous.canonical);
    expect(workerInput.halo).toEqual(synchronous.halo);
    expect(workerInput.haloRevision).toBe(synchronous.haloRevision);
    expect(
      meshChunk({
        seed: server.seed,
        cx: 0,
        cy: 0,
        cz: 0,
        data: workerInput.canonical,
        changes: [],
        halo: workerInput.halo,
      }),
    ).toEqual(
      meshChunk({
        seed: server.seed,
        cx: 0,
        cy: 0,
        cz: 0,
        data: synchronous.canonical,
        changes: [],
        halo: synchronous.halo,
      }),
    );
  });

  it('owns minimal entity state and the simulation clock independently of presentation', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'entity-clock',
    });
    const player = server.createEntity({ kind: 'player', position: [1, 40, -2] });

    server.updateEntity(player.id, { position: [2, 41, -3] });
    server.advanceClock(1.5);

    expect(server.getEntity(player.id)).toEqual({ id: player.id, kind: 'player', position: [2, 41, -3] });
    expect(server.worldTime).toBeCloseTo(1.5);
  });
});
