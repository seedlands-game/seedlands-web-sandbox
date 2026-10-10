import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import {
  buildDeathInventorySettlementCandidateV1,
  freezeDeathInventorySettlementPolicyV1,
  prepareDeathInventorySettlementSeriesV1,
} from '../../src/server/gameplay/death-inventory-settlement';
import type { TransportSpawnState } from '../../src/server/gameplay/ecs-transport-state';
import { createTransportDefinitionRegistryV1 } from '../../src/server/gameplay/modules/transport-model';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import {
  defineCombatModule,
  defineContentModule,
  defineCombatRulesModule,
  defineDeathInventoryPolicyModuleV1,
  defineInventoryModule,
  definePack,
  defineTransportInteractionModule,
  defineRulesetModule,
} from '@seedlands/stdlib/mod-api';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../support/core-platform';

const items = createItemDefinitionRegistry([
  { id: 'sample:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
  { id: 'sample:cargo', name: 'Cargo', itemType: 'resource', stackLimit: 64, capabilities: [] },
  {
    id: 'sample:visor',
    name: 'Visor',
    itemType: 'armor',
    stackLimit: 1,
    durability: { max: 40 },
    capabilities: [{ type: 'armor', slot: 'helmet', points: 2 }],
  },
]);
const definitions = createTransportDefinitionRegistryV1([
  {
    version: 1,
    id: 'sample:route-cart',
    locomotion: { provider: 'route', providerId: 'sample:rail' },
    bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
    seatOffset: [0, 0.55, 0],
    fuelCapacity: 100,
    inventoryCapacity: 1,
    presentationId: 'sample:route-cart-model',
  },
]);
const transportState = (rider: { entityId: string; lifetime: number } | null): TransportSpawnState => ({
  definitionId: 'sample:route-cart',
  yaw: 0.25,
  routeCursor: {
    family: 'sample:rail',
    cell: [0, 0, 0],
    variant: 'sample:straight',
    entry: { side: 'west', elevation: 0 },
    exit: { side: 'east', elevation: 0 },
    progress: 0,
    segmentLength: 1,
  },
  rider,
  fuel: 20,
  inventory: [null],
});
const surfaceTransportState = (rider: { entityId: string; lifetime: number } | null): TransportSpawnState => ({
  ...transportState(rider),
  definitionId: 'sample:surface-cart',
  routeCursor: null,
});
const policy = freezeDeathInventorySettlementPolicyV1({
  inventory: 'drop',
  cursor: 'drop',
  crafting: 'drop',
  armor: 'drop',
  actor: 'retain',
});

function setup() {
  const store = new EntityStore(items, undefined, undefined, undefined, definitions);
  for (const id of ['mounted-dead', 'plain-dead', 'survivor']) {
    store.spawn({ id, type: 'player', position: [0, 4, 0] });
    seedFourContainers(store, id);
  }
  const mounted = store.createReference('mounted-dead')!;
  const survivor = store.createReference('survivor')!;
  const stableRider = (reference: typeof mounted) => ({
    entityId: reference.entityId,
    lifetime: reference.lifetime,
  });
  store.spawn({
    id: 'mounted-cart',
    type: 'transport',
    position: [3, 4, 0],
    physicsVelocity: [0.25, 0, -0.5],
    transport: transportState(stableRider(mounted)),
  });
  store.spawn({
    id: 'survivor-cart',
    type: 'transport',
    position: [7, 4, 0],
    transport: transportState(stableRider(survivor)),
  });
  const payload = store.prepareMutation({
    transports: ['mounted-cart', 'survivor-cart'].map((id) => {
      const snapshot = store.transportComponentSnapshot(id);
      return {
        reference: store.createReference(id)!,
        snapshot: {
          ...snapshot,
          revision: snapshot.revision + 1,
          fuel: 40,
          inventory: [{ itemId: 'sample:cargo', count: 3 }],
        },
      };
    }),
  });
  payload.validate();
  payload.apply();
  return store;
}

function seedFourContainers(store: EntityStore, id: string) {
  const actor = store.actorStateAccess(id);
  actor.inventory.add({ itemId: 'sample:ore', count: 2 });
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: actor.inventoryCursor.revision + 1,
    stack: { itemId: 'sample:cargo', count: 1 },
    origin: null,
    craftingGrid: [{ itemId: 'sample:ore', count: 1 }, null, null, null],
  });
  actor.replaceArmor({
    helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 4 } },
    chestplate: null,
    leggings: null,
    boots: null,
  });
}

function deathCandidate(store: EntityStore, actorId: string) {
  const entity = store.get(actorId)!;
  const components = store.actorComponentSnapshot(actorId);
  return buildDeathInventorySettlementCandidateV1({
    source: {
      actorReference: store.createReference(actorId)!,
      health: entity.health!,
      components,
    },
    position: entity.position,
    settlementComponents: { ...components, lifecycle: 'dead' },
    policy,
  });
}

const snapshot = (store: EntityStore) => structuredClone(store.exportComponentSnapshot());

describe('transport-aware death inventory settlement series', () => {
  it('settles mounted and unmounted deaths together while preserving the live rider and transport payload', () => {
    const store = setup();
    const before = snapshot(store);
    const mountedReference = store.createReference('mounted-cart')!;
    const mountedComponent = store.transportComponentSnapshot('mounted-cart');
    const mountedState = store.transportState(mountedReference)!;
    const survivorComponent = store.transportComponentSnapshot('survivor-cart');
    const survivorState = store.transportState(store.createReference('survivor-cart')!)!;

    const settlement = prepareDeathInventorySettlementSeriesV1(store, {
      candidates: [deathCandidate(store, 'mounted-dead'), deathCandidate(store, 'plain-dead')],
    });

    expect(store.exportComponentSnapshot()).toEqual(before);
    settlement.validate();
    settlement.apply();
    expect(store.get('mounted-dead')).toMatchObject({ health: 0, type: 'player' });
    expect(store.get('plain-dead')).toMatchObject({ health: 0, type: 'player' });
    expect(store.actorComponentSnapshot('mounted-dead').lifecycle).toBe('dead');
    expect(store.actorComponentSnapshot('plain-dead').lifecycle).toBe('dead');
    expect(store.transportComponentSnapshot('mounted-cart')).toEqual({
      ...mountedComponent,
      revision: mountedComponent.revision + 1,
      rider: null,
    });
    expect(store.transportState(mountedReference)).toEqual({
      ...mountedState,
      rider: null,
    });
    expect(store.transportComponentSnapshot('survivor-cart')).toEqual(survivorComponent);
    expect(store.transportState(store.createReference('survivor-cart')!)).toEqual(survivorState);
    expect(store.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual(
      [0, 1].flatMap(() => [
        { itemId: 'sample:ore', count: 2 },
        { itemId: 'sample:cargo', count: 1 },
        { itemId: 'sample:ore', count: 1 },
        { itemId: 'sample:visor', count: 1, instance: { durability: 4 } },
      ]),
    );
    const after = snapshot(store);
    expect(() => settlement.apply()).toThrow(/already applied|already used/i);
    expect(snapshot(store)).toEqual(after);
  });

  it('rejects a death series after its captured transport component changes without altering the newer owners', () => {
    const store = setup();
    const settlement = prepareDeathInventorySettlementSeriesV1(store, {
      candidates: [deathCandidate(store, 'mounted-dead')],
    });
    const current = store.transportComponentSnapshot('mounted-cart');
    const transportChange = store.prepareMutation({
      transports: [
        {
          reference: store.createReference('mounted-cart')!,
          snapshot: { ...current, revision: current.revision + 1, yaw: 1.25 },
        },
      ],
    });
    transportChange.validate();
    transportChange.apply();
    const afterExternalChange = snapshot(store);

    expect(() => settlement.validate()).toThrow(/stale|changed|transport/i);

    expect(snapshot(store)).toEqual(afterExternalChange);
    expect(store.transportComponentSnapshot('mounted-cart')).toMatchObject({ revision: 2, yaw: 1.25 });
    expect(store.actorComponentSnapshot('mounted-dead').lifecycle).toBe('alive');
  });

  it('rejects a retained death candidate that proposes a living actor replacement', () => {
    const store = setup();
    const valid = deathCandidate(store, 'mounted-dead');
    if (!valid.actorReplacement) throw new TypeError('Expected the retained death policy replacement.');
    const forged = {
      ...valid,
      actorReplacement: {
        ...valid.actorReplacement,
        health: store.get('mounted-dead')!.health!,
        components: { ...valid.actorReplacement.components, lifecycle: 'alive' as const },
      },
    };
    const before = snapshot(store);

    expect(() => prepareDeathInventorySettlementSeriesV1(store, { candidates: [forged] })).toThrow(
      /death|health|lifecycle/i,
    );

    expect(snapshot(store)).toEqual(before);
  });

  it('rejects a death settlement over the shared 192 by 128 entry budget before owner writes', () => {
    const store = setup();
    const before = snapshot(store);
    const intrinsicDrops = Array.from({ length: 24_575 }, () => ({
      position: [10, 4, 0] as const,
      stack: { itemId: 'sample:ore', count: 1 },
    }));

    expect(() =>
      prepareDeathInventorySettlementSeriesV1(store, {
        candidates: [deathCandidate(store, 'mounted-dead')],
        intrinsicDrops,
      }),
    ).toThrow(/192|segment|budget/i);

    expect(snapshot(store)).toEqual(before);
  });

  it('unlinks a mounted lethal target through registered Combat while keeping a live mounted survivor', () => {
    const content = defineContentModule({
      moduleId: 'sample:transport-death-combat-content',
      items: [
        { id: 'sample:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
        { id: 'sample:cargo', name: 'Cargo', itemType: 'resource', stackLimit: 64, capabilities: [] },
      ],
      voxels: [
        {
          id: 'sample:platform',
          storageId: 5,
          solid: true,
          targetable: true,
          renderable: true,
          meshKind: 'cube',
          emission: 0,
          lightCost: 16,
          faceMaterials: [4, 4, 4, 4, 4, 4],
        },
      ],
      recipes: [],
      meleeDefinitions: [
        {
          id: 'sample:claw',
          range: 4,
          steps: [{ damage: 100, windupSeconds: 0.1, hitSeconds: 0.1, recoverySeconds: 0.1 }],
        },
      ],
      actorProfiles: [
        {
          archetype: 'night-stalker',
          entityType: 'npc',
          maxHealth: 20,
          navigation: { speed: 1, perceptionRange: 8 },
          meleeDefinitionId: 'sample:claw',
        },
      ],
    });
    const transportDefinitions = defineTransportInteractionModule({
      moduleId: 'sample:transport-death-combat-definitions',
      operationId: 'sample:deploy-transport',
      definitions: [
        {
          version: 1,
          id: 'sample:surface-cart',
          locomotion: { provider: 'surface', providerId: 'sample:ground' },
          bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
          seatOffset: [0, 0.55, 0],
          fuelCapacity: 100,
          inventoryCapacity: 1,
          presentationId: 'sample:surface-cart-model',
        },
      ],
      deployments: [],
      routes: [],
      surfaces: [{ id: 'sample:ground', voxels: [5], surfaceOffset: 1 }],
    });
    const deathModule = defineDeathInventoryPolicyModuleV1({
      moduleId: 'sample:transport-death-combat-policy',
      definition: {
        version: 1,
        actors: {
          player: policy,
          creature: { ...policy, actor: 'despawn' },
          npc: { ...policy, actor: 'despawn' },
        },
      },
    });
    const ruleset = defineRulesetModule({ id: 'sample:transport-death-rules', version: '1.0.0' });
    const modules = [
      content,
      transportDefinitions,
      defineInventoryModule(),
      defineCombatModule(),
      ruleset,
      defineCombatRulesModule({
        moduleId: 'sample:transport-death-combat-rules',
        profile: { damageMultiplier: 1, immuneTargetModes: [] },
      }),
      deathModule,
    ];
    const pack = definePack({ id: 'sample:transport-death-combat', version: '1.0.0', kind: 'playbook', modules });
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
      {
        approvedPermissions: {
          'sample:transport-death-combat': modules.flatMap(({ descriptor }) => descriptor.permissions ?? []),
        },
      },
    );
    const runtime = new GameplayRuntime({
      composition,
      moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'combat-player' }),
      moduleSystemAuthority: createGameplaySystemAuthority(composition),
      platform: testCorePlatform,
      getVoxel: () => 0,
      getWorldTime: () => 12,
      prepareVoxelEdit: () => {
        throw new Error('Unexpected voxel edit.');
      },
    });
    runtime.spawnPlayer({ id: 'mounted-target', position: [0, 4, 0] });
    runtime.entities.actorStateAccess('mounted-target').inventory.add({ itemId: 'sample:ore', count: 2 });
    runtime.spawnAutonomous(
      { id: 'registered-attacker', type: 'npc', archetype: 'night-stalker', position: [0, 4, 1] },
      { archetype: 'night-stalker' },
    );
    const targetReference = runtime.entities.createReference('mounted-target')!;
    runtime.entities.spawn({
      id: 'combat-cart',
      type: 'transport',
      position: [3, 4, 0],
      transport: surfaceTransportState({ entityId: targetReference.entityId, lifetime: targetReference.lifetime }),
    });
    runtime.entities.spawn({
      id: 'survivor',
      type: 'player',
      position: [8, 4, 0],
    });
    const survivorReference = runtime.entities.createReference('survivor')!;
    runtime.entities.spawn({
      id: 'survivor-cart',
      type: 'transport',
      position: [8, 4, 1],
      transport: surfaceTransportState({ entityId: survivorReference.entityId, lifetime: survivorReference.lifetime }),
    });
    const beforeDrops = runtime.entities.query({ type: 'world-item' }).length;

    const combatRequest = runtime.simulation.requestActorCombat('registered-attacker', 'mounted-target', 'sample:claw');
    expect(combatRequest, JSON.stringify(combatRequest).slice(0, 500)).toMatchObject({ success: true });
    runtime.advanceRules(0.3);

    expect(runtime.entities.get('mounted-target')?.health).toBe(0);
    expect(runtime.entities.actorStateAccess('mounted-target').lifecycle).toBe('dead');
    expect(runtime.entities.transportComponentSnapshot('combat-cart')).toMatchObject({ revision: 1, rider: null });
    expect(runtime.entities.transportComponentSnapshot('survivor-cart')).toMatchObject({
      revision: 0,
      rider: { entityId: 'survivor', lifetime: survivorReference.lifetime },
    });
    expect(runtime.entities.query({ type: 'world-item' })).toHaveLength(beforeDrops + 1);
    expect(runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore', count: 2 },
    ]);
  });
});
