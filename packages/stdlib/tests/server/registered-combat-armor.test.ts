import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import { createGameplayActorAuthority } from '../../src/server/composition/gameplay-actor-authority';
import { createGameplaySystemAuthority } from '../../src/server/composition/gameplay-system-authority';
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
const armor = (itemId: 'sample:visor' | 'sample:suit' | 'sample:greaves' | 'sample:boots', durability: number) => ({
  itemId,
  count: 1,
  instance: { durability },
});

const armorItems = [
  {
    id: 'sample:visor',
    name: 'Visor',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 40 },
    capabilities: [{ type: 'armor' as const, slot: 'helmet' as const, points: 2 }],
  },
  {
    id: 'sample:suit',
    name: 'Suit',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 80 },
    capabilities: [{ type: 'armor' as const, slot: 'chestplate' as const, points: 6 }],
  },
  {
    id: 'sample:greaves',
    name: 'Greaves',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 70 },
    capabilities: [{ type: 'armor' as const, slot: 'leggings' as const, points: 7 }],
  },
  {
    id: 'sample:boots',
    name: 'Boots',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 30 },
    capabilities: [{ type: 'armor' as const, slot: 'boots' as const, points: 8 }],
  },
] as const;

type RuntimeHook = (runtime: GameplayRuntime) => void;
const combatAuthorities = new WeakMap<GameplayRuntime, ReturnType<typeof createGameplayActorAuthority>>();

function setup(
  options: Readonly<{
    authorized?: boolean;
    rejectResolve?: boolean;
    afterPrepared?: RuntimeHook;
    windupSeconds?: number;
  }> = {},
) {
  const content = defineContentModule({
    moduleId: 'sample:combat-armor-content',
    items: armorItems,
    recipes: [],
    meleeDefinitions: [
      {
        id: 'sample:strike',
        range: 4,
        steps: [{ damage: 10, windupSeconds: options.windupSeconds ?? 0, hitSeconds: 0.1, recoverySeconds: 0.1 }],
      },
    ],
    actorProfiles: [
      {
        archetype: 'night-stalker',
        entityType: 'npc',
        maxHealth: 20,
        navigation: { speed: 1, perceptionRange: 8 },
        meleeDefinitionId: 'sample:strike',
      },
    ],
    defaultPlayerMeleeDefinitionId: 'sample:strike',
  });
  const modules = [
    content,
    defineRulesetModule({ id: 'sample:combat-rules', version: '1.0.0' }),
    defineInventoryModule(),
    defineInventoryActionsModule(),
    defineCombatModule(),
    defineCombatRulesModule({
      moduleId: 'sample:combat-armor-rules',
      profile: { damageMultiplier: 1, immuneTargetModes: ['creative'] },
    }),
    ...(options.rejectResolve
      ? [
          {
            descriptor: {
              id: 'sample:reject-resolve',
              version: '1.0.0',
              permissions: [{ resource: 'seedlands.combat', operations: ['execute' as const] }],
            },
            register(api: Parameters<typeof content.register>[0]) {
              api.registerRule({
                id: 'sample:reject-resolve/after',
                operationId: 'seedlands:resolve-combat',
                stage: 'after',
                apply() {
                  return { reject: 'sample-rejected' };
                },
              });
            },
          },
        ]
      : []),
  ];
  const pack = definePack({ id: 'sample:combat-armor', version: '1.0.0', kind: 'playbook', modules });
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
  const holder: { runtime: GameplayRuntime | null } = { runtime: null };
  let hookUsed = false;
  const actorAuthority = createGameplayActorAuthority(composition.resources, { playerAlias: 'fighter' });
  const runtime = new GameplayRuntime({
    composition,
    ...(options.authorized === false
      ? {}
      : {
          moduleActorAuthority: actorAuthority,
          moduleSystemAuthority: createGameplaySystemAuthority(composition),
        }),
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
  combatAuthorities.set(runtime, actorAuthority);
  runtime.spawnPlayer({ id: 'attacker', position: [0, 0, 0] });
  runtime.spawn({ id: 'target', type: 'npc', position: [0, 0, 1], health: 20, maxHealth: 20 });
  return runtime;
}

function bindCombat(runtime: GameplayRuntime) {
  const authority = combatAuthorities.get(runtime)?.forActor('attacker', 'player');
  if (!authority) throw new Error('Combat test authority is unavailable.');
  return runtime.bindModuleOperations(authority.authorizer, {
    moduleId: 'seedlands:combat-module',
    principalId: authority.principalId,
    originalActorId: 'attacker',
  });
}

function equip(
  runtime: GameplayRuntime,
  equipment: Partial<Record<'helmet' | 'chestplate' | 'leggings' | 'boots', ReturnType<typeof armor>>>,
  targetId = 'target',
) {
  runtime.entities.actorStateAccess(targetId).replaceArmor({ ...emptyArmor(), ...equipment });
}

function commitArmor(
  runtime: GameplayRuntime,
  equipment: Partial<Record<'helmet' | 'chestplate' | 'leggings' | 'boots', ReturnType<typeof armor>>>,
) {
  const before = runtime.entities.actorComponentSnapshot('target');
  const mutation = prepareEntityMutation(runtime.entities, {
    actors: [
      {
        reference: runtime.entities.createReference('target')!,
        health: runtime.entities.get('target')!.health!,
        components: {
          ...before,
          equipment: { ...before.equipment, armor: { ...emptyArmor(), ...equipment } },
        },
      },
    ],
  });
  mutation.validate();
  mutation.apply();
}

describe('registered Combat armor transaction', () => {
  it('applies non-Classic armor reduction and durability in the real registered resolve transaction', () => {
    const runtime = setup();
    equip(runtime, { helmet: armor('sample:visor', 3) });
    const before = runtime.getInventoryPointerView('target');
    const healthBefore = runtime.entities.get('target')!.health!;

    const result = runtime.attackEntity('attacker', 'target');
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, damage: 9.2 });
    const healthAfter = runtime.entities.get('target')!.health!;
    expect(healthBefore - healthAfter).toBe(9.2);
    expect(runtime.simulation.combat.snapshotFor('attacker').lastResult).toMatchObject({
      outcome: 'hit',
      damage: healthBefore - healthAfter,
    });
    expect(runtime.getInventoryPointerView('target')).toMatchObject({
      revision: before.revision + 1,
      armor: { helmet: armor('sample:visor', 2) },
    });
    expect(
      runtime.inventoryPointer('target', {
        actor: before.actor,
        expectedInventoryRevision: before.revision,
        command: { kind: 'close' },
      }),
    ).toEqual({ success: false, reason: 'stale-inventory-revision' });
  });

  it('caps protection at twenty points and removes a piece only after it protects this hit', () => {
    const runtime = setup();
    equip(runtime, {
      helmet: armor('sample:visor', 1),
      chestplate: armor('sample:suit', 9),
      leggings: armor('sample:greaves', 7),
      boots: armor('sample:boots', 5),
    });

    expect(runtime.attackEntity('attacker', 'target')).toMatchObject({ success: true, damage: 2 });
    expect(runtime.entities.get('target')?.health).toBe(18);
    expect(runtime.getInventoryPointerView('target').armor).toEqual({
      helmet: null,
      chestplate: armor('sample:suit', 8),
      leggings: armor('sample:greaves', 6),
      boots: armor('sample:boots', 4),
    });
  });

  it('returns registered resolve damage equal to its committed result and health delta', () => {
    const runtime = setup();
    equip(runtime, { helmet: armor('sample:visor', 3) });
    const healthBefore = runtime.entities.get('target')!.health!;
    const execution = bindCombat(runtime);
    try {
      expect(
        execution.invoke({
          operationId: 'seedlands:request-combat',
          target: { kind: 'entity', entityId: 'target' },
          input: { targetId: 'target' },
        }),
      ).toMatchObject({ ok: true });
      const pending = runtime.simulation.combat.peekPendingHits();
      expect(pending).toHaveLength(1);
      const result = execution.invoke({
        operationId: 'seedlands:resolve-combat',
        target: { kind: 'entity', entityId: 'target' },
        input: { token: pending[0]!.token },
      });
      const healthDelta = healthBefore - runtime.entities.get('target')!.health!;
      expect(result).toMatchObject({ ok: true, value: { success: true, outcome: 'hit', damage: healthDelta } });
      expect(runtime.simulation.combat.snapshotFor('attacker').lastResult?.damage).toBe(healthDelta);
    } finally {
      execution.dispose();
    }
  });

  it('applies the same registered armor transaction when an NPC hits a player', () => {
    const runtime = setup();
    runtime.spawnAutonomous(
      { id: 'npc-attacker', type: 'npc', archetype: 'night-stalker', position: [2, 0, 0] },
      { archetype: 'night-stalker' },
    );
    runtime.spawnPlayer({ id: 'player-target', position: [2, 0, 1] });
    equip(runtime, { helmet: armor('sample:visor', 3) }, 'player-target');
    const before = runtime.getInventoryPointerView('player-target');

    expect(runtime.simulation.requestActorCombat('npc-attacker', 'player-target', 'sample:strike')).toMatchObject({
      success: true,
      damage: 9.2,
    });
    expect(runtime.entities.get('player-target')?.health).toBe(10.8);
    expect(runtime.getInventoryPointerView('player-target')).toMatchObject({
      revision: before.revision + 1,
      armor: { helmet: armor('sample:visor', 2) },
    });
  });

  it('preserves unarmored damage and does not consume armor for creative immunity or a miss', () => {
    const unarmored = setup();
    const unarmoredRevision = unarmored.getInventoryPointerView('target').revision;
    expect(unarmored.attackEntity('attacker', 'target')).toMatchObject({ success: true, damage: 10 });
    expect(unarmored.entities.get('target')?.health).toBe(10);
    expect(unarmored.getInventoryPointerView('target').revision).toBe(unarmoredRevision);

    const creative = setup();
    equip(creative, { helmet: armor('sample:visor', 3) });
    const mode = creative.entities.actorStateAccess('target');
    const components = creative.entities.actorComponentSnapshot('target');
    mode.replaceModeComponents({
      mode: { ...components.mode!, value: 'creative', revision: mode.modeRevision + 1 },
      creativeCatalog: components.creativeCatalog!,
      flight: components.flight!,
    });
    const creativeHealth = creative.entities.get('target')!.health;
    const creativeRevision = mode.inventoryRevision;
    expect(creative.attackEntity('attacker', 'target')).toMatchObject({ success: true, damage: 0 });
    expect(creative.entities.get('target')?.health).toBe(creativeHealth);
    expect(creative.entities.actorStateAccess('target').armor.helmet).toEqual(armor('sample:visor', 3));
    expect(creative.entities.actorStateAccess('target').inventoryRevision).toBe(creativeRevision);

    const missed = setup({ windupSeconds: 0.2 });
    equip(missed, { helmet: armor('sample:visor', 3) });
    expect(missed.attackEntity('attacker', 'target')).toMatchObject({ success: true });
    missed.updateEntityWithoutSnapshot('target', { position: [10, 0, 0] });
    const missedBefore = missed.createSnapshot();
    missed.advanceRules(0.2);
    expect(missed.entities.exportComponentSnapshot()).toEqual(missedBefore.entityStore);
    expect(missed.simulation.combat.snapshotFor('attacker').lastResult).toMatchObject({
      outcome: 'miss',
      damage: 0,
      reason: 'out-of-range',
    });
    expect(missed.entities.actorStateAccess('target').armor.helmet).toEqual(armor('sample:visor', 3));
  });

  it('does not consume armor for invalid targets, missing authority, or rejected resolve', () => {
    const invalid = setup();
    equip(invalid, { helmet: armor('sample:visor', 3) });
    const invalidBefore = invalid.createSnapshot();
    expect(invalid.attackEntity('attacker', 'missing').success).toBe(false);
    expect(invalid.createSnapshot()).toEqual(invalidBefore);

    const unauthorized = setup({ authorized: false });
    equip(unauthorized, { helmet: armor('sample:visor', 3) });
    const unauthorizedBefore = unauthorized.createSnapshot();
    expect(unauthorized.attackEntity('attacker', 'target')).toEqual({
      success: false,
      reason: 'combat-authority-missing',
    });
    expect(unauthorized.createSnapshot()).toEqual(unauthorizedBefore);

    const rejected = setup({ rejectResolve: true });
    equip(rejected, { helmet: armor('sample:visor', 3) });
    const rejectedBefore = rejected.entities.exportComponentSnapshot();
    expect(rejected.attackEntity('attacker', 'target').success).toBe(true);
    expect(rejected.entities.exportComponentSnapshot()).toEqual(rejectedBefore);
    expect(rejected.simulation.combat.snapshotFor('attacker').lastResult).toMatchObject({
      outcome: 'cancelled',
      damage: 0,
    });
  });

  it('rejects armor or lifetime changes after prepare without committing health or armor', () => {
    let concurrentArmor: ReturnType<GameplayRuntime['entities']['exportComponentSnapshot']> | undefined;
    const armorStale = setup({
      afterPrepared(runtime) {
        commitArmor(runtime, { helmet: armor('sample:visor', 7) });
        concurrentArmor = runtime.entities.exportComponentSnapshot();
      },
    });
    equip(armorStale, { helmet: armor('sample:visor', 3) });
    expect(() => armorStale.attackEntity('attacker', 'target')).toThrow(/actor component state has changed/i);
    expect(armorStale.entities.exportComponentSnapshot()).toEqual(concurrentArmor);
    expect(armorStale.simulation.combat.snapshotFor('attacker').lastResult).toBeNull();

    let concurrentLifetime: ReturnType<GameplayRuntime['entities']['exportComponentSnapshot']> | undefined;
    const lifetimeStale = setup({
      afterPrepared(runtime) {
        runtime.entities.restoreComponentSnapshot(runtime.entities.exportComponentSnapshot());
        concurrentLifetime = runtime.entities.exportComponentSnapshot();
      },
    });
    equip(lifetimeStale, { helmet: armor('sample:visor', 3) });
    expect(() => lifetimeStale.attackEntity('attacker', 'target')).toThrow(/observation is stale/i);
    expect(lifetimeStale.entities.exportComponentSnapshot()).toEqual(concurrentLifetime);
    expect(lifetimeStale.simulation.combat.snapshotFor('attacker').lastResult).toBeNull();
  });

  it('leaves an abandoned candidate untouched and rejects a stale target lifetime', () => {
    const abandoned = setup();
    equip(abandoned, { helmet: armor('sample:visor', 3) });
    const abandonedBefore = abandoned.entities.exportComponentSnapshot();
    const candidate = prepareCombatDamage({
      entities: abandoned.entities,
      targetId: 'target',
      damage: 9.2,
      armor: { ...emptyArmor(), helmet: armor('sample:visor', 2) },
      actorDeathDrop: () => null,
    });
    candidate.entity!.validate();
    expect(abandoned.entities.exportComponentSnapshot()).toEqual(abandonedBefore);

    const lifetime = setup();
    equip(lifetime, { helmet: armor('sample:visor', 3) });
    const stale = prepareCombatDamage({
      entities: lifetime.entities,
      targetId: 'target',
      damage: 9.2,
      armor: { ...emptyArmor(), helmet: armor('sample:visor', 2) },
      actorDeathDrop: () => null,
    });
    lifetime.entities.restoreComponentSnapshot(lifetime.entities.exportComponentSnapshot());
    const lifetimeBefore = lifetime.entities.exportComponentSnapshot();
    expect(() => stale.entity!.validate()).toThrow(/owner, epoch or sequence is stale/i);
    expect(lifetime.entities.exportComponentSnapshot()).toEqual(lifetimeBefore);
  });
});
