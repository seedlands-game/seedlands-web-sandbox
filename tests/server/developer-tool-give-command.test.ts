import { describe, expect, it } from 'vitest';
import {
  ALL_COMMAND_CAPABILITIES,
  ServerCommandExecutor,
} from '../../packages/game-core/src/server/commands/server-command-executor';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';
import { testCorePlatform } from '../support/core-platform';

describe('developer give-item command', () => {
  it('creates a durable tool instance at full definition durability', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'developer-tool-give' });
    server.spawnPlayer({ id: 'player', position: [0, 60, 0] });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });
    const source = {
      actorId: 'developer',
      sourceType: 'local-developer' as const,
      entityId: 'player',
      capabilities: ALL_COMMAND_CAPABILITIES,
    };

    expect(await executor.execute(source, { type: 'give-item', itemId: ItemIds.WoodPickaxe, count: 1 })).toMatchObject({
      success: true,
    });
    expect(server.getInventory('player').slots).toContainEqual({
      itemId: ItemIds.WoodPickaxe,
      count: 1,
      instance: { durability: 60 },
    });
  });

  it('continues to reject unknown item ids without mutating inventory', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'developer-tool-unknown' });
    server.spawnPlayer({ id: 'player', position: [0, 60, 0] });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });
    const source = {
      actorId: 'developer',
      sourceType: 'local-developer' as const,
      entityId: 'player',
      capabilities: ALL_COMMAND_CAPABILITIES,
    };

    expect(await executor.execute(source, { type: 'give-item', itemId: 'missing:item', count: 1 })).toMatchObject({
      success: false,
    });
    expect(server.getInventory('player').slots.every((slot) => slot === null)).toBe(true);
  });
});
