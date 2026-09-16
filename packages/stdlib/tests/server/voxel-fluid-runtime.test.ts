import { testWorldgenExecutableProvider, testWorldgenProvider } from '../support/worldgen';
import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { GameServer, type WorldCommitResult } from '../../src/server/game-server';
import { computeFluidCandidate } from '../../src/server/fluid/fluid-transaction';
import { MemoryChunkPersistence } from '../../src/server/persistence/memory-chunk-persistence';
import { WorldMutationBuffer } from '../../src/server/world-mutation';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../src/world/voxel';

const clearBox = (server: GameServer, minX: number, maxX: number, minY: number, maxY: number) => {
  const edits = [];
  for (let y = minY; y <= maxY; y += 1)
    for (let x = minX; x <= maxX; x += 1) edits.push({ x, y, z: 0, value: Voxel.Air });
  server.editBatch({ actorId: 'fixture', edits });
};

const activateKnownFluidNeighborhood = (server: GameServer) => {
  const keys: string[] = [];
  for (const cx of [-1, 0])
    for (const cz of [-1, 0]) {
      server.getChunk(cx, 1, cz);
      keys.push(`${cx},1,${cz}`);
    }
  server.setFluidActiveChunks(keys);
};

const runFluidCandidates = (server: GameServer, maxCandidates: number) => {
  const commits: WorldCommitResult[] = [];
  let steps = 0;
  let processed = 0;
  while (steps < maxCandidates) {
    const lease = server.requestFluidWork();
    if (!lease) break;
    processed += lease.frontier.length + (lease.cleanupFrontier?.length ?? 0);
    const result = server.commitFluidCandidate(computeFluidCandidate(lease));
    if (!result.accepted) throw new Error(`Fluid candidate rejected: ${result.reason}`);
    if (result.commit) commits.push(result.commit);
    steps += 1;
  }
  return { steps, processed, pending: server.fluidDiagnostics.pendingCellCount, commits };
};

describe('bounded voxel fluid runtime', () => {
  it('falls before spreading, then attenuates across supported ground', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-fall',
    });
    clearBox(server, -4, 4, 50, 55);
    for (let x = -4; x <= 4; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.edit(0, 54, 0, Voxel.Water, 'fixture');

    runFluidCandidates(server, 8);

    expect(server.getVoxel(0, 50, 0)).toBe(Voxel.Water);
    expect(server.getFluidCell(0, 50, 0)).toMatchObject({ level: 8, source: false });
    expect(server.getFluidCell(1, 50, 0)?.level).toBe(7);
    expect(server.getVoxel(4, 54, 0)).toBe(Voxel.Air);
  });

  it('runs one bounded worker lease without leaving authority work in flight', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-30hz',
    });
    clearBox(server, -1, 1, 50, 51);
    server.edit(0, 49, 0, Voxel.Stone, 'fixture');
    server.edit(0, 50, 0, Voxel.Water, 'fixture');
    const result = runFluidCandidates(server, 1);
    expect(result.steps).toBe(1);
    expect(result.processed).toBeLessThanOrEqual(128);
    expect(server.fluidDiagnostics.inFlightLeaseCount).toBe(0);
  });

  it('respects obstacles and retracts unsupported flow after source removal', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-retract',
    });
    clearBox(server, -4, 4, 50, 52);
    for (let x = -4; x <= 4; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.edit(1, 50, 0, Voxel.Stone, 'fixture');
    server.edit(0, 50, 0, Voxel.Water, 'fixture');
    activateKnownFluidNeighborhood(server);
    runFluidCandidates(server, 8);
    expect(server.getVoxel(1, 50, 0)).toBe(Voxel.Stone);
    expect(server.getVoxel(-1, 50, 0)).toBe(Voxel.Water);
    expect(server.getFluidCell(-1, 50, 0)?.source).toBe(false);

    server.edit(0, 50, 0, Voxel.Air, 'fixture');
    for (let index = 0; index < 20; index += 1) runFluidCandidates(server, 8);
    expect(server.getVoxel(-1, 50, 0)).toBe(Voxel.Air);
  });

  it('crosses a Chunk boundary and restores versioned fluid sidecars', async () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-persist',
      persistence,
    });
    clearBox(first, 29, 35, 50, 52);
    for (let x = 29; x <= 35; x += 1) first.edit(x, 49, 0, Voxel.Stone, 'fixture');
    first.edit(31, 50, 0, Voxel.Water, 'fixture');
    runFluidCandidates(first, 8);
    expect(first.getVoxel(32, 50, 0)).toBe(Voxel.Water);
    const before = first.getFluidCell(32, 50, 0);
    await first.flushDirtyChunks();

    const restored = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-persist',
      persistence,
    });
    expect(restored.getVoxel(32, 50, 0)).toBe(Voxel.Water);
    expect(restored.getFluidCell(32, 50, 0)).toEqual(before);
  });

  it('limits work per call and remains deterministic across time slicing', () => {
    const make = () => {
      const server = new GameServer({
        worldgenProvider: testWorldgenExecutableProvider,
        platform: testCorePlatform,
        seedText: 'fluid-deterministic',
      });
      clearBox(server, -10, 10, 50, 54);
      for (let x = -10; x <= 10; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
      server.edit(0, 52, 0, Voxel.Water, 'fixture');
      return server;
    };
    const whole = make();
    const sliced = make();
    const result = runFluidCandidates(whole, 8);
    for (let i = 0; i < 8; i += 1) runFluidCandidates(sliced, 1);
    expect(result.steps).toBe(8);
    expect(result.processed).toBeLessThanOrEqual(8 * 128);
    for (let x = -10; x <= 10; x += 1)
      for (let y = 50; y <= 54; y += 1) expect(whole.getFluidCell(x, y, 0)).toEqual(sliced.getFluidCell(x, y, 0));
  });

  it('commits sidecar-only level changes so remesh and persistence cannot miss them', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-level-commit',
    });
    clearBox(server, -2, 2, 50, 52);
    for (let x = -2; x <= 2; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.edit(0, 50, 0, Voxel.Water, 'fixture');
    runFluidCandidates(server, 8);
    const before = server.getChunk(0, 1, 0).revision;
    server.edit(0, 50, 0, Voxel.Air, 'fixture');
    const result = runFluidCandidates(server, 3);
    expect(result.commits.some((commit) => commit.structuralChange?.meshChunks.includes('0,1,0'))).toBe(true);
    expect(server.getChunk(0, 1, 0).revision).toBeGreaterThan(before);
    expect(server.getChunk(0, 1, 0).dirty).toBe(true);
  });

  it('reactivates persisted non-source water and resumes convergence after reload', async () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-resume',
      persistence,
    });
    clearBox(first, -2, 2, 50, 54);
    first.edit(0, 54, 0, Voxel.Water, 'fixture');
    runFluidCandidates(first, 6);
    await first.flushDirtyChunks();
    const restored = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-resume',
      persistence,
    });
    restored.setFluidActiveChunks(['0,1,0']);
    expect(restored.getVoxel(0, 53, 0)).toBe(Voxel.Water);
    let processed = 0;
    for (let index = 0; index < 20; index += 1) processed += runFluidCandidates(restored, 8).processed;
    expect(processed).toBeGreaterThan(0);
    expect(restored.getVoxel(0, 52, 0)).toBe(Voxel.Water);
  });

  it('pauses at unloaded Chunk boundaries instead of materializing an unbounded flow path', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-loaded-window',
    });
    clearBox(server, 28, 31, 50, 52);
    for (let x = 28; x <= 31; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.getChunk(1, 1, 0);
    server.setFluidActiveChunks(['0,1,0']);
    server.edit(31, 50, 0, Voxel.Water, 'fixture');
    const materializedBefore = server.materializedChunkCount;

    for (let index = 0; index < 100; index += 1) runFluidCandidates(server, 8);

    expect(server.materializedChunkCount).toBe(materializedBefore);
  });

  it('reactivates a paused boundary when worker-first canonical data arrives', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-worker-boundary',
    });
    server.setFluidActiveChunks(['0,1,0', '1,1,0']);
    clearBox(server, 28, 31, 50, 52);
    for (let x = 28; x <= 31; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.edit(31, 50, 0, Voxel.Water, 'fixture');
    runFluidCandidates(server, 8);

    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    canonical[voxelIndex(0, 17, 0)] = Voxel.Stone;
    expect(
      server.acceptWorkerCanonical({
        key: '1,1,0',
        cx: 1,
        cy: 1,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: server.generatorVersion,
        provider: testWorldgenProvider,
        canonical,
      }),
    ).toBe(true);
    runFluidCandidates(server, 8);

    expect(server.getFluidCell(32, 50, 0)).toEqual({ level: 7, source: false });
  });

  it('initializes worker canonical Water with a legacy full-source sidecar', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-natural-sidecar',
    });
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    canonical[voxelIndex(1, 1, 1)] = Voxel.Water;
    expect(
      server.acceptWorkerCanonical({
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: server.generatorVersion,
        provider: testWorldgenProvider,
        canonical,
      }),
    ).toBe(true);
    expect(server.createDerivedMeshSnapshot(0, 0, 0).fluid[voxelIndex(1, 1, 1)]).toBe(0x88);
  });

  it('retries loaded Chunk activation after queue capacity becomes available', () => {
    const persistence = new MemoryChunkPersistence();
    const targetVoxels = new Uint16Array(CHUNK_SIZE ** 3);
    const targetFluid = new Uint8Array(CHUNK_SIZE ** 3);
    targetVoxels[voxelIndex(1, 18, 1)] = Voxel.Water;
    targetFluid[voxelIndex(1, 18, 1)] = 1;
    persistence.saveSnapshots([
      {
        key: '1,1,0',
        seedText: 'fluid-fairness',
        generatorVersion: 2,
        revision: 1,
        cx: 1,
        cy: 1,
        cz: 0,
        voxels: targetVoxels,
        fluidVersion: 1,
        fluid: targetFluid,
      },
    ]);
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-fairness',
      persistence,
    });
    const saturated = new Uint16Array(CHUNK_SIZE ** 3);
    saturated.fill(Voxel.Water);
    expect(
      server.acceptWorkerCanonical({
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: server.generatorVersion,
        provider: testWorldgenProvider,
        canonical: saturated,
      }),
    ).toBe(true);
    server.getChunk(1, 1, 0);
    server.setFluidActiveChunks(['0,0,0', '1,1,0']);
    for (let index = 0; index < 30; index += 1) {
      server.setFluidActiveChunks(['0,0,0', '1,1,0']);
      runFluidCandidates(server, 8);
    }
    expect(server.getVoxel(33, 50, 1)).toBe(Voxel.Air);
  });

  it('keeps batch and mutation-buffer water sidecars consistent through source removal', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-buffer-source-removal',
    });
    clearBox(server, -2, 2, 50, 52);
    for (let x = -2; x <= 2; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.editBatch({ actorId: 'fixture', edits: [{ x: 0, y: 50, z: 0, value: Voxel.Water }] });
    activateKnownFluidNeighborhood(server);
    expect(server.getFluidCell(0, 50, 0)).toEqual({ level: 8, source: true });
    runFluidCandidates(server, 8);
    expect(server.getVoxel(-1, 50, 0)).toBe(Voxel.Water);

    const edits = WorldMutationBuffer.forUniqueCoordinates({ sourceId: 'remove-source' }).write(0, 50, 0, Voxel.Air);
    server.editBatch({ actorId: 'fixture', buffers: [edits] });
    expect(server.getFluidCell(0, 50, 0)).toBeNull();
    for (let index = 0; index < 20; index += 1) runFluidCandidates(server, 8);
    expect(server.getVoxel(-1, 50, 0)).toBe(Voxel.Air);
  });

  it('accepts one cross-chunk candidate as one revision per changed chunk', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-cross-chunk-atomic',
    });
    server.setFluidActiveChunks(['0,1,0', '1,1,0']);
    clearBox(server, 30, 33, 50, 51);
    for (let x = 30; x <= 33; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.edit(31, 50, 0, Voxel.Water, 'fixture');
    const beforeLeft = server.getChunk(0, 1, 0).revision;
    const beforeRight = server.getChunk(1, 1, 0).revision;

    runFluidCandidates(server, 1);

    expect(server.getVoxel(32, 50, 0)).toBe(Voxel.Water);
    expect(server.getChunk(0, 1, 0).revision).toBe(beforeLeft + 1);
    expect(server.getChunk(1, 1, 0).revision).toBe(beforeRight + 1);
  });

  it('keeps a flow supplied by a second source when the first source is removed', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'fluid-two-source-cleanup',
    });
    clearBox(server, -3, 3, 50, 51);
    for (let x = -3; x <= 3; x += 1) server.edit(x, 49, 0, Voxel.Stone, 'fixture');
    server.edit(-2, 50, 0, Voxel.Water, 'fixture');
    server.edit(2, 50, 0, Voxel.Water, 'fixture');
    runFluidCandidates(server, 8);
    expect(server.getVoxel(0, 50, 0)).toBe(Voxel.Water);

    server.edit(-2, 50, 0, Voxel.Air, 'fixture');
    for (let index = 0; index < 20; index += 1) runFluidCandidates(server, 8);

    expect(server.getVoxel(0, 50, 0)).toBe(Voxel.Water);
    expect(server.getFluidCell(0, 50, 0)?.source).toBe(false);
  });
});
