import { describe, expect, it } from 'vitest';
import { GameServer } from '../../src/server/game-server';
import { ItemIds, getItemDefinition } from '../../src/server/gameplay/item-registry';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { Voxel } from '../../src/world/voxel';

describe('自然制作灯笼的生产规则', () => {
  it('一根原木和一块石材可制作灯笼，放置、保存恢复、拆除返还保持一致', async () => {
    const persistence = new MemoryGamePersistence();
    const server = new GameServer({ seedText: 'lantern-craft-save', persistence });
    const player = server.spawnPlayer({ position: [0.5, 42.6, 0.5] });
    server.editBatch({
      actorId: 'fixture',
      edits: [
        { x: 2, y: 40, z: 0, value: Voxel.Stone },
        { x: 2, y: 41, z: 0, value: Voxel.Air },
      ],
    });
    server.giveItem(player.id, { itemId: ItemIds.WoodBlock, count: 1 });
    server.giveItem(player.id, { itemId: ItemIds.StoneBlock, count: 1 });
    expect(server.craft(player.id, 'planks').success).toBe(true);
    expect(server.craft(player.id, 'lantern').success).toBe(true);
    expect(getItemDefinition(ItemIds.Lantern).placesVoxel).toBe(Voxel.Lantern);
    const slot = server.getInventory(player.id).slots.findIndex((item) => item?.itemId === ItemIds.Lantern);
    server.selectHotbarSlot(player.id, slot);
    expect(server.placeVoxel(player.id, [2, 41, 0]).success).toBe(true);
    await server.save();
    const restored = new GameServer({ seedText: 'lantern-craft-save', persistence });
    await restored.restore();
    expect(restored.getVoxel(2, 41, 0)).toBe(Voxel.Lantern);
    expect(restored.beginBreak(player.id, [2, 41, 0]).success).toBe(true);
    restored.advanceGameplayRules(1);
    expect(restored.getVoxel(2, 41, 0)).toBe(Voxel.Air);
    expect(restored.queryEntities({ type: 'world-item' }).some((item) => item.stack?.itemId === ItemIds.Lantern)).toBe(
      true,
    );
  });
  it('旧数值 9 保持辉光石语义，新灯笼使用数值 10 且不会生成 gameplay entity', async () => {
    const persistence = new MemoryGamePersistence();
    const server = new GameServer({ seedText: 'lantern-v10-compatibility', persistence });
    const player = server.spawnPlayer({ position: [0.5, 42.6, 0.5] });
    server.editBatch({
      actorId: 'fixture',
      edits: [
        { x: 2, y: 41, z: 0, value: Voxel.Glowstone },
        { x: 3, y: 41, z: 0, value: Voxel.Lantern },
      ],
    });
    await server.save();
    const restored = new GameServer({ seedText: 'lantern-v10-compatibility', persistence });
    await restored.restore();
    expect(restored.getVoxel(2, 41, 0)).toBe(9);
    expect(restored.getVoxel(3, 41, 0)).toBe(10);
    expect(getItemDefinition(ItemIds.Lantern).placesVoxel).toBe(10);
    expect(restored.queryEntities().some((entity) => entity.position.join(',') === '3,41,0')).toBe(false);
    expect(restored.getEntity(player.id)?.type).toBe('player');
  });
  it('死亡不能合成，即使外部赠予了足量材料也不消耗', () => {
    const server = new GameServer({ seedText: 'dead-craft' });
    const player = server.spawnPlayer({ position: [0, 34, 0] });
    server.applyDamage('fixture', player.id, 20, 'fixture');
    server.giveItem(player.id, { itemId: ItemIds.WoodBlock, count: 1 });
    const before = server.getInventory(player.id);
    expect(server.craft(player.id, 'planks').success).toBe(false);
    expect(server.getInventory(player.id)).toEqual(before);
  });
});
