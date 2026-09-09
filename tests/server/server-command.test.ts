import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import {
  ALL_COMMAND_CAPABILITIES,
  type CommandObservation,
  type CommandSource,
  ServerCommandExecutor,
} from '../../packages/game-core/src/server/commands/server-command-executor';
import { parseSlashCommand } from '../../packages/game-core/src/server/commands/slash-command-parser';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import type { ChunkPersistence } from '../../packages/game-core/src/server/persistence/chunk-persistence';
import { MemoryChunkPersistence } from '../../packages/game-core/src/server/persistence/memory-chunk-persistence';
import { Voxel } from '../../packages/game-core/src/world/voxel';

const admin: CommandSource = {
  actorId: 'local-developer',
  sourceType: 'local-developer',
  entityId: 'headless-player',
  capabilities: ALL_COMMAND_CAPABILITIES,
};

describe('server command boundary', () => {
  it('executes setblock and fill through one authoritative transaction each', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'command-mutation' });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });

    const setBlock = await executor.execute(admin, { type: 'set-block', position: [1, -20, 1], voxel: Voxel.Wood });
    expect(setBlock).toMatchObject({ success: true, worldRevision: 1, affectedChunks: ['0,-1,0'] });
    expect(setBlock.observation).toMatchObject({
      commandType: 'set-block',
      category: 'mutation',
      actorId: 'local-developer',
      success: true,
      mutationCount: 1,
      structuralEventCount: 1,
    });

    const fill = await executor.execute(admin, {
      type: 'fill',
      from: [0, -10, 0],
      to: [99, -1, 99],
      voxel: Voxel.Wood,
    });
    expect(fill).toMatchObject({ success: true, worldRevision: 2 });
    expect(fill.observation).toMatchObject({
      commandType: 'fill',
      mutationCount: 100_000,
      structuralEventCount: 1,
    });
    expect(fill.affectedChunks).toHaveLength(16);
    expect(new Set(fill.affectedChunks).size).toBe(fill.affectedChunks.length);
  });

  it('executes teleport, time, seed and inspect commands without bypassing server APIs', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'command-query' });
    server.createEntity({ id: 'headless-player', kind: 'player', position: [0, 34, 0] });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });

    expect(
      await executor.execute(admin, { type: 'teleport', entityId: 'headless-player', position: [2.5, 40, -3.25] }),
    ).toMatchObject({ success: true, data: { entity: { position: [2.5, 40, -3.25] } } });
    expect(await executor.execute(admin, { type: 'time-set', hours: 27.5 })).toMatchObject({
      success: true,
      data: { worldTime: 3.5 },
    });
    expect(await executor.execute(admin, { type: 'time-get' })).toMatchObject({
      success: true,
      data: { worldTime: 3.5 },
    });
    expect(await executor.execute(admin, { type: 'seed' })).toMatchObject({
      success: true,
      data: { seedText: 'command-query', generatorVersion: server.generatorVersion },
    });

    const revision = server.worldRevision;
    expect(await executor.execute(admin, { type: 'inspect-voxel', position: [0, -20, 0] })).toMatchObject({
      success: true,
      data: { position: [0, -20, 0], voxel: expect.any(Number) },
    });
    expect(await executor.execute(admin, { type: 'inspect-chunk', chunk: [0, -1, 0] })).toMatchObject({
      success: true,
      data: { chunk: { key: '0,-1,0', revision: 0, dirty: false } },
    });
    expect(server.worldRevision).toBe(revision);
    expect(server.mutationCount).toBe(0);
  });

  it('saves through the persistence port and reloads the exact authoritative voxel', async () => {
    const persistence = new MemoryChunkPersistence();
    const first = new GameServer({ platform: testCorePlatform, seedText: 'command-save', persistence });
    const executor = new ServerCommandExecutor(first, { now: testCorePlatform.now });
    await executor.execute(admin, { type: 'set-block', position: [33, -20, 1], voxel: Voxel.Wood });

    const saved = await executor.execute(admin, { type: 'save' });
    expect(saved).toMatchObject({ success: true, data: { savedChunks: ['1,-1,0'] } });
    expect(persistence.writes).toEqual(['1,-1,0']);

    const reloaded = new GameServer({ platform: testCorePlatform, seedText: 'command-save', persistence });
    const inspected = await new ServerCommandExecutor(reloaded, { now: testCorePlatform.now }).execute(admin, {
      type: 'inspect-voxel',
      position: [33, -20, 1],
    });
    expect(inspected).toMatchObject({ success: true, data: { voxel: Voxel.Wood } });
  });

  it('enforces capabilities before reading or mutating server state', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'command-permission' });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });
    const queryOnly: CommandSource = {
      actorId: 'observer',
      sourceType: 'scripted-test',
      capabilities: ['query'],
    };

    expect(await executor.execute(queryOnly, { type: 'seed' })).toMatchObject({ success: true });
    expect(
      await executor.execute(queryOnly, { type: 'set-block', position: [0, -20, 0], voxel: Voxel.Wood }),
    ).toMatchObject({
      success: false,
      error: { kind: 'permission', code: 'COMMAND_PERMISSION_DENIED' },
    });
    expect(server.worldRevision).toBe(0);
    expect(server.mutationCount).toBe(0);
  });

  it('fails closed when the injected permission hook fails', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'command-permission-hook' });
    const executor = new ServerCommandExecutor(server, {
      now: testCorePlatform.now,
      authorize: () => {
        throw new Error('permission backend unavailable');
      },
    });

    expect(await executor.execute(admin, { type: 'seed' })).toMatchObject({
      success: false,
      error: { kind: 'permission', code: 'COMMAND_PERMISSION_CHECK_FAILED' },
    });
    expect(server.materializedChunkCount).toBe(0);
    expect(server.worldRevision).toBe(0);
  });

  it('returns validation and execution failures without throwing or clearing dirty state', async () => {
    const persistence: ChunkPersistence = {
      loadSnapshot: () => null,
      saveSnapshots: () => {
        throw new Error('simulated store failure');
      },
    };
    const server = new GameServer({ platform: testCorePlatform, seedText: 'command-errors', persistence });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });

    expect(
      await executor.execute(admin, {
        type: 'fill',
        from: [0, 0, 0],
        to: [1_000_000, 1_000_000, 1_000_000],
        voxel: Voxel.Stone,
      }),
    ).toMatchObject({ success: false, error: { kind: 'validation', code: 'COMMAND_VALIDATION_FAILED' } });
    expect(
      await executor.execute(admin, {
        type: 'set-block',
        position: [0, -20, 0],
        voxel: 65_537,
      }),
    ).toMatchObject({ success: false, error: { kind: 'validation' } });

    await executor.execute(admin, { type: 'set-block', position: [0, -20, 0], voxel: Voxel.Wood });
    expect(await executor.execute(admin, { type: 'save' })).toMatchObject({
      success: false,
      error: { kind: 'execution', code: 'COMMAND_EXECUTION_FAILED', message: 'simulated store failure' },
    });
    expect(server.getChunk(0, -1, 0).dirty).toBe(true);
    expect(await executor.execute(admin, { type: 'seed' })).toMatchObject({ success: true });
  });

  it('parses the human slash shell strictly into structured commands', () => {
    expect(parseSlashCommand('/setblock 1 -20 3 StOnE')).toEqual({
      success: true,
      command: { type: 'set-block', position: [1, -20, 3], voxel: Voxel.Stone },
    });
    expect(parseSlashCommand('/fill 9 -1 9 0 -10 0 air')).toEqual({
      success: true,
      command: { type: 'fill', from: [9, -1, 9], to: [0, -10, 0], voxel: Voxel.Air },
    });
    expect(parseSlashCommand('/tp 1.5 40 -2.25')).toMatchObject({
      success: true,
      command: { type: 'teleport', position: [1.5, 40, -2.25] },
    });
    expect(parseSlashCommand('/time get')).toEqual({ success: true, command: { type: 'time-get' } });
    expect(parseSlashCommand('/time set 18.5')).toEqual({
      success: true,
      command: { type: 'time-set', hours: 18.5 },
    });
    expect(parseSlashCommand('/seed')).toEqual({ success: true, command: { type: 'seed' } });
    expect(parseSlashCommand('/save')).toEqual({ success: true, command: { type: 'save' } });
    expect(parseSlashCommand('/inspect voxel 1 -20 3')).toEqual({
      success: true,
      command: { type: 'inspect-voxel', position: [1, -20, 3] },
    });
    expect(parseSlashCommand('/inspect chunk 0 -1 0')).toEqual({
      success: true,
      command: { type: 'inspect-chunk', chunk: [0, -1, 0] },
    });

    for (const input of ['/unknown', '/setblock 1 2 3 lava', '/setblock 1.5 2 3 stone', '/seed extra'])
      expect(parseSlashCommand(input)).toMatchObject({
        success: false,
        error: { kind: 'parse', code: 'COMMAND_PARSE_FAILED' },
      });
  });

  it('isolates an observation sink failure from an already committed command', async () => {
    const records: CommandObservation[] = [];
    const server = new GameServer({ platform: testCorePlatform, seedText: 'command-observation' });
    const executor = new ServerCommandExecutor(server, {
      now: testCorePlatform.now,
      observe: (record) => {
        records.push(record);
        throw new Error('sink unavailable');
      },
    });

    const result = await executor.execute(admin, {
      type: 'set-block',
      position: [0, -20, 0],
      voxel: Voxel.Wood,
    });
    expect(result).toMatchObject({ success: true, worldRevision: 1 });
    expect(records).toHaveLength(1);
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(server.worldRevision).toBe(1);
  });
});
