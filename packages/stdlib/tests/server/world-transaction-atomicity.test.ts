import { describe, expect, it } from 'vitest';
import { computeFluidCandidate } from '../../src/server/fluid/fluid-transaction';
import { GameServer } from '../../src/server/game-server';
import { createGameServerWorldCommitApi } from '../../src/server/game-server-world-commit-adapter';
import { MAX_WORLD_EDIT_BATCH_EDITS } from '../../src/server/world-edit-batch-plan';
import { assertUniqueMutationBufferCoordinates, WorldMutationBuffer } from '../../src/server/world-mutation';
import { Voxel } from '../../src/world/voxel';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';

type CommitKind = 'single' | 'general-buffer' | 'unique-buffer';
const createServer = (seedText: string) =>
  new GameServer({ worldgenProvider: testWorldgenExecutableProvider, platform: testCorePlatform, seedText });
const createFluidCandidate = (seedText: string) => {
  const server = createServer(seedText);
  server.editBatch({
    actorId: 'setup',
    edits: [
      { x: 0, y: 49, z: 0, value: Voxel.Stone },
      { x: 0, y: 50, z: 0, value: Voxel.Water },
    ],
  });
  const lease = server.requestFluidWork()!;
  const candidate = computeFluidCandidate(lease);
  if (!candidate.writes.length) throw new Error('Fluid fixture must produce a canonical write.');
  return { server, lease, candidate };
};
const owner = (server: GameServer) =>
  (
    server as unknown as {
      gameplayHost: { kernelState: { restoreCommitFrontier(sequence: number, revision: number): void } };
    }
  ).gameplayHost.kernelState;
const exhaustKernelCommits = (server: GameServer) =>
  owner(server).restoreCommitFrontier(Number.MAX_SAFE_INTEGER, server.worldRevision);
const exhaustWorldRevision = (server: GameServer) =>
  owner(server).restoreCommitFrontier(server.commitSequence, Number.MAX_SAFE_INTEGER);
const bufferFor = (kind: CommitKind, position: readonly [number, number, number], value: number) => {
  const buffer =
    kind === 'unique-buffer'
      ? WorldMutationBuffer.forUniqueCoordinates({ sourceId: kind })
      : new WorldMutationBuffer({ sourceId: kind });
  return buffer.write(...position, value);
};
const commit = (server: GameServer, kind: CommitKind, position: readonly [number, number, number], value: number) =>
  kind === 'single'
    ? server.edit(...position, value)
    : server.editBatch({ actorId: 'capacity', buffers: [bufferFor(kind, position, value)] });
const expectCellUnchanged = (
  server: GameServer,
  position: readonly [number, number, number],
  before: number,
  worldRevision = 0,
) => {
  const chunk = server.getChunk(
    Math.floor(position[0] / 32),
    Math.floor(position[1] / 32),
    Math.floor(position[2] / 32),
  );
  expect(server.getVoxel(...position)).toBe(before);
  expect(chunk).toMatchObject({ revision: 0, dirty: false });
  expect(server.worldRevision).toBe(worldRevision);
  expect(server.mutationCount).toBe(0);
};

describe('world transaction atomicity and input bounds', () => {
  it.each(['single', 'general-buffer', 'unique-buffer'] as const)(
    'rejects exhausted Kernel commit capacity before %s writes canonical state',
    (kind) => {
      const server = createServer(`transaction-capacity-${kind}`);
      const position = [1, 20, 1] as const;
      const before = server.getVoxel(...position);
      const value = before === Voxel.Wood ? Voxel.Stone : Voxel.Wood;
      exhaustKernelCommits(server);
      expect(() => commit(server, kind, position, value)).toThrow(/capacity|exhausted/i);
      expectCellUnchanged(server, position, before);
    },
  );

  it.each(['single', 'general-buffer', 'unique-buffer'] as const)(
    'rejects exhausted world revision before %s writes canonical state',
    (kind) => {
      const server = createServer(`transaction-world-capacity-${kind}`);
      const position = [1, 20, 1] as const;
      const before = server.getVoxel(...position);
      const value = before === Voxel.Wood ? Voxel.Stone : Voxel.Wood;
      exhaustWorldRevision(server);
      expect(() => commit(server, kind, position, value)).toThrow(/revision.*exhausted|capacity/i);
      expectCellUnchanged(server, position, before, Number.MAX_SAFE_INTEGER);
    },
  );

  it.each(['kernel', 'world', 'chunk'] as const)(
    'rejects exhausted %s capacity before an accepted fluid candidate writes canonical state',
    (capacity) => {
      const server = createServer(`transaction-capacity-fluid-${capacity}`);
      server.editBatch({
        actorId: 'setup',
        edits: [
          { x: 0, y: 49, z: 0, value: Voxel.Stone },
          { x: 0, y: 50, z: 0, value: Voxel.Water },
        ],
      });
      if (capacity === 'chunk') server.getChunk(0, 1, 0).revision = Number.MAX_SAFE_INTEGER;
      const candidate = computeFluidCandidate(server.requestFluidWork()!);
      expect(candidate.writes.length).toBeGreaterThan(0);
      const before = candidate.writes.map((write) => ({
        write,
        voxel: server.getVoxel(...write.position),
        fluid: server.getFluidCell(...write.position),
      }));
      const mutations = server.mutationCount;
      if (capacity === 'kernel') exhaustKernelCommits(server);
      if (capacity === 'world') exhaustWorldRevision(server);
      const revision = server.worldRevision;

      expect(() => server.commitFluidCandidate(candidate)).toThrow(/capacity|exhausted/i);
      expect(server.requestFluidWork()).toBeNull();
      expect(server.abortFluidWork(candidate.workId, 'capacity-rejected')).toBe(true);
      expect(server.requestFluidWork()).not.toBeNull();
      for (const entry of before) {
        expect(server.getVoxel(...entry.write.position)).toBe(entry.voxel);
        expect(server.getFluidCell(...entry.write.position)).toEqual(entry.fluid);
      }
      expect(server.worldRevision).toBe(revision);
      expect(server.mutationCount).toBe(mutations);
    },
  );

  it('rejects exhausted Chunk revisions before single, general, or unique writes', () => {
    for (const kind of ['single', 'general-buffer', 'unique-buffer'] as const) {
      const server = createServer(`transaction-chunk-capacity-${kind}`);
      const position = [1, 20, 1] as const;
      const before = server.getVoxel(...position);
      const chunk = server.getChunk(0, 0, 0);
      chunk.revision = Number.MAX_SAFE_INTEGER;
      const value = before === Voxel.Wood ? Voxel.Stone : Voxel.Wood;
      expect(() => commit(server, kind, position, value)).toThrow(/revision.*exhausted|capacity/i);
      expect(server.getVoxel(...position)).toBe(before);
      expect(chunk.revision).toBe(Number.MAX_SAFE_INTEGER);
      expect(server.worldRevision).toBe(0);
      expect(server.mutationCount).toBe(0);
    }
  });

  it('bounds object batches without reducing the one-million-voxel Fill buffer contract', () => {
    const server = createServer('transaction-object-limit');
    const edits = Array.from({ length: MAX_WORLD_EDIT_BATCH_EDITS + 1 }, () => ({
      x: 0,
      y: 20,
      z: 0,
      value: Voxel.Wood,
    }));
    expect(() => server.editBatch({ actorId: 'oversized-object', edits })).toThrow(/edit.*limit/i);
    expect(server.worldRevision).toBe(0);
    expect(server.mutationCount).toBe(0);
  });

  it('reports sparse immediate metrics from enumerated edits instead of array length', () => {
    const server = createServer('transaction-sparse-metrics');
    const edits = new Array<{ x: number; y: number; z: number; value: number }>(1);
    const result = server.editBatch({ actorId: 'sparse', edits });
    expect(result.metrics).toMatchObject({ inputMutationCount: 0, mutationPayloadBytes: 0, mutationCapacityBytes: 0 });
  });

  it('rejects a false unique-coordinate buffer claim before writing', () => {
    const server = createServer('transaction-false-unique');
    const position = [1, 20, 1] as const;
    const before = server.getVoxel(...position);
    const buffer = WorldMutationBuffer.forUniqueCoordinates({ sourceId: 'false-unique' });
    buffer.write(...position, Voxel.Wood).write(...position, Voxel.Stone);
    expect(() => server.editBatch({ actorId: 'false-unique', buffers: [buffer] })).toThrow(/unique|duplicate/i);
    expectCellUnchanged(server, position, before);
  });

  it('rejects a false unique-coordinate claim before any authority Chunk or Station read', () => {
    let chunkReads = 0;
    let voxelReads = 0;
    const api = createGameServerWorldCommitApi({
      chunks: new Map(),
      getChunk: () => {
        chunkReads += 1;
        throw new Error('Chunk read must not be reached.');
      },
      getVoxel: () => {
        voxelReads += 1;
        return Voxel.Air;
      },
      getLoadedVoxel: () => {
        voxelReads += 1;
        return Voxel.Air;
      },
      kernelState: {} as never,
      mutationCount: { get: () => 0, set: () => undefined },
      platform: testCorePlatform,
      fluidChunks: {} as never,
      fluidWindow: {} as never,
      fluidRuntime: () => ({}) as never,
      priorityForBatch: () => 'ordinary',
      entities: () => ({}) as never,
      stationCodec: () => ({}) as never,
    });
    const buffer = WorldMutationBuffer.forUniqueCoordinates({ sourceId: 'false-unique-read-boundary' });
    buffer.write(1, 20, 1, Voxel.Wood).write(1, 20, 1, Voxel.Stone);

    expect(() => api.editBatch({ actorId: 'false-unique-read-boundary', buffers: [buffer] })).toThrow(
      /unique|duplicate/i,
    );
    expect({ chunkReads, voxelReads }).toEqual({ chunkReads: 0, voxelReads: 0 });
  });

  it('keeps the one-million-voxel Fill buffer valid under the unique-coordinate preflight', () => {
    const buffer = WorldMutationBuffer.forUniqueCoordinates({
      sourceId: 'one-million-unique',
      initialCapacity: 1_000_000,
    });
    for (let index = 0; index < 1_000_000; index += 1) buffer.write(index, 0, 0, Voxel.Stone);

    expect(() => assertUniqueMutationBufferCoordinates(buffer)).not.toThrow();
    expect(buffer.count).toBe(1_000_000);
  });

  it.each([
    [
      'nextFrontier',
      () => {
        throw new Error('untrusted next frontier callback');
      },
    ],
    ['nextCleanupFrontier', null],
  ] as const)('fails closed before a fluid write for an own %s forEach', (field, callback) => {
    const { server, lease, candidate } = createFluidCandidate(`transaction-fluid-${field}`);
    const before = candidate.writes.map((write) => ({
      position: write.position,
      voxel: server.getVoxel(...write.position),
      fluid: server.getFluidCell(...write.position),
    }));
    const revision = server.worldRevision;
    const mutations = server.mutationCount;
    Object.defineProperty(candidate[field], 'forEach', { configurable: true, enumerable: true, value: callback });

    expect(server.commitFluidCandidate(candidate)).toEqual({ accepted: false, reason: 'invalid-result' });
    for (const cell of before) {
      expect(server.getVoxel(...cell.position)).toBe(cell.voxel);
      expect(server.getFluidCell(...cell.position)).toEqual(cell.fluid);
    }
    expect(server.worldRevision).toBe(revision);
    expect(server.mutationCount).toBe(mutations);
    expect(server.requestFluidWork()?.frontier).toEqual(lease.frontier);
  });

  it('rejects candidate accessors, sparse arrays, and extra array properties without losing the lease', () => {
    {
      const { server, lease, candidate } = createFluidCandidate('transaction-fluid-accessor');
      Object.defineProperty(candidate, 'writes', {
        configurable: true,
        enumerable: true,
        get: () => {
          throw new Error('untrusted writes accessor');
        },
      });
      expect(server.commitFluidCandidate(candidate)).toEqual({ accepted: false, reason: 'invalid-result' });
      expect(server.requestFluidWork()?.frontier).toEqual(lease.frontier);
    }

    {
      const { server, lease, candidate } = createFluidCandidate('transaction-fluid-sparse');
      const sparse = new Array(candidate.nextFrontier.length + 1);
      candidate.nextFrontier.forEach((position, index) => (sparse[index] = position));
      candidate.nextFrontier = sparse;
      expect(server.commitFluidCandidate(candidate)).toEqual({ accepted: false, reason: 'invalid-result' });
      expect(server.requestFluidWork()?.frontier).toEqual(lease.frontier);
    }

    {
      const { server, lease, candidate } = createFluidCandidate('transaction-fluid-extra');
      Object.defineProperty(candidate.nextFrontier, 'unexpected', { enumerable: true, value: true });
      expect(server.commitFluidCandidate(candidate)).toEqual({ accepted: false, reason: 'invalid-result' });
      expect(server.requestFluidWork()?.frontier).toEqual(lease.frontier);
    }
  });
});
