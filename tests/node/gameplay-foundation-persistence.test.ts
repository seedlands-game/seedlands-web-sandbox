import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeCorePlatform } from '../../apps/node-server/src/node/runtime/node-core-platform';
import { FileGamePersistence } from '../../apps/node-server/src/node/persistence/file-game-persistence';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { GENERATOR_VERSION } from '../../packages/game-core/src/world/voxel';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';

const paths: string[] = [];
const stores: FileGamePersistence[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function open(directory: string) {
  const store = await FileGamePersistence.open({
    directory,
    seedText: 'sword-node',
    generatorVersion: GENERATOR_VERSION,
  });
  stores.push(store);
  return store;
}

describe('Node 木剑与权威战斗文件检查点', () => {
  it('合成新物品、前摇保存重启不补发伤害且保留已承诺冷却，随后正常命中', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seedlands-sword-'));
    paths.push(directory);
    const persistence = await open(directory);
    const server = new GameServer({ platform: nodeCorePlatform, seedText: 'sword-node', persistence });
    server.spawnPlayer({ id: 'player', position: [0.5, 100, 0.5] });
    server.spawnEntity({ id: 'target', type: 'creature', position: [2.5, 100, 0.5], health: 20, maxHealth: 20 });
    server.giveItem('player', { itemId: ItemIds.WoodBlock, count: 1 });
    expect(server.craft('player', 'planks').success).toBe(true);
    expect(server.craft('player', 'wood-sword').success).toBe(true);
    const swordSlot = server.getInventory('player').slots.findIndex((item) => item?.itemId === 'wood-sword');
    expect(swordSlot).toBeGreaterThanOrEqual(0);
    server.selectHotbarSlot('player', swordSlot);
    expect(server.attackEntity('player', 'target').success).toBe(true);
    expect(server.getEntity('target')?.health).toBe(20);
    const committedCooldown = server.getPlayerState('player').attackCooldownSeconds;
    expect(committedCooldown).toBeGreaterThan(0);
    await server.saveFrozen(server.freezeSaveSnapshot(1));
    await persistence.close();
    const reopened = await open(directory);
    const restored = new GameServer({ platform: nodeCorePlatform, seedText: 'sword-node', persistence: reopened });
    await restored.restore();
    expect(restored.getInventory('player').slots[swordSlot]).toEqual({ itemId: 'wood-sword', count: 1 });
    expect(restored.getEntity('target')?.health).toBe(20);
    expect(restored.getPlayerState('player').combat?.active).toBeNull();
    expect(restored.getPlayerState('player').attackCooldownSeconds).toBeCloseTo(committedCooldown);
    expect(restored.attackEntity('player', 'target').success).toBe(false);
    restored.advanceGameplayRules(committedCooldown + 0.01);
    expect(restored.getEntity('target')?.health).toBe(20);
    expect(restored.attackEntity('player', 'target').success).toBe(true);
    restored.advanceGameplayRules(0.2);
    expect(restored.getEntity('target')?.health).toBe(15);
    await restored.saveFrozen(restored.freezeSaveSnapshot(2));
    await reopened.close();
    const finalStore = await open(directory);
    const final = new GameServer({ platform: nodeCorePlatform, seedText: 'sword-node', persistence: finalStore });
    await final.restore();
    expect(final.getEntity('target')?.health).toBe(15);
    expect(final.getPlayerState('player').combat?.active).toBeNull();
    final.advanceGameplayRules(2);
    expect(final.getEntity('target')?.health).toBe(15);
  });
});
