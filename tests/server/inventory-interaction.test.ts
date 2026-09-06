import { describe, expect, it } from 'vitest';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { Inventory } from '../../src/server/gameplay/inventory';
import { GameServer } from '../../src/server/game-server';
import { ItemIds } from '../../src/server/gameplay/item-registry';

describe('玩家背包可用交互', () => {
  it('移动、指定槽食用和快捷栏选择通过正式存档恢复', async () => {
    const persistence = new MemoryGamePersistence();
    const first = new GameServer({ seedText: 'inventory-save', persistence });
    const player = first.spawnPlayer({ position: [0, 34, 0] });
    first.giveItem(player.id, { itemId: ItemIds.Berry, count: 70 });
    first.moveInventorySlot(player.id, 1, 9);
    first.setHungerForDebug(player.id, 10);
    first.useInventoryItem(player.id, 9);
    await first.save();
    const second = new GameServer({ seedText: 'inventory-save', persistence });
    await second.restore();
    expect(second.getInventory(player.id)).toEqual(first.getInventory(player.id));
    expect(second.getPlayerState(player.id).hunger).toBe(14);
  });
  it('拾取只成功一次且恢复不会重复增加物品', async () => {
    const persistence = new MemoryGamePersistence();
    const server = new GameServer({ seedText: 'pickup-event', persistence });
    const player = server.spawnPlayer({ position: [0, 34, 0] });
    const item = server.spawnWorldItem([0, 34, 0], { itemId: ItemIds.Berry, count: 1 });
    expect(server.pickupItem(player.id, item.id).success).toBe(true);
    expect(server.pickupItem(player.id, item.id).success).toBe(false);
    await server.save();
    await server.restore();
    expect(server.getInventory(player.id).slots).toContainEqual({ itemId: ItemIds.Berry, count: 1 });
  });
  it('同类部分合并、异类交换、移到空格都守恒', () => {
    const inventory = new Inventory(4, [
      { itemId: ItemIds.Berry, count: 60 },
      { itemId: ItemIds.Berry, count: 10 },
      { itemId: ItemIds.StoneBlock, count: 3 },
      null,
    ]);
    expect(inventory.moveStack(1, 0)).toBe(true);
    expect(inventory.slot(0)?.count).toBe(64);
    expect(inventory.slot(1)?.count).toBe(6);
    expect(inventory.moveStack(1, 2)).toBe(true);
    expect(inventory.slot(1)?.itemId).toBe(ItemIds.StoneBlock);
    expect(inventory.moveStack(2, 3)).toBe(true);
    expect(inventory.slot(2)).toBeNull();
    expect(inventory.snapshot().reduce((sum, stack) => sum + (stack?.count ?? 0), 0)).toBe(73);
  });
  it('无效索引、空来源、满栈拒绝且快照不变', () => {
    const inventory = new Inventory(3, [
      { itemId: ItemIds.Berry, count: 64 },
      { itemId: ItemIds.Berry, count: 3 },
      null,
    ]);
    const before = inventory.snapshot();
    for (const [a, b] of [
      [-1, 0],
      [1.5, 2],
      [3, 0],
      [2, 1],
      [1, 0],
      [0, 0],
    ])
      expect(inventory.moveStack(a, b)).toBe(false);
    expect(inventory.snapshot()).toEqual(before);
    expect(inventory.removeFromSlot(1, 4)).toBe(false);
    expect(inventory.removeFromSlot(1, -1)).toBe(false);
    expect(inventory.removeFromSlot(1, 1)).toBe(true);
    expect(inventory.slot(0)?.count).toBe(64);
    expect(inventory.slot(1)?.count).toBe(2);
  });
  it('任何背包槽食用只扣那一格，满饥饿与死亡不消耗', () => {
    const server = new GameServer({ seedText: 'inventory-use' });
    const player = server.spawnPlayer({ position: [0, 34, 0] });
    server.giveItem(player.id, { itemId: ItemIds.Berry, count: 70 });
    expect(server.moveInventorySlot(player.id, 1, 9).success).toBe(true);
    expect(server.useInventoryItem(player.id, 9).success).toBe(false);
    server.setHungerForDebug(player.id, 10);
    expect(server.useInventoryItem(player.id, 9).success).toBe(true);
    expect(server.getInventory(player.id).slots[0]?.count).toBe(64);
    expect(server.getInventory(player.id).slots[9]?.count).toBe(5);
    expect(server.getPlayerState(player.id).hunger).toBe(14);
    server.applyDamage('test', player.id, 20, 'test');
    expect(server.useInventoryItem(player.id, 9).success).toBe(false);
    expect(server.moveInventorySlot(player.id, 9, 0).success).toBe(false);
  });
  it('丢出指定槽也不能从另一格同物品扣除', () => {
    const server = new GameServer({ seedText: 'inventory-drop' });
    const player = server.spawnPlayer({ position: [0, 34, 0] });
    server.giveItem(player.id, { itemId: ItemIds.Berry, count: 70 });
    expect(server.dropItem(player.id, 1, 2).success).toBe(true);
    expect(server.getInventory(player.id).slots[0]?.count).toBe(64);
    expect(server.getInventory(player.id).slots[1]?.count).toBe(4);
  });
});
