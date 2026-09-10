import { expect, it } from 'vitest';
import { AutonomyRuntime } from '../../packages/game-core/src/server/simulation/autonomy-runtime';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import { prepareFeedingEffects } from '../../packages/game-core/src/server/simulation/prepared-feeding-effects';
import { testCorePlatform } from '../support/core-platform';

function setup() {
  const entities = new EntityStore();
  entities.spawn({ id: 'grazer', type: 'creature', archetype: 'grazer', position: [0, 1, 0] });
  entities.spawn({ id: 'food', type: 'world-item', position: [1, 1, 0], stack: { itemId: 'berry', count: 2 } });
  entities.spawn({ id: 'player', type: 'player', position: [0, 1, 1] });
  const simulation = new AutonomyRuntime({
    entities,
    getVoxel: () => 0,
    getWorldTime: () => 9,
    isPlayerAlive: () => true,
    clone: testCorePlatform.clone,
    combat: {
      actorAvailable: () => true,
      targetAvailable: () => true,
      validateHit: () => null,
      applyDamage: () => {
        throw new Error('Unexpected hit');
      },
    },
  });
  simulation.registerActor('grazer', { archetype: 'grazer', hunger: 60 });
  return { entities, simulation };
}

it('prepares an instant Eat completion and cancels existing Combat through one Action owner', () => {
  const { simulation } = setup();
  simulation.requestActorCombat('grazer', 'player', 'wood-sword');
  const previous = simulation.actionForActor('grazer')!;
  const before = simulation.snapshot();
  const plan = prepareFeedingEffects(simulation, 'grazer', 'food');
  expect(simulation.snapshot()).toEqual(before);
  plan.validate();
  plan.apply();
  expect(simulation.actionForActor('grazer')).toBeNull();
  expect(simulation.actionById(previous.id)).toMatchObject({ status: 'interrupted', reason: 'replaced' });
  expect(simulation.actionById(plan.action.id)).toMatchObject({
    type: 'eat',
    status: 'succeeded',
    result: { consumedEntityId: 'food', count: 1 },
  });
  expect(simulation.combat.snapshotFor('grazer').active).toBeNull();
  expect(simulation.combat.peekLifecycleEvents()).toEqual([]);
  expect(simulation.getActor('grazer')).toMatchObject({ behavior: 'idle', targetEntityId: null, hunger: 60 });
  expect(() => plan.apply()).toThrow(/used/i);
});

it('settles an existing Eat only once and rejects changed targets before preparation', () => {
  const { simulation } = setup();
  const pending = simulation.startAction('grazer', { type: 'eat', targetEntityId: 'food' });
  expect(() => prepareFeedingEffects(simulation, 'grazer', 'player', pending.id)).toThrow(/mismatch/);
  const plan = prepareFeedingEffects(simulation, 'grazer', 'food', pending.id);
  plan.validate();
  plan.apply();
  expect(plan.action.id).toBe(pending.id);
  expect(simulation.actionById(pending.id)).toMatchObject({ status: 'succeeded' });
  expect(() => prepareFeedingEffects(simulation, 'grazer', 'food', pending.id)).toThrow(/mismatch/);
});
