import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import { createGameplayActorAuthority } from '../../src/server/composition/gameplay-actor-authority';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import type { GameplaySnapshotV4 } from '../../src/server/gameplay/gameplay-snapshot';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import { defineInventoryActionsModule } from '../../src/server/gameplay/modules/inventory-actions-module';
import { defineInventoryModule } from '../../src/server/gameplay/modules/inventory-module';
import type { InventoryPointerCommand } from '../../src/server/gameplay/modules/inventory-pointer-contract';
import { testCorePlatform } from '../support/core-platform';

const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const visor = (durability: number) => ({
  itemId: 'sample:visor',
  count: 1,
  instance: { durability },
});
const suit = (durability: number) => ({
  itemId: 'sample:suit',
  count: 1,
  instance: { durability },
});

function setup() {
  const inventory = defineInventoryModule();
  const actions = defineInventoryActionsModule();
  const modules = [
    defineContentModule({
      moduleId: 'sample:equipment-restore-content',
      items: [
        {
          id: 'sample:visor',
          name: 'Visor',
          itemType: 'armor',
          stackLimit: 1,
          durability: { max: 40 },
          capabilities: [{ type: 'armor', slot: 'helmet', points: 2 }],
        },
        {
          id: 'sample:suit',
          name: 'Suit',
          itemType: 'armor',
          stackLimit: 1,
          durability: { max: 80 },
          capabilities: [{ type: 'armor', slot: 'chestplate', points: 5 }],
        },
        { id: 'sample:fiber', name: 'Fiber', itemType: 'resource', stackLimit: 64, capabilities: [] },
      ],
      recipes: [],
      meleeDefinitions: [],
    }),
    inventory,
    actions,
  ];
  const pack = definePack({ id: 'sample:equipment-restore', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: {
          algorithm: 'sha256',
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [],
        },
      },
    ],
    { approvedPermissions: { [pack.manifest.id]: modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const runtime = new GameplayRuntime({
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'pilot' }),
    platform: testCorePlatform,
    getVoxel: () => 0,
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit.');
    },
  });
  runtime.spawnPlayer({ id: 'pilot', position: [0, 2, 0] });
  const pointer = (command: InventoryPointerCommand) => {
    const view = runtime.getInventoryPointerView('pilot');
    return runtime.inventoryPointer('pilot', {
      actor: view.actor,
      expectedInventoryRevision: view.revision,
      command,
    });
  };
  return { runtime, pointer };
}

function actor(snapshot: GameplaySnapshotV4) {
  const value = snapshot.entityStore.actors.find((entry) => entry.entityId === 'pilot');
  if (!value) throw new Error('Expected pilot actor snapshot.');
  return value;
}

function createPopulatedSnapshot(): GameplaySnapshotV4 {
  const { runtime, pointer } = setup();
  runtime.giveItem('pilot', visor(37));
  runtime.giveItem('pilot', visor(11));
  runtime.giveItem('pilot', suit(71));
  runtime.giveItem('pilot', { itemId: 'sample:fiber', count: 3 });
  expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toMatchObject({
    success: true,
  });
  expect(pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 })).toMatchObject({
    success: true,
  });
  expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 3 }, button: 0 })).toMatchObject({
    success: true,
  });
  expect(pointer({ kind: 'click', slot: { kind: 'crafting', slot: 0 }, button: 2 })).toMatchObject({
    success: true,
  });
  expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 3 }, button: 0 })).toMatchObject({
    success: true,
  });
  expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 1 }, button: 0 })).toMatchObject({
    success: true,
  });
  return runtime.createSnapshot();
}

describe('equipment pointer V4 restore', () => {
  it('round-trips bag, cursor, crafting and durable armor, invalidates old handles, then keeps pointer revisions linear', () => {
    const saved = createPopulatedSnapshot();
    const savedActor = actor(saved);
    expect(savedActor.inventory[2]).toEqual(suit(71));
    expect(savedActor.inventory[3]).toEqual({ itemId: 'sample:fiber', count: 2 });
    expect(savedActor.inventoryCursor).toMatchObject({
      stack: visor(11),
      origin: { kind: 'inventory', slot: 1 },
      craftingGrid: [{ itemId: 'sample:fiber', count: 1 }, null, null, null],
    });
    expect(savedActor.equipment.armor).toEqual({ ...emptyArmor(), helmet: visor(37) });

    const target = setup();
    const oldView = target.runtime.getInventoryPointerView('pilot');
    const oldAccess = target.runtime.entities.actorStateAccess('pilot');
    const restorePayload = structuredClone(saved);
    expect(target.runtime.restoreSnapshot(restorePayload)).toEqual({ version: 4, worldTime: 12 });
    expect(target.runtime.entities.resolveReference(oldView.actor)).toBeNull();
    expect(() => oldAccess.inventory.snapshot()).toThrow(/stale|reference|epoch/i);

    let view = target.runtime.getInventoryPointerView('pilot');
    expect(view).toMatchObject({
      revision: savedActor.inventoryRevision,
      slots: savedActor.inventory,
      cursor: savedActor.inventoryCursor,
      armor: { helmet: visor(37), chestplate: null, leggings: null, boots: null },
    });
    expect(
      target.runtime.inventoryPointer('pilot', {
        actor: oldView.actor,
        expectedInventoryRevision: view.revision,
        command: { kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 },
      }),
    ).toEqual({ success: false, reason: 'actor-reference-stale' });

    const beforeSwap = view.revision;
    expect(target.pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 })).toMatchObject({
      success: true,
    });
    view = target.runtime.getInventoryPointerView('pilot');
    expect(view.revision).toBe(beforeSwap + 1);
    expect(view.armor.helmet).toEqual(visor(11));
    expect(view.cursor).toMatchObject({ stack: visor(37), origin: { kind: 'equipment', slot: 'helmet' } });

    expect(target.pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toMatchObject({
      success: true,
    });
    view = target.runtime.getInventoryPointerView('pilot');
    expect(view.revision).toBe(beforeSwap + 2);
    expect(view.slots[0]).toEqual(visor(37));
    expect(view.cursor.stack).toBeNull();

    expect(target.pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 })).toMatchObject({
      success: true,
    });
    view = target.runtime.getInventoryPointerView('pilot');
    expect(view.revision).toBe(beforeSwap + 3);
    expect(view.armor.helmet).toBeNull();
    expect(view.cursor).toMatchObject({ stack: visor(11), origin: { kind: 'equipment', slot: 'helmet' } });
    expect(target.pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 })).toMatchObject({
      success: true,
    });
    view = target.runtime.getInventoryPointerView('pilot');
    expect(view.revision).toBe(beforeSwap + 4);
    expect(view.armor.helmet).toEqual(visor(11));
    expect(view.cursor.stack).toBeNull();

    const mutableSaved = actor(restorePayload) as {
      inventory: Array<{ count: number } | null>;
      equipment: { armor: { helmet: { instance: { durability: number } } | null } };
    };
    mutableSaved.inventory[2]!.count = 9;
    mutableSaved.equipment.armor.helmet!.instance.durability = 1;
    expect(target.runtime.getInventoryPointerView('pilot').slots[2]).toEqual(suit(71));
    expect(target.runtime.getInventoryPointerView('pilot').armor.helmet).toEqual(visor(11));
  });

  it('migrates an omitted V4 armor field to four empty slots without changing bag, cursor or hotbar selection', () => {
    const source = setup();
    source.runtime.giveItem('pilot', { itemId: 'sample:fiber', count: 3 });
    expect(source.pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 })).toMatchObject({
      success: true,
    });
    expect(source.runtime.selectHotbarSlot('pilot', 2)).toMatchObject({ success: true });
    const saved = source.runtime.createSnapshot();
    const savedActor = actor(saved);
    const expectedInventory = structuredClone(savedActor.inventory);
    const expectedCursor = structuredClone(savedActor.inventoryCursor);
    delete (savedActor.equipment as { armor?: unknown }).armor;

    const target = setup();
    expect(target.runtime.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    const restored = target.runtime.getInventoryPointerView('pilot');
    expect(restored.slots).toEqual(expectedInventory);
    expect(restored.cursor).toEqual(expectedCursor);
    expect(restored.hotbarSize).toBe(savedActor.equipment.hotbarSize);
    expect(target.runtime.entities.actorStateAccess('pilot').selectedSlot).toBe(savedActor.equipment.selectedSlot);
    expect(restored.armor).toEqual(emptyArmor());
  });

  it('rejects armor in the wrong capability slot before changing actor, world or revisions', () => {
    const invalid = createPopulatedSnapshot();
    const invalidActor = actor(invalid);
    (invalidActor.equipment as { armor: unknown }).armor = { ...emptyArmor(), chestplate: visor(17) };
    const target = setup();
    target.runtime.giveItem('pilot', { itemId: 'sample:fiber', count: 2 });
    const reference = target.runtime.entities.createReference('pilot')!;
    const before = target.runtime.createSnapshot();

    expect(() => target.runtime.restoreSnapshot(invalid)).toThrow(/armor slot|gameplay snapshot/i);
    expect(target.runtime.createSnapshot()).toEqual(before);
    expect(target.runtime.entities.resolveReference(reference)?.id).toBe('pilot');
  });

  it('rejects invalid armor durability without partially installing the candidate owner', () => {
    const invalid = createPopulatedSnapshot();
    const invalidActor = actor(invalid);
    (invalidActor.equipment as { armor: unknown }).armor = { ...emptyArmor(), helmet: visor(41) };
    const target = setup();
    target.runtime.giveItem('pilot', suit(63));
    const reference = target.runtime.entities.createReference('pilot')!;
    const before = target.runtime.createSnapshot();

    expect(() => target.runtime.restoreSnapshot(invalid)).toThrow(/durability|gameplay snapshot/i);
    expect(target.runtime.createSnapshot()).toEqual(before);
    expect(target.runtime.entities.resolveReference(reference)?.id).toBe('pilot');
  });
});
