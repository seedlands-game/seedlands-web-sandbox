import { describe, expect, it } from 'vitest';
import {
  buildDeathInventorySettlementCandidateV1,
  prepareDeathInventorySettlementParticipantV1,
  prepareDeathInventorySettlementSeriesV1,
  type DeathInventorySettlementCandidateV1,
  type DeathInventorySettlementPolicyV1,
} from '../../src/server/gameplay/death-inventory-settlement';
import type { ActorComponentSnapshot } from '../../src/server/gameplay/ecs-actor-components';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import type { ArmorSlot } from '../../src/server/gameplay/modules/armor-policy';

const items = createItemDefinitionRegistry([
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `sample:ore-${index}`,
    name: `Ore ${index}`,
    itemType: 'resource' as const,
    stackLimit: 64,
    capabilities: [],
  })),
  {
    id: 'sample:visor',
    name: 'Visor',
    itemType: 'armor',
    stackLimit: 1,
    durability: { max: 40 },
    capabilities: [{ type: 'armor' as const, slot: 'helmet' as const, points: 2 }],
  },
  {
    id: 'sample:suit',
    name: 'Suit',
    itemType: 'armor',
    stackLimit: 1,
    durability: { max: 80 },
    capabilities: [{ type: 'armor' as const, slot: 'chestplate' as const, points: 5 }],
  },
]);

const emptyArmor = (): Record<ArmorSlot, null> => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const retainAll: DeathInventorySettlementPolicyV1 = {
  inventory: 'retain',
  cursor: 'retain',
  crafting: 'retain',
  armor: 'retain',
  actor: 'retain',
};
const dropAll: DeathInventorySettlementPolicyV1 = {
  inventory: 'drop',
  cursor: 'drop',
  crafting: 'drop',
  armor: 'drop',
  actor: 'retain',
};

function settlement(
  entities: EntityStore,
  id: string,
  policy: DeathInventorySettlementPolicyV1 = retainAll,
  proposed?: ActorComponentSnapshot,
): DeathInventorySettlementCandidateV1 {
  const components = entities.actorComponentSnapshot(id);
  return buildDeathInventorySettlementCandidateV1({
    source: { actorReference: entities.createReference(id)!, health: entities.get(id)!.health!, components },
    position: entities.get(id)!.position,
    settlementComponents: proposed ?? components,
    policy,
  });
}

function snapshot(entities: EntityStore) {
  return structuredClone(entities.exportComponentSnapshot());
}

describe('death inventory settlement source frontier', () => {
  it.each([
    ['health', (entities: EntityStore) => (entities.actorStateAccess('actor').health = 7)],
    ['needs', (entities: EntityStore) => (entities.actorStateAccess('actor').hunger = 19)],
    [
      'armor',
      (entities: EntityStore) =>
        entities.actorStateAccess('actor').replaceArmor({
          ...emptyArmor(),
          helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 20 } },
        }),
    ],
    [
      'inventory revision',
      (entities: EntityStore) => {
        const actor = entities.actorStateAccess('actor');
        actor.replaceInventoryInteraction(actor.inventoryRevision + 1, actor.inventoryCursor);
      },
    ],
  ])('rejects %s-only drift between candidate build and prepare', (_label, mutate) => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0], health: 8, maxHealth: 20 });
    const candidate = settlement(entities, 'actor');
    mutate(entities);
    const before = snapshot(entities);
    expect(() => prepareDeathInventorySettlementParticipantV1(entities, candidate)).toThrow(/stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
    expect(entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects epoch/lifetime drift before prepare and full frontier drift after prepare', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0], health: 8, maxHealth: 20 });
    const oldCandidate = settlement(entities, 'actor');
    entities.restoreComponentSnapshot(entities.exportComponentSnapshot());
    const afterRestore = snapshot(entities);
    expect(() => prepareDeathInventorySettlementParticipantV1(entities, oldCandidate)).toThrow(/reference.*stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(afterRestore);

    const currentCandidate = settlement(entities, 'actor');
    const prepared = prepareDeathInventorySettlementParticipantV1(entities, currentCandidate);
    entities.actorStateAccess('actor').hunger = 18;
    const changed = snapshot(entities);
    expect(() => prepared.validate()).toThrow(/component.*changed|stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(changed);
  });

  it('rejects a forged lifetime before preparing any mutation', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0], health: 8, maxHealth: 20 });
    const candidate = settlement(entities, 'actor');
    const before = snapshot(entities);
    const forged = {
      ...candidate,
      source: {
        ...candidate.source,
        actorReference: {
          ...candidate.source.actorReference,
          lifetime: candidate.source.actorReference.lifetime + 1,
        },
      },
    } as DeathInventorySettlementCandidateV1;
    expect(() => prepareDeathInventorySettlementParticipantV1(entities, forged)).toThrow(/reference.*stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('keeps detached source state instead of aliasing later caller changes', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0], health: 8, maxHealth: 20 });
    const source = structuredClone(entities.actorComponentSnapshot('actor'));
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: { actorReference: entities.createReference('actor')!, health: 8, components: source },
      settlementComponents: source,
      position: [0, 2, 0],
      policy: retainAll,
    });
    source.needs.hunger = 1;
    expect(candidate.source.components.needs.hunger).toBe(20);
    expect(Object.isFrozen(candidate.source.components.needs)).toBe(true);
    expect(() => prepareDeathInventorySettlementParticipantV1(entities, candidate)).not.toThrow();
  });
});

describe('death inventory settlement series', () => {
  it('uses proposed post-hit state for stable drops and appends intrinsic drops once', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [2, 3, 4], health: 5, maxHealth: 20 });
    const actor = entities.actorStateAccess('actor');
    actor.inventory.add({ itemId: 'sample:ore-0', count: 3 });
    actor.replaceInventoryInteraction(1, {
      version: 1,
      revision: 1,
      stack: { itemId: 'sample:ore-1', count: 2 },
      origin: { kind: 'inventory', slot: 1 },
      craftingGrid: [{ itemId: 'sample:ore-2', count: 1 }, null, null, null],
    });
    actor.replaceArmor({
      ...emptyArmor(),
      helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 2 } },
      chestplate: { itemId: 'sample:suit', count: 1, instance: { durability: 1 } },
    });
    entities.playerStateAccess('actor').breakAction = {
      position: [1, 2, 3],
      voxel: 4,
      elapsedSeconds: 0.5,
      requiredSeconds: 1,
    };
    const source = entities.actorComponentSnapshot('actor');
    const proposed: ActorComponentSnapshot = {
      ...structuredClone(source),
      needs: { ...source.needs, hunger: 17 },
      equipment: {
        ...source.equipment,
        armor: {
          ...source.equipment.armor!,
          helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 1 } },
          chestplate: null,
        },
      },
      player: { ...source.player!, breakAction: null },
    };
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: { actorReference: entities.createReference('actor')!, health: 5, components: source },
      position: [2, 3, 4],
      settlementComponents: proposed,
      policy: dropAll,
    });
    expect(candidate.dropIntents.map(({ source: origin }) => origin)).toEqual([
      { kind: 'inventory', slot: 0 },
      { kind: 'cursor' },
      { kind: 'crafting', slot: 0 },
      { kind: 'equipment', slot: 'helmet' },
    ]);
    expect(candidate.dropIntents.at(-1)?.stack.instance?.durability).toBe(1);

    const prepared = prepareDeathInventorySettlementSeriesV1(entities, {
      candidates: [candidate],
      intrinsicDrops: [{ position: [2, 3, 4], stack: { itemId: 'sample:ore-3', count: 1 } }],
    });
    prepared.validate();
    prepared.apply();
    expect(entities.actorStateAccess('actor')).toMatchObject({ lifecycle: 'dead', hunger: 17 });
    expect(entities.playerStateAccess('actor').breakAction).toBeNull();
    expect(entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore-0', count: 3 },
      { itemId: 'sample:ore-1', count: 2 },
      { itemId: 'sample:ore-2', count: 1 },
      { itemId: 'sample:visor', count: 1, instance: { durability: 1 } },
      { itemId: 'sample:ore-3', count: 1 },
    ]);
  });

  it('commits more than 128 drops through one series frontier in candidate order', () => {
    const entities = new EntityStore(items, undefined, { capacity: 36, hotbarSize: 9 });
    const candidates = Array.from({ length: 4 }, (_, index) => {
      const id = `actor-${index}`;
      entities.spawn({ id, type: 'player', position: [index, 2, 0] });
      expect(entities.actorStateAccess(id).inventory.add({ itemId: `sample:ore-${index}`, count: 36 * 64 })).toBe(true);
      return settlement(entities, id, { ...retainAll, inventory: 'drop' });
    });
    const prepared = prepareDeathInventorySettlementSeriesV1(entities, { candidates });
    prepared.validate();
    prepared.apply();
    const drops = entities.exportComponentSnapshot().entities.filter(({ type }) => type === 'world-item');
    expect(drops).toHaveLength(144);
    expect(drops.map(({ stack }) => stack!.itemId)).toEqual(
      candidates.flatMap((_candidate, index) => Array(36).fill(`sample:ore-${index}`)),
    );
    for (let index = 0; index < 4; index += 1)
      expect(entities.actorStateAccess(`actor-${index}`).inventoryRevision).toBe(1);
  });

  it('despawns an actor only with all four containers configured to drop', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'creature', type: 'creature', position: [4, 2, 0] });
    entities.actorStateAccess('creature').inventory.add({ itemId: 'sample:ore-0', count: 1 });
    const candidate = settlement(entities, 'creature', { ...dropAll, actor: 'despawn' });
    const prepared = prepareDeathInventorySettlementSeriesV1(entities, { candidates: [candidate] });
    prepared.validate();
    const result = prepared.apply();
    expect(result.despawnedIds).toEqual(['creature']);
    expect(entities.get('creature')).toBeNull();
    expect(entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore-0', count: 1 },
    ]);
  });

  it('rejects duplicate actors and replacement/despawn conflicts before any write', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0] });
    const candidate = settlement(entities, 'actor');
    const before = snapshot(entities);
    expect(() => prepareDeathInventorySettlementSeriesV1(entities, { candidates: [candidate, candidate] })).toThrow(
      /duplicate actor/i,
    );
    const conflict = { ...candidate, despawnReference: candidate.source.actorReference };
    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [conflict as DeathInventorySettlementCandidateV1],
      }),
    ).toThrow(/replacement.*despawn/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('rejects final-spawn capacity and the existing series budget without partial mutation', () => {
    const entities = new EntityStore(items);
    entities.spawn({ id: 'actor', type: 'player', position: [0, 2, 0] });
    entities.actorStateAccess('actor').inventory.add({ itemId: 'sample:ore-0', count: 2 });
    const saved = entities.exportComponentSnapshot();
    entities.restoreComponentSnapshot({ ...saved, lifetimeHighWater: Number.MAX_SAFE_INTEGER - 1 });
    const candidate = settlement(entities, 'actor', { ...retainAll, inventory: 'drop' });
    const before = snapshot(entities);
    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [candidate],
        intrinsicDrops: [{ position: [0, 2, 0], stack: { itemId: 'sample:ore-1', count: 1 } }],
      }),
    ).toThrow(/capacity|exhausted/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);

    const budgetDrops = Array.from({ length: 192 * 128 }, () => ({
      position: [0, 2, 0] as const,
      stack: { itemId: 'sample:ore-1', count: 1 },
    }));
    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, { candidates: [candidate], intrinsicDrops: budgetDrops }),
    ).toThrow(/1\.\.192 segments/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });
});
