import { GameplayModuleRuntime } from '../../../packages/game-core/src/server/gameplay/modules/gameplay-module-runtime';
import { EntityStore } from '../../../packages/game-core/src/server/gameplay/entity-store';
import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/game-core/server/composition/host-api';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import type { ModuleExecutionContext } from '../../../packages/game-core/src/server/composition/authorized-execution';

function setup(systemOperation = true) {
  let context: ModuleExecutionContext | undefined,
    commits = 0;
  const module: ModModule = {
    descriptor: {
      id: 'test:clock',
      version: '1.0.0',
      resources: [{ id: 'test.clock', operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: 'test.clock', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerOperation({
        id: 'test:act',
        resource: 'test.clock',
        run(value: ModuleExecutionContext) {
          context = value;
          return null;
        },
      });
      api.registerOperation({
        id: 'test:tick-op',
        resource: 'test.clock',
        executionKind: systemOperation ? 'system' : 'actor',
        run(value: ModuleExecutionContext) {
          context = value;
          return null;
        },
      });
      api.registerSystem({ id: 'test:tick', operationId: 'test:tick-op', intervalSeconds: 1 });
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
      principals: [
        { id: 'human', boundEntityId: 'alice' },
        { id: 'scheduler', kind: 'system' },
        { id: 'unbound-admin' },
      ],
      rules: [{ effect: 'allow', resources: ['test.clock'], operations: ['execute'], scope: 'any' }],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({
    composition,
    authorizer,
    clone: structuredClone,
    state: { read: () => ({ revision: 0, value: null }), commit: () => ({ ok: true, revision: ++commits }) },
  });
  return { runtime, composition, authorizer, state: () => ({ context, commits }) };
}

describe('actor and world system execution are disjoint', () => {
  it('binds a registered world system without inventing an original actor', () => {
    const world = setup();
    const system = world.runtime.bind({
      kind: 'system',
      moduleId: 'test:clock',
      principalId: 'scheduler',
      systemId: 'test:tick',
    });
    expect(system.invoke({ operationId: 'test:tick-op', target: { kind: 'world' } })).toMatchObject({ ok: true });
    expect(world.state().context).toMatchObject({
      kind: 'system',
      systemId: 'test:tick',
      principal: { id: 'scheduler' },
    });
    expect(Object.hasOwn(world.state().context!, 'originalActorId')).toBe(false);
  });
  it('rejects kind mismatch, entity target and forged system identity before commit', () => {
    const world = setup();
    const actor = world.runtime.bind({ moduleId: 'test:clock', principalId: 'human', originalActorId: 'alice' });
    const system = world.runtime.bind({
      kind: 'system',
      moduleId: 'test:clock',
      principalId: 'scheduler',
      systemId: 'test:tick',
    });
    expect(actor.invoke({ operationId: 'test:tick-op', target: { kind: 'world' } })).toMatchObject({
      ok: false,
      code: 'EXECUTION_KIND_MISMATCH',
    });
    expect(system.invoke({ operationId: 'test:act', target: { kind: 'world' } })).toMatchObject({
      ok: false,
      code: 'EXECUTION_KIND_MISMATCH',
    });
    expect(system.invoke({ operationId: 'test:tick-op', target: { kind: 'entity', entityId: 'alice' } })).toMatchObject(
      { ok: false },
    );
    expect(() =>
      world.runtime.bind({
        kind: 'system',
        moduleId: 'test:clock',
        principalId: 'scheduler',
        systemId: 'test:unknown',
      }),
    ).toThrow();
    expect(world.state().commits).toBe(0);
  });
  it('invalidates real manager system bindings on restore-generation changes and disposal without any actor', () => {
    const world = setup();
    const port = { read: () => ({ revision: 0, value: null }), commit: () => ({ ok: true as const, revision: 0 }) };
    const manager = new GameplayModuleRuntime({
      composition: world.composition,
      entities: new EntityStore(),
      clone: structuredClone,
      inventory: port,
      mode: port,
      ruleset: port,
      needs: port,
    });
    const source = { kind: 'system' as const, moduleId: 'test:clock', principalId: 'scheduler', systemId: 'test:tick' };
    const binding = manager.bindSystem(world.authorizer, source);
    const request = { operationId: 'test:tick-op', target: { kind: 'world' as const } };
    expect(binding.invoke(request)).toMatchObject({ ok: true });
    manager.clearBindings();
    expect(binding.invoke(request)).toMatchObject({ ok: false, code: 'SYSTEM_REFERENCE_STALE' });
    const fresh = manager.bindSystem(world.authorizer, source);
    expect(fresh.invoke(request)).toMatchObject({ ok: true });
    manager.dispose();
    expect(fresh.invoke(request)).toMatchObject({ ok: false });
  });
  it('does not reinterpret an admin or scheduler principal as the other execution kind', () => {
    const world = setup();
    expect(() =>
      world.runtime.bind({
        kind: 'system',
        moduleId: 'test:clock',
        principalId: 'unbound-admin',
        systemId: 'test:tick',
      }),
    ).toThrow();
    expect(() =>
      world.runtime.bind({ kind: 'actor', moduleId: 'test:clock', principalId: 'scheduler', originalActorId: 'alice' }),
    ).toThrow();
    expect(() => setup(false)).toThrow();
  });
});
