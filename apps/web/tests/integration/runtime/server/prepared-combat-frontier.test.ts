import { describe, expect, it } from 'vitest';
import type { DurableExecutionOriginV1 } from '../../../../../../packages/stdlib/src/server/composition/execution-origin';
import {
  type CombatRuntimeCallbacks,
  type CombatRuntimeSnapshotV3,
} from '../../../../../../packages/stdlib/src/server/gameplay/combat-runtime';
import { CombatRuntime } from '../../../fixtures/classic/content';
import type { CombatOriginValidationPort } from '../../../../../../packages/stdlib/src/server/gameplay/combat-origin';
import type {
  EntityIdentityPort,
  EntityLifetimeReference,
} from '../../../../../../packages/stdlib/src/server/simulation/action-identity';

const origin = (subject: string, actorId = 'actor', lifetime = 1): DurableExecutionOriginV1 => ({
  version: 1,
  principalSubject: subject,
  provenance: { packId: 'test:pack', moduleId: `test:${subject}` },
  originalActor: { entityId: actorId, lifetime },
});

const identities = (initial: Readonly<Record<string, number>>, epoch = 1) => {
  const lifetimes = new Map(Object.entries(initial));
  let currentEpoch = epoch;
  const referenceFor = (entityId: string): EntityLifetimeReference | null => {
    const lifetime = lifetimes.get(entityId);
    return lifetime === undefined ? null : { entityId, epoch: currentEpoch, lifetime };
  };
  const port: EntityIdentityPort = {
    referenceFor,
    resolve: (reference) => {
      const current = referenceFor(reference.entityId);
      return current && current.epoch === reference.epoch && current.lifetime === reference.lifetime
        ? reference.entityId
        : null;
    },
    rebind: (reference) => {
      const current = referenceFor(reference.entityId);
      return current && current.lifetime === reference.lifetime ? current : null;
    },
  };
  return { port, setEpoch: (value: number) => (currentEpoch = value) };
};

const validationPort: CombatOriginValidationPort = { validate: () => ({ ok: true }) };

const createRuntime = (hits: number[], host = identities({ actor: 1, other: 2, first: 3, second: 4 })) => {
  const callbacks: CombatRuntimeCallbacks = {
    actorAvailable: () => true,
    targetAvailable: () => true,
    validateHit: () => null,
    applyDamage: (_actorId, _targetId, damage) => {
      hits.push(damage);
      return damage;
    },
  };
  return {
    host,
    runtime: new CombatRuntime(callbacks, undefined, host.port, { requireOrigin: true, validationPort }),
  };
};

describe('prepared combat frontier', () => {
  it('stages a due hit without damage or live mutation until apply', () => {
    const hits: number[] = [];
    const { runtime } = createRuntime(hits);
    runtime.request('actor', 'first', 'wood-sword', undefined, origin('first'));
    const before = runtime.snapshot();

    const prepared = runtime.prepareMutation({ advanceSeconds: 0.3 });

    expect(hits).toEqual([]);
    expect(runtime.snapshot()).toEqual(before);
    expect(prepared.pendingHits).toMatchObject([
      { actorId: 'actor', targetId: 'first', comboStep: 0, baseDamage: 5, remainingSeconds: 0.12 },
    ]);
    prepared.validate();
    prepared.apply();
    expect(runtime.peekPendingHits()).toEqual(prepared.pendingHits);
  });

  it('preserves logical remainder through resolve and a buffered second hit', () => {
    const directHits: number[] = [];
    const preparedHits: number[] = [];
    const direct = createRuntime(directHits).runtime;
    const prepared = createRuntime(preparedHits).runtime;
    direct.request('actor', 'first', 'wood-sword', undefined, origin('first'));
    prepared.request('actor', 'first', 'wood-sword', undefined, origin('first'));

    direct.advance(0.3);
    const firstAdvance = prepared.prepareMutation({ advanceSeconds: 0.3 });
    firstAdvance.apply();
    const first = prepared.peekPendingHits()[0]!;
    prepared.prepareMutation({ resolveHit: { token: first.token, outcome: 'hit', damage: 5 } }).apply();
    expect(prepared.snapshotFor('actor')).toEqual(direct.snapshotFor('actor'));
    expect(preparedHits).toEqual([]);

    direct.request('actor', 'second', 'wood-sword', undefined, origin('second'));
    prepared.request('actor', 'second', 'wood-sword', undefined, origin('second'));
    direct.advance(0.8);
    prepared.prepareMutation({ advanceSeconds: 0.8 }).apply();
    const second = prepared.peekPendingHits()[0]!;
    prepared.prepareMutation({ resolveHit: { token: second.token, outcome: 'hit', damage: 7 } }).apply();
    expect(prepared.snapshotFor('actor')).toEqual(direct.snapshotFor('actor'));
    expect(prepared.peekLifecycleEvents()).toEqual(direct.takeLifecycleEvents());
    expect(prepared.peekLifecycleEvents()).toHaveLength(1);
    prepared.acknowledgeLifecycleEvents(1);
    expect(prepared.peekLifecycleEvents()).toEqual([]);
  });

  it('rejects stale plans, reused plans and reused pending tokens', () => {
    const { runtime } = createRuntime([]);
    runtime.request('actor', 'first', 'wood-sword', undefined, origin('first'));
    const stale = runtime.prepareMutation({ advanceSeconds: 0.1 });
    runtime.request('other', 'second', 'unarmed', undefined, origin('other', 'other', 2));
    expect(() => stale.validate()).toThrow(/stale/i);

    const plan = runtime.prepareMutation({ advanceSeconds: 0.2 });
    plan.apply();
    expect(() => plan.apply()).toThrow(/used/i);
    const pending = runtime.peekPendingHits()[0]!;
    expect(() => runtime.prepareMutation({ resolveHit: { token: 'wrong', outcome: 'hit', damage: 5 } })).toThrow(
      /token/i,
    );
    const resolved = runtime.prepareMutation({ resolveHit: { token: pending.token, outcome: 'hit', damage: 5 } });
    resolved.apply();
    expect(() => runtime.prepareMutation({ resolveHit: { token: pending.token, outcome: 'hit', damage: 5 } })).toThrow(
      /token/i,
    );
  });

  it('restores a pending V3 hit through a fresh epoch and rejects malformed data atomically', () => {
    const host = identities({ actor: 1, first: 3 }, 4);
    const { runtime } = createRuntime([], host);
    runtime.request('actor', 'first', 'wood-sword', undefined, origin('first'));
    runtime.prepareMutation({ advanceSeconds: 0.3 }).apply();
    const saved = runtime.snapshot() as CombatRuntimeSnapshotV3;
    const token = runtime.peekPendingHits()[0]!.token;
    expect(saved.combatants[0]!.combat.pendingHit).toMatchObject({ token, remainingSeconds: 0.12 });

    host.setEpoch(9);
    const restored = createRuntime([], host).runtime;
    restored.restore(saved);
    expect(restored.peekPendingHits()).toMatchObject([
      { token, actorIdentity: { epoch: 9 }, targetIdentity: { epoch: 9 } },
    ]);
    restored.prepareMutation({ resolveHit: { token, outcome: 'hit', damage: 5 } }).apply();
    expect(() => restored.prepareMutation({ resolveHit: { token, outcome: 'hit', damage: 5 } })).toThrow(/token/i);

    const before = restored.snapshot();
    const malformed = structuredClone(saved) as CombatRuntimeSnapshotV3;
    const combat = malformed.combatants[0]!.combat;
    Object.defineProperty(combat, 'pendingHit', {
      enumerable: true,
      get: () => {
        throw new Error('accessor must not execute');
      },
    });
    expect(() => restored.restore(malformed)).toThrow(/descriptor/i);
    expect(restored.snapshot()).toEqual(before);
  });

  it('combines hit resolution and target cancellation atomically on result capacity failure', () => {
    const { runtime } = createRuntime([]);
    runtime.request('actor', 'first', 'wood-sword', undefined, origin('first'));
    runtime.request('other', 'first', 'wood-sword', undefined, origin('other', 'other', 2));
    runtime.prepareMutation({ advanceSeconds: 0.18 }).apply();
    const snapshot = runtime.snapshot() as CombatRuntimeSnapshotV3;
    const exhausted: CombatRuntimeSnapshotV3 = { ...snapshot, resultSequence: Number.MAX_SAFE_INTEGER - 1 };
    runtime.restore(exhausted);
    const before = runtime.snapshot();
    const pending = runtime.peekPendingHits()[0]!;
    expect(() =>
      runtime.prepareMutation({
        resolveHit: { token: pending.token, outcome: 'hit', damage: 5 },
        cancelTargetIds: ['first'],
        exceptActorId: 'actor',
      }),
    ).toThrow(/exhausted/i);
    expect(runtime.snapshot()).toEqual(before);
    expect(runtime.peekLifecycleEvents()).toEqual([]);
  });
});
