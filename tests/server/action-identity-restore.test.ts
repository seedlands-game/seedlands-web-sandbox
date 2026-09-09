import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../support/core-platform';
import { ActionRuntime, type ActionSnapshotV2 } from '../../packages/game-core/src/server/simulation/action-runtime';
import type {
  EntityIdentityPort,
  EntityLifetimeReference,
} from '../../packages/game-core/src/server/simulation/action-identity';

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

describe('action lifetime identity restore', () => {
  it('captures host identity and restores nonterminal progress into the current epoch', () => {
    const host = identities({ actor: 4, target: 9 }, 2);
    const source = new ActionRuntime(testCorePlatform.clone, host.port);
    const action = source.start({ actorId: 'actor', type: 'attack', targetEntityId: 'target' }, 10);
    source.markRunning(action.id, [
      [0, 1, 0],
      [1, 1, 0],
    ]);
    source.setPathIndex(action.id, 2);
    const snapshot = source.snapshot();
    expect(snapshot).toMatchObject({
      version: 2,
      actions: [
        {
          actorIdentity: { entityId: 'actor', epoch: 2, lifetime: 4 },
          targetIdentity: { entityId: 'target', epoch: 2, lifetime: 9 },
          pathIndex: 2,
          status: 'running',
        },
      ],
    });

    host.setEpoch(8);
    const restored = new ActionRuntime(testCorePlatform.clone, host.port);
    restored.restore(snapshot);
    expect(restored.get(action.id)).toMatchObject({ status: 'running', pathIndex: 2 });
    expect(restored.snapshot()).toMatchObject({
      version: 2,
      actions: [
        {
          actorIdentity: { epoch: 8, lifetime: 4 },
          targetIdentity: { epoch: 8, lifetime: 9 },
        },
      ],
    });
  });

  it('rejects payload supplied bindings and stale execution references', () => {
    const host = identities({ actor: 1, target: 2 });
    const runtime = new ActionRuntime(testCorePlatform.clone, host.port);
    expect(() =>
      runtime.start(
        {
          actorId: 'actor',
          type: 'attack',
          targetEntityId: 'target',
          actorIdentity: { entityId: 'actor', epoch: 1, lifetime: 999 },
        } as never,
        0,
      ),
    ).toThrow(/binding/i);
    const action = runtime.start({ actorId: 'actor', type: 'attack', targetEntityId: 'target' }, 0);
    host.replace('target');
    expect(() => runtime.markRunning(action.id, [])).toThrow(/target-lifetime-mismatch/);
    expect(runtime.get(action.id)).toMatchObject({ status: 'failed', reason: 'target-lifetime-mismatch' });
  });

  it('settles a missing active target while retaining terminal history for deleted entities', () => {
    const host = identities({ actor: 1, target: 2 });
    const source = new ActionRuntime(testCorePlatform.clone, host.port);
    const active = source.start({ actorId: 'actor', type: 'attack', targetEntityId: 'target' }, 3);
    const snapshot = source.snapshot();
    host.remove('target');

    const restored = new ActionRuntime(testCorePlatform.clone, host.port);
    restored.restore(snapshot);
    expect(restored.get(active.id)).toMatchObject({
      actorId: 'actor',
      targetEntityId: 'target',
      status: 'failed',
      reason: 'restore-target-missing',
    });

    const terminalHost = identities({ actor: 1, target: 2 });
    const terminalSource = new ActionRuntime(testCorePlatform.clone, terminalHost.port);
    const completed = terminalSource.start({ actorId: 'actor', type: 'attack', targetEntityId: 'target' }, 3);
    terminalSource.succeed(completed.id, 4);
    const terminalSnapshot = terminalSource.snapshot();
    terminalHost.remove('target');
    terminalHost.remove('actor');
    const terminalRestored = new ActionRuntime(testCorePlatform.clone, terminalHost.port);
    terminalRestored.restore(terminalSnapshot);
    expect(terminalRestored.get(completed.id)).toMatchObject({
      actorId: 'actor',
      targetEntityId: 'target',
      status: 'succeeded',
    });
  });

  it('rejects an invalid active actor atomically and rejects malformed bound snapshots without fallback', () => {
    const host = identities({ current: 1, actor: 2, target: 3 });
    const runtime = new ActionRuntime(testCorePlatform.clone, host.port);
    const current = runtime.start({ actorId: 'current', type: 'idle' }, 0);
    const source = new ActionRuntime(testCorePlatform.clone, host.port);
    source.start({ actorId: 'actor', type: 'attack', targetEntityId: 'target' }, 1);
    const snapshot = source.snapshot() as ActionSnapshotV2;
    host.replace('actor');
    expect(() => runtime.restore(snapshot)).toThrow(/actor-lifetime-mismatch/);
    expect(runtime.forActor('current')?.id).toBe(current.id);

    const malformed = structuredClone(snapshot);
    delete (malformed.actions[0] as { actorIdentity?: EntityLifetimeReference }).actorIdentity;
    expect(() => runtime.restore(malformed)).toThrow(/actor binding/i);
    expect(runtime.forActor('current')?.id).toBe(current.id);
    expect(() => new ActionRuntime(testCorePlatform.clone).restore(snapshot)).toThrow(/identity port/i);
  });

  it('migrates a legacy active action once through current host identities', () => {
    const legacy = new ActionRuntime(testCorePlatform.clone);
    const action = legacy.start({ actorId: 'actor', type: 'attack', targetEntityId: 'target' }, 2);
    const host = identities({ actor: 5, target: 6 }, 7);
    const restored = new ActionRuntime(testCorePlatform.clone, host.port);
    restored.restore(legacy.snapshot());
    expect(restored.get(action.id)).toMatchObject({ status: 'pending', targetEntityId: 'target' });
    expect(restored.snapshot()).toMatchObject({
      version: 2,
      actions: [
        {
          actorIdentity: { epoch: 7, lifetime: 5 },
          targetIdentity: { epoch: 7, lifetime: 6 },
        },
      ],
    });
  });
});
