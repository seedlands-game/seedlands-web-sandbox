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
  it.each(['allocator', 'negative-index', 'oversized-index', 'negative-repath'] as const)(
    'atomically rejects invalid saved action invariants: %s',
    (kind) => {
      const source = new ActionRuntime(testCorePlatform.clone);
      source.start({ actorId: 'source', type: 'idle' }, 0);
      const malformed = source.snapshot();
      if (kind === 'allocator') malformed.sequence = 0;
      if (kind === 'negative-index') malformed.actions[0].pathIndex = -1;
      if (kind === 'oversized-index') malformed.actions[0].pathIndex = 1;
      if (kind === 'negative-repath') malformed.actions[0].repathCount = -1;
      const current = new ActionRuntime(testCorePlatform.clone);
      current.start({ actorId: 'current', type: 'idle' }, 0);
      const before = current.snapshot();
      expect(() => current.restore(malformed)).toThrow(/Invalid action snapshot/);
      expect(current.snapshot()).toEqual(before);
      const next = current.start({ actorId: 'next', type: 'idle' }, 1);
      expect(next.id).toBe('action-2');
      expect(current.forActor('current')?.actorId).toBe('current');
    },
  );
});
