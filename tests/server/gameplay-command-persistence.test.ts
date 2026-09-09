import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  ALL_COMMAND_CAPABILITIES,
  ServerCommandExecutor,
} from '../../packages/game-core/src/server/commands/server-command-executor';
import { parseSlashCommand } from '../../packages/game-core/src/server/commands/slash-command-parser';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import {
  WorldResourceAuthorizer,
  commandAuthorizationRequests,
} from '../../packages/game-core/src/server/harness/world-authorization';

const admin = {
  actorId: 'headless-admin',
  sourceType: 'local-developer' as const,
  entityId: 'player-1',
  capabilities: ALL_COMMAND_CAPABILITIES,
};

describe('gameplay command boundary', () => {
  it('routes query, player mutation and administrative commands through capabilities and source binding', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'gameplay-command' });
    server.spawnPlayer({ id: 'player-1', position: [0, 34, 0] });
    server.spawnPlayer({ id: 'player-2', position: [2, 34, 0] });
    const authorization = new WorldResourceAuthorizer({
      principals: [
        { id: admin.actorId, boundEntityId: admin.entityId },
        { id: 'player-1', boundEntityId: 'player-1' },
      ],
      rules: [
        { effect: 'allow', principal: { ids: [admin.actorId] }, resources: ['*'], operations: ['*'], scope: 'any' },
        {
          effect: 'allow',
          principal: { ids: ['player-1'] },
          resources: ['world.entity', 'world.action'],
          operations: ['read', 'execute', 'write'],
          scope: 'self',
        },
      ],
    });
    const executor = new ServerCommandExecutor(server, {
      now: testCorePlatform.now,
      authorize: (source, command) =>
        commandAuthorizationRequests(source, command, (actionId) => server.getAction(actionId)?.actorId ?? null).every(
          (request) => authorization.authorize(source.actorId, request).allowed,
        ),
    });

    expect(
      await executor.execute(admin, { type: 'give-item', entityId: 'player-1', itemId: ItemIds.WoodBlock, count: 2 }),
    ).toMatchObject({
      success: true,
      observation: { category: 'administrative' },
    });
    expect(await executor.execute(admin, { type: 'query-inventory', entityId: 'player-1' })).toMatchObject({
      success: true,
      data: { inventory: { slots: [expect.objectContaining({ itemId: ItemIds.WoodBlock, count: 2 })] } },
      observation: { category: 'query' },
    });

    const playerSource = {
      actorId: 'player-1',
      sourceType: 'player' as const,
      entityId: 'player-1',
      capabilities: ['query', 'mutation'] as const,
    };
    expect(await executor.execute(playerSource, { type: 'select-slot', slot: 0 })).toMatchObject({ success: true });
    expect(await executor.execute(playerSource, { type: 'query-player-state', entityId: 'player-2' })).toMatchObject({
      success: false,
      error: { kind: 'permission' },
    });
    expect(
      await executor.execute(playerSource, {
        type: 'give-item',
        entityId: 'player-1',
        itemId: ItemIds.Berry,
        count: 1,
      }),
    ).toMatchObject({
      success: false,
      error: { kind: 'permission' },
    });
  });

  it('parses the human-facing gameplay debug subset without making slash text the domain contract', () => {
    expect(parseSlashCommand('/give wood-block 4')).toEqual({
      success: true,
      command: { type: 'give-item', itemId: ItemIds.WoodBlock, count: 4 },
    });
    expect(parseSlashCommand('/inventory')).toEqual({
      success: true,
      command: { type: 'query-inventory' },
    });
    expect(parseSlashCommand('/damage 4')).toMatchObject({
      success: true,
      command: { type: 'apply-damage', amount: 4 },
    });
    expect(parseSlashCommand('/heal 2')).toMatchObject({
      success: true,
      command: { type: 'heal', amount: 2 },
    });
    expect(parseSlashCommand('/craft planks')).toEqual({
      success: true,
      command: { type: 'craft-recipe', recipeId: 'planks' },
    });
    expect(parseSlashCommand('/spawnitem berry 2 1 34 0')).toMatchObject({
      success: true,
      command: { type: 'spawn-world-item', itemId: ItemIds.Berry, count: 2, position: [1, 34, 0] },
    });
    expect(parseSlashCommand('/give unknown 1')).toMatchObject({ success: false, error: { kind: 'parse' } });
  });
});

describe('gameplay persistence', () => {
  it('roundtrips canonical players, entities, inventory, lifecycle and gameplay clock', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const first = new GameServer({ platform: testCorePlatform, seedText: 'gameplay-save', persistence });
    first.spawnPlayer({ id: 'player-1', position: [1, 40, -2] });
    first.giveItem('player-1', { itemId: ItemIds.Berry, count: 3 });
    first.setHungerForDebug('player-1', 11);
    first.applyDamage('system', 'player-1', 5, 'test');
    first.spawnWorldItem([4, 40, -2], { itemId: ItemIds.StoneBlock, count: 2 });
    first.advanceGameplayRules(7.5);
    await first.save();

    const second = new GameServer({ platform: testCorePlatform, seedText: 'gameplay-save', persistence });
    await second.restore();
    expect(second.getEntity('player-1')?.position).toEqual([1, 40, -2]);
    expect(second.getPlayerState('player-1')).toMatchObject({ health: 15, hunger: 11 });
    expect(second.getInventory('player-1').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 3 });
    expect(second.queryEntities({ type: 'world-item' })).toEqual([
      expect.objectContaining({ stack: { itemId: ItemIds.StoneBlock, count: 2 } }),
    ]);
    expect(second.gameplayTime).toBe(7.5);
  });

  it('migrates legacy position metadata and fails closed on malformed snapshots', async () => {
    const legacy = new MemoryGamePersistence({ clone: testCorePlatform.clone, legacyPlayerPosition: [4, 42, 8] });
    const migrated = new GameServer({ platform: testCorePlatform, seedText: 'legacy-gameplay', persistence: legacy });
    await migrated.restore();
    expect(migrated.queryEntities({ type: 'player' })).toEqual([expect.objectContaining({ position: [4, 40.4, 8] })]);
    const playerId = migrated.queryEntities({ type: 'player' })[0].id;
    expect(migrated.getPlayerState(playerId)).toMatchObject({ health: 20, hunger: 20, lifecycle: 'alive' });

    const malformed = new MemoryGamePersistence({
      clone: testCorePlatform.clone,
      rawGameplaySnapshot: { version: 1, players: [{ health: 999 }] },
    });
    const rejected = new GameServer({ platform: testCorePlatform, seedText: 'bad-gameplay', persistence: malformed });
    await expect(rejected.restore()).rejects.toThrow(/gameplay snapshot/i);
    expect(rejected.queryEntities()).toHaveLength(0);
  });

  it('keeps failed saves retryable and does not report a false checkpoint', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'retry-gameplay-save', persistence });
    server.spawnPlayer({ id: 'player-1', position: [0, 34, 0] });
    server.giveItem('player-1', { itemId: ItemIds.WoodBlock, count: 1 });
    persistence.failNextGameplaySave(new Error('simulated gameplay store failure'));
    await expect(server.save()).rejects.toThrow('simulated gameplay store failure');
    expect(server.gameplayRevision).toBeGreaterThan(server.persistedGameplayRevision);
    await expect(server.save()).resolves.toMatchObject({ gameplaySaved: true });
    expect(server.persistedGameplayRevision).toBe(server.gameplayRevision);
  });
});

describe('headless survival workflow', () => {
  it('runs gameplay commands without loading browser or PlayCanvas globals', () => {
    const run = spawnSync(process.execPath, ['scripts/server-headless.mjs', '--seed', 'survival-headless', '--json'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: ['/give wood-block 1', '/craft planks', '/craft wood-axe', '/damage 20', '/respawn', '/save', ''].join(
        '\n',
      ),
      env: process.env,
      timeout: 15_000,
    });

    expect(run.status, run.stderr).toBe(0);
    const output = run.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { success: boolean; data?: Record<string, unknown> });
    expect(output).toHaveLength(6);
    expect(output.every((result) => result.success)).toBe(true);
    expect(output[5]).toMatchObject({ data: { gameplaySaved: true } });
  }, 15_000);
});
