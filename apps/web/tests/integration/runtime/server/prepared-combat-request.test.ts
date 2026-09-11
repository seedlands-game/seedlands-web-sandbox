import { describe, expect, it } from 'vitest';
import type { DurableExecutionOriginV1 } from '../../../../../../packages/stdlib/src/server/composition/execution-origin';
import { type CombatRuntimeCallbacks } from '../../../../../../packages/stdlib/src/server/gameplay/combat-runtime';
import { CombatRuntime } from '../../../fixtures/classic/content';
import type { EntityIdentityPort } from '../../../../../../packages/stdlib/src/server/simulation/action-identity';

const makeOrigin = (subject: string, actorId = 'actor', lifetime = 1): DurableExecutionOriginV1 => ({
  version: 1,
  principalSubject: subject,
  provenance: { packId: 'test:pack', moduleId: `test:${subject}` },
  originalActor: { entityId: actorId, lifetime },
});

const identityPort = (): EntityIdentityPort => {
  const lifetimes = new Map([
    ['actor', 1],
    ['other', 2],
    ['first', 3],
    ['second', 4],
  ]);
  const referenceFor = (entityId: string) => {
    const lifetime = lifetimes.get(entityId);
    return lifetime === undefined ? null : { entityId, epoch: 1, lifetime };
  };
  return {
    referenceFor,
    resolve: (reference) => {
      const current = referenceFor(reference.entityId);
      return current?.lifetime === reference.lifetime && current.epoch === reference.epoch ? reference.entityId : null;
    },
    rebind: (reference) => {
      const current = referenceFor(reference.entityId);
      return current?.lifetime === reference.lifetime ? current : null;
    },
  };
};

const runtime = (hits: number[]) => {
  const callbacks: CombatRuntimeCallbacks = {
    actorAvailable: () => true,
    targetAvailable: () => true,
    validateHit: () => null,
    applyDamage: (_actorId, _targetId, damage) => {
      hits.push(damage);
      return damage;
    },
  };
  return new CombatRuntime(callbacks, undefined, identityPort(), {
    requireOrigin: true,
    validationPort: { validate: () => ({ ok: true }) },
  });
};

describe('prepared combat request', () => {
  it('turns a zero-windup request into an exact-once pending hit without damage', () => {
    const hits: number[] = [];
    const combat = runtime(hits);
    const prepared = combat.prepareRequest({
      actorId: 'actor',
      targetId: 'first',
      definitionId: 'unarmed',
      origin: makeOrigin('unarmed'),
    });
    expect(prepared).toMatchObject({ success: true, result: { actionId: 'combat-1', buffered: false } });
    if (!prepared.success) throw new Error(prepared.reason);
    expect(hits).toEqual([]);
    expect(combat.snapshot()).toMatchObject({ actionSequence: 0, combatants: [] });
    expect(prepared.pendingHits).toMatchObject([{ baseDamage: 4, remainingSeconds: 0 }]);
    prepared.apply();
    expect(hits).toEqual([]);
    const pending = combat.peekPendingHits()[0]!;
    combat.prepareMutation({ resolveHit: { token: pending.token, outcome: 'hit', damage: 4 } }).apply();
    expect(() => combat.prepareMutation({ resolveHit: { token: pending.token, outcome: 'hit', damage: 4 } })).toThrow(
      /token/i,
    );
    expect(combat.snapshotFor('actor').lastResult).toMatchObject({ outcome: 'hit', damage: 4 });
    expect(hits).toEqual([]);
  });

  it('leaves allocator and state untouched for rejection, abandonment and stale plans', () => {
    const combat = runtime([]);
    expect(
      combat.prepareRequest({
        actorId: '',
        targetId: 'first',
        definitionId: 'unarmed',
        origin: makeOrigin('bad'),
      }),
    ).toEqual({ success: false, reason: 'invalid-target' });
    const abandoned = combat.prepareRequest({
      actorId: 'actor',
      targetId: 'first',
      definitionId: 'wood-sword',
      origin: makeOrigin('abandoned'),
    });
    expect(abandoned).toMatchObject({ success: true, result: { actionId: 'combat-1' } });
    expect(combat.snapshot()).toMatchObject({ actionSequence: 0, combatants: [] });

    const stale = combat.prepareRequest({
      actorId: 'actor',
      targetId: 'first',
      definitionId: 'wood-sword',
      origin: makeOrigin('stale'),
    });
    combat.request('other', 'second', 'wood-sword', undefined, makeOrigin('other', 'other', 2));
    if (!stale.success) throw new Error(stale.reason);
    expect(() => stale.validate()).toThrow(/stale/i);
    expect(combat.snapshot()).toMatchObject({ actionSequence: 1 });
  });

  it('accepts a bounded external Action ID without consuming the Combat allocator', () => {
    const combat = runtime([]);
    const external = combat.prepareRequest({
      actorId: 'actor',
      targetId: 'first',
      definitionId: 'wood-sword',
      origin: makeOrigin('external'),
      actionId: 'action-77',
    });
    expect(external).toMatchObject({ success: true, result: { actionId: 'action-77' } });
    if (!external.success) throw new Error(external.reason);
    external.apply();
    expect(combat.snapshot()).toMatchObject({ actionSequence: 0 });

    const internal = combat.prepareRequest({
      actorId: 'other',
      targetId: 'second',
      definitionId: 'wood-sword',
      origin: makeOrigin('internal', 'other', 2),
    });
    expect(internal).toMatchObject({ success: true, result: { actionId: 'combat-1' } });
    expect(
      combat.prepareRequest({
        actorId: 'other',
        targetId: 'second',
        definitionId: 'wood-sword',
        origin: makeOrigin('invalid', 'other', 2),
        actionId: 'combat-9',
      }),
    ).toEqual({ success: false, reason: 'invalid-action-id' });
  });

  it('matches combo-window rejection and retains a distinct buffered origin', () => {
    const combat = runtime([]);
    const current = combat.prepareRequest({
      actorId: 'actor',
      targetId: 'first',
      definitionId: 'wood-sword',
      origin: makeOrigin('current'),
    });
    if (!current.success) throw new Error(current.reason);
    current.apply();
    expect(
      combat.prepareRequest({
        actorId: 'actor',
        targetId: 'second',
        definitionId: 'wood-sword',
        origin: makeOrigin('too-early'),
      }),
    ).toEqual({ success: false, reason: 'combo-window-closed' });

    combat.prepareMutation({ advanceSeconds: 0.18 }).apply();
    const first = combat.peekPendingHits()[0]!;
    combat.prepareMutation({ resolveHit: { token: first.token, outcome: 'hit', damage: 5 } }).apply();
    const buffered = combat.prepareRequest({
      actorId: 'actor',
      targetId: 'second',
      definitionId: 'wood-sword',
      origin: makeOrigin('buffered'),
      actionId: current.result.actionId,
    });
    expect(buffered).toMatchObject({ success: true, result: { buffered: true, actionId: current.result.actionId } });
    if (!buffered.success) throw new Error(buffered.reason);
    buffered.apply();
    combat.prepareMutation({ advanceSeconds: 0.5 }).apply();
    expect(combat.peekPendingHits()).toMatchObject([
      { comboStep: 1, targetId: 'second', origin: { principalSubject: 'buffered' } },
    ]);
  });
});
