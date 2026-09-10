import { describe, expect, it } from 'vitest';
import { ActionRuntime } from '../../packages/game-core/src/server/simulation/action-runtime';
import { testCorePlatform } from '../support/core-platform';

describe('prepared action settlement', () => {
  it('prepares every result before writing the first action', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const first = actions.start({ actorId: 'a', type: 'idle' }, 0);
    const second = actions.start({ actorId: 'b', type: 'idle' }, 0);
    const before = actions.snapshot();
    expect(() =>
      actions.prepareSettlements([
        { id: first.id, status: 'succeeded', now: 1, result: { accepted: true } },
        { id: second.id, status: 'succeeded', now: 1, result: { invalid: () => 0 } },
      ]),
    ).toThrow();
    expect(actions.snapshot()).toEqual(before);
  });
  it('does not partially finish an action when its result clone fails', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const active = actions.start({ actorId: 'a', type: 'idle' }, 0);
    const before = actions.snapshot();
    expect(() => actions.succeed(active.id, 1, { invalid: () => 0 })).toThrow();
    expect(actions.snapshot()).toEqual(before);
  });
  it('rejects stale and reused plans, and does not clone during installation', () => {
    let cloneCalls = 0;
    const actions = new ActionRuntime((value) => {
      cloneCalls++;
      return testCorePlatform.clone(value);
    });
    const first = actions.start({ actorId: 'a', type: 'idle' }, 0);
    const prepared = actions.prepareSettlements([
      { id: first.id, status: 'succeeded', now: 1, result: { done: true } },
    ]);
    const before = actions.snapshot();
    expect(before.actions[0].status).toBe('pending');
    (prepared.results[0].result as { done: boolean }).done = false;
    prepared.validate();
    const calls = cloneCalls;
    prepared.apply();
    expect(cloneCalls).toBe(calls);
    expect(actions.get(first.id)).toMatchObject({ status: 'succeeded', result: { done: true } });
    expect(() => prepared.apply()).toThrow(/used/i);
    const second = actions.start({ actorId: 'b', type: 'idle' }, 0);
    const stale = actions.prepareSettlements([{ id: second.id, status: 'interrupted', now: 1, reason: 'death' }]);
    actions.markRunning(second.id, []);
    expect(() => stale.validate()).toThrow(/stale/i);
  });
});
