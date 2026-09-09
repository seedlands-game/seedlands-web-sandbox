import { describe, expect, it } from 'vitest';
import { Inventory } from '../../packages/game-core/src/server/gameplay/inventory';
import {
  createItemDefinitionRegistry,
  defaultItemDefinitionRegistry,
  type ItemDefinitionInput,
} from '../../packages/game-core/src/server/gameplay/item-registry';
import {
  cloneItemStack,
  normalizeItemStack,
  sameItemStackIdentity,
} from '../../packages/game-core/src/server/gameplay/item-instance';

const definition = (overrides: Partial<ItemDefinitionInput> = {}): ItemDefinitionInput => ({
  id: 'test:hammer',
  name: 'Hammer',
  itemType: 'tool',
  stackLimit: 1,
  capabilities: [],
  durability: { max: 100 },
  ...overrides,
});

const items = () =>
  createItemDefinitionRegistry([
    definition(),
    {
      id: 'test:ore',
      name: 'Ore',
      itemType: 'resource',
      stackLimit: 64,
      capabilities: [],
    },
  ]);

describe('item durability definitions and normalization', () => {
  it('keeps default Overworld definitions state-less and validates bounded durable tools', () => {
    expect(defaultItemDefinitionRegistry.list().every((item) => item.durability === undefined)).toBe(true);
    expect(items().require('test:hammer')).toMatchObject({ durability: { max: 100 }, stackLimit: 1 });

    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createItemDefinitionRegistry([definition({ durability: { max: invalid } })])).toThrow(/durability/i);
    }
    expect(() => createItemDefinitionRegistry([definition({ stackLimit: 2 })])).toThrow(/durability|stack limit/i);
    expect(() => createItemDefinitionRegistry([definition({ itemType: 'resource', durability: { max: 10 } })])).toThrow(
      /durability|tool/i,
    );
    expect(() => createItemDefinitionRegistry([definition({ durability: { max: 10, charge: 2 } as never })])).toThrow(
      /durability/i,
    );
  });

  it('normalizes a complete instance into a detached exact stack', () => {
    const registry = items();
    const source = { itemId: 'test:hammer', count: 1, instance: { durability: 73 } };
    const normalized = normalizeItemStack(registry, source);
    source.instance.durability = 1;

    expect(normalized).toEqual({ itemId: 'test:hammer', count: 1, instance: { durability: 73 } });
    expect(Object.isFrozen(normalized.instance)).toBe(true);
    expect(registry.normalizeStack(normalized)).toEqual(normalized);
    expect(cloneItemStack(normalized)).toEqual(normalized);
    expect(cloneItemStack(normalized)).not.toBe(normalized);
  });

  it('rejects unknown or malformed instance state without a migration option', () => {
    const registry = items();
    const invalid: unknown[] = [
      { itemId: 'test:missing', count: 1 },
      { itemId: 'test:hammer', count: 1 },
      { itemId: 'test:hammer', count: 1, instance: { durability: 0 } },
      { itemId: 'test:hammer', count: 1, instance: { durability: 101 } },
      { itemId: 'test:hammer', count: 1, instance: { durability: 50, quality: 'rare' } },
      { itemId: 'test:ore', count: 1, instance: { durability: 1 } },
      { itemId: 'test:ore', count: 1, mystery: true },
    ];
    for (const value of invalid) expect(() => normalizeItemStack(registry, value)).toThrow();
  });

  it('migrates legacy state-less durable tools only through the explicit option', () => {
    const registry = items();
    const legacy = { itemId: 'test:hammer', count: 1 };

    expect(() => normalizeItemStack(registry, legacy)).toThrow(/instance|durability/i);
    expect(normalizeItemStack(registry, legacy, { migrateLegacyDurability: 'initialize-at-max' })).toEqual({
      itemId: 'test:hammer',
      count: 1,
      instance: { durability: 100 },
    });
    expect(legacy).toEqual({ itemId: 'test:hammer', count: 1 });
  });

  it('distinguishes definition-level amount from exact stack identity', () => {
    const full = { itemId: 'test:hammer', count: 1, instance: { durability: 100 } };
    const worn = { itemId: 'test:hammer', count: 1, instance: { durability: 40 } };
    expect(sameItemStackIdentity(full, cloneItemStack(full))).toBe(true);
    expect(sameItemStackIdentity(full, worn)).toBe(false);

    const inventory = new Inventory(2, [full, worn], items());
    expect(inventory.containsAmount('test:hammer', 2)).toBe(true);
    expect(inventory.contains(full)).toBe(true);
    const single = new Inventory(1, [full], items());
    expect(single.contains(worn)).toBe(false);
  });
});

describe('Inventory item instance preservation', () => {
  it('deep-copies add, snapshot, slot and clear results', () => {
    const registry = items();
    const source = { itemId: 'test:hammer', count: 1, instance: { durability: 82 } };
    const inventory = new Inventory(2, undefined, registry);
    expect(inventory.add(source)).toBe(true);
    source.instance.durability = 1;

    const snapshot = inventory.snapshot();
    expect(snapshot[0]).toEqual({ itemId: 'test:hammer', count: 1, instance: { durability: 82 } });
    expect(snapshot[0]?.instance).not.toBe(source.instance);
    expect(Object.isFrozen(snapshot[0]?.instance)).toBe(true);
    expect(inventory.slot(0)?.instance?.durability).toBe(82);

    const cleared = inventory.clear();
    expect(cleared).toEqual([{ itemId: 'test:hammer', count: 1, instance: { durability: 82 } }]);
    expect(cleared[0]?.instance).not.toBe(snapshot[0]?.instance);
    expect(inventory.snapshot()).toEqual([null, null]);
  });

  it('removes and moves only the exact durable instance', () => {
    const registry = items();
    const full = { itemId: 'test:hammer', count: 1, instance: { durability: 100 } };
    const worn = { itemId: 'test:hammer', count: 1, instance: { durability: 40 } };
    const inventory = new Inventory(3, [full, worn, null], registry);

    expect(inventory.remove({ ...worn })).toBe(true);
    expect(inventory.snapshot()).toEqual([full, null, null]);
    expect(inventory.add(worn)).toBe(true);
    expect(inventory.moveStack(0, 1)).toBe(true);
    expect(inventory.snapshot()).toEqual([worn, full, null]);
    const beforeSplit = inventory.snapshot();
    expect(inventory.split(0, 1, 2)).toBe(false);
    expect(inventory.snapshot()).toEqual(beforeSplit);
    expect(inventory.removeFromSlot(1, 1)).toBe(true);
    expect(inventory.snapshot()).toEqual([worn, null, null]);
  });

  it('keeps legacy resource add, merge and split behavior', () => {
    const inventory = new Inventory(3, undefined, items());
    expect(inventory.add({ itemId: 'test:ore', count: 70 })).toBe(true);
    expect(inventory.snapshot()).toEqual([{ itemId: 'test:ore', count: 64 }, { itemId: 'test:ore', count: 6 }, null]);
    expect(inventory.split(0, 5, 2)).toBe(true);
    expect(inventory.snapshot()).toEqual([
      { itemId: 'test:ore', count: 59 },
      { itemId: 'test:ore', count: 6 },
      { itemId: 'test:ore', count: 5 },
    ]);
  });

  it('rejects malformed replacement and detached candidates before owner replacement', () => {
    const registry = items();
    const inventory = new Inventory(2, [{ itemId: 'test:ore', count: 2 }, null], registry);
    const replacement = { itemId: 'test:hammer', count: 1, instance: { durability: 61 } };
    inventory.replace([replacement, null]);
    replacement.instance.durability = 2;
    expect(inventory.slot(0)?.instance?.durability).toBe(61);
    const before = inventory.snapshot();

    expect(() => inventory.replace([{ itemId: 'test:hammer', count: 1 }, null])).toThrow(/instance|durability/i);
    expect(inventory.snapshot()).toEqual(before);
    expect(() => inventory.replace([undefined as never, null])).toThrow(/stack|shape/i);
    expect(inventory.snapshot()).toEqual(before);
    expect(() => inventory.canAdd({ itemId: 'test:hammer', count: 1 } as never)).toThrow(/instance|durability/i);
    expect(inventory.snapshot()).toEqual(before);
    expect(() => inventory.add({ itemId: 'test:missing', count: 1 })).toThrow(/unknown item/i);
    expect(inventory.snapshot()).toEqual(before);
  });
});
