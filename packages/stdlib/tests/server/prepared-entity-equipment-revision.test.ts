import { describe, expect, it } from 'vitest';
import type { ActorComponentSnapshot } from '../../src/server/gameplay/ecs-actor-components';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { buildInventoryPointerCandidate } from '../../src/server/gameplay/modules/inventory-pointer-model';
import { prepareEntityMutation } from '../../src/server/gameplay/prepared-entity-mutation';

const items = createItemDefinitionRegistry([
  { id: 'sample:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
  {
    id: 'sample:visor',
    name: 'Visor',
    itemType: 'armor',
    stackLimit: 1,
    durability: { max: 40 },
    capabilities: [{ type: 'armor', slot: 'helmet', points: 2 }],
  },
]);
const content = createGameplayContent({ items: items.list(), recipes: [], meleeDefinitions: [] });
const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const visor = (durability = 37) => ({ itemId: 'sample:visor', count: 1, instance: { durability } });

function setup() {
  const entities = new EntityStore(items);
  entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0], health: 20, maxHealth: 20 });
  return entities;
}

function replacement(entities: EntityStore, components: ActorComponentSnapshot) {
  return prepareEntityMutation(entities, {
    actors: [{ reference: entities.createReference('actor')!, health: 20, components }],
  });
}

function commit(entities: EntityStore, components: ActorComponentSnapshot) {
  const prepared = replacement(entities, components);
  prepared.validate();
  prepared.apply();
  return entities.actorComponentSnapshot('actor');
}

describe('prepared actor equipment inventory revision', () => {
  it('advances once for an armor-only change and makes an old pointer revision stale', () => {
    const entities = setup();
    const before = entities.actorComponentSnapshot('actor');
    const after = commit(entities, {
      ...before,
      equipment: { ...before.equipment, armor: { ...emptyArmor(), helmet: visor() } },
    });
    expect(after.inventoryRevision).toBe((before.inventoryRevision ?? 0) + 1);

    expect(() =>
      buildInventoryPointerCandidate(content, {
        actor: {
          version: 1,
          reference: entities.createReference('actor')!,
          kind: 'player',
          slots: after.inventory,
          equipment: {
            selectedSlot: after.equipment.selectedSlot,
            hotbarSize: after.equipment.hotbarSize,
            armor: after.equipment.armor!,
          },
          lifecycle: after.lifecycle,
          inventoryRevision: after.inventoryRevision!,
          cursor: after.inventoryCursor!,
        },
        input: {
          actor: entities.createReference('actor')!,
          expectedInventoryRevision: before.inventoryRevision ?? 0,
          command: { kind: 'close' },
        },
      }),
    ).toThrow(/stale-inventory-revision/);
  });

  it('advances exactly once when bag, cursor, crafting, and armor change together', () => {
    const entities = setup();
    const before = entities.actorComponentSnapshot('actor');
    const inventory = [...before.inventory];
    inventory[0] = { itemId: 'sample:ore', count: 4 };
    const after = commit(entities, {
      ...before,
      inventory,
      inventoryCursor: {
        version: 1,
        revision: (before.inventoryCursor?.revision ?? 0) + 1,
        stack: { itemId: 'sample:ore', count: 2 },
        origin: { kind: 'inventory', slot: 1 },
        craftingGrid: [{ itemId: 'sample:ore', count: 1 }, null, null, null],
      },
      equipment: { ...before.equipment, armor: { ...emptyArmor(), helmet: visor() } },
    });
    expect(after.inventoryRevision).toBe((before.inventoryRevision ?? 0) + 1);
    expect(after.inventory[0]).toEqual({ itemId: 'sample:ore', count: 4 });
    expect(after.inventoryCursor).toMatchObject({
      stack: { itemId: 'sample:ore', count: 2 },
      craftingGrid: [{ itemId: 'sample:ore', count: 1 }, null, null, null],
    });
    expect(after.equipment.armor?.helmet).toEqual(visor());
  });

  it.each([
    ['cursor', { stack: { itemId: 'sample:ore', count: 2 }, craftingGrid: [null, null, null, null] }],
    ['crafting', { stack: null, craftingGrid: [{ itemId: 'sample:ore', count: 1 }, null, null, null] }],
  ] as const)('advances once for a %s-only interaction change', (_label, interaction) => {
    const entities = setup();
    const before = entities.actorComponentSnapshot('actor');
    const after = commit(entities, {
      ...before,
      inventoryCursor: {
        version: 1,
        revision: (before.inventoryCursor?.revision ?? 0) + 1,
        stack: interaction.stack,
        origin: null,
        craftingGrid: interaction.craftingGrid,
      },
    });
    expect(after.inventoryRevision).toBe((before.inventoryRevision ?? 0) + 1);
  });

  it('treats armor durability as interaction state and advances once', () => {
    const entities = setup();
    const initial = entities.actorComponentSnapshot('actor');
    const equipped = commit(entities, {
      ...initial,
      equipment: { ...initial.equipment, armor: { ...emptyArmor(), helmet: visor(37) } },
    });
    const damaged = commit(entities, {
      ...equipped,
      equipment: { ...equipped.equipment, armor: { ...emptyArmor(), helmet: visor(36) } },
    });
    expect(damaged.inventoryRevision).toBe((equipped.inventoryRevision ?? 0) + 1);
    expect(damaged.equipment.armor?.helmet?.instance?.durability).toBe(36);
  });

  it('treats missing legacy armor and explicit empty armor as equivalent', () => {
    const entities = setup();
    const before = entities.actorComponentSnapshot('actor');
    const after = commit(entities, {
      ...before,
      equipment: { selectedSlot: before.equipment.selectedSlot, hotbarSize: before.equipment.hotbarSize },
    });
    expect(after.inventoryRevision).toBe(before.inventoryRevision);
    expect(after.equipment.armor).toEqual(emptyArmor());
  });

  it('does not advance for an equal clone or a selected-slot-only replacement', () => {
    const entities = setup();
    const before = entities.actorComponentSnapshot('actor');
    const equal = commit(entities, structuredClone(before));
    expect(equal.inventoryRevision).toBe(before.inventoryRevision);

    const selected = commit(entities, {
      ...equal,
      equipment: { ...equal.equipment, selectedSlot: 1 },
    });
    expect(selected.inventoryRevision).toBe(equal.inventoryRevision);
    expect(selected.equipment.selectedSlot).toBe(1);
  });

  it('rejects a stale prepared armor change without committing it', () => {
    const entities = setup();
    const before = entities.actorComponentSnapshot('actor');
    const prepared = replacement(entities, {
      ...before,
      equipment: { ...before.equipment, armor: { ...emptyArmor(), helmet: visor() } },
    });
    prepared.validate();
    entities.actorStateAccess('actor').inventory.add({ itemId: 'sample:ore', count: 1 });
    const changed = entities.exportComponentSnapshot();

    expect(() => prepared.apply()).toThrow(/stale|changed/i);
    expect(entities.exportComponentSnapshot()).toEqual(changed);
    expect(entities.actorStateAccess('actor').armor).toEqual(emptyArmor());
  });

  it('rejects a stale actor lifetime during preparation without writes', () => {
    const entities = setup();
    const staleReference = entities.createReference('actor')!;
    const candidate = entities.actorComponentSnapshot('actor');
    entities.restoreComponentSnapshot(entities.exportComponentSnapshot());
    const before = entities.exportComponentSnapshot();

    expect(() =>
      prepareEntityMutation(entities, {
        actors: [
          {
            reference: staleReference,
            health: 20,
            components: {
              ...candidate,
              equipment: { ...candidate.equipment, armor: { ...emptyArmor(), helmet: visor() } },
            },
          },
        ],
      }),
    ).toThrow(/reference.*stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('leaves armor and revision unchanged when a prepared candidate is abandoned', () => {
    const entities = setup();
    const before = entities.exportComponentSnapshot();
    const current = entities.actorComponentSnapshot('actor');
    const prepared = replacement(entities, {
      ...current,
      equipment: { ...current.equipment, armor: { ...emptyArmor(), helmet: visor() } },
    });
    prepared.validate();

    expect(entities.exportComponentSnapshot()).toEqual(before);
    expect(entities.actorStateAccess('actor').inventoryRevision).toBe(current.inventoryRevision);
    expect(entities.actorStateAccess('actor').armor).toEqual(emptyArmor());
  });

  it('rejects an invalid armor candidate during preparation without writes', () => {
    const entities = setup();
    const before = entities.exportComponentSnapshot();
    const current = entities.actorComponentSnapshot('actor');

    expect(() =>
      replacement(entities, {
        ...current,
        equipment: {
          ...current.equipment,
          armor: { ...emptyArmor(), chestplate: visor() },
        },
      }),
    ).toThrow(/armor slot/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('rejects a changed max revision before writes but permits a no-op', () => {
    const entities = setup();
    const access = entities.actorStateAccess('actor');
    access.replaceInventoryInteraction(Number.MAX_SAFE_INTEGER, access.inventoryCursor);
    const before = entities.exportComponentSnapshot();
    const current = entities.actorComponentSnapshot('actor');

    expect(() =>
      replacement(entities, {
        ...current,
        equipment: { ...current.equipment, armor: { ...emptyArmor(), helmet: visor() } },
      }),
    ).toThrow(/revision.*exhausted/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);

    const noOp = replacement(entities, structuredClone(current));
    noOp.validate();
    noOp.apply();
    expect(entities.actorStateAccess('actor').inventoryRevision).toBe(Number.MAX_SAFE_INTEGER);
  });
});
