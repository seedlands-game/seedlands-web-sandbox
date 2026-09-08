import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { ActionRuntime } from '../../packages/game-core/src/server/simulation/action-runtime';

describe('asynchronous actor actions', () => {
  it('moves through pending, running and succeeded states using stable ids', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const accepted = actions.start({ actorId: 'actor-1', type: 'move-to', targetPosition: [4.5, 1, 0.5] }, 10);
    expect(accepted).toMatchObject({ id: 'action-1', status: 'pending', startedAt: 10 });
    actions.markRunning(accepted.id, [
      [0.5, 1, 0.5],
      [1.5, 1, 0.5],
    ]);
    actions.succeed(accepted.id, 12, { position: [4.5, 1, 0.5] });
    expect(actions.get(accepted.id)).toMatchObject({ status: 'succeeded', endedAt: 12 });
  });

  it('interrupts an actor old action when a replacement starts or stop is explicit', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const first = actions.start({ actorId: 'actor-1', type: 'wander', targetPosition: [2.5, 1, 0.5] }, 0);
    actions.markRunning(first.id, []);
    const second = actions.start({ actorId: 'actor-1', type: 'flee', targetPosition: [-3.5, 1, 0.5] }, 1);
    expect(actions.get(first.id)).toMatchObject({ status: 'interrupted', reason: 'replaced', endedAt: 1 });
    expect(actions.forActor('actor-1')?.id).toBe(second.id);
    expect(actions.interruptActor('actor-1', 2, 'stopped')).toBe(true);
    expect(actions.get(second.id)).toMatchObject({ status: 'interrupted', reason: 'stopped' });
  });

  it('returns clones and roundtrips a validated snapshot', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const action = actions.start({ actorId: 'actor-1', type: 'go-to-poi', poiId: 'home' }, 3);
    const queried = actions.get(action.id)!;
    queried.status = 'failed';
    expect(actions.get(action.id)?.status).toBe('pending');

    const restored = new ActionRuntime(testCorePlatform.clone);
    restored.restore(actions.snapshot());
    expect(restored.get(action.id)).toEqual(actions.get(action.id));
    expect(() => restored.restore({ version: 1, sequence: 0, actions: [{ ...action, status: 'unknown' }] })).toThrow(
      /Invalid action snapshot/,
    );
  });
});
