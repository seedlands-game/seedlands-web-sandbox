import { describe, expect, it } from 'vitest';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { buildInventoryPointerCandidate } from '../../src/server/gameplay/modules/inventory-pointer-model';
import type { InventoryPointerActorProjectionV1 } from '../../src/server/gameplay/modules/inventory-pointer-contract';
import type { ArmorSlot } from '../../src/server/gameplay/modules/armor-policy';

const equipmentContent = createGameplayContent({
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
    {
      id: 'sample:leggings',
      name: 'Leggings',
      itemType: 'armor',
      stackLimit: 1,
      durability: { max: 70 },
      capabilities: [{ type: 'armor', slot: 'leggings', points: 4 }],
    },
    {
      id: 'sample:boots',
      name: 'Boots',
      itemType: 'armor',
      stackLimit: 1,
      durability: { max: 50 },
      capabilities: [{ type: 'armor', slot: 'boots', points: 2 }],
    },
    {
      id: 'sample:stacked-cap',
      name: 'Stacked Cap',
      itemType: 'armor',
      stackLimit: 16,
      capabilities: [{ type: 'armor', slot: 'helmet', points: 1 }],
    },
    { id: 'sample:fiber', name: 'Fiber', itemType: 'resource', stackLimit: 64, capabilities: [] },
  ],
  recipes: [],
  meleeDefinitions: [],
});
const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const stack = (itemId: string, durability: number) => ({ itemId, count: 1, instance: { durability } });
const actor = (overrides: Partial<InventoryPointerActorProjectionV1> = {}): InventoryPointerActorProjectionV1 => ({
  version: 1,
  reference: { entityId: 'pilot', epoch: 1, lifetime: 1 },
  kind: 'player',
  slots: [
    stack('sample:visor', 37),
    stack('sample:suit', 71),
    stack('sample:leggings', 63),
    stack('sample:boots', 42),
    ...Array(8).fill(null),
  ],
  equipment: { selectedSlot: 0, hotbarSize: 4, armor: emptyArmor() },
  lifecycle: 'alive',
  inventoryRevision: 7,
  cursor: { version: 1, revision: 3, stack: null, origin: null, craftingGrid: [null, null, null, null] },
  ...overrides,
});
const command = (source: InventoryPointerActorProjectionV1, value: unknown) => ({
  actor: source.reference,
  expectedInventoryRevision: source.inventoryRevision,
  command: value,
});
const click = (source: InventoryPointerActorProjectionV1, slot: ArmorSlot, button: 0 | 2 = 0) =>
  buildInventoryPointerCandidate(equipmentContent, {
    actor: source,
    input: command(source, { kind: 'click', slot: { kind: 'equipment', slot }, button }),
  });
describe('equipment inventory pointer candidate', () => {
  it.each([
    ['helmet', 'sample:visor', 37],
    ['chestplate', 'sample:suit', 71],
    ['leggings', 'sample:leggings', 63],
    ['boots', 'sample:boots', 42],
  ] as const)('equips and removes one %s item without losing instance durability', (slot, itemId, durability) => {
    const source = actor();
    const picked = buildInventoryPointerCandidate(equipmentContent, {
      actor: source,
      input: command(source, {
        kind: 'click',
        slot: { kind: 'inventory', slot: ['helmet', 'chestplate', 'leggings', 'boots'].indexOf(slot) },
        button: 0,
      }),
    });
    const equipped = click({ ...source, slots: picked.slots, inventoryRevision: 8, cursor: picked.cursor }, slot);
    expect(equipped.equipment.armor[slot]).toEqual(stack(itemId, durability));
    expect(equipped.cursor.stack).toBeNull();

    const removed = click(
      {
        ...source,
        slots: equipped.slots,
        equipment: equipped.equipment,
        inventoryRevision: 9,
        cursor: equipped.cursor,
      },
      slot,
      2,
    );
    expect(removed.equipment.armor[slot]).toBeNull();
    expect(removed.cursor).toMatchObject({ stack: stack(itemId, durability), origin: { kind: 'equipment', slot } });
    expect(source.equipment.armor).toEqual(emptyArmor());
  });

  it('atomically swaps occupied equipment and recursively freezes detached candidate state', () => {
    const source = actor({
      equipment: { ...actor().equipment, armor: { ...emptyArmor(), helmet: stack('sample:visor', 11) } },
      cursor: {
        version: 1,
        revision: 3,
        stack: stack('sample:visor', 37),
        origin: { kind: 'inventory', slot: 0 },
        craftingGrid: [null, null, null, null],
      },
    });
    const result = click(source, 'helmet');
    expect(result.equipment.armor.helmet).toEqual(stack('sample:visor', 37));
    expect(result.cursor).toMatchObject({
      stack: stack('sample:visor', 11),
      origin: { kind: 'equipment', slot: 'helmet' },
    });
    expect(source.equipment.armor.helmet).toEqual(stack('sample:visor', 11));
    expect(result.equipment).not.toBe(source.equipment);
    expect(result.equipment.armor).not.toBe(source.equipment.armor);
    expect(result.equipment.armor.helmet).not.toBe(source.equipment.armor.helmet);
    expect(result.equipment.armor.helmet!.instance).not.toBe(source.equipment.armor.helmet!.instance);
    expect(Object.isFrozen(result.equipment)).toBe(true);
    expect(Object.isFrozen(result.equipment.armor)).toBe(true);
    expect(Object.isFrozen(result.equipment.armor.helmet)).toBe(true);
    expect(Object.isFrozen(result.equipment.armor.helmet!.instance)).toBe(true);
  });

  it('right-click equips the single durable item without splitting it', () => {
    const source = actor({
      cursor: {
        version: 1,
        revision: 3,
        stack: stack('sample:boots', 42),
        origin: { kind: 'inventory', slot: 3 },
        craftingGrid: [null, null, null, null],
      },
    });
    const result = click(source, 'boots', 2);
    expect(result.equipment.armor.boots).toEqual(stack('sample:boots', 42));
    expect(result.cursor.stack).toBeNull();
  });

  it('puts only one item from a stack into an equipment slot', () => {
    const source = actor({
      cursor: {
        version: 1,
        revision: 3,
        stack: { itemId: 'sample:stacked-cap', count: 3 },
        origin: { kind: 'inventory', slot: 0 },
        craftingGrid: [null, null, null, null],
      },
    });
    const result = click(source, 'helmet');
    expect(result.equipment.armor.helmet).toEqual({ itemId: 'sample:stacked-cap', count: 1 });
    expect(result.cursor.stack).toEqual({ itemId: 'sample:stacked-cap', count: 2 });
  });

  it.each([
    ['wrong armor slot', stack('sample:suit', 71), 'invalid-pointer-slot'],
    ['item without armor capability', { itemId: 'sample:fiber', count: 1 }, 'invalid-pointer-slot'],
    ['unknown item', { itemId: 'sample:unknown', count: 1 }, 'Unknown item'],
  ])('rejects %s without mutating any source state', (_label, held, reason) => {
    const source = actor({
      cursor: { version: 1, revision: 3, stack: held, origin: null, craftingGrid: [null, null, null, null] },
    });
    const before = structuredClone(source);
    expect(() => click(source, 'helmet')).toThrow(reason);
    expect(source).toEqual(before);
  });

  it('quick-moves armor into an empty matching slot before the existing bag partition', () => {
    const source = actor();
    const result = buildInventoryPointerCandidate(equipmentContent, {
      actor: source,
      input: command(source, { kind: 'quick-move', slot: { kind: 'inventory', slot: 1 } }),
    });
    expect(result.equipment.armor.chestplate).toEqual(stack('sample:suit', 71));
    expect(result.slots[1]).toBeNull();
  });

  it('equips one stackable armor item before merging the remainder into the bag', () => {
    const source = actor({
      slots: [
        { itemId: 'sample:stacked-cap', count: 3 },
        ...Array(3).fill(null),
        { itemId: 'sample:stacked-cap', count: 2 },
        ...Array(7).fill(null),
      ],
    });
    const result = buildInventoryPointerCandidate(equipmentContent, {
      actor: source,
      input: command(source, { kind: 'quick-move', slot: { kind: 'inventory', slot: 0 } }),
    });
    expect(result.equipment.armor.helmet).toEqual({ itemId: 'sample:stacked-cap', count: 1 });
    expect(result.slots[0]).toBeNull();
    expect(result.slots[4]).toEqual({ itemId: 'sample:stacked-cap', count: 4 });
  });

  it('keeps occupied equipment and continues quick-move through the existing bag partition', () => {
    const source = actor({
      equipment: { ...actor().equipment, armor: { ...emptyArmor(), chestplate: stack('sample:suit', 33) } },
    });
    const result = buildInventoryPointerCandidate(equipmentContent, {
      actor: source,
      input: command(source, { kind: 'quick-move', slot: { kind: 'inventory', slot: 1 } }),
    });
    expect(result.equipment.armor.chestplate).toEqual(stack('sample:suit', 33));
    expect(result.slots[1]).toBeNull();
    expect(result.slots[4]).toEqual(stack('sample:suit', 71));
  });

  it('quick-moves equipment into the bag and fails atomically when the bag is full', () => {
    const equipped = actor({
      slots: Array(12).fill(null),
      equipment: { ...actor().equipment, armor: { ...emptyArmor(), helmet: stack('sample:visor', 37) } },
    });
    const moved = buildInventoryPointerCandidate(equipmentContent, {
      actor: equipped,
      input: command(equipped, { kind: 'quick-move', slot: { kind: 'equipment', slot: 'helmet' } }),
    });
    expect(moved.equipment.armor.helmet).toBeNull();
    expect(moved.slots[0]).toEqual(stack('sample:visor', 37));

    const full = actor({ ...equipped, slots: Array(12).fill({ itemId: 'sample:fiber', count: 64 }) });
    const before = structuredClone(full);
    expect(() =>
      buildInventoryPointerCandidate(equipmentContent, {
        actor: full,
        input: command(full, { kind: 'quick-move', slot: { kind: 'equipment', slot: 'helmet' } }),
      }),
    ).toThrow('destination-full');
    expect(full).toEqual(before);
  });

  it('hotbar-removes equipment but rejects swapping a non-armor item into that slot', () => {
    const equipped = actor({
      slots: Array(12).fill(null),
      equipment: { ...actor().equipment, armor: { ...emptyArmor(), helmet: stack('sample:visor', 37) } },
    });
    const removed = buildInventoryPointerCandidate(equipmentContent, {
      actor: equipped,
      input: command(equipped, { kind: 'hotbar', slot: { kind: 'equipment', slot: 'helmet' }, hotbarSlot: 2 }),
    });
    expect(removed.equipment.armor.helmet).toBeNull();
    expect(removed.slots[2]).toEqual(stack('sample:visor', 37));

    const matching = actor({
      slots: [stack('sample:visor', 37), ...Array(11).fill(null)],
      equipment: { ...actor().equipment, armor: { ...emptyArmor(), helmet: stack('sample:visor', 11) } },
    });
    const swapped = buildInventoryPointerCandidate(equipmentContent, {
      actor: matching,
      input: command(matching, { kind: 'hotbar', slot: { kind: 'equipment', slot: 'helmet' }, hotbarSlot: 0 }),
    });
    expect(swapped.equipment.armor.helmet).toEqual(stack('sample:visor', 37));
    expect(swapped.slots[0]).toEqual(stack('sample:visor', 11));

    const blocked = actor({ ...equipped, slots: [{ itemId: 'sample:fiber', count: 1 }, ...Array(11).fill(null)] });
    const before = structuredClone(blocked);
    expect(() =>
      buildInventoryPointerCandidate(equipmentContent, {
        actor: blocked,
        input: command(blocked, { kind: 'hotbar', slot: { kind: 'equipment', slot: 'helmet' }, hotbarSlot: 0 }),
      }),
    ).toThrow('invalid-pointer-slot');
    expect(blocked).toEqual(before);
  });

  it.each(['distribute', 'collect'] as const)('rejects unsupported %s equipment entry without mutation', (kind) => {
    const source = actor({
      cursor: {
        version: 1,
        revision: 3,
        stack: stack('sample:visor', 37),
        origin: { kind: 'inventory', slot: 0 },
        craftingGrid: [null, null, null, null],
      },
    });
    const before = structuredClone(source);
    const pointerCommand =
      kind === 'distribute'
        ? { kind, button: 2 as const, targets: [{ kind: 'equipment' as const, slot: 'helmet' as const }] }
        : { kind, slot: { kind: 'equipment' as const, slot: 'helmet' as const } };
    expect(() =>
      buildInventoryPointerCandidate(equipmentContent, { actor: source, input: command(source, pointerCommand) }),
    ).toThrow('invalid-pointer-slot');
    expect(source).toEqual(before);
  });

  it('distributes an equipment-origin cursor into the bag without retaining a second owner', () => {
    const wearing = actor({
      slots: Array(12).fill(null),
      equipment: {
        ...actor().equipment,
        armor: { ...emptyArmor(), helmet: { itemId: 'sample:stacked-cap', count: 1 } },
      },
    });
    const picked = click(wearing, 'helmet');
    const distributed = buildInventoryPointerCandidate(equipmentContent, {
      actor: {
        ...wearing,
        slots: picked.slots,
        equipment: picked.equipment,
        inventoryRevision: picked.inventoryRevision,
        cursor: picked.cursor,
      },
      input: command(
        { ...wearing, inventoryRevision: picked.inventoryRevision },
        { kind: 'distribute', button: 2, targets: [{ kind: 'inventory', slot: 4 }] },
      ),
    });
    expect(distributed.equipment.armor.helmet).toBeNull();
    expect(distributed.slots[4]).toEqual({ itemId: 'sample:stacked-cap', count: 1 });
    expect(distributed.cursor).toMatchObject({ stack: null, origin: null });
  });

  it('does not collect matching items out of equipment when collecting through a bag slot', () => {
    const source = actor({
      slots: [{ itemId: 'sample:stacked-cap', count: 2 }, ...Array(11).fill(null)],
      equipment: {
        ...actor().equipment,
        armor: { ...emptyArmor(), helmet: { itemId: 'sample:stacked-cap', count: 1 } },
      },
      cursor: {
        version: 1,
        revision: 3,
        stack: { itemId: 'sample:stacked-cap', count: 1 },
        origin: { kind: 'equipment', slot: 'helmet' },
        craftingGrid: [null, null, null, null],
      },
    });
    const result = buildInventoryPointerCandidate(equipmentContent, {
      actor: source,
      input: command(source, { kind: 'collect', slot: { kind: 'inventory', slot: 0 } }),
    });
    expect(result.cursor.stack).toEqual({ itemId: 'sample:stacked-cap', count: 3 });
    expect(result.equipment.armor.helmet).toEqual({ itemId: 'sample:stacked-cap', count: 1 });
  });

  it('restores an equipment-origin cursor before bag settlement and keeps the full-bag drop fallback', () => {
    const fullSlots = Array(12).fill({ itemId: 'sample:fiber', count: 64 });
    const returning = actor({
      slots: fullSlots,
      cursor: {
        version: 1,
        revision: 3,
        stack: stack('sample:visor', 37),
        origin: { kind: 'equipment', slot: 'helmet' },
        craftingGrid: [null, null, null, null],
      },
    });
    const restored = buildInventoryPointerCandidate(equipmentContent, {
      actor: returning,
      input: command(returning, { kind: 'close' }),
    });
    expect(restored.equipment.armor.helmet).toEqual(stack('sample:visor', 37));
    expect(restored.cursor.stack).toBeNull();
    expect(restored.dropIntents).toEqual([]);

    const occupied = actor({
      ...returning,
      equipment: { ...returning.equipment, armor: { ...emptyArmor(), helmet: stack('sample:visor', 11) } },
    });
    const dropped = buildInventoryPointerCandidate(equipmentContent, {
      actor: occupied,
      input: command(occupied, { kind: 'close' }),
    });
    expect(dropped.equipment.armor.helmet).toEqual(stack('sample:visor', 11));
    expect(dropped.dropIntents).toEqual([stack('sample:visor', 37)]);

    const available = actor({
      ...returning,
      slots: Array(12).fill(null),
      equipment: { ...returning.equipment, armor: { ...emptyArmor(), helmet: stack('sample:visor', 11) } },
    });
    const bagged = buildInventoryPointerCandidate(equipmentContent, {
      actor: available,
      input: command(available, { kind: 'close' }),
    });
    expect(bagged.equipment.armor.helmet).toEqual(stack('sample:visor', 11));
    expect(bagged.slots[0]).toEqual(stack('sample:visor', 37));
    expect(bagged.dropIntents).toEqual([]);
  });

  it('preserves equipment origin through a cursor drop and keeps an empty close as a frozen no-op', () => {
    const holding = actor({
      cursor: {
        version: 1,
        revision: 3,
        stack: stack('sample:boots', 42),
        origin: { kind: 'equipment', slot: 'boots' },
        craftingGrid: [null, null, null, null],
      },
    });
    const dropped = buildInventoryPointerCandidate(equipmentContent, {
      actor: holding,
      input: command(holding, { kind: 'drop', button: 2 }),
    });
    expect(dropped.dropIntents).toEqual([stack('sample:boots', 42)]);
    expect(dropped.cursor).toMatchObject({ stack: null, origin: null });

    const source = actor({ slots: Array(12).fill(null) });
    const noOp = buildInventoryPointerCandidate(equipmentContent, {
      actor: source,
      input: command(source, { kind: 'close' }),
    });
    expect(noOp.changed).toBe(false);
    expect(noOp.inventoryRevision).toBe(source.inventoryRevision);
    expect(noOp.cursor.revision).toBe(source.cursor.revision);
    expect(Object.isFrozen(noOp.equipment.armor)).toBe(true);
  });

  it('rejects a pre-existing multi-item equipment stack before building a candidate', () => {
    const source = actor({
      equipment: {
        ...actor().equipment,
        armor: { ...emptyArmor(), helmet: { itemId: 'sample:stacked-cap', count: 2 } },
      },
    });
    const before = structuredClone(source);
    expect(() =>
      buildInventoryPointerCandidate(equipmentContent, {
        actor: source,
        input: command(source, { kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 }),
      }),
    ).toThrow('invalid-pointer-slot');
    expect(source).toEqual(before);

    const invalidCursor = actor({
      cursor: {
        version: 1,
        revision: 3,
        stack: { itemId: 'sample:stacked-cap', count: 2 },
        origin: { kind: 'equipment', slot: 'helmet' },
        craftingGrid: [null, null, null, null],
      },
    });
    const cursorBefore = structuredClone(invalidCursor);
    expect(() =>
      buildInventoryPointerCandidate(equipmentContent, {
        actor: invalidCursor,
        input: command(invalidCursor, { kind: 'close' }),
      }),
    ).toThrow('invalid-pointer-slot');
    expect(invalidCursor).toEqual(cursorBefore);
  });
});
