import { describe, expect, it } from 'vitest';
import {
  type CombatRuntimeCallbacks,
  type CombatRuntimeSnapshotV1,
} from '../../../../../../packages/stdlib/src/server/gameplay/combat-runtime';
import { CombatRuntime } from '../../../fixtures/classic/content';
import type {
  EntityIdentityPort,
  EntityLifetimeReference,
} from '../../../../../../packages/stdlib/src/server/simulation/action-identity';

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
  return {
    port,
    remove: (entityId: string) => lifetimes.delete(entityId),
    replace: (entityId: string) => lifetimes.set(entityId, (lifetimes.get(entityId) ?? 0) + 1),
    setEpoch: (value: number) => {
      currentEpoch = value;
    },
  };
};

const callbacks = (hits: number[]): CombatRuntimeCallbacks => ({
  actorAvailable: () => true,
  targetAvailable: () => true,
  validateHit: () => null,
  applyDamage: (_actorId, _targetId, damage) => {
    hits.push(damage);
    return damage;
  },
});

describe('combat lifetime identity restore', () => {
  it('preserves windup progress and rebinds actor and target to the current epoch', () => {
    const host = identities({ actor: 2, target: 3 }, 4);
    const hits: number[] = [];
    const source = new CombatRuntime(callbacks(hits), undefined, host.port);
    source.request('actor', 'target', 'wood-sword');
    source.advance(0.1);
    const snapshot = source.snapshot();
    expect(snapshot).toMatchObject({
      version: 2,
      combatants: [
        {
          actorIdentity: { epoch: 4, lifetime: 2 },
          combat: { active: { phase: 'windup', phaseElapsedSeconds: 0.1, targetIdentity: { lifetime: 3 } } },
        },
      ],
    });
    host.setEpoch(9);
    const restored = new CombatRuntime(callbacks(hits), undefined, host.port);
    restored.restore(snapshot);
    expect(restored.snapshotFor('actor').active).toMatchObject({ phase: 'windup', phaseElapsedSeconds: 0.1 });
    expect(restored.snapshot()).toMatchObject({
      version: 2,
      combatants: [{ actorIdentity: { epoch: 9 }, combat: { active: { targetIdentity: { epoch: 9 } } } }],
    });
    restored.advance(0.08);
    expect(hits).toEqual([5]);
  });

  it('preserves hit dedupe and buffered target identity across restore', () => {
    const host = identities({ actor: 1, first: 2, second: 3 });
    const hits: number[] = [];
    const source = new CombatRuntime(callbacks(hits), undefined, host.port);
    source.request('actor', 'first', 'wood-sword');
    source.advance(0.18);
    expect(hits).toEqual([5]);
    expect(source.request('actor', 'second', 'wood-sword')).toMatchObject({ success: true, buffered: true });

    const restored = new CombatRuntime(callbacks(hits), undefined, host.port);
    restored.restore(source.snapshot());
    expect(restored.snapshot()).toMatchObject({
      combatants: [{ combat: { active: { phase: 'hit', bufferedTargetId: 'second' } } }],
    });
    restored.advance(0.4);
    expect(hits).toEqual([5]);
    expect(restored.snapshotFor('actor').active).toMatchObject({ comboStep: 1, targetId: 'second', phase: 'windup' });
    restored.advance(0.14);
    expect(hits).toEqual([5, 7]);
  });

  it('settles a missing restore target and rejects an invalid actor atomically', () => {
    const host = identities({ actor: 1, target: 2, current: 3, currentTarget: 4 });
    const source = new CombatRuntime(callbacks([]), undefined, host.port);
    source.request('actor', 'target', 'wood-sword');
    const sourceSnapshot = source.snapshot();
    host.remove('target');
    const restored = new CombatRuntime(callbacks([]), undefined, host.port);
    restored.restore(sourceSnapshot);
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'cancelled', reason: 'restore-target-missing' },
    });

    const mismatchHost = identities({ actor: 1, target: 2 });
    const mismatchSource = new CombatRuntime(callbacks([]), undefined, mismatchHost.port);
    mismatchSource.request('actor', 'target', 'wood-sword');
    const mismatchSnapshot = mismatchSource.snapshot();
    mismatchHost.replace('target');
    const mismatchRestored = new CombatRuntime(callbacks([]), undefined, mismatchHost.port);
    mismatchRestored.restore(mismatchSnapshot);
    expect(mismatchRestored.snapshotFor('actor').lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'restore-target-lifetime-mismatch',
    });

    const current = new CombatRuntime(callbacks([]), undefined, host.port);
    current.request('current', 'currentTarget', 'wood-sword');
    const invalidActorHost = identities({ actor: 1, target: 2 });
    const invalidSource = new CombatRuntime(callbacks([]), undefined, invalidActorHost.port);
    invalidSource.request('actor', 'target', 'wood-sword');
    const invalidSnapshot = invalidSource.snapshot();
    invalidActorHost.replace('actor');
    const target = new CombatRuntime(callbacks([]), undefined, invalidActorHost.port);
    target.restore({ version: 2, actionSequence: 0, resultSequence: 0, combatants: [] });
    expect(() => target.restore(invalidSnapshot)).toThrow(/actor-lifetime-mismatch/);
    expect(target.snapshot()).toMatchObject({ version: 2, combatants: [] });
    expect(current.snapshotFor('current').active).not.toBeNull();
  });

  it('rejects stale execution bindings and keeps legacy version 1 restore-cancelled behavior', () => {
    const host = identities({ actor: 1, target: 2 });
    const runtime = new CombatRuntime(callbacks([]), undefined, host.port);
    runtime.request('actor', 'target', 'wood-sword');
    host.replace('target');
    runtime.advance(0.1);
    expect(runtime.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'cancelled', reason: 'target-lifetime-mismatch' },
    });

    const legacySource = new CombatRuntime(callbacks([]));
    legacySource.request('actor', 'target', 'wood-sword');
    const legacy = legacySource.snapshot() as CombatRuntimeSnapshotV1;
    expect(legacy.version).toBe(1);
    const legacyPort = identities({ actor: 1, target: 2 });
    const legacyRestored = new CombatRuntime(callbacks([]), undefined, legacyPort.port);
    legacyRestored.restore(legacy);
    expect(legacyRestored.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'cancelled', reason: 'restore-cancelled' },
    });

    const malformedHost = identities({ actor: 1, target: 2 });
    const malformedSource = new CombatRuntime(callbacks([]), undefined, malformedHost.port);
    malformedSource.request('actor', 'target', 'wood-sword');
    const malformed = structuredClone(malformedSource.snapshot());
    delete (malformed.combatants[0].combat.active as { targetIdentity?: EntityLifetimeReference }).targetIdentity;
    expect(() => new CombatRuntime(callbacks([]), undefined, malformedHost.port).restore(malformed)).toThrow(
      /target binding/i,
    );
  });

  it('restores terminal combat history without requiring deleted actor or target bindings', () => {
    const host = identities({ actor: 1, target: 2 });
    const source = new CombatRuntime(callbacks([]), undefined, host.port);
    source.request('actor', 'target', 'unarmed');
    source.advance(1);
    const snapshot = source.snapshot();
    host.remove('actor');
    host.remove('target');
    const restored = new CombatRuntime(callbacks([]), undefined, host.port);
    restored.restore(snapshot);
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { targetId: 'target', outcome: 'hit' },
    });
  });
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('rejects allocator rollback before replacing state (bound=%s terminal=%s)', (bound, terminal) => {
    const host = identities({ actor: 1, target: 2 });
    const source = new CombatRuntime(callbacks([]), undefined, bound ? host.port : undefined);
    source.request('actor', 'target', 'wood-sword');
    if (terminal) source.advance(2);
    const malformed = { ...source.snapshot(), actionSequence: 0 };
    const current = new CombatRuntime(callbacks([]), undefined, bound ? host.port : undefined);
    current.request('actor', 'target', 'wood-sword');
    const before = current.snapshot();
    expect(() => current.restore(malformed)).toThrow(/allocator/i);
    expect(current.snapshot()).toEqual(before);
  });
});
