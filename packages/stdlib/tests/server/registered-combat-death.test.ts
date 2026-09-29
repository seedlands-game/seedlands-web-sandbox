import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import { createGameplayActorAuthority } from '../../src/server/composition/gameplay-actor-authority';
import { createGameplaySystemAuthority } from '../../src/server/composition/gameplay-system-authority';
import type { CommittedOperationFact } from '../../src/server/composition/operation-contracts';
import type { DeathInventoryPolicyDefinitionV1 } from '../../src/server/gameplay/modules/death-inventory-policy-module';
import {
  defineDeathInventoryPolicyModuleV1,
  resolveDeathInventoryPolicyCapabilityV1,
} from '../../src/server/gameplay/modules/death-inventory-policy-module';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { prepareCombatDamage } from '../../src/server/gameplay/prepared-combat-damage';
import { prepareEntityMutation } from '../../src/server/gameplay/prepared-entity-mutation';
import { defineCombatModule } from '../../src/server/gameplay/modules/combat-module';
import { defineCombatRulesModule } from '../../src/server/gameplay/modules/combat-rules-module';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import { defineInventoryActionsModule } from '../../src/server/gameplay/modules/inventory-actions-module';
import { defineInventoryModule } from '../../src/server/gameplay/modules/inventory-module';
import { defineRulesetModule } from '../../src/server/gameplay/modules/ruleset-module';
import { testCorePlatform } from '../support/core-platform';

const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const visor = (durability: number) => ({ itemId: 'sample:visor', count: 1, instance: { durability } });
const suit = (durability: number) => ({ itemId: 'sample:suit', count: 1, instance: { durability } });
const retain = { inventory: 'retain', cursor: 'retain', crafting: 'retain', armor: 'retain', actor: 'retain' } as const;
const dropRetain = { inventory: 'drop', cursor: 'drop', crafting: 'drop', armor: 'drop', actor: 'retain' } as const;
const dropDespawn = { ...dropRetain, actor: 'despawn' } as const;
const policy = (kind: 'drop' | 'retain'): DeathInventoryPolicyDefinitionV1 => ({
  version: 1,
  actors:
    kind === 'drop'
      ? { player: dropRetain, creature: dropDespawn, npc: dropDespawn }
      : { player: retain, creature: retain, npc: retain },
});

type Hook = (runtime: GameplayRuntime) => void;
type TargetKind = 'player' | 'npc';
type FixtureOptions = Readonly<{
  targetKind?: TargetKind;
  targetHealth?: number;
  deathPolicy?: 'drop' | 'retain' | null;
  authorized?: boolean;
  rejectResolve?: boolean;
  afterPrepared?: Hook;
}>;

function setup(options: FixtureOptions = {}) {
  const targetKind = options.targetKind ?? 'npc';
  const content = defineContentModule({
    moduleId: 'sample:death-combat-content',
    items: [
      { id: 'sample:ore-a', name: 'Ore A', itemType: 'resource', stackLimit: 64, capabilities: [] },
      { id: 'sample:ore-b', name: 'Ore B', itemType: 'resource', stackLimit: 64, capabilities: [] },
      { id: 'sample:ore-c', name: 'Ore C', itemType: 'resource', stackLimit: 64, capabilities: [] },
      { id: 'sample:trophy', name: 'Trophy', itemType: 'resource', stackLimit: 64, capabilities: [] },
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
        capabilities: [{ type: 'armor', slot: 'chestplate', points: 6 }],
      },
    ],
    recipes: [],
    meleeDefinitions: [
      {
        id: 'sample:strike',
        range: 4,
        steps: [{ damage: 10, windupSeconds: 0, hitSeconds: 0.1, recoverySeconds: 0.1 }],
      },
    ],
    actorProfiles: [
      {
        archetype: 'night-stalker',
        entityType: 'npc',
        maxHealth: 20,
        navigation: { speed: 1, perceptionRange: 8 },
        meleeDefinitionId: 'sample:strike',
        deathDrop: { itemId: 'sample:trophy', count: 1 },
      },
    ],
    defaultPlayerMeleeDefinitionId: 'sample:strike',
  });
  const combat = defineCombatModule();
  const observableCombat = Object.freeze({
    ...combat,
    descriptor: Object.freeze({
      ...combat.descriptor,
      permissions: Object.freeze([
        ...(combat.descriptor.permissions ?? []),
        { resource: 'seedlands.ruleset', operations: ['read' as const] },
      ]),
    }),
  });
  const modules = [
    content,
    defineRulesetModule({ id: 'sample:death-combat-rules', version: '1.0.0' }),
    defineInventoryModule(),
    defineInventoryActionsModule(),
    observableCombat,
    defineCombatRulesModule({
      moduleId: 'sample:death-combat-rules',
      profile: { damageMultiplier: 1, immuneTargetModes: ['creative'] },
    }),
    ...(options.deathPolicy === null
      ? []
      : [
          defineDeathInventoryPolicyModuleV1({
            moduleId: 'sample:death-inventory-policy',
            definition: policy(options.deathPolicy ?? 'drop'),
          }),
        ]),
    ...(options.rejectResolve
      ? [
          {
            descriptor: {
              id: 'sample:reject-death-resolve',
              version: '1.0.0',
              permissions: [{ resource: 'seedlands.combat', operations: ['execute' as const] }],
            },
            register(api: Parameters<typeof content.register>[0]) {
              api.registerRule({
                id: 'sample:reject-death-resolve/after',
                operationId: 'seedlands:resolve-combat',
                stage: 'after',
                apply() {
                  return { reject: 'sample-death-rejected' };
                },
              });
            },
          },
        ]
      : []),
  ];
  const pack = definePack({ id: 'sample:death-combat', version: '1.0.0', kind: 'playbook', modules });
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
  const authority = createGameplayActorAuthority(composition.resources, { playerAlias: 'fighter' });
  const holder: { runtime: GameplayRuntime | null } = { runtime: null };
  let hookUsed = false;
  const runtime = new GameplayRuntime({
    composition,
    ...(options.authorized === false
      ? {}
      : { moduleActorAuthority: authority, moduleSystemAuthority: createGameplaySystemAuthority(composition) }),
    platform: {
      ...testCorePlatform,
      clone: <Value>(value: Value): Value => {
        if (
          holder.runtime &&
          options.afterPrepared &&
          !hookUsed &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          (value as { success?: unknown }).success === true &&
          (value as { outcome?: unknown }).outcome === 'hit'
        ) {
          hookUsed = true;
          options.afterPrepared(holder.runtime);
        }
        return structuredClone(value);
      },
    },
    getVoxel: () => 0,
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit.');
    },
  });
  holder.runtime = runtime;
  const attackerId = 'attacker';
  const targetId = 'target';
  if (targetKind === 'player') {
    runtime.spawnAutonomous(
      { id: attackerId, type: 'npc', archetype: 'night-stalker', position: [0, 0, 0] },
      { archetype: 'night-stalker' },
    );
    runtime.spawnPlayer({ id: targetId, position: [0, 0, 1] });
  } else {
    runtime.spawnPlayer({ id: attackerId, position: [0, 0, 0] });
    runtime.spawnAutonomous(
      { id: targetId, type: 'npc', archetype: 'night-stalker', position: [0, 0, 1] },
      { archetype: 'night-stalker' },
    );
  }
  runtime.updateEntityWithoutSnapshot(targetId, { health: options.targetHealth ?? 5 });
  const attack = () =>
    targetKind === 'player'
      ? runtime.simulation.requestActorCombat(attackerId, targetId, 'sample:strike')
      : runtime.attackEntity(attackerId, targetId);
  const bind = () => {
    const actor = runtime.entities.get(attackerId)!;
    const binding = authority.forActor(attackerId, actor.type)!;
    return runtime.bindModuleOperations(binding.authorizer, {
      moduleId: 'seedlands:combat-module',
      principalId: binding.principalId,
      originalActorId: attackerId,
    });
  };
  return { runtime, composition, attackerId, targetId, attack, bind };
}

function seedOwned(runtime: GameplayRuntime, targetId = 'target') {
  const actor = runtime.entities.actorStateAccess(targetId);
  actor.inventory.add({ itemId: 'sample:ore-a', count: 2 });
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: actor.inventoryCursor.revision + 1,
    stack: { itemId: 'sample:ore-b', count: 1 },
    origin: null,
    craftingGrid: [{ itemId: 'sample:ore-c', count: 1 }, null, null, null],
  });
  actor.replaceArmor({ ...emptyArmor(), helmet: visor(1), chestplate: suit(5) });
  if (runtime.entities.get(targetId)?.type === 'player')
    runtime.entities.playerStateAccess(targetId).breakAction = {
      position: [1, 2, 3],
      voxel: 4,
      elapsedSeconds: 0.5,
      requiredSeconds: 1,
    };
  return runtime.entities.actorComponentSnapshot(targetId);
}

function directPending(fixture: ReturnType<typeof setup>) {
  const execution = fixture.bind();
  const facts: CommittedOperationFact[] = [];
  execution.subscribe((fact) => facts.push(fact));
  expect(
    execution.invoke({
      operationId: 'seedlands:request-combat',
      target: { kind: 'entity', entityId: fixture.targetId },
      input: { targetId: fixture.targetId },
    }),
  ).toMatchObject({ ok: true });
  const pending = fixture.runtime.simulation.combat.peekPendingHits();
  expect(pending).toHaveLength(1);
  return {
    execution,
    facts,
    dispose() {
      execution.dispose();
    },
    resolve: () =>
      execution.invoke({
        operationId: 'seedlands:resolve-combat',
        target: { kind: 'entity', entityId: fixture.targetId },
        input: { token: pending[0]!.token },
      }),
  };
}

const entityState = (runtime: GameplayRuntime) => ({
  entities: runtime.entities.exportComponentSnapshot(),
  combat: runtime.simulation.combat.snapshot(),
  gameplayRevision: runtime.gameplayRevision,
});

describe('registered Combat death inventory policy', () => {
  it('settles a lethal player hit with post-hit armor and one shared revision', () => {
    const fixture = setup({ targetKind: 'player', deathPolicy: 'drop' });
    const before = seedOwned(fixture.runtime);
    const healthBefore = fixture.runtime.entities.get(fixture.targetId)!.health!;
    const pending = directPending(fixture);

    const result = pending.resolve();
    const target = fixture.runtime.entities.actorStateAccess(fixture.targetId);
    const healthDelta = healthBefore - target.health;
    expect(result).toMatchObject({ ok: true, value: { success: true, outcome: 'hit', damage: healthDelta } });
    expect(target).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: before.inventoryRevision! + 1 });
    expect(target.inventory.snapshot().every((slot) => slot === null)).toBe(true);
    expect(target.inventoryCursor).toMatchObject({ stack: null, craftingGrid: [null, null, null, null] });
    expect(target.armor).toEqual(emptyArmor());
    expect(fixture.runtime.entities.playerStateAccess(fixture.targetId).breakAction).toBeNull();
    expect(fixture.runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore-a', count: 2 },
      { itemId: 'sample:ore-b', count: 1 },
      { itemId: 'sample:ore-c', count: 1 },
      suit(4),
    ]);
    expect(fixture.runtime.simulation.combat.snapshotFor(fixture.attackerId).lastResult).toMatchObject({
      outcome: 'hit',
      damage: healthDelta,
    });
    expect(pending.facts.at(-1)).toMatchObject({
      operationId: 'seedlands:resolve-combat',
      value: { success: true, outcome: 'hit', damage: healthDelta },
    });
    pending.dispose();
  });

  it('despawns a lethal NPC and appends its intrinsic drop exactly once', () => {
    const fixture = setup({ deathPolicy: 'drop' });
    seedOwned(fixture.runtime);
    const healthBefore = fixture.runtime.entities.get(fixture.targetId)!.health!;
    const pending = directPending(fixture);

    expect(pending.resolve()).toMatchObject({
      ok: true,
      value: { success: true, outcome: 'hit', damage: healthBefore },
    });
    expect(fixture.runtime.entities.get(fixture.targetId)).toBeNull();
    const dropped = fixture.runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack);
    expect(dropped).toEqual([
      { itemId: 'sample:ore-a', count: 2 },
      { itemId: 'sample:ore-b', count: 1 },
      { itemId: 'sample:ore-c', count: 1 },
      suit(4),
      { itemId: 'sample:trophy', count: 1 },
    ]);
    expect(fixture.attack().success).toBe(false);
    fixture.runtime.advanceRules(1);
    expect(fixture.runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual(dropped);
    pending.dispose();
  });

  it('retains all containers while still committing player death and post-hit durability', () => {
    const fixture = setup({ targetKind: 'player', deathPolicy: 'retain' });
    const before = seedOwned(fixture.runtime);

    expect(fixture.attack()).toMatchObject({ success: true, damage: 5 });
    const target = fixture.runtime.entities.actorStateAccess(fixture.targetId);
    expect(target).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: before.inventoryRevision! + 1 });
    expect(target.inventory.slot(0)).toEqual({ itemId: 'sample:ore-a', count: 2 });
    expect(target.inventoryCursor).toMatchObject({
      stack: { itemId: 'sample:ore-b', count: 1 },
      craftingGrid: [{ itemId: 'sample:ore-c', count: 1 }, null, null, null],
    });
    expect(target.armor).toEqual({ ...emptyArmor(), helmet: null, chestplate: suit(4) });
    expect(fixture.runtime.entities.query({ type: 'world-item' })).toEqual([]);
    expect(fixture.runtime.entities.playerStateAccess(fixture.targetId).breakAction).toBeNull();
  });

  it('retains a dead NPC when its composed actor policy selects retain', () => {
    const fixture = setup({ deathPolicy: 'retain' });
    const before = seedOwned(fixture.runtime);

    expect(fixture.attack()).toMatchObject({ success: true, damage: 5 });
    const target = fixture.runtime.entities.actorStateAccess(fixture.targetId);
    expect(target).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: before.inventoryRevision! + 1 });
    expect(target.inventory.slot(0)).toEqual({ itemId: 'sample:ore-a', count: 2 });
    expect(target.armor).toEqual({ ...emptyArmor(), helmet: null, chestplate: suit(4) });
    expect(fixture.runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:trophy', count: 1 },
    ]);
    expect(fixture.runtime.simulation.actorIds()).toContain(fixture.targetId);
  });

  it('rejects a composed lethal resolve without policy and leaves the pending frontier untouched', () => {
    const fixture = setup({ deathPolicy: null });
    seedOwned(fixture.runtime);
    const pending = directPending(fixture);
    const before = entityState(fixture.runtime);

    expect(pending.resolve()).toEqual({
      ok: false,
      code: 'DEATH_INVENTORY_POLICY_UNAVAILABLE',
      message: 'death-inventory-policy-unavailable',
    });
    expect(entityState(fixture.runtime)).toEqual(before);
    expect(fixture.runtime.entities.query({ type: 'world-item' })).toEqual([]);
    pending.dispose();
  });

  it('keeps nonfatal armor behavior when the composed policy capability is absent', () => {
    const fixture = setup({ deathPolicy: null, targetHealth: 20 });
    fixture.runtime.entities.actorStateAccess(fixture.targetId).replaceArmor({
      ...emptyArmor(),
      helmet: visor(3),
    });
    const beforeRevision = fixture.runtime.entities.actorStateAccess(fixture.targetId).inventoryRevision;

    expect(fixture.attack()).toMatchObject({ success: true, damage: 9.2 });
    expect(fixture.runtime.entities.get(fixture.targetId)?.health).toBe(10.8);
    expect(fixture.runtime.entities.actorStateAccess(fixture.targetId).armor.helmet).toEqual(visor(2));
    expect(fixture.runtime.entities.actorStateAccess(fixture.targetId).inventoryRevision).toBe(beforeRevision + 1);
  });

  it('does not settle death for invalid, unauthorized, or rule-cancelled attacks', () => {
    const invalid = setup({ deathPolicy: 'drop' });
    seedOwned(invalid.runtime);
    const invalidBefore = invalid.runtime.entities.exportComponentSnapshot();
    expect(invalid.runtime.attackEntity(invalid.attackerId, 'missing').success).toBe(false);
    expect(invalid.runtime.entities.exportComponentSnapshot()).toEqual(invalidBefore);

    const unauthorized = setup({ deathPolicy: 'drop', authorized: false });
    seedOwned(unauthorized.runtime);
    const unauthorizedBefore = unauthorized.runtime.createSnapshot();
    expect(unauthorized.attack()).toEqual({ success: false, reason: 'combat-authority-missing' });
    expect(unauthorized.runtime.createSnapshot()).toEqual(unauthorizedBefore);

    const cancelled = setup({ deathPolicy: 'drop', rejectResolve: true });
    seedOwned(cancelled.runtime);
    const entityBefore = cancelled.runtime.entities.exportComponentSnapshot();
    expect(cancelled.attack().success).toBe(true);
    expect(cancelled.runtime.entities.exportComponentSnapshot()).toEqual(entityBefore);
    expect(cancelled.runtime.entities.query({ type: 'world-item' })).toEqual([]);
    expect(cancelled.runtime.simulation.combat.snapshotFor(cancelled.attackerId).lastResult).toMatchObject({
      outcome: 'cancelled',
      damage: 0,
    });
  });

  it('rejects post-prepare actor component or lifetime drift without partial death writes', () => {
    let concurrentComponents: ReturnType<GameplayRuntime['entities']['exportComponentSnapshot']> | undefined;
    const changed = setup({
      deathPolicy: 'drop',
      afterPrepared(runtime) {
        const components = runtime.entities.actorComponentSnapshot('target');
        const mutation = prepareEntityMutation(runtime.entities, {
          actors: [
            {
              reference: runtime.entities.createReference('target')!,
              health: runtime.entities.get('target')!.health!,
              components: {
                ...components,
                equipment: { ...components.equipment, armor: { ...emptyArmor(), helmet: visor(7) } },
              },
            },
          ],
        });
        mutation.validate();
        mutation.apply();
        concurrentComponents = runtime.entities.exportComponentSnapshot();
      },
    });
    seedOwned(changed.runtime);
    const changedPending = directPending(changed);
    expect(changedPending.resolve()).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(changed.runtime.entities.exportComponentSnapshot()).toEqual(concurrentComponents);
    expect(changed.runtime.simulation.combat.snapshotFor(changed.attackerId).lastResult).toBeNull();
    expect(changed.runtime.entities.query({ type: 'world-item' })).toEqual([]);
    changedPending.dispose();

    let concurrentLifetime: ReturnType<GameplayRuntime['entities']['exportComponentSnapshot']> | undefined;
    const lifetime = setup({
      deathPolicy: 'drop',
      afterPrepared(runtime) {
        runtime.entities.restoreComponentSnapshot(runtime.entities.exportComponentSnapshot());
        concurrentLifetime = runtime.entities.exportComponentSnapshot();
      },
    });
    seedOwned(lifetime.runtime);
    const lifetimePending = directPending(lifetime);
    expect(lifetimePending.resolve()).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(lifetime.runtime.entities.exportComponentSnapshot()).toEqual(concurrentLifetime);
    expect(lifetime.runtime.simulation.combat.snapshotFor(lifetime.attackerId).lastResult).toBeNull();
    expect(lifetime.runtime.entities.query({ type: 'world-item' })).toEqual([]);
    lifetimePending.dispose();
  });

  it('rejects post-prepare effects drift without applying entity or combat changes', () => {
    const fixture = setup({
      deathPolicy: 'drop',
      afterPrepared(runtime) {
        runtime.simulation.recordAttacked('target', 'concurrent-attacker');
      },
    });
    seedOwned(fixture.runtime);
    const pending = directPending(fixture);
    const entitiesBefore = fixture.runtime.entities.exportComponentSnapshot();

    expect(pending.resolve()).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(fixture.runtime.entities.exportComponentSnapshot()).toEqual(entitiesBefore);
    expect(fixture.runtime.simulation.combat.snapshotFor(fixture.attackerId).lastResult).toBeNull();
    expect(fixture.runtime.entities.query({ type: 'world-item' })).toEqual([]);
    pending.dispose();
  });

  it('rejects death drop allocation exhaustion without entity or combat writes', () => {
    const fixture = setup({ deathPolicy: 'drop' });
    seedOwned(fixture.runtime);
    const snapshot = fixture.runtime.createSnapshot();
    snapshot.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    fixture.runtime.restoreSnapshot(snapshot);
    const pending = directPending(fixture);
    const before = entityState(fixture.runtime);

    expect(pending.resolve()).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(entityState(fixture.runtime)).toEqual(before);
    expect(fixture.runtime.entities.query({ type: 'world-item' })).toEqual([]);
    pending.dispose();
  });

  it('keeps a composed lethal candidate detached when it is abandoned after validation', () => {
    const fixture = setup({ targetKind: 'player', deathPolicy: 'drop' });
    seedOwned(fixture.runtime);
    const before = entityState(fixture.runtime);
    const capability = resolveDeathInventoryPolicyCapabilityV1(fixture.composition);
    expect(capability).not.toBeNull();

    const candidate = prepareCombatDamage({
      entities: fixture.runtime.entities,
      targetId: fixture.targetId,
      damage: 5,
      armor: { ...emptyArmor(), chestplate: suit(4) },
      deathInventory: { kind: 'composed', capability },
      actorDeathDrop: () => null,
    });
    candidate.entity!.validate();

    expect(entityState(fixture.runtime)).toEqual(before);
    expect(fixture.runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });
});
