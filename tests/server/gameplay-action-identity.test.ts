import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { applyActorAuthorityAction } from '../../packages/game-core/src/server/gameplay/actor-authority-gameplay';
import { testCorePlatform } from '../support/core-platform';

const createRuntime = () => {
  const runtime = new GameplayRuntime({
    platform: testCorePlatform,
    getVoxel: () => 0,
    editVoxel: () => {
      throw new Error('Unexpected edit');
    },
    getWorldTime: () => 9,
  });
  runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
  runtime.spawnAutonomous(
    { id: 'actor', type: 'creature', archetype: 'grazer', position: [1, 1, 0] },
    { archetype: 'grazer' },
  );
  return runtime;
};

describe('gameplay host action identity binding', () => {
  it('writes bound action and combat codecs from the actual gameplay host', () => {
    const runtime = createRuntime();
    runtime.simulation.startAction('actor', { type: 'move-to', targetPosition: [4, 1, 0] });
    expect(runtime.simulation.actions.snapshot().version).toBe(2);
    expect(runtime.simulation.combat.snapshot().version).toBe(2);
  });

  it('invalidates a queued action when its actor is removed through the entity owner', () => {
    const runtime = createRuntime();
    const action = runtime.simulation.startAction('actor', { type: 'move-to', targetPosition: [4, 1, 0] });
    runtime.entities.despawn('actor');
    expect(() =>
      runtime.simulation.actions.markRunning(action.id, [
        [1, 1, 0],
        [4, 1, 0],
      ]),
    ).toThrow();
    expect(runtime.simulation.actions.get(action.id)?.status).not.toBe('running');
  });
  it('completes consuming the last food unit after the effect removes its target', () => {
    const runtime = createRuntime();
    runtime.entities.actorStateAccess('actor').hunger = 80;
    const food = runtime.spawnWorldItem([1.25, 1, 0], { itemId: 'berry', count: 1 });
    const result = applyActorAuthorityAction(
      {
        entities: runtime.entities,
        simulation: runtime.simulation,
        getVoxel: () => 0,
        isPlayerAlive: () => true,
        touch: () => {},
      },
      'actor',
      { type: 'consume-world-item', targetId: food.id },
    );
    expect(result).toMatchObject({ accepted: true, action: { status: 'succeeded' } });
    expect(runtime.entities.get(food.id)).toBeNull();
    expect(runtime.simulation.getActor('actor')?.hunger).toBe(0);
  });
});
