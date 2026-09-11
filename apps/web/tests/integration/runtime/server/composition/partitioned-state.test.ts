import { describe, expect, it } from 'vitest';
import { definePack, type ModModule, type ModStateAddress } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/stdlib/host';
import { WorldResourceAuthorizer } from '../../../../../../../packages/stdlib/src/server/harness/world-authorization';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

function setup(partitions: number | null = 2, addressOverride?: ModStateAddress, original = false) {
  let reads = 0;
  const module: ModModule = {
    descriptor: {
      id: 'test:partition-module',
      version: '1.0.0',
      resources: [{ id: 'test.partition', operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: 'test.partition', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerState({
        id: 'test:partition',
        version: '1.0.0',
        resource: 'test.partition',
        partitions: partitions ?? undefined,
        validate: (value) => typeof value === 'number',
      });
      api.registerOperation({
        id: 'test:read-parts',
        resource: 'test.partition',
        run(_context, _input, state) {
          if (addressOverride) return state.read(addressOverride);
          if (original) {
            const address = { componentId: 'test:partition', target: { kind: 'world' as const }, partition: 0 };
            state.write(address, 20);
            return { before: state.readOriginal(address), after: state.read(address) };
          }
          return [0, 1].map((partition) =>
            state.read({ componentId: 'test:partition', target: { kind: 'world' }, partition }),
          );
        },
      });
    },
  };
  const pack = definePack({ id: 'test:pack', version: '1.0.0', kind: 'playbook', modules: [module] });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:pack': module.descriptor.permissions! } },
  );
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: [
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: ['test.partition'],
          operations: ['read', 'write', 'execute'],
          scope: 'any',
        },
      ],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({
    composition,
    authorizer,
    clone: testCorePlatform.clone,
    state: {
      read(address) {
        reads++;
        return { revision: 0, value: address.partition ?? -1 };
      },
      commit: () => ({ ok: true, revision: 0 }),
    },
  }).bind({ moduleId: 'test:partition-module', principalId: 'human', originalActorId: 'alice' });
  return {
    composition,
    invoke: () => runtime.invoke({ operationId: 'test:read-parts', target: { kind: 'world' } }),
    reads: () => reads,
  };
}

describe('registered world state partitions', () => {
  it('preserves distinct world addresses and includes partition capacity in composition identity', () => {
    const test = setup();
    expect(test.invoke()).toMatchObject({ ok: true, value: [0, 1] });
    expect(test.reads()).toBe(2);
    expect(test.composition.definitionMap).not.toEqual(setup(3).composition.definitionMap);
  });
  it('keeps original observations available for after-rule validation', () => {
    expect(setup(2, undefined, true).invoke()).toMatchObject({ ok: true, value: { before: 0, after: 20 } });
  });
  it('rejects invalid partition addresses before host read', () => {
    for (const partition of [undefined, -1, 0.5, 2, Number.NaN]) {
      const test = setup(2, { componentId: 'test:partition', target: { kind: 'world' }, partition });
      expect(test.invoke()).toMatchObject({ ok: false, code: 'STATE_PARTITION_INVALID' });
      expect(test.reads()).toBe(0);
    }
    const undeclared = setup(null, { componentId: 'test:partition', target: { kind: 'world' }, partition: 0 });
    expect(undeclared.invoke()).toMatchObject({ ok: false, code: 'STATE_PARTITION_INVALID' });
    expect(undeclared.reads()).toBe(0);
    const entity = setup(2, {
      componentId: 'test:partition',
      target: { kind: 'entity', entityId: 'alice' },
      partition: 0,
    });
    expect(entity.invoke()).toMatchObject({ ok: false, code: 'STATE_PARTITION_INVALID' });
    expect(entity.reads()).toBe(0);
  });
});
