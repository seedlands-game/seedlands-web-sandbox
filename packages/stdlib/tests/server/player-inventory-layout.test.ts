import { defineInventoryModule } from '../../src/server/gameplay/modules/inventory-module';
import { ModeRuntime } from '../../src/server/gameplay/modules/mode-runtime';
import { expect, it } from 'vitest';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';

const items = createItemDefinitionRegistry([
  { id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] },
]);
const layout = { capacity: 36, hotbarSize: 9 };
it('supports explicit player capacity without changing NPC or legacy defaults', () => {
  const world = new EntityStore(items, undefined, layout);
  world.spawn({ id: 'alice', type: 'player', position: [0, 2, 0] });
  world.spawn({ id: 'npc', type: 'npc', position: [1, 2, 0] });
  const actor = world.actorStateAccess('alice');
  expect(actor.inventory.capacity).toBe(36);
  expect(actor.hotbarSize).toBe(9);
  expect(world.actorStateAccess('npc').inventory.capacity).toBe(24);
  expect(world.actorStateAccess('npc').hotbarSize).toBe(8);
  actor.inventory.add({ itemId: 'test:wood', count: 1 });
  actor.inventory.moveStack(0, 35);
  expect(actor.selectSlot(8)).toBe(true);
  world.restoreComponentSnapshot(world.exportComponentSnapshot());
  expect(world.actorStateAccess('alice').inventory.slot(35)).toEqual({ itemId: 'test:wood', count: 1 });
  expect(world.actorStateAccess('alice').selectedSlot).toBe(8);
  expect(world.actorStateAccess('alice').selectSlot(9)).toBe(false);
  world.dispose();
});
it('preserves a legacy 24-slot save instead of truncating or duplicating it', () => {
  const old = new EntityStore(items);
  old.spawn({ id: 'alice', type: 'player', position: [0, 2, 0] });
  old.actorStateAccess('alice').inventory.add({ itemId: 'test:wood', count: 64 });
  old.actorStateAccess('alice').inventory.moveStack(0, 23);
  const current = new EntityStore(items, undefined, layout);
  current.restoreComponentSnapshot(old.exportComponentSnapshot());
  expect(current.actorStateAccess('alice').inventory.capacity).toBe(24);
  expect(current.actorStateAccess('alice').inventory.slot(23)?.count).toBe(64);
  const corrupted = current.exportComponentSnapshot();
  corrupted.actors[0].inventory.push(null);
  expect(() => current.restoreComponentSnapshot(corrupted)).toThrow();
  expect(current.actorStateAccess('alice').inventory.slot(23)?.count).toBe(64);
  old.dispose();
  current.dispose();
});

it('第9创造槽可选择并跨模式保留36格生存库存', () => {
  const world = new EntityStore(items, undefined, layout);
  world.spawn({ id: 'alice', type: 'player', position: [0, 2, 0] });
  const actor = world.actorStateAccess('alice');
  actor.inventory.add({ itemId: 'test:wood', count: 3 });
  actor.inventory.moveStack(0, 35);
  const mode = new ModeRuntime({
    entities: world,
    findSafeLanding: () => [0, 2, 0],
    cancelIncompatibleActions: () => {},
    changed: () => {},
  });
  expect(mode.switchMode('alice', { mode: 'creative', creativeHotbar: Array(9).fill('test:wood') })).toMatchObject({
    success: true,
  });
  expect(mode.selectCreativeSlot('alice', 8)).toMatchObject({ success: true });
  expect(mode.selectCreativeSlot('alice', 9)).toMatchObject({ success: false });
  world.restoreComponentSnapshot(world.exportComponentSnapshot());
  expect(world.actorStateAccess('alice').creativeCatalog.selectedSlot).toBe(8);
  expect(mode.switchMode('alice', { mode: 'survival' })).toMatchObject({ success: true });
  expect(world.actorStateAccess('alice').inventory.slot(35)).toEqual({ itemId: 'test:wood', count: 3 });
  world.dispose();
});

it('布局进入能力身份，不同库存合同不能使用同一身份', () => {
  const identity = (capacity: number) =>
    defineInventoryModule({ playerLayout: { capacity, hotbarSize: 9 } }).descriptor.provides?.find(
      (capability) => capability.id === 'seedlands:player-inventory-layout',
    )?.definitionIdentity;
  expect(identity(36)).toBeDefined();
  expect(identity(36)).not.toBe(identity(45));
  expect(identity(36)).toBe(identity(36));
});
