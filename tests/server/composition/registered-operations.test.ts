import { describe, expect, it } from 'vitest';
import {
  definePack,
  type ModModule,
  type ModuleInvocationValue,
  type ModCandidateState,
} from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/game-core/server/composition/host-api';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';

const address = (entityId: string) => ({ componentId: 'test:coins', target: { kind: 'entity' as const, entityId } });
const target = { kind: 'entity' as const, entityId: 'alice' };

function setup(options: { veto?: boolean; selfOnly?: boolean; stale?: boolean } = {}) {
  const values = new Map<string, ModuleInvocationValue>([
    ['alice', 10],
    ['bob', 0],
  ]);
  let revision = 0;
  let commits = 0;
  let reads = 0;
  let retained: ModCandidateState | undefined;
  const module: ModModule = {
    descriptor: {
      id: 'test:bank',
      version: '1.0.0',
      resources: [{ id: 'test.bank', operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: 'test.bank', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerState({
        id: 'test:coins',
        version: '1.0.0',
        resource: 'test.bank',
        validate: (value) => value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0),
      });
      api.registerOperation({
        id: 'test:transfer',
        resource: 'test.bank',
        run(context, _input, state) {
          retained = state;
          const from = address(context.originalActorId),
            to = address('bob');
          const balance = state.read(from),
            recipient = state.read(to);
          if (typeof balance !== 'number' || typeof recipient !== 'number') throw new TypeError('invalid balance');
          state.write(from, balance - 4);
          state.write(to, recipient + 4);
          return { transferred: 4, actorId: context.originalActorId };
        },
      });
      api.registerOperation({
        id: 'test:close',
        resource: 'test.bank',
        run(context, _input, state) {
          state.write(address(context.originalActorId), null);
          return state.read(address(context.originalActorId));
        },
      });
      api.registerRule({
        id: 'test:limit',
        operationId: 'test:transfer',
        apply() {
          if (options.veto) return { reject: 'limit' };
        },
      });
    },
  };
  const pack = definePack({ id: 'test:playbook', version: '1.0.0', kind: 'playbook', modules: [module] });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:playbook': module.descriptor.permissions! } },
  );
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: [
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: ['test.bank'],
          operations: ['read', 'write', 'execute'],
          scope: options.selfOnly ? 'self' : 'any',
        },
      ],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({
    composition,
    authorizer,
    clone: structuredClone,
    state: {
      read(key) {
        reads++;
        if (key.target.kind !== 'entity') throw new Error('unsupported target');
        return { revision, value: values.get(key.target.entityId) ?? null };
      },
      commit(observed, writes) {
        if (options.stale || observed.some((entry) => entry.revision !== revision))
          return { ok: false, reason: 'stale-state' };
        for (const entry of writes) {
          if (entry.address.target.kind !== 'entity') throw new Error('unsupported target');
          values.set(entry.address.target.entityId, entry.value);
        }
        commits++;
        revision++;
        return { ok: true, revision };
      },
    },
  });
  const execution = runtime.bind({ moduleId: 'test:bank', principalId: 'human', originalActorId: 'alice' });
  return { runtime, execution, values, retained: () => retained!, commits: () => commits, reads: () => reads };
}

describe('registered operation candidate and commit stages', () => {
  it('commits both inventory candidates once and retains the host actor despite forged payload fields', () => {
    const world = setup();
    expect(
      world.execution.invoke({
        operationId: 'test:transfer',
        target,
        input: { originalActorId: 'bob', principalId: 'admin' },
      }),
    ).toMatchObject({ ok: true, value: { actorId: 'alice', transferred: 4 } });
    expect([...world.values]).toEqual([
      ['alice', 6],
      ['bob', 4],
    ]);
    expect(world.commits()).toBe(1);
  });
  it('does not commit either inventory or emit facts when a named rule vetoes', () => {
    const world = setup({ veto: true });
    let facts = 0;
    world.execution.subscribe(() => facts++);
    expect(world.execution.invoke({ operationId: 'test:transfer', target })).toMatchObject({
      ok: false,
      code: 'RULE_REJECTED',
    });
    expect([...world.values]).toEqual([
      ['alice', 10],
      ['bob', 0],
    ]);
    expect(world.commits()).toBe(0);
    expect(facts).toBe(0);
  });
  it('rejects stale observed state at atomic commit without publishing a fact', () => {
    const world = setup({ stale: true });
    expect(world.execution.invoke({ operationId: 'test:transfer', target })).toMatchObject({
      ok: false,
      code: 'STATE_CONFLICT',
    });
    expect(world.commits()).toBe(0);
    expect([...world.values]).toEqual([
      ['alice', 10],
      ['bob', 0],
    ]);
  });
  it('checks self authorization before returning another actor state', () => {
    const world = setup({ selfOnly: true });
    expect(world.execution.invoke({ operationId: 'test:transfer', target })).toMatchObject({
      ok: false,
      code: 'WORLD_PERMISSION_DENIED',
    });
    expect(world.reads()).toBe(1);
    expect(world.commits()).toBe(0);
  });
  it('freezes committed facts, rejects synchronous reentry, and bounds deferred operations', () => {
    const world = setup();
    let reentrant: unknown;
    const queued: boolean[] = [];
    world.execution.subscribe((fact, enqueue) => {
      expect(Object.isFrozen(fact)).toBe(true);
      expect(Object.isFrozen(fact.value)).toBe(true);
      reentrant = world.execution.invoke({ operationId: 'test:transfer', target });
      for (let index = 0; index < 65; index++) queued.push(enqueue({ operationId: 'test:transfer', target }));
    });
    expect(world.execution.invoke({ operationId: 'test:transfer', target })).toMatchObject({ ok: true });
    expect(reentrant).toMatchObject({ ok: false, code: 'TRANSACTION_REENTRANT' });
    expect(queued.filter(Boolean)).toHaveLength(64);
    expect(world.commits()).toBe(1);
    world.runtime.dispose();
    expect(world.execution.invoke({ operationId: 'test:transfer', target })).toMatchObject({
      ok: false,
      code: 'RUNTIME_DISPOSED',
    });
  });
  it('reads an explicit null candidate instead of the pre-transaction value', () => {
    const world = setup();
    expect(world.execution.invoke({ operationId: 'test:close', target })).toMatchObject({ ok: true, value: null });
    expect(world.values.get('alice')).toBeNull();
  });
  it('closes captured candidate access once its operation has finished', () => {
    const world = setup();
    world.execution.invoke({ operationId: 'test:transfer', target });
    expect(() => world.retained().read(address('alice'))).toThrow(/closed/i);
    expect(() => world.retained().write(address('alice'), 100)).toThrow(/closed/i);
    expect(world.values.get('alice')).toBe(6);
  });
});
