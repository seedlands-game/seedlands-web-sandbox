import { describe, expect, it } from 'vitest';
import { prepareCombatEffects } from '../../packages/game-core/src/server/simulation/prepared-combat-effects';
import { ActionRuntime } from '../../packages/game-core/src/server/simulation/action-runtime';
import { CombatRuntime } from '../../packages/game-core/src/server/gameplay/combat-runtime';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import { PoiRegistry } from '../../packages/game-core/src/server/simulation/poi-registry';
import { PerceptionRuntime } from '../../packages/game-core/src/server/simulation/perception-runtime';
import type { ActorState } from '../../packages/game-core/src/server/simulation/actor-state';

function setup() {
  const entities = new EntityStore();
  entities.spawn({ id: 'wolf', type: 'creature', archetype: 'night-stalker', position: [0, 0, 0] });
  const actions = new ActionRuntime(structuredClone);
  const action = actions.start({ actorId: 'wolf', type: 'attack', targetEntityId: 'alice' }, 0);
  const combat = new CombatRuntime({
    actorAvailable: () => true,
    targetAvailable: () => true,
    validateHit: () => null,
    applyDamage: () => {
      throw new Error('unexpected damage');
    },
  });
  combat.request('wolf', 'alice', 'wood-sword', () => action.id);
  const actors = new Map<string, ActorState>([
    [
      'wolf',
      {
        entityId: 'wolf',
        archetype: 'night-stalker',
        hunger: 0,
        behavior: 'attack',
        targetEntityId: 'alice',
        homePoiId: null,
        workPoiId: null,
        foodPoiId: null,
        active: true,
        wanderIndex: 0,
      },
    ],
  ]);
  const perception = new PerceptionRuntime({
    entities,
    pois: new PoiRegistry(),
    getVoxel: () => 0,
    isPlayerAlive: () => true,
  });
  const combatPlan = combat.prepareMutation({ cancelActorIds: ['wolf'] });
  const effects = prepareCombatEffects({
    combat,
    combatPlan,
    actions,
    actors,
    perception,
    now: 0,
    deaths: ['wolf'],
    removals: ['wolf'],
  });
  return { entities, actions, combat, actors, perception, combatPlan, effects };
}
describe('prepared Combat lifecycle and autonomy effects', () => {
  it('prepares effects without a second Combat mutation and installs only after the shared plan', () => {
    const world = setup();
    expect(world.actions.forActor('wolf')?.status).toBe('pending');
    expect(world.combat.snapshotFor('wolf').active).not.toBeNull();
    expect(world.actors.has('wolf')).toBe(true);
    world.combatPlan.validate();
    world.effects.validate();
    world.combatPlan.apply();
    world.entities.despawn('wolf');
    world.effects.apply();
    expect(world.actions.forActor('wolf')).toBeNull();
    expect(world.actions.get('action-1')?.status).toBe('interrupted');
    expect(world.actors.has('wolf')).toBe(false);
    expect(world.combat.peekLifecycleEvents()).toEqual([]);
    expect(world.effects.interrupted).toBe(1);
  });
  it('rejects a removal identity that appeared after preparation', () => {
    const world = setup();
    const actor = world.actors.get('wolf')!;
    world.actors.delete('wolf');
    const effects = prepareCombatEffects({ ...world, now: 0, deaths: ['wolf'], removals: ['wolf'] });
    world.actors.set('wolf', actor);
    expect(() => effects.validate()).toThrow(/stale/);
  });
  it('does not report completion when the same prepared effects interrupt the dead actor', () => {
    const world = setup();
    const combatPlan = {
      ...world.combatPlan,
      lifecycleEvents: [{ actorId: 'wolf', actionId: 'action-1', status: 'completed' as const, result: null }],
    };
    const effects = prepareCombatEffects({ ...world, combatPlan, now: 0, deaths: ['wolf'] });
    expect(effects.completed).toBe(0);
    effects.validate();
    world.combatPlan.apply();
    effects.apply();
    expect(world.perception.observe('wolf', 10).observations).not.toContainEqual({
      type: 'action-completed',
      subjectId: 'action-1',
    });
  });
  it('rejects changed autonomy identity before either shared plan is installed', () => {
    const world = setup();
    world.actors.set('wolf', { ...world.actors.get('wolf')!, behavior: 'idle' });
    expect(() => world.effects.validate()).toThrow(/stale/);
    expect(world.actions.forActor('wolf')?.status).toBe('pending');
    expect(world.combat.snapshotFor('wolf').active).not.toBeNull();
  });
  it('prepares mode interruption of a non-Combat Action without changing it before apply', () => {
    const world = setup();
    world.actions.start({ actorId: 'builder', type: 'idle' }, 0);
    const effects = prepareCombatEffects({
      ...world,
      now: 1,
      interruptions: [{ actorId: 'builder', reason: 'mode-changed' }],
    });
    expect(world.actions.forActor('builder')?.status).toBe('pending');
    effects.validate();
    world.combatPlan.apply();
    effects.apply();
    expect(world.actions.forActor('builder')).toBeNull();
    expect(world.actions.get('action-2')).toMatchObject({ status: 'interrupted', reason: 'mode-changed' });
  });
});
