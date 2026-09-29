import { describe, expect, it } from 'vitest';
import {
  buildDeathInventorySettlementCandidateV1,
  prepareDeathInventorySettlementSeriesV1,
  type DeathInventoryAdditionalActorReplacementV1,
  type DeathInventorySettlementPolicyV1,
} from '../../src/server/gameplay/death-inventory-settlement';
import type { DeathInventoryAdditionalActorReplacementV1 as PublicAdditionalActorReplacementV1 } from '../../src/server/composition/mod-api';
import type { ActorComponentSnapshot } from '../../src/server/gameplay/ecs-actor-components';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';

const items = createItemDefinitionRegistry([
  ...Array.from({ length: 3 }, (_, index) => ({
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
]);
const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const retainAll: DeathInventorySettlementPolicyV1 = {
  inventory: 'retain',
  cursor: 'retain',
  crafting: 'retain',
  armor: 'retain',
  actor: 'retain',
};
const dropAll: DeathInventorySettlementPolicyV1 = {
  ...retainAll,
  inventory: 'drop',
  cursor: 'drop',
  crafting: 'drop',
  armor: 'drop',
};

const snapshot = (entities: EntityStore) => structuredClone(entities.exportComponentSnapshot());
const death = (entities: EntityStore, id = 'dead', policy = retainAll) => {
  const components = entities.actorComponentSnapshot(id);
  return buildDeathInventorySettlementCandidateV1({
    source: { actorReference: entities.createReference(id)!, health: entities.get(id)!.health!, components },
    position: entities.get(id)!.position,
    settlementComponents: components,
    policy,
  });
};
const additional = (
  entities: EntityStore,
  id: string,
  components: ActorComponentSnapshot,
): DeathInventoryAdditionalActorReplacementV1 => {
  const reference = entities.createReference(id)!;
  return {
    source: {
      actorReference: reference,
      health: entities.get(id)!.health!,
      components: entities.actorComponentSnapshot(id),
    },
    replacement: { reference, health: entities.get(id)!.health!, components },
  };
};
const pair = () => {
  const entities = new EntityStore(items);
  entities.spawn({ id: 'survivor', type: 'player', position: [0, 2, 0], health: 12, maxHealth: 20 });
  entities.spawn({ id: 'dead', type: 'player', position: [2, 2, 0], health: 1, maxHealth: 20 });
  return entities;
};
const hungry = (source: ActorComponentSnapshot, hunger: number): ActorComponentSnapshot => ({
  ...structuredClone(source),
  needs: { ...source.needs, hunger },
});

describe('death inventory mixed series', () => {
  it('commits one living needs replacement with all four death containers exactly once', () => {
    const entities = pair();
    const dead = entities.actorStateAccess('dead');
    dead.inventory.add({ itemId: 'sample:ore-0', count: 2 });
    dead.replaceInventoryInteraction(dead.inventoryRevision + 1, {
      version: 1,
      revision: dead.inventoryCursor.revision + 1,
      stack: { itemId: 'sample:ore-1', count: 1 },
      origin: null,
      craftingGrid: [{ itemId: 'sample:ore-2', count: 1 }, null, null, null],
    });
    dead.replaceArmor({
      ...emptyArmor(),
      helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 9 } },
    });
    const survivor = entities.actorComponentSnapshot('survivor');
    const publicInput: PublicAdditionalActorReplacementV1 = additional(entities, 'survivor', hungry(survivor, 17));
    const prepared = prepareDeathInventorySettlementSeriesV1(entities, {
      candidates: [death(entities, 'dead', dropAll)],
      additionalActorReplacements: [publicInput],
    });

    prepared.validate();
    prepared.apply();
    expect(entities.actorStateAccess('survivor').hunger).toBe(17);
    expect(entities.actorStateAccess('dead').lifecycle).toBe('dead');
    expect(entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore-0', count: 2 },
      { itemId: 'sample:ore-1', count: 1 },
      { itemId: 'sample:ore-2', count: 1 },
      { itemId: 'sample:visor', count: 1, instance: { durability: 9 } },
    ]);
  });

  it.each([
    ['health', (entities: EntityStore) => (entities.actorStateAccess('survivor').health = 11)],
    ['needs', (entities: EntityStore) => (entities.actorStateAccess('survivor').hunger = 19)],
    [
      'armor',
      (entities: EntityStore) =>
        entities.actorStateAccess('survivor').replaceArmor({
          ...emptyArmor(),
          helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 8 } },
        }),
    ],
    [
      'inventory revision',
      (entities: EntityStore) => {
        const actor = entities.actorStateAccess('survivor');
        actor.replaceInventoryInteraction(actor.inventoryRevision + 1, actor.inventoryCursor);
      },
    ],
  ])('rejects additional actor %s drift before preparing any mutation', (_label, mutate) => {
    const entities = pair();
    const source = entities.actorComponentSnapshot('survivor');
    const replacement = additional(entities, 'survivor', hungry(source, 17));
    mutate(entities);
    const before = snapshot(entities);

    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [death(entities)],
        additionalActorReplacements: [replacement],
      }),
    ).toThrow(/stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('rejects restore lifetime drift before prepare and full frontier drift after prepare', () => {
    const entities = pair();
    const source = entities.actorComponentSnapshot('survivor');
    const old = additional(entities, 'survivor', hungry(source, 17));
    entities.restoreComponentSnapshot(entities.exportComponentSnapshot());
    const restored = snapshot(entities);
    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [death(entities)],
        additionalActorReplacements: [old],
      }),
    ).toThrow(/reference.*stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(restored);

    const current = entities.actorComponentSnapshot('survivor');
    const prepared = prepareDeathInventorySettlementSeriesV1(entities, {
      candidates: [death(entities)],
      additionalActorReplacements: [additional(entities, 'survivor', hungry(current, 17))],
    });
    entities.actorStateAccess('survivor').hunger = 18;
    const changed = snapshot(entities);
    expect(() => prepared.validate()).toThrow(/component.*changed|stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(changed);
  });

  it.each(['epoch', 'lifetime'] as const)('rejects a forged additional source %s', (field) => {
    const entities = pair();
    const source = entities.actorComponentSnapshot('survivor');
    const valid = additional(entities, 'survivor', hungry(source, 17));
    const before = snapshot(entities);
    const forged = {
      ...valid,
      source: {
        ...valid.source,
        actorReference: {
          ...valid.source.actorReference,
          [field]: valid.source.actorReference[field] + 1,
        },
      },
    };

    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [death(entities)],
        additionalActorReplacements: [forged],
      }),
    ).toThrow(/reference.*stale/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('detaches additional source and replacement state before returning the prepared frontier', () => {
    const entities = pair();
    const source = structuredClone(entities.actorComponentSnapshot('survivor'));
    const proposed = hungry(source, 17);
    const reference = entities.createReference('survivor')!;
    const position: [number, number, number] = [4, 3, 2];
    const prepared = prepareDeathInventorySettlementSeriesV1(entities, {
      candidates: [death(entities)],
      additionalActorReplacements: [
        {
          source: { actorReference: reference, health: 12, components: source },
          replacement: { reference, health: 12, components: proposed, position },
        },
      ],
    });
    source.needs.hunger = 1;
    proposed.needs.hunger = 2;
    position[0] = 9;

    prepared.validate();
    prepared.apply();
    expect(entities.actorStateAccess('survivor').hunger).toBe(17);
    expect(entities.get('survivor')?.position).toEqual([4, 3, 2]);
  });

  it('rejects cross-set duplicates, mismatched references and death-shaped additional replacements', () => {
    const entities = pair();
    const source = entities.actorComponentSnapshot('survivor');
    const valid = additional(entities, 'survivor', source);
    const candidate = death(entities);
    const before = snapshot(entities);

    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [candidate],
        additionalActorReplacements: [
          {
            source: candidate.source,
            replacement: {
              reference: candidate.source.actorReference,
              health: candidate.source.health,
              components: candidate.source.components,
            },
          },
        ],
      }),
    ).toThrow(/duplicate actor/i);
    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [candidate],
        additionalActorReplacements: [
          { ...valid, replacement: { ...valid.replacement, reference: candidate.source.actorReference } },
        ],
      }),
    ).toThrow(/does not match/i);
    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [candidate],
        additionalActorReplacements: [
          {
            ...valid,
            replacement: { ...valid.replacement, health: 0, components: { ...source, lifecycle: 'dead' } },
          },
        ],
      }),
    ).toThrow(/must remain alive/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('rejects spawn/despawn bypass fields and unknown series input', () => {
    const entities = pair();
    const components = entities.actorComponentSnapshot('survivor');
    const valid = additional(entities, 'survivor', components);
    const before = snapshot(entities);
    for (const invalid of [
      { ...valid, spawns: [] },
      { ...valid, replacement: { ...valid.replacement, despawn: true } },
      { ...valid, source: { ...valid.source, extra: true } },
    ])
      expect(() =>
        prepareDeathInventorySettlementSeriesV1(entities, {
          candidates: [death(entities)],
          additionalActorReplacements: [invalid as DeathInventoryAdditionalActorReplacementV1],
        }),
      ).toThrow(/additional actor replacement|settlement source/i);
    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [death(entities)],
        additionalActorReplacements: [valid],
        unknown: true,
      } as Parameters<typeof prepareDeathInventorySettlementSeriesV1>[1]),
    ).toThrow(/series input/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });

  it('preflights final spawn capacity before survivor, death, drop or revision writes', () => {
    const entities = pair();
    entities.actorStateAccess('dead').inventory.add({ itemId: 'sample:ore-0', count: 2 });
    const saved = entities.exportComponentSnapshot();
    entities.restoreComponentSnapshot({ ...saved, lifetimeHighWater: Number.MAX_SAFE_INTEGER });
    const survivor = entities.actorComponentSnapshot('survivor');
    const before = snapshot(entities);

    expect(() =>
      prepareDeathInventorySettlementSeriesV1(entities, {
        candidates: [death(entities, 'dead', dropAll)],
        additionalActorReplacements: [additional(entities, 'survivor', hungry(survivor, 17))],
      }),
    ).toThrow(/capacity|exhausted/i);
    expect(entities.exportComponentSnapshot()).toEqual(before);
    expect(entities.actorStateAccess('survivor').hunger).toBe(20);
    expect(entities.actorStateAccess('dead').inventoryRevision).toBe(0);
    expect(entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('combines more than 128 survivor and death entries under one series frontier', () => {
    const entities = new EntityStore(items);
    const additionalActorReplacements = Array.from({ length: 128 }, (_, index) => {
      const id = `survivor-${index}`;
      entities.spawn({ id, type: 'player', position: [index, 2, 0], health: 12, maxHealth: 20 });
      const source = entities.actorComponentSnapshot(id);
      return additional(entities, id, hungry(source, 19));
    });
    entities.spawn({ id: 'dead', type: 'player', position: [130, 2, 0], health: 1, maxHealth: 20 });
    const prepared = prepareDeathInventorySettlementSeriesV1(entities, {
      candidates: [death(entities)],
      additionalActorReplacements,
    });

    prepared.validate();
    prepared.apply();
    expect(entities.actorStateAccess('survivor-127').hunger).toBe(19);
    expect(entities.actorStateAccess('dead').lifecycle).toBe('dead');
  });
});
