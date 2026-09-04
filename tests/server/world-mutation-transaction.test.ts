import { describe, expect, it } from 'vitest';
import { executeFillCommand } from '../../src/server/commands/fill-command';
import { GameServer } from '../../src/server/game-server';
import { WorldMutationBuffer } from '../../src/server/world-mutation';
import type { ChunkPersistence } from '../../src/server/persistence/chunk-persistence';
import { MemoryChunkPersistence } from '../../src/server/persistence/memory-chunk-persistence';
import { Voxel, chunkKey } from '../../src/world/voxel';

describe('world mutation transaction', () => {
  it('commits cross-Chunk writes with one world revision and one revision per changed Chunk', () => {
    const server = new GameServer({ seedText: 'transaction-revision' });
    const result = server.editBatch({
      actorId: 'player-1',
      edits: [
        { x: 32, y: 20, z: 0, value: Voxel.Wood },
        { x: 31, y: 20, z: 0, value: Voxel.Sand },
        { x: 32, y: 21, z: 0, value: Voxel.Water },
      ],
    });

    expect(result).toMatchObject({ committed: true, worldRevision: 1 });
    expect(result.structuralChange).toEqual({
      type: 'voxel-region-changed',
      actorId: 'player-1',
      worldRevision: 1,
      mutationCount: 3,
      chunks: [chunkKey(0, 0, 0), chunkKey(1, 0, 0)],
      chunkRevisions: [
        { key: chunkKey(0, 0, 0), revision: 1 },
        { key: chunkKey(1, 0, 0), revision: 1 },
      ],
      meshChunks: expect.arrayContaining([chunkKey(0, 0, 0), chunkKey(1, 0, 0)]),
      bounds: { min: [31, 20, 0], max: [32, 21, 0] },
    });
    expect(server.worldRevision).toBe(1);
    expect(server.mutationCount).toBe(3);
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 1, dirty: true });
    expect(server.getChunk(1, 0, 0)).toMatchObject({ revision: 1, dirty: true });
  });

  it('coalesces repeated writes and drops a final state equal to the pre-commit value', () => {
    const server = new GameServer({ seedText: 'transaction-coalesce' });
    const original = server.getVoxel(4, 20, 4);
    const other = original === Voxel.Wood ? Voxel.Stone : Voxel.Wood;

    const noOp = server.editBatch({
      actorId: 'simulation',
      edits: [
        { x: 4, y: 20, z: 4, value: other },
        { x: 4, y: 20, z: 4, value: original },
      ],
    });
    expect(noOp).toMatchObject({ committed: false, worldRevision: 0, structuralChange: null });
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 0, dirty: false });
    expect(server.mutationCount).toBe(0);

    const changed = server.editBatch({
      actorId: 'simulation',
      edits: [
        { x: 4, y: 20, z: 4, value: Voxel.Air },
        { x: 4, y: 20, z: 4, value: other },
      ],
    });
    expect(changed.structuralChange?.mutationCount).toBe(1);
    expect(server.getVoxel(4, 20, 4)).toBe(other);
  });

  it('merges buffers by explicit priority and source id instead of caller array order', () => {
    const run = (reverse: boolean) => {
      const server = new GameServer({ seedText: 'transaction-buffer-order' });
      const player = new WorldMutationBuffer({ sourceId: 'player', priority: 10 });
      const simulation = new WorldMutationBuffer({ sourceId: 'simulation', priority: 20 });
      player.write(3, 20, 3, Voxel.Wood);
      simulation.write(3, 20, 3, Voxel.Sand);
      const buffers = reverse ? [simulation, player] : [player, simulation];
      const result = server.editBatch({ actorId: 'tick-1', buffers });
      return { result, voxel: server.getVoxel(3, 20, 3) };
    };

    const forward = run(false);
    const reversed = run(true);
    expect(forward.voxel).toBe(Voxel.Sand);
    expect(reversed.voxel).toBe(Voxel.Sand);
    expect(reversed.result).toMatchObject({
      committed: forward.result.committed,
      worldRevision: forward.result.worldRevision,
      structuralChange: forward.result.structuralChange,
      semanticEvents: forward.result.semanticEvents,
    });
  });

  it('validates values before a mutation buffer can silently narrow them', () => {
    const buffer = new WorldMutationBuffer({ sourceId: 'invalid-values', priority: 0 });

    expect(() => buffer.write(Number.NaN, 0, 0, Voxel.Stone)).toThrow(/coordinate/i);
    expect(() => buffer.write(0.5, 0, 0, Voxel.Stone)).toThrow(/coordinate/i);
    expect(() => buffer.write(2 ** 31, 0, 0, Voxel.Stone)).toThrow(/coordinate/i);
    expect(() => buffer.write(0, 0, 0, 65_537)).toThrow(/voxel/i);
    expect(buffer.count).toBe(0);
  });

  it('rejects mixing object edits and mutation buffers because their relative priority is undefined', () => {
    const server = new GameServer({ seedText: 'transaction-mixed-inputs' });
    const buffer = new WorldMutationBuffer({ sourceId: 'simulation', priority: 0 });
    buffer.write(0, 20, 0, Voxel.Wood);

    expect(() =>
      server.editBatch({
        actorId: 'mixed',
        edits: [{ x: 0, y: 20, z: 0, value: Voxel.Stone }],
        buffers: [buffer],
      }),
    ).toThrow(/edits.*buffers/i);
    expect(server.worldRevision).toBe(0);
  });

  it('rejects an invalid batch atomically before changing canonical state or revisions', () => {
    const server = new GameServer({ seedText: 'transaction-atomic-validation' });
    const before = server.getVoxel(0, 20, 0);
    const replacement = before === Voxel.Wood ? Voxel.Stone : Voxel.Wood;

    expect(() =>
      server.editBatch({
        actorId: 'invalid-batch',
        edits: [
          { x: 0, y: 20, z: 0, value: replacement },
          { x: Number.NaN, y: 20, z: 0, value: Voxel.Stone },
        ],
      }),
    ).toThrow(/coordinate/i);
    expect(server.getVoxel(0, 20, 0)).toBe(before);
    expect(server.worldRevision).toBe(0);
    expect(server.mutationCount).toBe(0);
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 0, dirty: false });
  });

  it('does not partially write an earlier Chunk when a later Chunk cannot be loaded', () => {
    const persistence: ChunkPersistence = {
      loadSnapshot: (key) => {
        if (key === chunkKey(1, 0, 0)) throw new Error('simulated snapshot read failure');
        return null;
      },
      saveSnapshots: () => undefined,
    };
    const server = new GameServer({ seedText: 'transaction-load-failure', persistence });
    const before = server.getVoxel(0, 20, 0);
    const value = before === Voxel.Wood ? Voxel.Stone : Voxel.Wood;

    expect(() =>
      server.editBatch({
        actorId: 'load-failure',
        edits: [
          { x: 0, y: 20, z: 0, value },
          { x: 32, y: 20, z: 0, value },
        ],
      }),
    ).toThrow('simulated snapshot read failure');
    expect(server.getVoxel(0, 20, 0)).toBe(before);
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 0, dirty: false });
    expect(server.worldRevision).toBe(0);
    expect(server.mutationCount).toBe(0);
  });

  it('orders negative and multi-digit Chunk coordinates numerically', () => {
    const server = new GameServer({ seedText: 'transaction-numeric-order' });
    const result = server.editBatch({
      actorId: 'order',
      edits: [
        { x: 32, y: -20, z: 0, value: Voxel.Wood },
        { x: -64, y: -20, z: 0, value: Voxel.Wood },
        { x: -320, y: -20, z: 0, value: Voxel.Wood },
      ],
    });

    expect(result.structuralChange?.chunks).toEqual([chunkKey(-10, -1, 0), chunkKey(-2, -1, 0), chunkKey(1, -1, 0)]);
    expect(result.structuralChange?.chunkRevisions.map(({ key }) => key)).toEqual(result.structuralChange?.chunks);
  });

  it('preserves explicit semantic causality when state coalesces to a no-op', () => {
    const server = new GameServer({ seedText: 'transaction-semantics' });
    const original = server.getVoxel(0, 20, 0);
    const temporary = original === Voxel.Air ? Voxel.Stone : Voxel.Air;
    const result = server.editBatch({
      actorId: 'door-system',
      edits: [
        { x: 0, y: 20, z: 0, value: temporary },
        { x: 0, y: 20, z: 0, value: original },
      ],
      semanticEvents: [{ type: 'actor-passed-doorway', subjectId: 'actor-7', data: { doorwayId: 'door-3' } }],
    });

    expect(result).toEqual({
      committed: true,
      worldRevision: 1,
      structuralChange: null,
      semanticEvents: [
        { type: 'actor-passed-doorway', subjectId: 'actor-7', data: { doorwayId: 'door-3' }, worldRevision: 1 },
      ],
      metrics: expect.any(Object),
    });
    expect(server.getChunk(0, 0, 0)).toMatchObject({ revision: 0, dirty: false });
  });

  it('resolves an inclusive reversed FillCommand and commits 100k writes once', () => {
    const server = new GameServer({ seedText: 'transaction-fill-100k' });
    const result = executeFillCommand(server, 'harness', {
      from: [99, -1, 99],
      to: [0, -10, 0],
      voxel: Voxel.Wood,
    });

    expect(result.committed).toBe(true);
    expect(result.worldRevision).toBe(1);
    expect(result.structuralChange?.mutationCount).toBe(100_000);
    expect(result.metrics.inputMutationCount).toBe(100_000);
    expect(result.metrics.structuralEventCount).toBe(1);
    expect(result.metrics.mutationPayloadBytes).toBe(
      100_000 * (Int32Array.BYTES_PER_ELEMENT * 3 + Uint16Array.BYTES_PER_ELEMENT),
    );
    expect(result.metrics.mutationCapacityBytes).toBeGreaterThanOrEqual(result.metrics.mutationPayloadBytes);
    expect(result.structuralChange?.chunks).toHaveLength(16);
    expect(new Set(result.structuralChange?.meshChunks).size).toBe(result.structuralChange?.meshChunks.length);
    expect(server.getVoxel(0, -10, 0)).toBe(Voxel.Wood);
    expect(server.getVoxel(99, -1, 99)).toBe(Voxel.Wood);
  });

  it('rejects an oversized FillCommand before allocating or committing', () => {
    const server = new GameServer({ seedText: 'transaction-fill-limit' });

    expect(() =>
      executeFillCommand(server, 'harness', {
        from: [0, 0, 0],
        to: [1_000_000, 1_000_000, 1_000_000],
        voxel: Voxel.Stone,
      }),
    ).toThrow(/1,000,000|limit/i);
    expect(server.worldRevision).toBe(0);
    expect(server.mutationCount).toBe(0);
  });

  it('keeps FillCommand fast-path mesh invalidation equivalent to the generic transaction path', () => {
    const generic = new GameServer({ seedText: 'transaction-fill-mesh-equivalence' });
    const filled = new GameServer({ seedText: 'transaction-fill-mesh-equivalence' });
    const edits = [];
    for (let y = -33; y <= -32; y += 1)
      for (let z = -33; z <= -32; z += 1)
        for (let x = -33; x <= -32; x += 1) edits.push({ x, y, z, value: Voxel.Wood });

    const genericResult = generic.editBatch({ actorId: 'generic', edits });
    const fillResult = executeFillCommand(filled, 'fill', {
      from: [-32, -32, -32],
      to: [-33, -33, -33],
      voxel: Voxel.Wood,
    });

    expect(fillResult.structuralChange).toMatchObject({
      mutationCount: genericResult.structuralChange?.mutationCount,
      chunks: genericResult.structuralChange?.chunks,
      meshChunks: genericResult.structuralChange?.meshChunks,
      bounds: genericResult.structuralChange?.bounds,
    });
  });

  it('keeps edit as a one-element editBatch convenience API', () => {
    const server = new GameServer({ seedText: 'transaction-edit-convenience' });
    const current = server.getVoxel(-1, 20, -1);
    const value = current === Voxel.Sand ? Voxel.Wood : Voxel.Sand;

    const result = server.edit(-1, 20, -1, value);
    expect(result).toMatchObject({ committed: true, worldRevision: 1 });
    expect(result.structuralChange?.mutationCount).toBe(1);
    expect(server.mutationCount).toBe(1);
  });

  it('keeps world revision and mutation count process-local while restoring Chunk revision', () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({ seedText: 'transaction-process-counters', persistence });
    first.edit(0, -20, 0, Voxel.Wood);
    first.flushDirtyChunks();

    const reloaded = new GameServer({ seedText: 'transaction-process-counters', persistence });
    expect(reloaded.worldRevision).toBe(0);
    expect(reloaded.mutationCount).toBe(0);
    expect(reloaded.getChunk(0, -1, 0).revision).toBe(1);
    expect(reloaded.worldRevision).toBe(0);
    expect(reloaded.mutationCount).toBe(0);
  });
});
