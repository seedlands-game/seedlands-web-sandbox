import { describe, expect, it } from 'vitest';
import { ActionRuntime } from '../../../../../../packages/stdlib/src/server/simulation/action-runtime';
import { EntityStore } from '../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';

describe('prepared Action acceptance', () => {
  it('can abandon a replacement without interrupting the current action or consuming its next ID', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const first = actions.start({ actorId: 'a', type: 'idle' }, 0);
    const before = actions.snapshot();
    const prepared = actions.prepareStart({ actorId: 'a', type: 'attack', targetEntityId: 'b' }, 1, {
      status: 'running',
    });
    expect(prepared.action.id).toBe('action-2');
    expect(actions.snapshot()).toEqual(before);
    expect(actions.forActor('a')?.id).toBe(first.id);
    expect(actions.start({ actorId: 'b', type: 'idle' }, 1).id).toBe('action-2');
    expect(() => prepared.apply()).toThrow();
    expect(() => prepared.validate()).toThrow(/stale/i);
  });
  it('prepares replacement and output before installing, without any clone during apply', () => {
    let clones = 0;
    const actions = new ActionRuntime((value) => {
      clones++;
      return testCorePlatform.clone(value);
    });
    const first = actions.start({ actorId: 'a', type: 'idle' }, 0);
    const saved = actions.snapshot();
    saved.actions[0].result = { progress: 1 };
    actions.restore(saved);
    const prepared = actions.prepareStart({ actorId: 'a', type: 'attack', targetEntityId: 'b' }, 1, {
      status: 'running',
    });
    expect(clones).toBeGreaterThan(0);
    prepared.action.targetEntityId = 'untrusted-output-change';
    prepared.validate();
    const before = clones;
    prepared.apply();
    expect(clones).toBe(before);
    expect(actions.get(first.id)).toMatchObject({ status: 'interrupted', reason: 'replaced' });
    expect(actions.forActor('a')).toMatchObject({ id: 'action-2', status: 'running', targetEntityId: 'b' });
    expect(() => prepared.apply()).toThrow(/used/i);
  });
  it('rejects a restore frontier change and allocator exhaustion without cancelling the live action', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const empty = actions.snapshot();
    const stale = actions.prepareStart({ actorId: 'a', type: 'idle' }, 0);
    stale.validate();
    actions.restore(empty);
    expect(() => stale.apply()).toThrow(/stale/i);
    actions.start({ actorId: 'a', type: 'idle' }, 0);
    const exhausted = actions.snapshot();
    exhausted.sequence = Number.MAX_SAFE_INTEGER;
    actions.restore(exhausted);
    const before = actions.snapshot();
    expect(() => actions.prepareStart({ actorId: 'a', type: 'attack', targetEntityId: 'b' }, 1)).toThrow(
      /sequence.*exhausted/i,
    );
    expect(actions.snapshot()).toEqual(before);
  });
  it('rejects changed source action and unavailable identity before any write', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'a', type: 'player', position: [0, 1, 0] });
    entities.spawn({ id: 'b', type: 'player', position: [1, 1, 0] });
    const actions = new ActionRuntime(testCorePlatform.clone, {
      referenceFor: (id) => entities.createReference(id),
      resolve: (reference) => entities.resolveReference(reference)?.id ?? null,
      rebind: (reference) => entities.createReference(reference.entityId),
    });
    const first = actions.start({ actorId: 'a', type: 'idle' }, 0);
    const stale = actions.prepareStart({ actorId: 'a', type: 'attack', targetEntityId: 'b' }, 1);
    actions.markRunning(first.id, []);
    expect(() => stale.validate()).toThrow(/stale/i);
    const missing = actions.prepareStart({ actorId: 'a', type: 'attack', targetEntityId: 'b' }, 1);
    const before = actions.snapshot();
    entities.despawn('b');
    expect(() => missing.validate()).toThrow(/target/i);
    expect(actions.snapshot()).toEqual(before);
  });
});
