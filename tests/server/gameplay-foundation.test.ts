import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../support/core-platform';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import {
  ItemIds,
  createItemDefinitionRegistry,
  getItemCapability,
  getItemDefinition,
  listItemDefinitions,
} from '../../packages/game-core/src/server/gameplay/item-registry';
import { createRecipeRegistry, getRecipe } from '../../packages/game-core/src/server/gameplay/recipe-registry';
import {
  CombatRuntime,
  createMeleeDefinitionRegistry,
  listMeleeDefinitions,
  type MeleeDefinition,
} from '../../packages/game-core/src/server/gameplay/combat-runtime';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { Voxel } from '../../packages/game-core/src/world/voxel';

const openWorld = (meleeDefinitions?: readonly MeleeDefinition[]) => {
  const cells = new Map<string, number>();
  const runtime = new GameplayRuntime({
    getVoxel: ([x, y, z]) => cells.get(`${x},${y},${z}`) ?? Voxel.Air,
    editVoxel: () => {
      throw new Error('unexpected edit');
    },
    getWorldTime: () => 9,
    platform: testCorePlatform,
    ...(meleeDefinitions ? { meleeDefinitions } : {}),
  });
  runtime.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
  const target = runtime.spawn({
    id: 'target',
    type: 'creature',
    archetype: 'grazer',
    position: [2.5, 1, 0.5],
    health: 20,
    maxHealth: 20,
  });
  return { runtime, target, cells };
};

describe('gameplay foundation item contract', () => {
  it('migrates every item to deeply frozen typed capabilities and adds the wood sword recipe', () => {
    const definitions = listItemDefinitions();
    expect(definitions).toHaveLength(11);
    expect(new Set(definitions.map((definition) => definition.id)).size).toBe(definitions.length);
    for (const definition of definitions) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.capabilities)).toBe(true);
      for (const capability of definition.capabilities) expect(Object.isFrozen(capability)).toBe(true);
    }

    expect(getItemCapability(ItemIds.StoneBlock, 'place')).toEqual({ type: 'place', voxel: Voxel.Stone });
    expect(getItemCapability(ItemIds.Berry, 'consume')).toEqual({ type: 'consume', hungerRestore: 4 });
    expect(getItemCapability(ItemIds.WoodAxe, 'mine')).toEqual({ type: 'mine', tool: 'axe', multiplier: 3 });
    expect(getItemCapability(ItemIds.WoodSword, 'melee')).toEqual({
      type: 'melee',
      definitionId: 'wood-sword',
    });
    expect(getItemDefinition(ItemIds.WoodAxe).itemType).toBe(getItemDefinition(ItemIds.WoodSword).itemType);
    expect(getItemDefinition(ItemIds.WoodAxe).capabilities).not.toEqual(
      getItemDefinition(ItemIds.WoodSword).capabilities,
    );
    expect(getItemDefinition(ItemIds.WoodSword)).toMatchObject({ itemType: 'tool', stackLimit: 1 });
    expect(getRecipe('wood-sword')).toEqual({
      id: 'wood-sword',
      inputs: [{ itemId: ItemIds.Plank, count: 2 }],
      outputs: [{ itemId: ItemIds.WoodSword, count: 1 }],
    });

    const woodSword = {
      id: ItemIds.WoodSword,
      name: '木剑',
      itemType: 'tool' as const,
      stackLimit: 1,
      capabilities: [{ type: 'melee' as const, definitionId: 'wood-sword' }],
    };
    expect(() => createItemDefinitionRegistry([woodSword, woodSword], () => true)).toThrow(/duplicate/i);
    expect(() => createItemDefinitionRegistry([woodSword], () => false)).toThrow(/unknown melee definition/i);
    const slowSword = createItemDefinitionRegistry(
      [{ ...woodSword, capabilities: [{ type: 'melee', definitionId: 'slow' }] }],
      (id) => id === 'slow',
    );
    const fastSword = createItemDefinitionRegistry(
      [{ ...woodSword, capabilities: [{ type: 'melee', definitionId: 'fast' }] }],
      (id) => id === 'fast',
    );
    expect(slowSword.get(ItemIds.WoodSword)).toMatchObject({ name: '木剑', itemType: 'tool' });
    expect(fastSword.get(ItemIds.WoodSword)).toMatchObject({ name: '木剑', itemType: 'tool' });
    expect(slowSword.get(ItemIds.WoodSword)?.capabilities).not.toEqual(fastSword.get(ItemIds.WoodSword)?.capabilities);
    expect(() => createRecipeRegistry([getRecipe('wood-sword'), getRecipe('wood-sword')])).toThrow(/duplicate/i);
    expect(Object.isFrozen(getRecipe('wood-sword').inputs)).toBe(true);
  });

  it('validates injectable melee definitions and executes different timings through one runtime', () => {
    const slow = {
      id: 'slow',
      range: 2,
      steps: [{ damage: 9, windupSeconds: 0.5, hitSeconds: 0.1, recoverySeconds: 0.2 }],
    };
    const fast = {
      id: 'fast',
      range: 2,
      steps: [{ damage: 2, windupSeconds: 0.1, hitSeconds: 0.1, recoverySeconds: 0.2 }],
    };
    expect(() => createMeleeDefinitionRegistry([slow, slow])).toThrow(/duplicate/i);
    expect(() => createMeleeDefinitionRegistry([{ ...fast, steps: [{ ...fast.steps[0], hitSeconds: 0 }] }])).toThrow(
      /step/i,
    );
    expect(() => createMeleeDefinitionRegistry([{ ...fast, steps: Array(9).fill(fast.steps[0]) }])).toThrow(
      /definition/i,
    );
    const registry = createMeleeDefinitionRegistry([slow, fast]);
    const hits: Array<{ actorId: string; damage: number }> = [];
    const combat = new CombatRuntime(
      {
        actorAvailable: () => true,
        targetAvailable: () => true,
        validateHit: () => null,
        applyDamage: (actorId, _targetId, damage) => {
          hits.push({ actorId, damage });
          return damage;
        },
      },
      registry,
    );
    combat.request('slow-actor', 'target', 'slow');
    combat.request('fast-actor', 'target', 'fast');
    combat.advance(0.11);
    expect(hits).toEqual([{ actorId: 'fast-actor', damage: 2 }]);
    combat.advance(0.4);
    expect(hits).toEqual([
      { actorId: 'fast-actor', damage: 2 },
      { actorId: 'slow-actor', damage: 9 },
    ]);
    expect(Object.isFrozen(registry.get('slow')?.steps)).toBe(true);
  });
});

describe('authoritative melee runtime', () => {
  it('retains hit results after a coalesced advance has left the visible phase', () => {
    const { runtime } = openWorld();
    runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    runtime.attackEntity('player', 'target');
    runtime.advanceRules(0.3);
    const first = runtime.getPlayerState('player').combat;
    expect(first?.active?.phase).toBe('recovery');
    expect(first?.lastResult).toMatchObject({ comboStep: 0, outcome: 'hit', damage: 5 });
    expect(runtime.getEntity('target')).toMatchObject({ health: 15 });

    expect(runtime.attackEntity('player', 'target')).toMatchObject({ success: true, buffered: true });
    runtime.advanceRules(1);
    const second = runtime.getPlayerState('player').combat;
    expect(second?.active).toBeNull();
    expect(second?.lastResult).toMatchObject({ comboStep: 1, outcome: 'hit', damage: 7 });
    expect(second!.lastResult!.sequence).toBeGreaterThan(first!.lastResult!.sequence);
    expect(runtime.getEntity('target')).toMatchObject({ health: 8 });
  });

  it('runs wood sword windup, one hit and a buffered second combo step', () => {
    const { runtime } = openWorld();
    runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });

    expect(runtime.attackEntity('player', 'target')).toMatchObject({ success: true, buffered: false });
    expect(runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(runtime.getPlayerState('player').combat?.active).toMatchObject({
      definitionId: 'wood-sword',
      comboStep: 0,
      phase: 'windup',
      comboLength: 2,
      canBuffer: false,
    });

    runtime.advanceRules(0.17);
    expect(runtime.getEntity('target')).toMatchObject({ health: 20 });
    runtime.advanceRules(0.02);
    const first = runtime.getPlayerState('player').combat;
    expect(runtime.getEntity('target')).toMatchObject({ health: 15 });
    expect(first?.lastResult).toMatchObject({ comboStep: 0, outcome: 'hit', damage: 5 });

    expect(runtime.attackEntity('player', 'target')).toMatchObject({ success: true, buffered: true });
    expect(runtime.attackEntity('player', 'target')).toMatchObject({ success: false, reason: 'buffer-full' });
    runtime.advanceRules(0.4);
    expect(runtime.getPlayerState('player').combat?.active).toMatchObject({ comboStep: 1, phase: 'windup' });
    runtime.advanceRules(0.2);
    expect(runtime.getEntity('target')).toMatchObject({ health: 8 });
    const second = runtime.getPlayerState('player').combat?.lastResult;
    expect(second).toMatchObject({ comboStep: 1, outcome: 'hit', damage: 7 });
    expect(second!.sequence).toBeGreaterThan(first!.lastResult!.sequence);
  });

  it('rechecks range, occlusion and target existence at the hit boundary', () => {
    const moved = openWorld();
    moved.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    moved.runtime.attackEntity('player', 'target');
    moved.runtime.updateEntity('target', { position: [20, 1, 0.5] });
    moved.runtime.advanceRules(0.2);
    expect(moved.runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(moved.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'miss',
      reason: 'out-of-range',
      damage: 0,
    });

    const blocked = openWorld();
    blocked.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    blocked.runtime.attackEntity('player', 'target');
    blocked.cells.set('1,1,0', Voxel.Stone);
    blocked.cells.set('1,2,0', Voxel.Stone);
    blocked.runtime.advanceRules(0.2);
    expect(blocked.runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(blocked.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'miss',
      reason: 'blocked',
    });

    const missing = openWorld();
    missing.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    missing.runtime.attackEntity('player', 'target');
    missing.runtime.despawnEntity('target');
    missing.runtime.advanceRules(0.2);
    expect(missing.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'target-missing',
    });
  });

  it('cancels on slot changes and death, and never restores in-flight damage', () => {
    const slot = openWorld();
    slot.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    slot.runtime.attackEntity('player', 'target');
    slot.runtime.selectHotbarSlot('player', 1);
    slot.runtime.advanceRules(1);
    expect(slot.runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(slot.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'slot-changed',
    });

    const death = openWorld();
    death.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    death.runtime.attackEntity('player', 'target');
    death.runtime.applyDamage('fixture', 'player', 20, 'test');
    death.runtime.advanceRules(1);
    expect(death.runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(death.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'attacker-dead',
    });

    const source = openWorld();
    source.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    source.runtime.attackEntity('player', 'target');
    const restored = new GameplayRuntime({
      getVoxel: () => Voxel.Air,
      editVoxel: () => {
        throw new Error('unexpected edit');
      },
      getWorldTime: () => 9,
      platform: testCorePlatform,
    });
    restored.restoreSnapshot(source.runtime.createSnapshot());
    expect(restored.getEntity('target')).toMatchObject({ health: 20 });
    expect(restored.getPlayerState('player').combat?.active).toBeNull();
    expect(restored.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'restore-cancelled',
    });
    const lockout = restored.getPlayerState('player').combat?.cooldownRemainingSeconds ?? 0;
    expect(lockout).toBeGreaterThan(0);
    expect(restored.attackEntity('player', 'target')).toMatchObject({ success: false, reason: 'cooldown' });
    restored.advanceRules(lockout);
    expect(restored.attackEntity('player', 'target')).toMatchObject({ success: true });
  });

  it('cancels when moving or dropping the selected item during windup', () => {
    const moved = openWorld();
    moved.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    moved.runtime.attackEntity('player', 'target');
    expect(moved.runtime.moveInventorySlot('player', 0, 1)).toEqual({ success: true });
    moved.runtime.advanceRules(1);
    expect(moved.runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(moved.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'slot-changed',
    });

    const dropped = openWorld();
    dropped.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    dropped.runtime.attackEntity('player', 'target');
    expect(dropped.runtime.dropItem('player', 0, 1)).toMatchObject({ success: true });
    dropped.runtime.advanceRules(1);
    expect(dropped.runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(dropped.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'slot-changed',
    });
  });

  it('preserves the full buffered combo lockout on restore without replaying its damage', () => {
    const source = openWorld();
    source.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    expect(source.runtime.attackEntity('player', 'target')).toMatchObject({ success: true, buffered: false });
    source.runtime.advanceRules(0.18);
    expect(source.runtime.getEntity('target')).toMatchObject({ health: 15 });
    expect(source.runtime.attackEntity('player', 'target')).toMatchObject({ success: true, buffered: true });
    expect(source.runtime.getPlayerState('player').combat?.cooldownRemainingSeconds).toBeCloseTo(0.92);

    const restored = openWorld().runtime;
    restored.restoreSnapshot(source.runtime.createSnapshot());
    expect(restored.getEntity('target')).toMatchObject({ health: 15 });
    expect(restored.getPlayerState('player').combat).toMatchObject({
      active: null,
      cooldownRemainingSeconds: 0.92,
      lastResult: { outcome: 'cancelled', reason: 'restore-cancelled' },
    });
    restored.advanceRules(0.32);
    expect(restored.getEntity('target')).toMatchObject({ health: 15 });
    expect(restored.attackEntity('player', 'target')).toMatchObject({ success: false, reason: 'cooldown' });
    restored.advanceRules(0.6);
    expect(restored.getEntity('target')).toMatchObject({ health: 15 });
    expect(restored.attackEntity('player', 'target')).toMatchObject({ success: true });
  });

  it('validates and restores active combat with the injected melee definitions', () => {
    const definitions = listMeleeDefinitions().map((definition) =>
      definition.id === 'wood-sword'
        ? {
            ...definition,
            steps: [{ damage: 6, windupSeconds: 0.8, hitSeconds: 0.1, recoverySeconds: 0.2 }],
          }
        : definition,
    );
    const source = openWorld(definitions);
    source.runtime.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    expect(source.runtime.attackEntity('player', 'target')).toMatchObject({ success: true });
    source.runtime.advanceRules(0.3);
    expect(source.runtime.getPlayerState('player').combat?.active).toMatchObject({
      phase: 'windup',
      phaseElapsedSeconds: 0.3,
      phaseDurationSeconds: 0.8,
    });

    const restored = openWorld(definitions);
    expect(restored.runtime.restoreSnapshot(source.runtime.createSnapshot())).toMatchObject({ version: 3 });
    expect(restored.runtime.getEntity('target')).toMatchObject({ health: 20 });
    expect(restored.runtime.getPlayerState('player').combat).toMatchObject({
      active: null,
      cooldownRemainingSeconds: 0.8,
      lastResult: { outcome: 'cancelled', reason: 'restore-cancelled' },
    });
  });

  it('keeps unarmed immediate compatibility and runs NPC attacks through the same staged owner', () => {
    const unarmed = openWorld();
    expect(unarmed.runtime.attackEntity('player', 'target')).toMatchObject({ success: true, buffered: false });
    expect(unarmed.runtime.getEntity('target')).toMatchObject({ health: 16 });
    expect(unarmed.runtime.attackEntity('player', 'target')).toMatchObject({ success: false, reason: 'cooldown' });
    unarmed.runtime.advanceRules(1);
    expect(unarmed.runtime.getEntity('target')).toMatchObject({ health: 16 });
    expect(unarmed.runtime.getPlayerState('player').combat?.lastResult).toMatchObject({
      definitionId: 'unarmed',
      outcome: 'hit',
    });

    const server = new GameServer({ platform: testCorePlatform, seedText: 'shared-melee-owner' });
    server.spawnPlayer({ id: 'player', position: [2.5, 1, 0.5] });
    server.spawnAutonomousActor({ id: 'hostile', archetype: 'night-stalker', position: [0.9, 1, 0.5] });
    for (let x = 0; x <= 2; x += 1) {
      server.edit(x, 1, 0, Voxel.Air, 'fixture');
      server.edit(x, 2, 0, Voxel.Air, 'fixture');
    }
    expect(server.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: true,
    });
    expect(server.getPlayerState('player').health).toBe(20);
    expect(server.getCombatState('hostile').active).toMatchObject({
      definitionId: 'night-stalker-claw',
      phase: 'windup',
    });
    server.advanceGameplayRules(0.35);
    expect(server.getPlayerState('player').health).toBe(18);
    expect(server.getCombatState('hostile').lastResult).toMatchObject({ outcome: 'hit', damage: 2 });
  });

  it('migrates a legacy player cooldown into the combat owner', () => {
    const source = openWorld().runtime.createSnapshot();
    delete source.simulation.combat;
    source.players[0].attackCooldownSeconds = 0.3;
    const restored = openWorld().runtime;

    expect(restored.restoreSnapshot(source)).toMatchObject({ version: 3 });
    expect(restored.getPlayerState('player').combat).toMatchObject({
      active: null,
      cooldownRemainingSeconds: 0.3,
    });
    expect(restored.attackEntity('player', 'target')).toMatchObject({ success: false, reason: 'cooldown' });
    restored.advanceRules(0.3);
    expect(restored.attackEntity('player', 'target')).toMatchObject({ success: true });
  });

  it('rejects a snapshot whose autonomous combat action id no longer matches its running action', () => {
    const source = openWorld().runtime;
    source.spawnAutonomous(
      {
        id: 'hostile',
        type: 'creature',
        archetype: 'night-stalker',
        position: [1.5, 1, 0.5],
        health: 12,
        maxHealth: 12,
      },
      { archetype: 'night-stalker' },
    );
    expect(source.simulation.requestActorCombat('hostile', 'player', 'night-stalker-claw')).toMatchObject({
      success: true,
      actionId: 'action-1',
    });
    const malformed = source.createSnapshot();
    const combatant = malformed.simulation.combat?.combatants.find((entry) => entry.actorId === 'hostile');
    if (!combatant?.combat.active) throw new Error('Expected active hostile combat snapshot.');
    const mutableActive = combatant.combat.active as { actionId: string };
    mutableActive.actionId = 'forged-action';

    const restored = openWorld().runtime;
    expect(() => restored.restoreSnapshot(malformed)).toThrow(/combat action/i);
    expect(restored.simulation.snapshot().actions.actions).toEqual([]);
  });
});
