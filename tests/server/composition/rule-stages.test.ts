import { describe, expect, it } from 'vitest';
import { definePack, type ModModule, type ModRuleDefinition } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/game-core/server/composition/host-api';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import type { CommittedOperationFact } from '../../../packages/game-core/src/server/composition/operation-contracts';

function setup(options: { beforeVeto?: boolean; afterVeto?: boolean; stage?: string; inverseOrder?: boolean } = {}) {
  let health = 20,
    commits = 0;
  const order: string[] = [];
  const facts: CommittedOperationFact[] = [];
  const address = { componentId: 'test:health', target: { kind: 'entity' as const, entityId: 'alice' } };
  const module: ModModule = {
    descriptor: {
      id: 'test:health-module',
      version: '1.0.0',
      resources: [{ id: 'test.health', operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: 'test.health', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.registerState({
        id: 'test:health',
        version: '1.0.0',
        resource: 'test.health',
        validate: (value) => typeof value === 'number' && value >= 0,
      });
      api.registerOperation({
        id: 'test:damage',
        resource: 'test.health',
        run(_context, input, state) {
          order.push('operation');
          if (!input || typeof input !== 'object' || !('amount' in input) || typeof input.amount !== 'number')
            throw new TypeError('Expected damage amount.');
          expect(Object.isFrozen(input)).toBe(true);
          const previous = state.read(address);
          if (typeof previous !== 'number') throw new TypeError('Expected health.');
          state.write(address, previous - input.amount);
          return previous - input.amount;
        },
      });
      api.registerRule({
        id: 'test:reduce',
        operationId: 'test:damage',
        stage: options.stage ?? 'before',
        ...(options.inverseOrder ? { after: ['test:after'] } : {}),
        apply(_context, input) {
          order.push('before');
          if (options.beforeVeto) return { reject: 'before veto' };
          expect(Object.isFrozen(input)).toBe(true);
          return { input: { amount: 2 } };
        },
      } as ModRuleDefinition);
      api.registerRule({
        id: 'test:after',
        operationId: 'test:damage',
        stage: 'after',
        apply(_context, input, state) {
          order.push('after');
          expect(input).toEqual({ amount: 2 });
          expect(state.read(address)).toBe(18);
          if (options.afterVeto) return { reject: 'after veto' };
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
      rules: [{ effect: 'allow', resources: ['test.health'], operations: ['read', 'write', 'execute'], scope: 'self' }],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({
    composition,
    authorizer,
    clone: structuredClone,
    state: {
      read: () => ({ revision: commits, value: health }),
      commit: (_observed, writes) => {
        const next = writes[0]?.value;
        if (typeof next !== 'number') throw new TypeError('Expected candidate health.');
        health = next;
        commits++;
        return { ok: true, revision: commits };
      },
    },
  });
  const binding = runtime.bind({ moduleId: 'test:health-module', principalId: 'human', originalActorId: 'alice' });
  binding.subscribe((fact) => facts.push(fact));
  return {
    composition,
    invoke: () => binding.invoke({ operationId: 'test:damage', target: address.target, input: { amount: 8 } }),
    state: () => ({ health, commits, order, facts }),
  };
}

describe('explicit rule stages', () => {
  it('runs before input transformation, operation, then after validation and publishes both inputs', () => {
    const world = setup();
    expect(world.invoke()).toMatchObject({ ok: true, value: 18 });
    expect(world.state()).toMatchObject({ health: 18, commits: 1, order: ['before', 'operation', 'after'] });
    expect(world.state().facts).toHaveLength(1);
    expect(world.state().facts[0]).toMatchObject({ input: { amount: 8 }, effectiveInput: { amount: 2 } });
    expect(Object.isFrozen(world.state().facts[0].effectiveInput)).toBe(true);
    expect(world.composition.definitionMap.rules).toEqual([
      { id: 'test:reduce', operationId: 'test:damage', moduleId: 'test:health-module', stage: 'before' },
      { id: 'test:after', operationId: 'test:damage', moduleId: 'test:health-module', stage: 'after' },
    ]);
  });
  it('before veto avoids running the operation, and after veto discards all candidates', () => {
    const before = setup({ beforeVeto: true });
    expect(before.invoke()).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
    expect(before.state()).toEqual({ health: 20, commits: 0, order: ['before'], facts: [] });
    const after = setup({ afterVeto: true });
    expect(after.invoke()).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
    expect(after.state()).toEqual({ health: 20, commits: 0, order: ['before', 'operation', 'after'], facts: [] });
  });
  it('rejects unknown stages and dependencies that contradict the stage boundary', () => {
    expect(() => setup({ stage: 'during' })).toThrow();
    expect(() => setup({ inverseOrder: true })).toThrow();
  });
});
