import { describe, expect, it } from 'vitest';
import type { DurableExecutionOriginV1 } from '../../packages/game-core/src/server/composition/execution-origin';
import {
  CombatRuntime,
  type CombatRuntimeCallbacks,
  type CombatRuntimeSnapshotV1,
  type CombatRuntimeSnapshotV2,
  type CombatRuntimeSnapshotV3,
} from '../../packages/game-core/src/server/gameplay/combat-runtime';
import type { CombatOriginValidationPort } from '../../packages/game-core/src/server/gameplay/combat-origin';
import type {
  EntityIdentityPort,
  EntityLifetimeReference,
} from '../../packages/game-core/src/server/simulation/action-identity';

const origin = (principalSubject: string, actorId = 'actor', lifetime = 1): DurableExecutionOriginV1 => ({
  version: 1,
  principalSubject,
  provenance: { packId: 'test:pack', moduleId: `test:${principalSubject}` },
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
  return {
    port,
    remove: (entityId: string) => lifetimes.delete(entityId),
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

const policy = (allowed: Set<string>, seen: string[] = []): CombatOriginValidationPort => ({
  validate: (value, checkpoint) => {
    seen.push(`${checkpoint.stage}:${value.principalSubject}:${checkpoint.comboStep}`);
    return allowed.has(value.principalSubject)
      ? { ok: true }
      : { ok: false, reason: `origin-revoked:${value.principalSubject}` };
  },
});

describe('combat durable execution origin', () => {
  it('revalidates the current origin immediately before a delayed hit', () => {
    const host = identities({ actor: 1, target: 2 });
    const allowed = new Set(['subject-a']);
    const hits: number[] = [];
    const runtime = new CombatRuntime(callbacks(hits), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(allowed),
    });
    expect(runtime.request('actor', 'target', 'wood-sword')).toEqual({ success: false, reason: 'origin-required' });
    expect(runtime.snapshot()).toMatchObject({ actionSequence: 0, combatants: [] });
    expect(runtime.request('actor', 'target', 'wood-sword', undefined, origin('subject-a'))).toMatchObject({
      success: true,
    });
    allowed.delete('subject-a');
    runtime.advance(0.18);

    expect(hits).toEqual([]);
    expect(runtime.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'cancelled', reason: 'origin-revoked:subject-a' },
    });
  });

  it('keeps a distinct buffered origin and never copies the current step origin', () => {
    const host = identities({ actor: 1, first: 2, second: 3 });
    const allowed = new Set(['first-source', 'second-source']);
    const hits: number[] = [];
    const runtime = new CombatRuntime(callbacks(hits), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(allowed),
    });
    runtime.request('actor', 'first', 'wood-sword', undefined, origin('first-source'));
    runtime.advance(0.18);
    expect(hits).toEqual([5]);
    expect(runtime.request('actor', 'second', 'wood-sword', undefined, origin('second-source'))).toMatchObject({
      success: true,
      buffered: true,
    });
    allowed.delete('second-source');
    runtime.advance(0.5);

    expect(hits).toEqual([5]);
    expect(runtime.snapshotFor('actor').lastResult).toMatchObject({
      comboStep: 1,
      targetId: 'second',
      outcome: 'cancelled',
      reason: 'origin-revoked:second-source',
    });
  });

  it('cancels without damage when current provenance no longer matches the hit source', () => {
    const host = identities({ actor: 1, target: 2 });
    const hits: number[] = [];
    let expectedModule = 'test:source';
    const runtime = new CombatRuntime(callbacks(hits), undefined, host.port, {
      requireOrigin: true,
      validationPort: {
        validate: (value) =>
          value.provenance.moduleId === expectedModule ? { ok: true } : { ok: false, reason: 'origin-source-mismatch' },
      },
    });
    runtime.request('actor', 'target', 'wood-sword', undefined, origin('source'));
    expectedModule = 'test:replacement';
    runtime.advance(0.18);

    expect(hits).toEqual([]);
    expect(runtime.snapshotFor('actor').lastResult).toMatchObject({
      outcome: 'cancelled',
      reason: 'origin-source-mismatch',
    });
  });

  it('restores V3 through a new epoch and host alias by stable subject with hit dedupe intact', () => {
    const host = identities({ actor: 1, first: 2, second: 3 }, 4);
    const sourceSeen: string[] = [];
    const restoredSeen: string[] = [];
    const allowed = new Set(['stable-browser', 'stable-agent']);
    const hits: number[] = [];
    const source = new CombatRuntime(callbacks(hits), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(allowed, sourceSeen),
    });
    source.request('actor', 'first', 'wood-sword', undefined, origin('stable-browser'));
    source.advance(0.18);
    source.request('actor', 'second', 'wood-sword', undefined, origin('stable-agent'));
    const snapshot = source.snapshot();
    expect(snapshot).toMatchObject({
      version: 3,
      combatants: [
        {
          combat: {
            active: {
              origin: { principalSubject: 'stable-browser' },
              bufferedOrigin: { principalSubject: 'stable-agent' },
            },
          },
        },
      ],
    });
    expect(JSON.stringify(source.snapshotFor('actor'))).not.toContain('origin');

    host.setEpoch(9);
    const restored = new CombatRuntime(callbacks(hits), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(allowed, restoredSeen),
    });
    restored.restore(snapshot);
    expect(restored.snapshot()).toMatchObject({
      version: 3,
      combatants: [{ actorIdentity: { epoch: 9 }, combat: { active: { targetIdentity: { epoch: 9 } } } }],
    });
    expect(restoredSeen).toContain('restore:stable-agent:1');
    restored.advance(0.4);
    expect(hits).toEqual([5]);
    restored.advance(0.14);
    expect(hits).toEqual([5, 7]);
  });

  it('preserves committed lethal recovery through V3 restore without replaying damage', () => {
    const host = identities({ actor: 1, target: 2 });
    const allowed = new Set(['stable-attacker']);
    const hits: number[] = [];
    const source = new CombatRuntime(
      {
        ...callbacks(hits),
        applyDamage: (_actorId, targetId, damage) => {
          hits.push(damage);
          host.remove(targetId);
          return damage;
        },
      },
      undefined,
      host.port,
      { requireOrigin: true, validationPort: policy(allowed) },
    );
    source.request('actor', 'target', 'wood-sword', undefined, origin('stable-attacker'));
    source.advance(0.18);
    const snapshot = source.snapshot();

    const restored = new CombatRuntime(callbacks(hits), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(allowed),
    });
    restored.restore(snapshot);
    restored.advance(1);
    expect(hits).toEqual([5]);
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'hit', damage: 5, targetId: 'target' },
    });
  });

  it.each([1, 2] as const)('cancels originless V%s in-flight state in requireOrigin mode', (version) => {
    const host = identities({ actor: 1, target: 2 });
    const source = new CombatRuntime(callbacks([]), undefined, version === 2 ? host.port : undefined);
    source.request('actor', 'target', 'wood-sword');
    const snapshot = source.snapshot() as CombatRuntimeSnapshotV1 | CombatRuntimeSnapshotV2;
    const restored = new CombatRuntime(callbacks([]), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(new Set()),
    });
    restored.restore(snapshot);

    expect(restored.snapshot()).toMatchObject({ version: 3, actionSequence: 1 });
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'cancelled', reason: 'restore-origin-missing' },
    });
  });

  it('keeps legacy terminal history and allocator high-water while cancelling originless work', () => {
    const source = new CombatRuntime(callbacks([]));
    source.request('finished', 'target', 'unarmed');
    source.advance(1);
    source.request('actor', 'target', 'wood-sword');
    const legacy = source.snapshot() as CombatRuntimeSnapshotV1;
    const host = identities({ finished: 1, actor: 2, target: 3 });
    const restored = new CombatRuntime(callbacks([]), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(new Set()),
    });
    restored.restore(legacy);

    expect(restored.snapshot()).toMatchObject({ version: 3, actionSequence: 2, resultSequence: 2 });
    expect(restored.snapshotFor('finished').lastResult).toMatchObject({ outcome: 'hit', sequence: 1 });
    expect(restored.snapshotFor('actor').lastResult).toMatchObject({
      outcome: 'cancelled',
      sequence: 2,
      reason: 'restore-origin-missing',
    });
  });

  it('rejects malformed origin accessors on request and V3 restore before replacing live state', () => {
    const host = identities({ actor: 1, target: 2 });
    const allowed = new Set(['good']);
    const runtime = new CombatRuntime(callbacks([]), undefined, host.port, {
      requireOrigin: true,
      validationPort: policy(allowed),
    });
    const accessor = { ...origin('good') };
    Object.defineProperty(accessor, 'principalSubject', {
      enumerable: true,
      get: () => {
        throw new Error('accessor must not run');
      },
    });
    expect(() => runtime.request('actor', 'target', 'wood-sword', undefined, accessor)).toThrow(/shape/i);
    expect(() => runtime.request('actor', 'target', 'wood-sword', undefined, origin('good', 'actor', 9))).toThrow(
      /lifetime/i,
    );
    expect(runtime.snapshot()).toMatchObject({ version: 3, actionSequence: 0, combatants: [] });

    runtime.request('actor', 'target', 'wood-sword', undefined, origin('good'));
    const before = runtime.snapshot();
    const malformed = structuredClone(before) as CombatRuntimeSnapshotV3;
    const savedOrigin = malformed.combatants[0]!.combat.active!.origin as unknown as Record<string, unknown>;
    Object.defineProperty(savedOrigin, 'principalSubject', {
      enumerable: true,
      get: () => {
        throw new Error('snapshot accessor must not run');
      },
    });
    expect(() => runtime.restore(malformed)).toThrow(/shape/i);
    expect(runtime.snapshot()).toEqual(before);

    const containerAccessor = structuredClone(before) as CombatRuntimeSnapshotV3;
    const active = containerAccessor.combatants[0]!.combat.active!;
    Object.defineProperty(active, 'origin', {
      enumerable: true,
      get: () => {
        throw new Error('origin container accessor must not run');
      },
    });
    expect(() => runtime.restore(containerAccessor)).toThrow(/descriptor/i);
    expect(runtime.snapshot()).toEqual(before);

    const actorMismatch: CombatRuntimeSnapshotV3 = {
      ...(before as CombatRuntimeSnapshotV3),
      combatants: (before as CombatRuntimeSnapshotV3).combatants.map((entry, index) =>
        index === 0 && entry.combat.active
          ? {
              ...entry,
              combat: {
                ...entry.combat,
                active: {
                  ...entry.combat.active,
                  origin: {
                    ...entry.combat.active.origin,
                    originalActor: { ...entry.combat.active.origin.originalActor, entityId: 'other' },
                  },
                },
              },
            }
          : entry,
      ),
    };
    expect(() => runtime.restore(actorMismatch)).toThrow(/actor/i);
    expect(runtime.snapshot()).toEqual(before);
  });
});
