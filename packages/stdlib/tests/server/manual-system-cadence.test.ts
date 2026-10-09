import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import type { ModSystemDefinition } from '../../src/server/composition/lifecycle-contracts';
import type { ModModule } from '../../src/server/composition/contracts';
import { createModuleLifecycle } from '../../src/server/composition/module-lifecycle';
import { cloneCompositionCheckpointIdentity } from '../../src/server/composition/checkpoint-identity';
import { createRegisteredOperationRuntime } from '../../src/server/composition/registered-operations';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';

const moduleId = 'sample:cadence';
const resource = 'sample.cadence-state';
const component = 'sample:cadence-state';
const systems: readonly ModSystemDefinition[] = [
  { id: 'sample:manual', operationId: 'sample:manual-op', cadence: 'manual' },
  { id: 'sample:interval', operationId: 'sample:interval-op', intervalSeconds: 0.5 },
  { id: 'sample:every-advance', operationId: 'sample:every-op', cadence: 'every-advance' },
] as const;

const makeSystemModule = (definitions: readonly ModSystemDefinition[] = systems): ModModule => ({
  descriptor: {
    id: moduleId,
    version: '1.0.0',
    resources: [{ id: resource, operations: ['read', 'write', 'execute'] }],
    permissions: [{ resource, operations: ['read', 'write', 'execute'] }],
  },
  register(api) {
    api.registerState({
      id: component,
      version: '1.0.0',
      resource,
      validate: (value) =>
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Number.isSafeInteger((value as Readonly<Record<string, unknown>>).count),
    });
    for (const definition of definitions) {
      const operationId = definition.operationId;
      api.registerOperation({
        id: operationId,
        executionKind: 'system',
        resource,
        run(_context, _input, state) {
          const address = { componentId: component, target: { kind: 'world' as const } };
          const value = state.read(address) as { count: number };
          state.write(address, { count: value.count + 1 });
          return { count: value.count + 1 };
        },
      });
      api.registerSystem(definition);
    }
  },
});

const assemble = (definitions?: readonly ModSystemDefinition[]) => {
  const pack = definePack({
    id: 'sample:cadence-pack',
    version: '1.0.0',
    kind: 'playbook',
    modules: [makeSystemModule(definitions)],
  });
  const artifact = {
    ...pack,
    integrity: {
      algorithm: 'sha256' as const,
      manifestDigest: 'a'.repeat(64),
      entryDigest: 'b'.repeat(64),
      resources: [],
    },
  };
  const approvedPermissions = {
    'sample:cadence-pack': [{ resource, operations: ['read', 'write', 'execute'] as const }],
  };
  return assembleWorldPacks([artifact], { approvedPermissions });
};

const clone = <Value>(value: Value): Value => structuredClone(value);

function createRuntime(composition: ReturnType<typeof assemble>, approved: boolean) {
  const principalId = approved ? 'cadence-host' : 'unapproved-host';
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: principalId, kind: 'system', subject: `sample:${principalId}` }],
      rules: approved
        ? [
            {
              effect: 'allow',
              principal: { ids: [principalId] },
              resources: [resource],
              operations: ['read', 'write', 'execute'],
              scope: 'any',
            },
          ]
        : [],
    },
    composition.resources,
  );
  let count = 0;
  let revision = 0;
  const runtime = createRegisteredOperationRuntime({
    composition,
    authorizer,
    clone,
    state: {
      read(address) {
        if (address.componentId !== component) throw new Error('Unexpected component read.');
        return { revision, value: { count } };
      },
      commit(observed, writes) {
        if (observed.some((entry) => entry.revision !== revision)) return { ok: false, reason: 'stale' };
        for (const write of writes) {
          if (write.address.componentId !== component) return { ok: false, reason: 'wrong component' };
          count = (write.value as { count: number }).count;
        }
        revision += 1;
        return { ok: true, revision };
      },
    },
  });
  const bindings = new Map(
    composition.registrations.systems.map(({ moduleId: owner, definition }) => [
      definition.id,
      runtime.bind({ kind: 'system', moduleId: owner, principalId, systemId: definition.id }),
    ]),
  );
  return {
    bindings,
    invoke(module: string, request: Parameters<ReturnType<typeof runtime.bind>['invoke']>[0], systemId: string) {
      const binding = bindings.get(systemId);
      if (!binding || module !== moduleId) throw new Error(`Unexpected scheduled system: ${systemId}`);
      return binding.invoke(request);
    },
    snapshot: () => ({ count, revision }),
  };
}

describe('registered manual system cadence', () => {
  it('assembles a real manual system definition', () => {
    const composition = assemble();
    expect(composition.registrations.systems.map(({ definition }) => definition.cadence)).toEqual([
      'every-advance',
      'interval',
      'manual',
    ]);
  });

  it('runs only through its explicitly authorized registered system binding', () => {
    const composition = assemble();
    const runtime = createRuntime(composition, true);
    const binding = runtime.bindings.get('sample:manual')!;
    expect(binding.invoke({ operationId: 'sample:manual-op', target: { kind: 'world' } }).ok).toBe(true);
    expect(runtime.snapshot()).toEqual({ count: 1, revision: 1 });

    const denied = createRuntime(composition, false).bindings.get('sample:manual')!;
    expect(denied.invoke({ operationId: 'sample:manual-op', target: { kind: 'world' } })).toMatchObject({
      ok: false,
      code: 'WORLD_PERMISSION_DENIED',
    });
  });

  it('never runs from advance or preview and snapshots manual remainder as zero', () => {
    const composition = assemble();
    const runtime = createRuntime(composition, true);
    const lifecycle = createModuleLifecycle({ composition, invoke: runtime.invoke });
    lifecycle.activateFresh();
    expect(lifecycle.previewAdvanceOperationCount(1, 1)).toBe(3);
    lifecycle.advance(1);
    expect(runtime.snapshot().count).toBe(3);
    expect(lifecycle.snapshot()).toEqual({
      version: 1,
      time: 1,
      systems: [
        { id: 'sample:every-advance', remainder: 0 },
        { id: 'sample:interval', remainder: 0 },
        { id: 'sample:manual', remainder: 0 },
      ],
    });
    const invalidRestore = {
      version: 1 as const,
      time: 1,
      systems: [
        { id: 'sample:every-advance', remainder: 0 },
        { id: 'sample:interval', remainder: 0 },
        { id: 'sample:manual', remainder: 0.25 },
      ],
    };
    expect(() => lifecycle.validate(invalidRestore)).toThrow();
    const fresh = createModuleLifecycle({ composition, invoke: runtime.invoke });
    expect(() => fresh.resume(invalidRestore)).toThrow();
    expect(runtime.snapshot()).toEqual({ count: 3, revision: 3 });
  });

  it('rejects interval fields and dependency edges on manual systems', () => {
    const invalidInterval = { ...systems[0], intervalSeconds: 1 } as unknown as ModSystemDefinition;
    expect(() => assemble([invalidInterval])).toThrow();
    expect(() => assemble([{ ...systems[0], after: ['sample:interval'] }])).toThrow();
    expect(() => assemble([{ ...systems[0], after: ['sample:interval'] }, systems[1]])).toThrow();
    expect(() => assemble([{ ...systems[0], before: ['sample:interval'] }, systems[1]])).toThrow();
    expect(() => assemble([systems[0], { ...systems[1], after: ['sample:manual'] }])).toThrow();
    expect(() => assemble([systems[0], { ...systems[1], before: ['sample:manual'] }])).toThrow();
  });

  it('round-trips canonical manual identity and rejects serialized schedule fields', () => {
    const composition = assemble();
    const identity = {
      version: 1 as const,
      playbookId: composition.playbookId,
      packLock: composition.packLock,
      definitionMap: composition.definitionMap,
    };
    expect(cloneCompositionCheckpointIdentity(identity).definitionMap.systems).toEqual(
      composition.definitionMap.systems,
    );
    for (const invalid of [{ intervalSeconds: 1 }, { after: ['sample:interval'] }, { before: ['sample:interval'] }]) {
      const malformed = structuredClone(identity);
      const manual = malformed.definitionMap.systems.find(({ definition }) => definition.id === 'sample:manual')!;
      Object.assign(manual.definition, invalid);
      expect(() => cloneCompositionCheckpointIdentity(malformed)).toThrow();
    }
  });

  it('can advance a large manual-only schedule without synthetic catch-up calls', () => {
    const composition = assemble([systems[0]]);
    const runtime = createRuntime(composition, true);
    const lifecycle = createModuleLifecycle({ composition, invoke: runtime.invoke });
    lifecycle.activateFresh();
    expect(lifecycle.previewAdvanceOperationCount(1_000_000, 10_000)).toBe(0);
    lifecycle.advance(1_000_000);
    expect(runtime.snapshot()).toEqual({ count: 0, revision: 0 });
    expect(lifecycle.snapshot()).toEqual({
      version: 1,
      time: 1_000_000,
      systems: [{ id: 'sample:manual', remainder: 0 }],
    });
  });
});
