import { describe, expect, it } from 'vitest';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import {
  validateInventoryCursor,
  validateInventoryEquipmentProjection,
  validateInventoryPointerInput,
} from '../../src/server/gameplay/modules/inventory-pointer-contract';
import { copyAuthorityActionReference } from '../../src/server/protocol/network-action-reference-copy';
import { projectGameplayViewReference } from '../../src/server/protocol/network-reference-projection';
import type { AuthorityGameplayView } from '../../src/server/protocol/authority-worker-protocol';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { projectInventoryPointerView } from '../../src/server/gameplay/gameplay-inventory-pointer';
import {
  buildDeathInventorySettlementCandidateV1,
  prepareDeathInventorySettlementParticipantV1,
  type DeathInventorySettlementPolicyV1,
} from '../../src/server/gameplay/death-inventory-settlement';

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
  {
    id: 'sample:suit',
    name: 'Suit',
    itemType: 'armor',
    stackLimit: 1,
    durability: { max: 80 },
    capabilities: [{ type: 'armor', slot: 'chestplate', points: 5 }],
  },
]);
const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const dropAll: DeathInventorySettlementPolicyV1 = {
  inventory: 'drop',
  cursor: 'drop',
  crafting: 'drop',
  armor: 'drop',
  actor: 'retain',
};

describe('equipment pointer and projection contract', () => {
  it('strictly copies equipment pointer slots and rejects unknown or malformed fields', () => {
    const source = {
      type: 'inventory-pointer',
      actor: { entityId: 'player', epoch: 1, lifetime: 2 },
      expectedInventoryRevision: 4,
      command: { kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 },
    };
    const copied = copyAuthorityActionReference(source);
    expect(copied).toEqual(source);
    expect(copied).not.toBe(source);
    if (copied.type !== 'inventory-pointer') throw new Error('Expected inventory pointer copy.');
    expect(copied.command).not.toBe(source.command);
    source.command.slot.slot = 'boots';
    expect(copied).toMatchObject({ command: { slot: { kind: 'equipment', slot: 'helmet' } } });

    expect(() => validateInventoryPointerInput({ ...source, command: { ...source.command, extra: true } })).toThrow();
    expect(() => copyAuthorityActionReference({ ...source, unexpected: true })).toThrow(/unknown fields/i);
    for (const slot of ['head', 0, null])
      expect(() =>
        validateInventoryPointerInput({
          ...source,
          command: { kind: 'click', slot: { kind: 'equipment', slot }, button: 0 },
        }),
      ).toThrow(/slot|command|unknown/i);
  });

  it('validates complete armor and cursor origins by capability without retaining input aliases', () => {
    const helmet = { itemId: 'sample:visor', count: 1, instance: { durability: 31 } };
    const projection = validateInventoryEquipmentProjection(
      { selectedSlot: 0, hotbarSize: 2, armor: { ...emptyArmor(), helmet } },
      items,
      4,
    );
    const cursor = validateInventoryCursor(
      {
        version: 1,
        revision: 3,
        stack: helmet,
        origin: { kind: 'equipment', slot: 'helmet' },
        craftingGrid: [null, null, null, null],
      },
      items,
    );
    helmet.instance.durability = 1;
    expect(projection.armor.helmet?.instance?.durability).toBe(31);
    expect(cursor.stack?.instance?.durability).toBe(31);
    expect(Object.isFrozen(projection.armor)).toBe(true);
    expect(Object.isFrozen(projection.armor.helmet?.instance)).toBe(true);
    expect(() =>
      validateInventoryEquipmentProjection(
        { selectedSlot: 0, hotbarSize: 2, armor: { ...emptyArmor(), helmet: { ...helmet, itemId: 'sample:suit' } } },
        items,
        4,
      ),
    ).toThrow(/armor slot/i);
    expect(() =>
      validateInventoryEquipmentProjection(
        { selectedSlot: 0, hotbarSize: 2, armor: { ...emptyArmor(), unknown: null } },
        items,
        4,
      ),
    ).toThrow(/armor projection/i);
  });

  it('projects authoritative bag and all armor slots with detached durable instances', () => {
    const bag = { itemId: 'sample:suit', count: 1, instance: { durability: 62 } };
    const helmet = { itemId: 'sample:visor', count: 1, instance: { durability: 27 } };
    const view = {
      gameplayRevision: 5,
      gameplayTime: 9,
      inventory: {
        version: 1,
        actor: { entityId: 'player', epoch: 1, lifetime: 1 },
        revision: 6,
        slots: [bag],
        hotbarSize: 1,
        armor: { ...emptyArmor(), helmet },
        cursor: { version: 1, revision: 2, stack: null, origin: null, craftingGrid: [null, null, null, null] },
        matchedCraftingRecipeIds: [],
      },
      player: {
        entityId: 'player',
        health: 20,
        maxHealth: 20,
        hunger: 20,
        maxHunger: 20,
        lifecycle: 'alive',
        inventory: [],
        selectedSlot: 0,
        hotbarSize: 1,
        breakAction: null,
      },
      entities: [],
      actors: [],
      craftableRecipeIds: [],
      metrics: {},
    } as unknown as AuthorityGameplayView;
    const projected = projectGameplayViewReference(view, {
      epoch: 'sample:world',
      snapshotPhysicsTick: 1,
      snapshotCommitSequence: 2,
      snapshotWorldRevision: 3,
    });
    bag.instance.durability = 1;
    helmet.instance.durability = 1;
    expect(projected.player.inventory[0]).toEqual({
      slot: 0,
      itemId: 'sample:suit',
      count: 1,
      instance: { durability: 62 },
    });
    expect(projected.player.armor.helmet).toEqual({
      itemId: 'sample:visor',
      count: 1,
      instance: { durability: 27 },
    });
    expect(Object.isFrozen(projected.player.inventory)).toBe(true);
    expect(Object.isFrozen(projected.player.armor)).toBe(true);
    expect(Object.isFrozen(projected.player.armor.helmet?.instance)).toBe(true);
  });

  it('projects the actor-owned armor through the real Authority inventory view without aliases', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0] });
    entities.actorStateAccess('actor').replaceArmor({
      ...emptyArmor(),
      helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 33 } },
    });
    const source = entities.actorStateAccess('actor').armor;
    const projected = projectInventoryPointerView(
      entities,
      createGameplayContent({ items: items.list(), recipes: [], meleeDefinitions: [] }),
      'actor',
    );
    (source.helmet as { count: number }).count = 9;
    expect(projected.armor.helmet).toEqual({
      itemId: 'sample:visor',
      count: 1,
      instance: { durability: 33 },
    });
    expect(Object.keys(projected.armor)).toEqual(['helmet', 'chestplate', 'leggings', 'boots']);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.armor.helmet)).toBe(true);
  });
});

describe('death inventory settlement contract', () => {
  const populated = () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [2, 3, 4], health: 5, maxHealth: 20 });
    const actor = entities.actorStateAccess('actor');
    actor.inventory.add({ itemId: 'sample:ore', count: 3 });
    actor.replaceInventoryInteraction(1, {
      version: 1,
      revision: 1,
      stack: { itemId: 'sample:ore', count: 2 },
      origin: { kind: 'inventory', slot: 1 },
      craftingGrid: [{ itemId: 'sample:ore', count: 1 }, null, null, null],
    });
    actor.replaceArmor({
      ...emptyArmor(),
      helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 29 } },
      chestplate: { itemId: 'sample:suit', count: 1, instance: { durability: 71 } },
    });
    return entities;
  };

  it('builds one stable detached drop intent per occupied bag, cursor, crafting, and armor source', () => {
    const entities = populated();
    const components = structuredClone(entities.actorComponentSnapshot('actor'));
    const sourceComponents = structuredClone(entities.actorComponentSnapshot('actor'));
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: {
        actorReference: entities.createReference('actor')!,
        health: entities.get('actor')!.health!,
        components: sourceComponents,
      },
      position: [2, 3, 4],
      settlementComponents: components,
      policy: dropAll,
    });
    components.inventory[0]!.count = 1;
    (components.equipment.armor!.helmet!.instance as { durability: number }).durability = 1;
    expect(candidate.dropIntents.map((entry) => entry.source)).toEqual([
      { kind: 'inventory', slot: 0 },
      { kind: 'cursor' },
      { kind: 'crafting', slot: 0 },
      { kind: 'equipment', slot: 'helmet' },
      { kind: 'equipment', slot: 'chestplate' },
    ]);
    expect(candidate.dropIntents[0]!.stack.count).toBe(3);
    expect(candidate.dropIntents[3]!.stack.instance?.durability).toBe(29);
    expect(candidate.actorReplacement).toMatchObject({
      health: 0,
      components: {
        lifecycle: 'dead',
        inventoryCursor: { stack: null, craftingGrid: [null, null, null, null] },
        equipment: { armor: emptyArmor() },
      },
    });
    expect(Object.isFrozen(candidate.dropIntents)).toBe(true);
    expect(Object.isFrozen(candidate.dropIntents[3]!.stack.instance)).toBe(true);
    expect(Object.isFrozen(candidate.actorReplacement?.components.player?.spawnPosition)).toBe(true);
  });

  it('commits the actor replacement and all drops through one prepared participant', () => {
    const entities = populated();
    const beforeRevision = entities.actorStateAccess('actor').inventoryRevision;
    const components = entities.actorComponentSnapshot('actor');
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: {
        actorReference: entities.createReference('actor')!,
        health: entities.get('actor')!.health!,
        components,
      },
      position: [2, 3, 4],
      settlementComponents: components,
      policy: dropAll,
    });
    const participant = prepareDeathInventorySettlementParticipantV1(entities, candidate);
    participant.validate();
    participant.apply();
    const actor = entities.actorStateAccess('actor');
    expect(actor.lifecycle).toBe('dead');
    expect(actor.inventory.snapshot().every((slot) => slot === null)).toBe(true);
    expect(actor.inventoryCursor).toMatchObject({ stack: null, craftingGrid: [null, null, null, null] });
    expect(actor.armor).toEqual(emptyArmor());
    expect(actor.inventoryRevision).toBe(beforeRevision + 1);
    expect(entities.query({ type: 'world-item' }).map((entry) => entry.stack)).toEqual(
      candidate.dropIntents.map((entry) => entry.stack),
    );
  });

  it('rejects a stale prepared participant without changing actor or creating drops', () => {
    const entities = populated();
    const components = entities.actorComponentSnapshot('actor');
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: {
        actorReference: entities.createReference('actor')!,
        health: entities.get('actor')!.health!,
        components,
      },
      position: [2, 3, 4],
      settlementComponents: components,
      policy: dropAll,
    });
    const participant = prepareDeathInventorySettlementParticipantV1(entities, candidate);
    entities.actorStateAccess('actor').inventory.add({ itemId: 'sample:ore', count: 1 });
    const changed = entities.exportComponentSnapshot();
    expect(() => participant.validate()).toThrow(/stale|changed/i);
    expect(entities.exportComponentSnapshot()).toEqual(changed);
    expect(entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects a candidate whose actor inventory revision changed before participant preparation', () => {
    const entities = populated();
    const components = entities.actorComponentSnapshot('actor');
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: {
        actorReference: entities.createReference('actor')!,
        health: entities.get('actor')!.health!,
        components,
      },
      position: [2, 3, 4],
      settlementComponents: components,
      policy: dropAll,
    });
    const actor = entities.actorStateAccess('actor');
    actor.replaceInventoryInteraction(actor.inventoryRevision + 1, actor.inventoryCursor);
    const changed = entities.exportComponentSnapshot();
    expect(() => prepareDeathInventorySettlementParticipantV1(entities, candidate)).toThrow(/component.*stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(changed);
    expect(entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects exhausted spawn allocation before changing the actor', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [2, 3, 4], health: 5, maxHealth: 20 });
    entities.actorStateAccess('actor').inventory.add({ itemId: 'sample:ore', count: 1 });
    const snapshot = entities.exportComponentSnapshot();
    entities.restoreComponentSnapshot({ ...snapshot, lifetimeHighWater: Number.MAX_SAFE_INTEGER });
    const before = entities.exportComponentSnapshot();
    const components = entities.actorComponentSnapshot('actor');
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: {
        actorReference: entities.createReference('actor')!,
        health: entities.get('actor')!.health!,
        components,
      },
      position: [2, 3, 4],
      settlementComponents: components,
      policy: dropAll,
    });
    expect(() => prepareDeathInventorySettlementParticipantV1(entities, candidate)).toThrow(/capacity|exhausted/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });
});
